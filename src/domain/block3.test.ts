import { describe, expect, it } from 'vitest';
import { operate } from './operations';
import {
  advanceEncargoStage,
  createInitialState,
  createOrder,
  deliverEncargoOrder,
  emitTicket,
  evaluateOrderLoyalty,
  getCustomerOrders,
  getEligibleRaffleTickets,
  runManualRaffleDraw,
  upsertCustomer,
} from './rules';

describe('Bloque 3 · Clientes, lealtad (10 combos -> gratis -> boleto) e idempotencia', () => {
  it('mantiene cobro rápido sin ficha de cliente y guarda historial por folio para clientes con ficha', () => {
    let state = createInitialState('2026-11-18T09:00:00Z');

    // Cobro rápido sin ficha
    const quick = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'autoservicio',
      items: [{ itemId: 'combo', quantity: 1 }],
      paymentLines: [{ method: 'efectivo', amountCents: 7000 }],
    });
    expect(quick.ok).toBe(true);
    if (!quick.ok) return;
    state = quick.state;
    expect(quick.data.customerAlias).toBe('Autoservicio');

    // Alta de ficha con nombre, teléfono y consentimiento
    const cust = upsertCustomer(state, 'lomas', {
      name: 'Sofía Martínez',
      phone: '8681112233',
      contactConsent: true,
    });
    expect(cust.ok).toBe(true);
    if (!cust.ok) return;
    state = cust.state;

    const withCust = createOrder(state, {
      branchId: 'trevino',
      serviceType: 'autoservicio',
      customerId: cust.data.id,
      items: [{ itemId: 'combo', quantity: 2 }],
      paymentLines: [{ method: 'efectivo', amountCents: 14000 }],
    });
    expect(withCust.ok).toBe(true);
    if (!withCust.ok) return;
    state = withCust.state;

    const history = getCustomerOrders(state, cust.data.id);
    expect(history).toHaveLength(1);
    expect(history[0].folio).toBe('TRE-0001');
  });

  it('habilita 1 combo gratis al completar 10 combos pagados, emite 1 boleto al completar el combo gratis y evita duplicados', () => {
    let state = createInitialState('2026-11-18T10:00:00Z');
    const cust = upsertCustomer(state, 'lomas', {
      name: 'Andrea Morales',
      phone: '8685554433',
      contactConsent: true,
    });
    if (!cust.ok) throw new Error(cust.error);
    state = cust.state;
    const customerId = cust.data.id;

    // Venta de 10 combos pagados pero ticket aún NO emitido -> no suma progreso todavía
    const tenSale = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'autoservicio',
      customerId,
      items: [{ itemId: 'combo', quantity: 10 }],
      paymentLines: [{ method: 'efectivo', amountCents: 70000 }],
      now: '2026-11-18T10:10:00Z',
    });
    if (!tenSale.ok) throw new Error(tenSale.error);
    state = tenSale.state;
    expect(state.customers?.find((c) => c.id === customerId)?.freeCombosAvailable).toBe(0);

    // Emitir ticket -> completa autoservicio pagado -> habilita 1 combo gratis
    const emitted10 = emitTicket(state, tenSale.data.id, { now: '2026-11-18T10:15:00Z' });
    if (!emitted10.ok) throw new Error(emitted10.error);
    state = emitted10.state;

    const after10 = state.customers?.find((c) => c.id === customerId)!;
    expect(after10.combosTowardFree).toBe(0);
    expect(after10.freeCombosAvailable).toBe(1);
    expect(state.raffleTickets ?? []).toHaveLength(0); // Boleto aún NO hasta completar el combo gratis!

    // Reintentar emisión o evaluar lealtad de nuevo NO duplica el premio ni los combos
    const retriedEmit = emitTicket(state, tenSale.data.id, { now: '2026-11-18T10:16:00Z' });
    if (!retriedEmit.ok) throw new Error(retriedEmit.error);
    state = evaluateOrderLoyalty(retriedEmit.state, tenSale.data.id, '2026-11-18T10:17:00Z');
    expect(state.customers?.find((c) => c.id === customerId)?.freeCombosAvailable).toBe(1);

    // Canjear el combo gratis en un encargo ($0.00)
    const freeOrder = createOrder(state, {
      branchId: 'trevino',
      serviceType: 'encargo',
      customerId,
      redeemFreeCombo: true,
      items: [{ itemId: 'combo', quantity: 1 }],
      paymentLines: [],
      now: '2026-11-18T11:00:00Z',
    });
    if (!freeOrder.ok) throw new Error(freeOrder.error);
    state = freeOrder.state;
    expect(freeOrder.data.totalCents).toBe(0);
    expect(state.customers?.find((c) => c.id === customerId)?.freeCombosAvailable).toBe(0);

    // Avanzar encargo, emitir ticket y entregar -> aquí recién se genera el boleto de rifa
    state = (() => {
      let s = state;
      for (let i = 0; i < 3; i++) {
        const adv = advanceEncargoStage(s, freeOrder.data.id);
        if (!adv.ok) throw new Error(adv.error);
        s = adv.state;
      }
      const tick = emitTicket(s, freeOrder.data.id, { now: '2026-11-18T12:00:00Z' });
      if (!tick.ok) throw new Error(tick.error);
      s = tick.state;
      expect(s.raffleTickets ?? []).toHaveLength(0); // Encargo aún no entregado!
      const del = deliverEncargoOrder(s, freeOrder.data.id, '2026-11-18T12:10:00Z');
      if (!del.ok) throw new Error(del.error);
      return del.state;
    })();

    const eligible = getEligibleRaffleTickets(state, 2026);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].ticketCode).toBe('RIFA-2026-0001');
    expect(eligible[0].customerId).toBe(customerId);

    // Reevaluar de nuevo NO duplica el boleto
    state = evaluateOrderLoyalty(state, freeOrder.data.id, '2026-11-18T12:12:00Z');
    expect(state.raffleTickets).toHaveLength(1);

    // Supervisión realiza sorteo manual con historial
    const draw = operate(
      state,
      'lomas',
      { action: 'runRaffleDraw', year: 2026, notes: 'Sorteo prueba dic' },
      { role: 'supervisor', actorLabel: 'admin@horeb.mx' },
    );
    expect(draw.ok).toBe(true);
    if (!draw.ok) return;
    expect(draw.state.raffleDraws).toHaveLength(1);
    expect(draw.state.raffleDraws?.[0].winnerTicketCode).toBe('RIFA-2026-0001');

    // Ya ganado, el boleto sale de elegibles y no permite sortear en vacío
    expect(getEligibleRaffleTickets(draw.state, 2026)).toHaveLength(0);
    expect(runManualRaffleDraw(draw.state, 'lomas', { year: 2026 }).ok).toBe(false);
  });
});
