import { describe, expect, it } from 'vitest';
import { operate } from './operations';
import {
  createInitialState,
  createOrder,
  emitTicket,
  getBranchCatalog,
  getOpenShift,
  getOrderLineItems,
  getOrderPaymentLines,
  getShiftMetrics,
  openNewShift,
  closeShift,
  updateBranchSettings,
} from './rules';

describe('Bloque 1 · Cobro, catálogo, folios, pagos externos y reimpresión', () => {
  it('permite mezclar combo + edredón + detergente + bolsa y conserva precios si Supervisión los cambia después', () => {
    let state = createInitialState('2026-11-18T10:00:00Z');
    const catalog = getBranchCatalog(state, 'lomas');
    expect(catalog.map((c) => c.id)).toEqual(['combo', 'edredon', 'detergente', 'bolsa']);

    // 1 combo ($70) + 1 detergente ($20) + 1 bolsa ($35) = $125.00 MXN
    const created = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'autoservicio',
      items: [
        { itemId: 'combo', quantity: 1 },
        { itemId: 'detergente', quantity: 1 },
        { itemId: 'bolsa', quantity: 1 },
      ],
      paymentLines: [{ method: 'efectivo', amountCents: 12500, cashReceivedCents: 15000 }],
      now: '2026-11-18T10:05:00Z',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    state = created.state;

    expect(created.data.folio).toBe('LOM-0001');
    expect(created.data.totalCents).toBe(12500);
    expect(getOrderLineItems(created.data)).toHaveLength(3);

    // Supervisión cambia el precio del combo a $80 y detergente a $25
    const nextCatalog = getBranchCatalog(state, 'lomas').map((item) =>
      item.id === 'combo'
        ? { ...item, priceCents: 8000 }
        : item.id === 'detergente'
          ? { ...item, priceCents: 2500 }
          : item,
    );
    const updated = updateBranchSettings(state, 'lomas', { catalog: nextCatalog }, 'admin@horeb.mx');
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    state = updated.state;

    // La orden previa conserva sus precios congelados ($70 y $20)
    const oldOrder = state.orders.find((o) => o.folio === 'LOM-0001')!;
    expect(oldOrder.totalCents).toBe(12500);
    expect(getOrderLineItems(oldOrder).find((i) => i.itemId === 'combo')?.unitPriceCents).toBe(7000);
    expect(state.auditLogs?.length).toBeGreaterThanOrEqual(2);

    // Nueva orden sí toma los nuevos precios ($80 + $25 = $105)
    const second = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'autoservicio',
      items: [
        { itemId: 'combo', quantity: 1 },
        { itemId: 'detergente', quantity: 1 },
      ],
      paymentLines: [{ method: 'efectivo', amountCents: 10500 }],
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.data.folio).toBe('LOM-0002');
      expect(second.data.totalCents).toBe(10500);
    }
  });

  it('registra referencia, usuario y fecha al confirmar terminal o transferencia en otro turno sin alterar corte previo', () => {
    let state = createInitialState('2026-11-18T09:00:00Z');
    const shift1 = getOpenShift(state, 'trevino')!;

    const sale = operate(
      state,
      'trevino',
      {
        action: 'create',
        input: {
          serviceType: 'encargo',
          customerAlias: 'Carlos Pérez',
          items: [{ itemId: 'combo', quantity: 1 }],
          paymentLines: [
            { method: 'efectivo', amountCents: 3000 },
            { method: 'transferencia', amountCents: 4000, confirmImmediately: false },
          ],
        },
      },
      { role: 'operator', actorLabel: 'felix_mf@horeb.mx' },
    );
    expect(sale.ok).toBe(true);
    if (!sale.ok || !sale.order) return;
    state = sale.state;

    const pendingLine = getOrderPaymentLines(state, sale.order.id).find((l) => l.status === 'pendiente')!;
    state = (() => {
      const closed = closeShift(state, 'trevino', 3000, '2026-11-18T14:00:00Z');
      if (!closed.ok) throw new Error(closed.error);
      const opened = openNewShift(closed.state, 'trevino', '2026-11-18T14:05:00Z', 0);
      if (!opened.ok) throw new Error(opened.error);
      return opened.state;
    })();

    const confirmed = operate(
      state,
      'trevino',
      { action: 'confirm', lineId: pendingLine.id, reference: 'NU-99812' },
      { role: 'operator', actorLabel: 'felix_mf@horeb.mx' },
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    state = confirmed.state;

    const updatedLine = getOrderPaymentLines(state, sale.order.id).find((l) => l.id === pendingLine.id)!;
    expect(updatedLine.status).toBe('confirmado');
    expect(updatedLine.reference).toBe('NU-99812');
    expect(updatedLine.confirmedBy).toBe('felix_mf@horeb.mx');
    expect(updatedLine.confirmedAt).toBeTruthy();

    // El corte del turno 1 conserva sus $30 efectivo y $40 pendiente original
    const prevShift = state.shifts.find((s) => s.id === shift1.id)!;
    expect(prevShift.closingSummary?.expectedCashCents).toBe(3000);
    expect(prevShift.closingSummary?.confirmedTransferCents).toBe(0);
    expect(prevShift.closingSummary?.pendingBalanceCents).toBe(4000);

    // El turno 2 refleja los $40 confirmados
    const shift2 = getOpenShift(state, 'trevino')!;
    expect(getShiftMetrics(state, shift2.id).confirmedTransferCents).toBe(4000);
  });

  it('respeta permisos de reimpresión y conserva el pago cuando falla la impresión', () => {
    let state = createInitialState('2026-11-18T10:00:00Z');
    const created = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'autoservicio',
      items: [{ itemId: 'edredon', quantity: 1 }],
      paymentLines: [{ method: 'tarjeta', amountCents: 9500, confirmImmediately: true, reference: 'CLIP-101' }],
    });
    if (!created.ok) throw new Error(created.error);
    state = created.state;

    // Falla de impresora: pago confirmado no se pierde
    const failEmit = emitTicket(state, created.data.id, { simulateFailure: true });
    if (!failEmit.ok) throw new Error(failEmit.error);
    state = failEmit.state;
    expect(failEmit.data.status).toBe('fallo');
    expect(getOrderPaymentLines(state, created.data.id)[0].status).toBe('confirmado');

    // Reintentar emisión bajo mismo folio
    const okEmit = emitTicket(state, created.data.id, { simulateFailure: false });
    if (!okEmit.ok) throw new Error(okEmit.error);
    state = okEmit.state;
    expect(state.orders).toHaveLength(1);
    expect(okEmit.data.status).toBe('emitido');

    // Caja NO puede reimprimir si allowOperatorReprint es false
    const deniedReprint = operate(
      state,
      'lomas',
      { action: 'reprint', orderId: created.data.id },
      { role: 'operator', actorLabel: 'felix_mf@horeb.mx' },
    );
    expect(deniedReprint.ok).toBe(false);

    // Supervisión SÍ puede reimprimir sin duplicar la venta
    const allowedReprint = operate(
      state,
      'lomas',
      { action: 'reprint', orderId: created.data.id },
      { role: 'supervisor', actorLabel: 'admin@horeb.mx' },
    );
    expect(allowedReprint.ok).toBe(true);
    if (allowedReprint.ok) {
      expect(allowedReprint.state.orders).toHaveLength(1);
      expect(allowedReprint.state.tickets[created.data.id].reprintCount).toBe(1);
      expect(allowedReprint.state.tickets[created.data.id].lastReprintedBy).toBe('admin@horeb.mx');
    }
  });
});
