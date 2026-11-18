import {
  advanceEncargoStage, assignOrderMachines, captureEncargoPayment, closeShift, confirmPaymentLine,
  createOrder, deleteMachine, deliverEncargoOrder, emitTicket, openNewShift, recordCashMovement,
  recordOrderWhatsappSent, reprintTicket, seedSampleMachinesForBranch, setMachineStatus,
  updateBranchSettings, upsertMachine,
  type CreateOrderInput, type PaymentInputLine,
} from './rules.ts';
import type {
  BranchId,
  BranchSettings,
  CashMovement,
  DemoState,
  MachineKind,
  MachineStatus,
  Order,
} from './types.ts';

export type Operation =
  | { action: 'create'; input: Omit<CreateOrderInput, 'branchId' | 'now'> }
  | { action: 'capture'; orderId: string; lines: PaymentInputLine[] }
  | { action: 'confirm'; lineId: string; reference?: string }
  | { action: 'advance'; orderId: string; machineIds?: string[] }
  | { action: 'deliver'; orderId: string }
  | { action: 'emit'; orderId: string; simulateFailure: boolean }
  | { action: 'reprint'; orderId: string }
  | { action: 'closeShift' | 'openShift'; amount: number }
  | { action: 'movement'; kind: CashMovement['kind']; amount: number; reason: string }
  | { action: 'updateSettings'; settings: Partial<BranchSettings> }
  | { action: 'upsertMachine'; machine: { id?: string; code: string; name: string; kind: MachineKind } }
  | { action: 'deleteMachine'; machineId: string }
  | { action: 'seedSampleMachines' }
  | { action: 'setMachineStatus'; machineId: string; status: Extract<MachineStatus, 'disponible' | 'fuera_de_servicio'>; reason?: string }
  | { action: 'assignMachines'; orderId: string; machineIds: string[] }
  | { action: 'recordWhatsappSent'; orderId: string };

export type OperationResult =
  | { ok: true; state: DemoState; order?: Order }
  | { ok: false; error: string };

export interface OperationContext {
  role?: 'operator' | 'supervisor';
  actorLabel?: string;
}

export function requiresSupervisor(action: Operation['action']) {
  return (
    action === 'closeShift' ||
    action === 'openShift' ||
    action === 'movement' ||
    action === 'updateSettings' ||
    action === 'upsertMachine' ||
    action === 'deleteMachine' ||
    action === 'seedSampleMachines'
  );
}

export function operate(
  state: DemoState,
  branch: BranchId,
  operation: Operation,
  context: OperationContext = {},
): OperationResult {
  const actorRole = context.role ?? 'supervisor';
  const actorLabel = context.actorLabel ?? (actorRole === 'supervisor' ? 'Supervisión' : 'Caja');
  switch (operation.action) {
    case 'create': {
      const { now: _now, ...input } = operation.input as CreateOrderInput;
      const result = createOrder(state, { ...input, branchId: branch, actorLabel });
      return result.ok ? { ...result, order: result.data } : result;
    }
    case 'capture': {
      const result = captureEncargoPayment(state, operation.orderId, operation.lines, undefined, actorLabel);
      return result.ok ? { ...result, order: result.data } : result;
    }
    case 'confirm':
      return confirmPaymentLine(state, operation.lineId, undefined, {
        reference: operation.reference,
        actorLabel,
      });
    case 'advance':
      return advanceEncargoStage(state, operation.orderId, {
        machineIds: operation.machineIds,
        actorLabel,
      });
    case 'deliver': return deliverEncargoOrder(state, operation.orderId);
    case 'emit': return emitTicket(state, operation.orderId, { simulateFailure: operation.simulateFailure });
    case 'reprint': return reprintTicket(state, operation.orderId, { actorRole, actorLabel });
    case 'closeShift': return closeShift(state, branch, operation.amount);
    case 'openShift': return openNewShift(state, branch, undefined, operation.amount);
    case 'movement': return recordCashMovement(state, branch, operation.kind, operation.amount, operation.reason);
    case 'updateSettings': return updateBranchSettings(state, branch, operation.settings, actorLabel);
    case 'upsertMachine': return upsertMachine(state, branch, operation.machine, actorLabel);
    case 'deleteMachine': return deleteMachine(state, branch, operation.machineId, actorLabel);
    case 'seedSampleMachines': return seedSampleMachinesForBranch(state, branch, actorLabel);
    case 'setMachineStatus':
      return setMachineStatus(state, branch, operation.machineId, operation.status, {
        reason: operation.reason,
        actorLabel,
      });
    case 'assignMachines': {
      const result = assignOrderMachines(state, operation.orderId, operation.machineIds, actorLabel);
      return result.ok ? { ...result, order: result.data } : result;
    }
    case 'recordWhatsappSent': {
      const result = recordOrderWhatsappSent(state, operation.orderId, actorLabel);
      return result.ok ? { ...result, order: result.data } : result;
    }
  }
}
