import {
  advanceEncargoStage, captureEncargoPayment, closeShift, confirmPaymentLine, createOrder,
  deliverEncargoOrder, emitTicket, openNewShift, recordCashMovement, updateBranchSettings,
  type CreateOrderInput, type PaymentInputLine,
} from './rules.ts';
import type { BranchId, BranchSettings, CashMovement, DemoState, Order } from './types.ts';

export type Operation =
  | { action: 'create'; input: Omit<CreateOrderInput, 'branchId' | 'now'> }
  | { action: 'capture'; orderId: string; lines: PaymentInputLine[] }
  | { action: 'confirm'; lineId: string }
  | { action: 'advance' | 'deliver'; orderId: string }
  | { action: 'emit'; orderId: string; simulateFailure: boolean }
  | { action: 'closeShift' | 'openShift'; amount: number }
  | { action: 'movement'; kind: CashMovement['kind']; amount: number; reason: string }
  | { action: 'updateSettings'; settings: Partial<BranchSettings> };

export type OperationResult =
  | { ok: true; state: DemoState; order?: Order }
  | { ok: false; error: string };

export function requiresSupervisor(action: Operation['action']) {
  return action === 'closeShift' || action === 'openShift' || action === 'movement' || action === 'updateSettings';
}

export function operate(state: DemoState, branch: BranchId, operation: Operation): OperationResult {
  switch (operation.action) {
    case 'create': {
      const { now: _now, ...input } = operation.input as CreateOrderInput;
      const result = createOrder(state, { ...input, branchId: branch });
      return result.ok ? { ...result, order: result.data } : result;
    }
    case 'capture': {
      const result = captureEncargoPayment(state, operation.orderId, operation.lines);
      return result.ok ? { ...result, order: result.data } : result;
    }
    case 'confirm': return confirmPaymentLine(state, operation.lineId);
    case 'advance': return advanceEncargoStage(state, operation.orderId);
    case 'deliver': return deliverEncargoOrder(state, operation.orderId);
    case 'emit': return emitTicket(state, operation.orderId, { simulateFailure: operation.simulateFailure });
    case 'closeShift': return closeShift(state, branch, operation.amount);
    case 'openShift': return openNewShift(state, branch, undefined, operation.amount);
    case 'movement': return recordCashMovement(state, branch, operation.kind, operation.amount, operation.reason);
    case 'updateSettings': return updateBranchSettings(state, branch, operation.settings);
  }
}
