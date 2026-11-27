import { describe, expect, it } from 'vitest';
import { getBranchMachines, getOrderPendingCents } from './rules';
import { createTrainingSandboxState, WALKTHROUGH_FLOWS } from './sandboxManual';

describe('sandboxManual (training state & walkthrough flows)', () => {
  it('builds a realistic training sandbox with orders, pending balances, customers, and machines', () => {
    const state = createTrainingSandboxState();

    expect(state.orders.length).toBeGreaterThan(8);
    expect((state.customers ?? []).length).toBeGreaterThanOrEqual(4);
    expect(getBranchMachines(state, 'lomas')).toHaveLength(22);
    expect(getBranchMachines(state, 'trevino')).toHaveLength(22);

    // Every active lavado/secado order has assigned machines belonging to its branch
    const stageOrders = state.orders.filter(
      (o) => o.serviceType === 'encargo' && (o.encargoStage === 'lavado' || o.encargoStage === 'secado'),
    );
    expect(stageOrders.length).toBeGreaterThan(0);
    for (const ord of stageOrders) {
      expect((ord.assignedMachineIds ?? []).length).toBeGreaterThan(0);
      const branchMachineIds = new Set(getBranchMachines(state, ord.branchId).map((m) => m.id));
      for (const mId of ord.assignedMachineIds ?? []) {
        expect(branchMachineIds.has(mId)).toBe(true);
      }
    }

    // Must contain at least one machine en_uso and one fuera_de_servicio
    const lomasMachines = getBranchMachines(state, 'lomas');
    expect(lomasMachines.some((m) => m.status === 'en_uso')).toBe(true);
    expect(lomasMachines.some((m) => m.status === 'fuera_de_servicio')).toBe(true);

    // Must contain an unpaid pending encargo order and a partial-payment encargo order
    const unpaidEncargo = state.orders.find(
      (o) =>
        o.branchId === 'lomas' &&
        o.customerAlias.includes('Roberto Garza') &&
        getOrderPendingCents(state, o.id) > 0,
    );
    expect(unpaidEncargo).toBeDefined();
    const partialEncargo = state.orders.find(
      (o) =>
        o.customerAlias.includes('Anticipo Demo') &&
        getOrderPendingCents(state, o.id) > 0 &&
        getOrderPendingCents(state, o.id) < o.totalCents,
    );
    expect(partialEncargo).toBeDefined();
  });

  it('executes every interactive simulation step immutably without throwing', () => {
    const baseState = createTrainingSandboxState();
    const originalOrdersCount = baseState.orders.length;

    expect(WALKTHROUGH_FLOWS.length).toBe(6);

    for (const flow of WALKTHROUGH_FLOWS) {
      expect(flow.steps.length).toBeGreaterThanOrEqual(3);
      for (const step of flow.steps) {
        if (step.simulate) {
          const nextState = step.simulate(baseState, 'lomas');
          expect(nextState).not.toBe(baseState);
          expect(baseState.orders.length).toBe(originalOrdersCount);
        }
      }
    }
  });
});
