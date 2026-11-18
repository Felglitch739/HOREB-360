import { createInitialState } from './rules.ts';
import type { BranchId, DemoState } from './types.ts';

export type BranchRole = 'operator' | 'supervisor';
export interface BranchRow { branch_id: BranchId; version: number; updated_at?: string; state: Partial<DemoState> }

export function combineBranches(rows: BranchRow[]): DemoState {
  const initial = createInitialState();
  const state = { ...initial, activeBranchId: rows[0]?.branch_id ?? initial.activeBranchId, shifts: [] as DemoState['shifts'] };
  for (const { branch_id, updated_at, state: saved } of rows) {
    state.orders.push(...(saved.orders ?? []));
    state.paymentLines.push(...(saved.paymentLines ?? []));
    state.shifts.push(...(saved.shifts ?? initial.shifts.filter((shift) => shift.branchId === branch_id).map((shift) => ({ ...shift, openedAt: updated_at ?? shift.openedAt }))));
    Object.assign(state.tickets, saved.tickets ?? {});
    state.nextFolioSeq[branch_id] = saved.nextFolioSeq?.[branch_id] ?? 1;
  }
  state.orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return state;
}
