import { describe, expect, it } from 'vitest';
import { COMBO_PRICE_CENTS, formatMxn, formatMxnCurrency, parsePesosToCents } from './money';
import { runNightClosingForBranch } from './reconciliation';
import {
  advanceEncargoStage,
  buildDailyRevenueTrend,
  canDeliverOrder,
  captureEncargoPayment,
  closeShift,
  confirmPaymentLine,
  createInitialState,
  createOrder,
  deliverEncargoOrder,
  emitTicket,
  getBranchCatalog,
  getBranchDisplayName,
  getGlobalAdminTotals,
  getOpenShift,
  getOrderPaymentLines,
  getOrderPendingCents,
  getShiftMetrics,
  openNewShift,
  updateBranchSettings,
} from './rules';

function unwrap<T>(res: { ok: true; state: ReturnType<typeof createInitialState>; data: T } | { ok: false; error: string }) {
  if (!res.ok) throw new Error(`Expected ok=true, got error: ${res.error}`);
  return res;
}

describe('HOREB 360 · Reglas de dinero y operación', () => {
  it('maneja centavos enteros MXN sin flotantes', () => {
    expect(COMBO_PRICE_CENTS).toBe(7000);
    expect(formatMxn(7000)).toBe('$70.00');
    expect(formatMxn(35000)).toBe('$350.00');
    expect(parsePesosToCents('70')).toBe(7000);
    expect(parsePesosToCents('30.50')).toBe(3050);
    expect(parsePesosToCents('-10')).toBeNull();
  });

  it('rechaza un reparto de $69 para una venta de $70 y acepta el reparto exacto', () => {
    const state = createInitialState('2026-11-17T10:00:00Z');

    const rejected = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'autoservicio',
      folio: 'LOM-0099',
      paymentLines: [
        { method: 'efectivo', amountCents: 3000 },
        { method: 'tarjeta', amountCents: 3900, confirmImmediately: true },
      ],
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error).toContain('$69.00');
      expect(rejected.error).toContain('$70.00');
    }

    const accepted = unwrap(
      createOrder(state, {
        branchId: 'lomas',
        serviceType: 'autoservicio',
        folio: 'LOM-0099',
        paymentLines: [
          { method: 'efectivo', amountCents: 3000 },
          { method: 'tarjeta', amountCents: 4000, confirmImmediately: true },
        ],
      }),
    );
    expect(accepted.state.orders).toHaveLength(1);
    expect(accepted.data.folio).toBe('LOM-0099');
    expect(accepted.data.totalCents).toBe(7000);
    const duplicateTender = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'autoservicio',
      paymentLines: [
        { method: 'efectivo', amountCents: 3000 },
        { method: 'efectivo', amountCents: 4000 },
      ],
    });
    expect(duplicateTender.ok).toBe(false);
  });

  it('Treviño: $30 efectivo + $40 transferencia pendiente, corte, turno nuevo, confirmación posterior, ticket y entrega', () => {
    let state = createInitialState('2026-11-17T09:00:00Z');
    const shift1 = getOpenShift(state, 'trevino')!;

    // Recibir el encargo antes de cobrar y usar el mismo folio en la recogida.
    const created = unwrap(
      createOrder(state, {
        branchId: 'trevino',
        serviceType: 'encargo',
        folio: 'TRE-0001',
        customerAlias: 'Cliente Demo Treviño',
        paymentLines: [],
      }),
    );
    state = created.state;
    const orderId = created.data.id;
    expect(getOrderPendingCents(state, orderId)).toBe(7000);
    expect(getShiftMetrics(state, shift1.id).pendingBalanceCents).toBe(7000);
    expect(getOrderPaymentLines(state, orderId)).toHaveLength(0);
    expect(emitTicket(state, orderId).ok).toBe(false);
    state = unwrap(advanceEncargoStage(state, orderId)).state;
    state = unwrap(advanceEncargoStage(state, orderId)).state;
    state = unwrap(advanceEncargoStage(state, orderId)).state;

    const payment = [
      { method: 'efectivo', amountCents: 3000 },
      { method: 'transferencia', amountCents: 4000 },
    ] as const;
    state = unwrap(captureEncargoPayment(state, orderId, [...payment])).state;
    expect(captureEncargoPayment(state, orderId, [...payment]).ok).toBe(false);
    expect(emitTicket(state, orderId).ok).toBe(false);

    // El corte en vivo de turno 1 muestra $30 en efectivo y $40 de saldo pendiente
    const m1 = getShiftMetrics(state, shift1.id);
    expect(m1.expectedCashCents).toBe(3000);
    expect(m1.confirmedTransferCents).toBe(0);
    expect(m1.pendingBalanceCents).toBe(4000);

    // 2. Cerrar turno 1 con $30 contado y abrir turno 2
    state = unwrap(closeShift(state, 'trevino', 3000)).state;
    const opened2 = unwrap(openNewShift(state, 'trevino'));
    state = opened2.state;
    const shift2 = opened2.data;
    expect(shift2.number).toBe(2);

    // 3. Confirmar los $40 de transferencia en el turno nuevo
    const lines = getOrderPaymentLines(state, orderId);
    const pendingTransfer = lines.find((l) => l.method === 'transferencia')!;
    state = unwrap(confirmPaymentLine(state, pendingTransfer.id)).state;

    // El corte anterior (turno 1) se conserva intacto
    const closedShift1 = state.shifts.find((s) => s.id === shift1.id)!;
    expect(closedShift1.closingSummary?.expectedCashCents).toBe(3000);
    expect(closedShift1.closingSummary?.confirmedTransferCents).toBe(0);
    expect(closedShift1.closingSummary?.pendingBalanceCents).toBe(4000);

    // La confirmación cae en el turno 2
    const m2 = getShiftMetrics(state, shift2.id);
    expect(m2.confirmedTransferCents).toBe(4000);
    expect(m2.expectedCashCents).toBe(0);
    expect(m2.pendingBalanceCents).toBe(0);

    // El folio original se conserva
    expect(state.orders.find((o) => o.id === orderId)?.folio).toBe('TRE-0001');

    // La orden ya está lista y aún requiere un ticket emitido.
    expect(canDeliverOrder(state, orderId).allowed).toBe(false);

    // 5. Emitir ticket y entregar
    state = unwrap(emitTicket(state, orderId)).state;
    expect(canDeliverOrder(state, orderId).allowed).toBe(true);
    const delivered = unwrap(deliverEncargoOrder(state, orderId));
    expect(delivered.data.encargoStage).toBe('entregado');
  });

  it('simula falla de ticket después de pagar y reemite bajo el mismo folio sin duplicar venta ni ingresos', () => {
    let state = createInitialState();
    const shift = getOpenShift(state, 'lomas')!;

    const created = unwrap(
      createOrder(state, {
        branchId: 'lomas',
        serviceType: 'autoservicio',
        folio: 'LOM-0055',
        paymentLines: [{ method: 'efectivo', amountCents: 7000 }],
      }),
    );
    state = created.state;
    const orderId = created.data.id;

    // Simular falla de ticket
    const failed = unwrap(emitTicket(state, orderId, { simulateFailure: true }));
    state = failed.state;
    expect(failed.data.status).toBe('fallo');
    expect(failed.data.attempts).toBe(1);

    // Reemitir el mismo ticket
    const retried = unwrap(emitTicket(state, orderId, { simulateFailure: false }));
    state = retried.state;
    expect(retried.data.status).toBe('emitido');
    expect(retried.data.folio).toBe('LOM-0055');
    expect(retried.data.attempts).toBe(2);

    // No se duplicó la venta ni el ingreso
    expect(state.orders).toHaveLength(1);
    expect(state.paymentLines).toHaveLength(1);
    expect(getShiftMetrics(state, shift.id).expectedCashCents).toBe(7000);
  });

  it('cinco casos del plan de Carlos: total $350 ($120 efectivo, $100 tarjeta, $130 transferencia) y $140 / $70 / $140', () => {
    let state = createInitialState();

    // Lomas: $70 efectivo y $70 tarjeta
    state = unwrap(
      createOrder(state, {
        branchId: 'lomas',
        serviceType: 'autoservicio',
        paymentLines: [{ method: 'efectivo', amountCents: 7000 }],
      }),
    ).state;
    state = unwrap(
      createOrder(state, {
        branchId: 'lomas',
        serviceType: 'autoservicio',
        paymentLines: [{ method: 'tarjeta', amountCents: 7000, confirmImmediately: true }],
      }),
    ).state;

    // Treviño: $30 efectivo + $40 transferencia
    state = unwrap(
      createOrder(state, {
        branchId: 'trevino',
        serviceType: 'encargo',
        customerAlias: 'Encargo Treviño',
        paymentLines: [
          { method: 'efectivo', amountCents: 3000 },
          { method: 'transferencia', amountCents: 4000, confirmImmediately: true },
        ],
      }),
    ).state;

    // Sucursal 3: $20 efectivo + $30 tarjeta + $20 transferencia, y otra venta de $70 transferencia
    state = unwrap(
      createOrder(state, {
        branchId: 'sucursal-3',
        serviceType: 'autoservicio',
        paymentLines: [
          { method: 'efectivo', amountCents: 2000 },
          { method: 'tarjeta', amountCents: 3000, confirmImmediately: true },
          { method: 'transferencia', amountCents: 2000, confirmImmediately: true },
        ],
      }),
    ).state;
    state = unwrap(
      createOrder(state, {
        branchId: 'sucursal-3',
        serviceType: 'autoservicio',
        paymentLines: [{ method: 'transferencia', amountCents: 7000, confirmImmediately: true }],
      }),
    ).state;

    const admin = getGlobalAdminTotals(state);
    expect(admin.totals.totalConfirmedCents).toBe(35000);
    expect(admin.totals.cashCents).toBe(12000);
    expect(admin.totals.cardCents).toBe(10000);
    expect(admin.totals.transferCents).toBe(13000);
    expect(admin.totals.pendingCents).toBe(0);

    const lomas = admin.byBranch.find((b) => b.branch.id === 'lomas')!;
    const trevino = admin.byBranch.find((b) => b.branch.id === 'trevino')!;
    const s3 = admin.byBranch.find((b) => b.branch.id === 'sucursal-3')!;
    expect(lomas.totalConfirmedCents).toBe(14000);
    expect(trevino.totalConfirmedCents).toBe(7000);
    expect(s3.totalConfirmedCents).toBe(14000);

    const withPendingTransfer = getGlobalAdminTotals({
      ...state,
      paymentLines: state.paymentLines.map((line) =>
        line.method === 'transferencia' ? { ...line, status: 'pendiente' } : line,
      ),
    });
    expect(withPendingTransfer.totals).toMatchObject({
      transferCents: 0,
      totalConfirmedCents: 22000,
      pendingCents: 13000,
    });
  });

  it('permite anticipo parcial en encargo, cobro de saldo posterior sin colisión y formato MXN', () => {
    expect(formatMxnCurrency(12500)).toBe('$125.00 MXN');

    let state = createInitialState('2026-11-18T10:00:00Z');
    const created = unwrap(
      createOrder(state, {
        branchId: 'lomas',
        serviceType: 'encargo',
        customerAlias: 'Patricia Anticipo',
        items: [{ itemId: 'combo', quantity: 2 }], // $140
        allowPartialPayment: true,
        weightKg: 8.5,
        promisedDeliveryAt: '2026-11-18T18:00:00Z',
        notes: 'Sin suavizante',
        paymentLines: [{ method: 'efectivo', amountCents: 5000 }],
        now: '2026-11-18T10:05:00Z',
      }),
    );
    state = created.state;
    expect(created.data.totalCents).toBe(14000);
    expect(created.data.weightKg).toBe(8.5);
    expect(created.data.notes).toBe('Sin suavizante');
    expect(getOrderPendingCents(state, created.data.id)).toBe(9000);

    // Cobrar el saldo restante ($90) en dos exhibiciones / tarjeta para verificar IDs sin colisión
    const balance = unwrap(
      captureEncargoPayment(
        state,
        created.data.id,
        [{ method: 'tarjeta', amountCents: 9000, confirmImmediately: true }],
        'Caja',
        '2026-11-18T17:50:00Z',
      ),
    );
    state = balance.state;
    expect(getOrderPendingCents(state, created.data.id)).toBe(0);
    const lines = getOrderPaymentLines(state, created.data.id);
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((l) => l.id)).size).toBe(2);
  });

  it('permite agregar producto nuevo al catálogo, renombrar sucursal y registrar bitácora de auditoría', () => {
    let state = createInitialState('2026-11-18T10:00:00Z');
    expect(getBranchDisplayName(state, 'sucursal-3')).toBe('Sucursal 3 (por confirmar)');

    const existingCatalog = getBranchCatalog(state, 'sucursal-3');
    const updated = unwrap(
      updateBranchSettings(
        state,
        'sucursal-3',
        {
          branchDisplayName: 'Sucursal Norte',
          branchAddress: 'Av. Constitución #240',
          catalog: [
            ...existingCatalog,
            {
              id: 'edredon-king',
              name: 'Edredón King Size',
              priceCents: 18500,
              requiresMachine: true,
              loyaltyCredits: 1,
              active: true,
            },
          ],
        },
        'carlos@horeb.mx',
        '2026-11-18T10:30:00Z',
      ),
    );
    state = updated.state;
    expect(getBranchDisplayName(state, 'sucursal-3')).toBe('Sucursal Norte');
    expect(getBranchCatalog(state, 'sucursal-3').some((c) => c.id === 'edredon-king')).toBe(true);
    expect((state.auditLogs ?? []).some((log) => log.branchId === 'sucursal-3')).toBe(true);
  });

  it('calcula tendencia anclada a actividad y delimita pendientes en cierre manual fuera de las 23:00', () => {
    let state = createInitialState('2026-11-10T10:00:00Z');
    // Turno #1 en Lomas tiene una transferencia pendiente antigua, luego cierra y se abre Turno #2
    state = unwrap(
      createOrder(state, {
        branchId: 'lomas',
        serviceType: 'encargo',
        customerAlias: 'Turno Previo',
        paymentLines: [{ method: 'transferencia', amountCents: 7000 }], // pendiente
        now: '2026-11-10T11:00:00Z',
      }),
    ).state;
    state = unwrap(closeShift(state, 'lomas', 0, '2026-11-10T14:00:00Z')).state;
    state = unwrap(openNewShift(state, 'lomas', '2026-11-10T14:05:00Z', 50000)).state;
    state = unwrap(
      createOrder(state, {
        branchId: 'lomas',
        serviceType: 'autoservicio',
        paymentLines: [{ method: 'efectivo', amountCents: 7000 }],
        now: '2026-11-10T16:00:00Z',
      }),
    ).state;

    const lomasOrderIds = new Set(state.orders.filter((o) => o.branchId === 'lomas').map((o) => o.id));
    const trend = buildDailyRevenueTrend(state, lomasOrderIds, 7, new Date('2026-11-26T12:00:00Z'));
    expect(trend.anchoredToHistory).toBe(true);
    expect(trend.periodTotalCents).toBe(7000);
    expect(trend.historicalTotalCents).toBe(7000);

    const closing = runNightClosingForBranch(state, 'lomas', {
      closingDate: '2026-11-10',
      enforce2300Rule: false,
      now: '2026-11-10T20:15:00-06:00',
      actorLabel: 'admin@horeb.mx',
    });
    expect(closing.ok).toBe(true);
    if (!closing.ok) return;
    expect(closing.data.reportText).toContain('CIERRE DE DÍA');
    expect(closing.data.reportText).not.toContain('NOCTURNO 23:00');
    // La transferencia pendiente de un turno previo ya cerrado no se arrastra al cierre del turno #2
    expect(closing.data.pendingTransferCents).toBe(0);
  });
});
