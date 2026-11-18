import {
  advanceEncargoStage, closeShift, confirmPaymentLine, createInitialState, createOrder,
  deliverEncargoOrder, emitTicket, openNewShift,
} from './rules';
import type { BranchId, DemoState, PaymentMethod } from './types';

function time(base: Date, daysAgo: number, hour: number, minute = 0) {
  const date = new Date(base);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return (date > base ? base : date).toISOString();
}

export function hasPristineDemo(state: DemoState) {
  return state.orders.length === 0 && state.shifts.every((shift) =>
    shift.number === 1 && shift.status === 'abierto' && !shift.openingCashCents && !shift.cashMovements?.length,
  );
}

export function createExampleState(base = new Date()): DemoState {
  let state = createInitialState(time(base, 6, 8));
  const add = (branchId: BranchId, daysAgo: number, hour: number, method: PaymentMethod, quantity: number, alias?: string, stage = 0, pending = false) => {
    const now = time(base, daysAgo, hour);
    const order = createOrder(state, {
      branchId, now, serviceType: alias ? 'encargo' : 'autoservicio', customerAlias: alias, comboCount: quantity,
      paymentLines: pending && alias
        ? [{ method: 'efectivo', amountCents: 3000 }, { method: 'transferencia', amountCents: quantity * 7000 - 3000 }]
        : [{ method, amountCents: quantity * 7000 }],
    });
    if (!order.ok) throw new Error(order.error);
    state = order.state;
    const id = order.data.id;
    if (!pending) {
      const external = state.paymentLines.find((line) => line.orderId === id && line.status === 'pendiente');
      if (external) {
        const result = confirmPaymentLine(state, external.id, now);
        if (result.ok) state = result.state;
      }
      const ticket = emitTicket(state, id, { now });
      if (ticket.ok) state = ticket.state;
    }
    for (let step = 0; step < Math.min(stage, 3); step += 1) {
      const result = advanceEncargoStage(state, id);
      if (result.ok) state = result.state;
    }
    if (stage === 4) {
      const result = deliverEncargoOrder(state, id, now);
      if (result.ok) state = result.state;
    }
  };

  add('lomas', 6, 9, 'efectivo', 3);
  add('lomas', 5, 12, 'tarjeta', 5);
  add('lomas', 4, 10, 'transferencia', 4, 'Cliente Demo Iris', 4);
  add('lomas', 3, 13, 'efectivo', 8);
  add('lomas', 2, 15, 'tarjeta', 5);
  add('lomas', 1, 11, 'efectivo', 6);
  const closed = closeShift(state, 'lomas', 119000, time(base, 1, 19));
  if (closed.ok) {
    const next = openNewShift(closed.state, 'lomas', time(base, 0, 8));
    if (next.ok) state = next.state;
  }
  add('lomas', 0, 9, 'efectivo', 2, 'Cliente Demo Luz', 3, true);
  add('lomas', 0, 10, 'tarjeta', 3, 'Cliente Demo Mar', 2);
  add('lomas', 0, 11, 'efectivo', 1, 'Cliente Demo Sol', 1);
  add('lomas', 0, 12, 'transferencia', 2, 'Cliente Demo Nube', 0, true);
  add('lomas', 0, 13, 'efectivo', 2);
  add('trevino', 0, 10, 'tarjeta', 4, 'Cliente Demo Alba', 3);
  add('trevino', 0, 11, 'efectivo', 2, 'Cliente Demo Río', 2, true);
  add('sucursal-3', 0, 10, 'transferencia', 3);
  add('sucursal-3', 0, 12, 'efectivo', 2, 'Cliente Demo Luna', 3);
  return state;
}
