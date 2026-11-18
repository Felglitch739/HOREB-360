import { BRANCHES, createInitialState } from './rules';
import type { DemoState } from './types';

export const STORAGE_KEY = 'horeb360_demo_state_v1';

export function loadDemoState(): DemoState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as DemoState;
    if (!parsed || !Array.isArray(parsed.orders) || !Array.isArray(parsed.shifts)
      || !Array.isArray(parsed.paymentLines) || !parsed.tickets || !parsed.nextFolioSeq
      || !BRANCHES.some((branch) => branch.id === parsed.activeBranchId)) {
      return createInitialState();
    }
    return {
      ...parsed,
      orders: parsed.orders.map((order) => order.serviceType === 'autoservicio'
        ? { ...order, orderStatus: parsed.tickets[order.id]?.status === 'emitido' ? 'completado' : 'en_proceso' }
        : order),
    };
  } catch {
    return createInitialState();
  }
}

export function saveDemoState(state: DemoState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignorar errores de cuota en modo demo
  }
}

export function clearDemoState(): DemoState {
  const fresh = createInitialState();
  saveDemoState(fresh);
  return fresh;
}
