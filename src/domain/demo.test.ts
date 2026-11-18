import { expect, it } from 'vitest';
import { createExampleState, hasPristineDemo } from './examples';
import { calculateTender, parsePesosToCents } from './money';
import { closeShift, createInitialState, createOrder, emitTicket, getBranchSettings, getShiftMetrics, openNewShift, recordCashMovement, suggestNextFolio, updateBranchSettings } from './rules';

it('respeta la coma decimal y los separadores de miles válidos', () => {
  expect(parsePesosToCents('30,50')).toBe(3050);
  expect(parsePesosToCents('1,200.50')).toBe(120050);
  expect(parsePesosToCents('1,2,00')).toBeNull();
});

it('salta un folio manual ocupado y completa autoservicio al emitir su ticket', () => {
  const sale = { branchId: 'lomas', serviceType: 'autoservicio', paymentLines: [{ method: 'efectivo', amountCents: 7000 }] } as const;
  const first = createOrder(createInitialState(), { ...sale, folio: 'LOM-0002', paymentLines: [...sale.paymentLines] });
  if (!first.ok) throw new Error(first.error);
  expect(suggestNextFolio(first.state, 'lomas')).toBe('LOM-0001');
  expect(first.data.orderStatus).toBe('en_proceso');
  const second = createOrder(first.state, { ...sale, paymentLines: [...sale.paymentLines] });
  if (!second.ok) throw new Error(second.error);
  expect(suggestNextFolio(second.state, 'lomas')).toBe('LOM-0003');
  const issued = emitTicket(second.state, first.data.id);
  if (!issued.ok) throw new Error(issued.error);
  expect(issued.state.orders.find((item) => item.id === first.data.id)?.orderStatus).toBe('completado');
});

it('incluye fondo, entrada y retiro en el corte sin contarlos como ventas', () => {
  const initial = closeShift(createInitialState(), 'lomas', 0);
  if (!initial.ok) throw new Error(initial.error);
  const opened = openNewShift(initial.state, 'lomas', undefined, 10000);
  if (!opened.ok) throw new Error(opened.error);
  const entry = recordCashMovement(opened.state, 'lomas', 'entrada', 2000, 'Cambio');
  if (!entry.ok) throw new Error(entry.error);
  const withdrawal = recordCashMovement(entry.state, 'lomas', 'retiro', 3500, 'Depósito');
  if (!withdrawal.ok) throw new Error(withdrawal.error);
  expect(recordCashMovement(withdrawal.state, 'lomas', 'retiro', 8501, 'Depósito').ok).toBe(false);
  expect(getShiftMetrics(withdrawal.state, opened.data.id)).toMatchObject({ expectedCashCents: 8500, totalConfirmedCents: 0 });
  const closed = closeShift(withdrawal.state, 'lomas', 8000);
  if (!closed.ok) throw new Error(closed.error);
  expect(closed.data.closingSummary).toMatchObject({ expectedCashCents: 8500, countedCashCents: 8000, differenceCents: -500 });
  expect(recordCashMovement(closed.state, 'lomas', 'entrada', 1000, 'Cambio').ok).toBe(false);
});

it('crea ejemplos en las tres sucursales con folios, pagos y turnos consistentes', () => {
  const state = createExampleState(new Date(2026, 10, 17, 20));
  expect(hasPristineDemo(createInitialState())).toBe(true);
  expect(hasPristineDemo(state)).toBe(false);
  const cashOnly = recordCashMovement(createInitialState(), 'lomas', 'entrada', 500, 'Cambio');
  if (!cashOnly.ok) throw new Error(cashOnly.error);
  expect(hasPristineDemo(cashOnly.state)).toBe(false);
  expect(new Set(state.orders.map((order) => order.branchId)).size).toBe(3);
  expect(new Set(state.orders.map((order) => order.folio)).size).toBe(state.orders.length);
  expect(state.orders.every((order) => state.tickets[order.id])).toBe(true);
  expect(state.paymentLines.every((line) => line.status !== 'confirmado' || state.shifts.some((shift) => shift.id === line.confirmedShiftId))).toBe(true);
  expect(state.shifts.find((shift) => shift.id === 'shift-lomas-1')?.closingSummary?.differenceCents).toBe(0);
});

it('calcula el cambio y registra solo lo aplicado, aunque se dejen métodos vacíos', () => {
  expect(calculateTender(7000, '30', '', '40')).toMatchObject({ ok: true, cashApplied: 3000, transfer: 4000, remaining: 0 });
  expect(calculateTender(7000, '69', '', '')).toMatchObject({ ok: true, remaining: 100 });
  expect(calculateTender(7000, '', '', '71').ok).toBe(false);
  expect(calculateTender(7000, 'foo', '', '').ok).toBe(false);
  const tender = calculateTender(7000, '100', '', '');
  if (!tender.ok) throw new Error(tender.error);
  expect(tender).toMatchObject({ cash: 10000, cashApplied: 7000, change: 3000 });

  const initial = createInitialState();
  const sale = createOrder(initial, {
    branchId: 'lomas',
    serviceType: 'autoservicio',
    paymentLines: [{ method: 'efectivo', amountCents: tender.cashApplied, cashReceivedCents: tender.cash }],
  });
  if (!sale.ok) throw new Error(sale.error);
  expect(sale.state.paymentLines[0]).toMatchObject({ amountCents: 7000, cashReceivedCents: 10000 });
  expect(getShiftMetrics(sale.state, 'shift-lomas-1').expectedCashCents).toBe(7000);
});

it('permite actualizar precio y datos del ticket por sucursal sin alterar órdenes previas', () => {
  const initial = createInitialState();
  const prevSale = createOrder(initial, {
    branchId: 'lomas',
    serviceType: 'autoservicio',
    paymentLines: [{ method: 'efectivo', amountCents: 7000 }],
  });
  if (!prevSale.ok) throw new Error(prevSale.error);

  const updated = updateBranchSettings(prevSale.state, 'lomas', {
    comboPriceCents: 8000,
    businessName: 'LAVANDERÍA HOREB LOMAS',
    defaultPaperWidth: '58mm',
  });
  if (!updated.ok) throw new Error(updated.error);
  expect(getBranchSettings(updated.state, 'lomas')).toMatchObject({
    comboPriceCents: 8000,
    businessName: 'LAVANDERÍA HOREB LOMAS',
    defaultPaperWidth: '58mm',
  });

  const nextSale = createOrder(updated.state, {
    branchId: 'lomas',
    serviceType: 'autoservicio',
    paymentLines: [{ method: 'efectivo', amountCents: 8000 }],
  });
  if (!nextSale.ok) throw new Error(nextSale.error);
  expect(nextSale.data.totalCents).toBe(8000);
  expect(nextSale.state.orders.find((o) => o.id === prevSale.data.id)?.totalCents).toBe(7000);
});
