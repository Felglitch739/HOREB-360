import { describe, expect, it } from 'vitest';
import {
  confirmTransferBatch,
  matchBankTransfersCsv,
  runNightClosingForBranch,
} from './reconciliation';
import {
  closeShift,
  createInitialState,
  createOrder,
  getOpenShift,
  getOrderPaymentLines,
} from './rules';

describe('Bloque 4 · Cierre nocturno 23:00 y bandeja de transferencias / conciliación CSV', () => {
  it('cierra turno abierto a las 23:00 en fecha controlada, rechaza antes de 23:00 si aplica regla y no duplica al repetir', () => {
    let state = createInitialState('2026-11-18T10:00:00-06:00');
    const sale = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'autoservicio',
      items: [{ itemId: 'combo', quantity: 1 }],
      paymentLines: [{ method: 'efectivo', amountCents: 7000 }],
      now: '2026-11-18T12:00:00-06:00',
    });
    if (!sale.ok) throw new Error(sale.error);
    state = sale.state;

    // Regla 23:00 rechaza ejecución a las 21:00 hora local Monterrey
    const tooEarly = runNightClosingForBranch(state, 'lomas', {
      enforce2300Rule: true,
      now: '2026-11-18T21:00:00-06:00',
    });
    expect(tooEarly.ok).toBe(false);

    // Con hora 23:05 (-06:00), ejecuta cierre automático
    const first = runNightClosingForBranch(state, 'lomas', {
      enforce2300Rule: true,
      now: '2026-11-18T23:05:00-06:00',
      actorLabel: 'admin@horeb.mx',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.alreadyExecuted).toBe(false);
    expect(first.data.closingDate).toBe('2026-11-18');
    expect(first.data.wasAutoClosed).toBe(true);
    expect(first.data.expectedCashCents).toBe(7000);
    expect(first.data.reportText).toContain('Lomas');
    expect(getOpenShift(first.state, 'lomas')).toBeUndefined();

    // Repetir la ejecución para la misma sucursal y fecha NO duplica el corte
    const second = runNightClosingForBranch(first.state, 'lomas', {
      enforce2300Rule: true,
      closingDate: '2026-11-18',
      now: '2026-11-18T23:10:00-06:00',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyExecuted).toBe(true);
    expect(second.state.nightClosings).toHaveLength(1);

    // Si en otra sucursal el turno ya fue cerrado manualmente, genera el reporte sin re-cerrar
    const treClosed = closeShift(second.state, 'trevino', 0, '2026-11-18T20:00:00-06:00');
    if (!treClosed.ok) throw new Error(treClosed.error);
    const treNight = runNightClosingForBranch(treClosed.state, 'trevino', {
      closingDate: '2026-11-18',
      now: '2026-11-18T23:00:00-06:00',
    });
    expect(treNight.ok).toBe(true);
    if (treNight.ok) {
      expect(treNight.data.wasAutoClosed).toBe(false);
    }
  });

  it('concilia coincidencias exactas desde CSV ficticio y deja coincidencias ambiguas para confirmación manual', () => {
    let state = createInitialState('2026-11-18T10:00:00Z');

    // Folio LOM-0001: $70 transferencia pendiente (único $70)
    const o1 = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'encargo',
      customerAlias: 'Cliente Uno',
      paymentLines: [{ method: 'transferencia', amountCents: 7000, confirmImmediately: false }],
    });
    if (!o1.ok) throw new Error(o1.error);
    state = o1.state;

    // Folios LOM-0002 y LOM-0003: dos transferencias pendientes de $40 (ambiguas si no hay folio)
    const o2 = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'encargo',
      customerAlias: 'Cliente Dos',
      paymentLines: [
        { method: 'efectivo', amountCents: 3000 },
        { method: 'transferencia', amountCents: 4000, confirmImmediately: false },
      ],
    });
    if (!o2.ok) throw new Error(o2.error);
    state = o2.state;

    const o3 = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'encargo',
      customerAlias: 'Cliente Tres',
      paymentLines: [
        { method: 'efectivo', amountCents: 3000 },
        { method: 'transferencia', amountCents: 4000, confirmImmediately: false },
      ],
    });
    if (!o3.ok) throw new Error(o3.error);
    state = o3.state;

    const csv = [
      'fecha,referencia,importe,concepto',
      '2026-11-18,NU-1001,70.00,Pago LOM-0001',
      '2026-11-18,NU-1002,40.00,Abono sin folio',
      '2026-11-18,NU-1003,99.00,Otro abono no encontrado',
    ].join('\n');

    const matched = matchBankTransfersCsv(state, 'lomas', csv);
    expect(matched.ok).toBe(true);
    if (!matched.ok) return;

    expect(matched.rows[0].status).toBe('exact');
    expect(matched.rows[0].matchedFolio).toBe('LOM-0001');
    expect(matched.rows[1].status).toBe('ambiguous');
    expect([...matched.rows[1].candidateFolios].sort()).toEqual(['LOM-0002', 'LOM-0003']);
    expect(matched.rows[2].status).toBe('unmatched');

    // Solo confirmamos las exactas
    const exact = matched.rows.filter((r) => r.status === 'exact' && r.matchedLineId);
    const confirmed = confirmTransferBatch(
      state,
      exact.map((r) => ({ lineId: r.matchedLineId!, reference: r.referencia })),
      'felix_mf@horeb.mx',
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;

    expect(getOrderPaymentLines(confirmed.state, o1.data.id)[0].status).toBe('confirmado');
    // Las ambiguas LOM-0002 y LOM-0003 permanecen pendientes para revisión manual
    expect(getOrderPaymentLines(confirmed.state, o2.data.id).find((l) => l.method === 'transferencia')?.status).toBe('pendiente');
    expect(getOrderPaymentLines(confirmed.state, o3.data.id).find((l) => l.method === 'transferencia')?.status).toBe('pendiente');
  });
});
