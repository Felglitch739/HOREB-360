import { describe, expect, it } from 'vitest';
import { operate } from './operations';
import {
  advanceEncargoStage,
  assignOrderMachines,
  createInitialState,
  createOrder,
  deleteMachine,
  getBranchMachines,
  recordOrderWhatsappSent,
  seedSampleMachinesForBranch,
  setMachineStatus,
  upsertMachine,
} from './rules';

describe('Bloque 2 · Padrón de máquinas, exclusividad, etapas y WhatsApp', () => {
  it('gestiona padrón editable por sucursal con permisos de Supervisión y bloquea duplicados o máquinas fuera de servicio', () => {
    let state = createInitialState('2026-11-18T10:00:00Z');
    expect(getBranchMachines(state, 'lomas')).toHaveLength(0);

    // Supervisión agrega lavadora y secadora
    const addL1 = operate(
      state,
      'lomas',
      { action: 'upsertMachine', machine: { code: 'L1', name: 'Lavadora #1 LG', kind: 'lavadora' } },
      { role: 'supervisor', actorLabel: 'admin@horeb.mx' },
    );
    expect(addL1.ok).toBe(true);
    if (!addL1.ok) return;
    state = addL1.state;

    const addS1 = upsertMachine(
      state,
      'lomas',
      { code: 'S1', name: 'Secadora #1 LG', kind: 'secadora' },
      'admin@horeb.mx',
    );
    if (!addS1.ok) throw new Error(addS1.error);
    state = addS1.state;

    const l1 = getBranchMachines(state, 'lomas').find((m) => m.code === 'L1')!;
    const s1 = getBranchMachines(state, 'lomas').find((m) => m.code === 'S1')!;

    // Código duplicado rechazado
    const dup = upsertMachine(state, 'lomas', { code: 'L1', name: 'Otra', kind: 'lavadora' });
    expect(dup.ok).toBe(false);

    // Marcar L1 fuera de servicio bloquea asignación
    const off = setMachineStatus(state, 'lomas', l1.id, 'fuera_de_servicio', {
      reason: 'Revisión de desagüe',
    });
    if (!off.ok) throw new Error(off.error);
    state = off.state;

    const blockedSale = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'encargo',
      customerAlias: 'Laura Méndez',
      machineIds: [l1.id],
      paymentLines: [],
    });
    expect(blockedSale.ok).toBe(false);

    // Habilitar L1 nuevamente
    const on = setMachineStatus(state, 'lomas', l1.id, 'disponible');
    if (!on.ok) throw new Error(on.error);
    state = on.state;

    // Primera orden ocupa L1
    const order1 = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'encargo',
      customerAlias: 'Cliente Uno',
      machineIds: [l1.id],
      paymentLines: [],
    });
    if (!order1.ok) throw new Error(order1.error);
    state = order1.state;

    // Segunda orden NO puede ocupar L1 al mismo tiempo
    const order2 = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'encargo',
      customerAlias: 'Cliente Dos',
      machineIds: [l1.id],
      paymentLines: [],
    });
    expect(order2.ok).toBe(false);

    // No se puede eliminar máquina en uso
    expect(deleteMachine(state, 'lomas', l1.id).ok).toBe(false);
    // Pero sí una libre
    const tempMachine = upsertMachine(state, 'lomas', { code: 'L9', name: 'Temporal', kind: 'lavadora' });
    if (!tempMachine.ok) throw new Error(tempMachine.error);
    expect(deleteMachine(tempMachine.state, 'lomas', tempMachine.data.id).ok).toBe(true);

    // S1 sigue disponible
    expect(getBranchMachines(state, 'lomas').find((m) => m.id === s1.id)?.status).toBe('disponible');
  });

  it('libera máquinas al avanzar etapas y separa abrir WhatsApp de registrar envío confirmado', () => {
    let state = createInitialState('2026-11-18T11:00:00Z');
    const seeded = seedSampleMachinesForBranch(state, 'trevino', 'admin@horeb.mx');
    if (!seeded.ok) throw new Error(seeded.error);
    state = seeded.state;

    const machines = getBranchMachines(state, 'trevino');
    const l1 = machines.find((m) => m.code === 'L1')!;
    const s1 = machines.find((m) => m.code === 'S1')!;

    // Crear encargo en recibido y asignarle L1 al iniciar lavado
    const ord = createOrder(state, {
      branchId: 'trevino',
      serviceType: 'encargo',
      customerAlias: 'Paty Ruiz',
      paymentLines: [],
      now: '2026-11-18T11:05:00Z',
    });
    if (!ord.ok) throw new Error(ord.error);
    state = ord.state;

    // recibido -> lavado con L1
    const washing = advanceEncargoStage(state, ord.data.id, {
      machineIds: [l1.id],
      actorLabel: 'felix_mf@horeb.mx',
    });
    if (!washing.ok) throw new Error(washing.error);
    state = washing.state;
    expect(getBranchMachines(state, 'trevino').find((m) => m.id === l1.id)?.status).toBe('en_uso');

    // Reasignar con assignOrderMachines a la misma orden sigue funcionando o evita ocupar otras ocupadas
    const other = createOrder(state, {
      branchId: 'trevino',
      serviceType: 'encargo',
      customerAlias: 'Otro',
      paymentLines: [],
    });
    if (!other.ok) throw new Error(other.error);
    expect(assignOrderMachines(other.state, other.data.id, [l1.id]).ok).toBe(false);

    // lavado -> secado con S1: L1 se libera (+1 ciclo) y S1 queda en uso
    const drying = advanceEncargoStage(state, ord.data.id, {
      machineIds: [s1.id],
      actorLabel: 'felix_mf@horeb.mx',
    });
    if (!drying.ok) throw new Error(drying.error);
    state = drying.state;
    const l1After = getBranchMachines(state, 'trevino').find((m) => m.id === l1.id)!;
    const s1After = getBranchMachines(state, 'trevino').find((m) => m.id === s1.id)!;
    expect(l1After.status).toBe('disponible');
    expect(l1After.cycles).toBe(l1.cycles + 1);
    expect(s1After.status).toBe('en_uso');

    // secado -> listo: S1 se libera (+1 ciclo), prepara mensaje con folio y sucursal, whatsappSentAt sigue null
    const ready = advanceEncargoStage(state, ord.data.id, {
      now: '2026-11-18T12:00:00Z',
    });
    if (!ready.ok) throw new Error(ready.error);
    state = ready.state;

    expect(getBranchMachines(state, 'trevino').find((m) => m.id === s1.id)?.status).toBe('disponible');
    expect(ready.data.whatsappPreparedAt).toBe('2026-11-18T12:00:00Z');
    expect(ready.data.whatsappMessage).toContain(ord.data.folio);
    expect(ready.data.whatsappMessage).toContain('Treviño');
    expect(ready.data.whatsappSentAt ?? null).toBeNull();

    // Operador registra envío cuando realmente envió por WhatsApp
    const sent = recordOrderWhatsappSent(state, ord.data.id, 'felix_mf@horeb.mx', '2026-11-18T12:03:00Z');
    if (!sent.ok) throw new Error(sent.error);
    expect(sent.data.whatsappSentAt).toBe('2026-11-18T12:03:00Z');
    expect(sent.data.whatsappSentBy).toBe('felix_mf@horeb.mx');
  });
});
