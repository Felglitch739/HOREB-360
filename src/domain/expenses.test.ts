import { describe, expect, it } from 'vitest';
import { buildExpensesAndProfitSheets } from './excelExport';
import { operate, requiresSupervisor } from './operations';
import {
  calculateProfitAndLoss,
  createInitialState,
  createOrder,
  deleteExpense,
  deleteSupplyItem,
  getBranchExpenses,
  getBranchSupplies,
  upsertExpense,
  upsertSupplyItem,
} from './rules';
import { combineBranches } from './sharedState';

describe('Gastos y Ganancia + Catálogo de Insumos (QLAK style)', () => {
  it('restringe las operaciones de gastos e insumos exclusivamente al administrador (supervisor)', () => {
    expect(requiresSupervisor('upsertSupplyItem')).toBe(true);
    expect(requiresSupervisor('deleteSupplyItem')).toBe(true);
    expect(requiresSupervisor('upsertExpense')).toBe(true);
    expect(requiresSupervisor('deleteExpense')).toBe(true);
  });

  it('gestiona el catálogo de insumos con validaciones y auditoría por sucursal', () => {
    let state = createInitialState('2026-11-20T10:00:00Z');

    const s1 = operate(
      state,
      'lomas',
      {
        action: 'upsertSupplyItem',
        supply: { name: 'Jabón para lavadora', unitLabel: 'unidad', unitCostCents: 7000 },
      },
      { role: 'supervisor', actorLabel: 'carlos@horeb.mx' },
    );
    expect(s1.ok).toBe(true);
    if (!s1.ok) return;
    state = s1.state;

    const s2 = upsertSupplyItem(
      state,
      'lomas',
      { name: 'Jabón líquido', unitLabel: 'garrafa', unitCostCents: 18000 },
      'carlos@horeb.mx',
    );
    expect(s2.ok).toBe(true);
    if (!s2.ok) return;
    state = s2.state;

    // Duplicado nombre + unidad en la misma sucursal rechazado
    const dup = upsertSupplyItem(state, 'lomas', {
      name: 'jabón líquido',
      unitLabel: 'Garrafa',
      unitCostCents: 19000,
    });
    expect(dup.ok).toBe(false);

    // Misma descripción en distinta sucursal sí está permitida
    const trevinoSup = upsertSupplyItem(state, 'trevino', {
      name: 'Jabón líquido',
      unitLabel: 'garrafa',
      unitCostCents: 18000,
    });
    expect(trevinoSup.ok).toBe(true);

    const lomasSupplies = getBranchSupplies(state, ['lomas']);
    expect(lomasSupplies).toHaveLength(2);

    const target = lomasSupplies.find((s) => s.name === 'Jabón para lavadora')!;
    const updated = upsertSupplyItem(state, 'lomas', {
      id: target.id,
      name: 'Jabón para lavadora',
      unitLabel: 'unidad',
      unitCostCents: 7500,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    state = updated.state;
    expect(getBranchSupplies(state, ['lomas']).find((s) => s.id === target.id)?.unitCostCents).toBe(7500);

    const deleted = deleteSupplyItem(state, 'lomas', target.id);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(getBranchSupplies(deleted.state, ['lomas'])).toHaveLength(1);
    expect((deleted.state.auditLogs ?? []).some((log) => log.category === 'gasto')).toBe(true);
  });

  it('calcula gasto total por cantidad × costo unitario, ganancia neta por fecha/sucursal y hojas de Excel', () => {
    let state = createInitialState('2026-11-20T12:00:00Z');

    // Ingresos confirmados en Lomas ($70 + $140 = $210) y Treviño ($70), más $70 pendiente en Lomas (no entra en ingreso confirmado)
    const o1 = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'autoservicio',
      paymentLines: [{ method: 'efectivo', amountCents: 7000 }],
      now: '2026-11-20T14:00:00-06:00',
    });
    if (!o1.ok) throw new Error(o1.error);
    state = o1.state;

    const o2 = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'encargo',
      customerAlias: 'Cliente Mes',
      comboCount: 2,
      paymentLines: [{ method: 'tarjeta', amountCents: 14000, confirmImmediately: true }],
      now: '2026-11-24T15:00:00-06:00',
    });
    if (!o2.ok) throw new Error(o2.error);
    state = o2.state;

    const oPending = createOrder(state, {
      branchId: 'lomas',
      serviceType: 'encargo',
      customerAlias: 'Transferencia pendiente',
      paymentLines: [{ method: 'transferencia', amountCents: 7000 }], // pendiente
      now: '2026-11-24T16:00:00-06:00',
    });
    if (!oPending.ok) throw new Error(oPending.error);
    state = oPending.state;

    const oTrev = createOrder(state, {
      branchId: 'trevino',
      serviceType: 'autoservicio',
      paymentLines: [{ method: 'efectivo', amountCents: 7000 }],
      now: '2026-11-24T17:00:00-06:00',
    });
    if (!oTrev.ok) throw new Error(oTrev.error);
    state = oTrev.state;

    // 4 garrafas de jabón líquido a $180 = $720 MXN (en Lomas el 2026-11-24)
    const e1 = operate(
      state,
      'lomas',
      {
        action: 'upsertExpense',
        expense: {
          date: '2026-11-24',
          category: 'insumos',
          concept: 'Jabón líquido',
          unitLabel: 'garrafa',
          quantity: 4,
          unitCostCents: 18000,
        },
      },
      { role: 'supervisor', actorLabel: 'carlos@horeb.mx' },
    );
    expect(e1.ok).toBe(true);
    if (!e1.ok) return;
    state = e1.state;

    // 2.5 litros de cloro a $45 = $112.50 MXN (11250 cents) el 2026-11-20 en Lomas
    const e2 = upsertExpense(state, 'lomas', {
      date: '2026-11-20',
      category: 'insumos',
      concept: 'Cloro concentrado',
      unitLabel: 'litro',
      quantity: 2.5,
      unitCostCents: 4500,
    });
    if (!e2.ok) throw new Error(e2.error);
    state = e2.state;
    expect(e2.data.totalCents).toBe(11250);

    // Gasto de gas en Treviño el 2026-11-24 ($500)
    const e3 = upsertExpense(state, 'trevino', {
      date: '2026-11-24',
      category: 'gas',
      concept: 'Carga de gas',
      unitLabel: 'carga',
      quantity: 1,
      unitCostCents: 50000,
    });
    if (!e3.ok) throw new Error(e3.error);
    state = e3.state;

    // Filtro por fecha específica (2026-11-24) solo Lomas: ingresos $140 (14000) - gastos $720 (72000) = -$580 (-58000)
    const dayLomas = calculateProfitAndLoss(state, {
      branches: ['lomas'],
      fromDate: '2026-11-24',
      toDate: '2026-11-24',
    });
    expect(dayLomas.revenueCents).toBe(14000);
    expect(dayLomas.expensesCents).toBe(72000);
    expect(dayLomas.suppliesCents).toBe(72000);
    expect(dayLomas.netProfitCents).toBe(-58000);

    // Consolidado Lomas + Treviño en noviembre: ingresos $280 (28000) - gastos ($720 + $112.50 + $500 = 133250)
    const allMonth = calculateProfitAndLoss(state, {
      branches: ['lomas', 'trevino'],
      fromDate: '2026-11-01',
      toDate: '2026-11-30',
    });
    expect(allMonth.revenueCents).toBe(28000);
    expect(allMonth.expensesCents).toBe(133250);
    expect(allMonth.suppliesCents).toBe(83250);
    expect(allMonth.netProfitCents).toBe(-105250);
    expect(allMonth.byCategory.find((c) => c.category === 'gas')?.totalCents).toBe(50000);

    // Eliminar gasto funciona correctamente
    const afterDel = deleteExpense(state, 'lomas', e2.data.id);
    expect(afterDel.ok).toBe(true);
    if (!afterDel.ok) return;
    expect(getBranchExpenses(afterDel.state, ['lomas'])).toHaveLength(1);

    // Hojas de Excel
    const sheets = buildExpensesAndProfitSheets(state, {
      branches: ['lomas', 'trevino'],
      fromDate: '2026-11-01',
      toDate: '2026-11-30',
      periodLabel: 'Noviembre 2026',
    });
    expect(sheets.map((s) => s.name)).toEqual([
      'Ganancia Neta',
      'Gastos por Categoría',
      'Detalle de Gastos',
      'Catálogo Insumos',
    ]);

    // combineBranches conserva expenses y supplyCatalog por sucursal
    const combined = combineBranches([
      {
        branch_id: 'lomas',
        version: 1,
        state: {
          orders: state.orders.filter((o) => o.branchId === 'lomas'),
          paymentLines: state.paymentLines.filter((p) =>
            state.orders.some((o) => o.id === p.orderId && o.branchId === 'lomas'),
          ),
          shifts: state.shifts.filter((s) => s.branchId === 'lomas'),
          expenses: state.expenses?.filter((e) => e.branchId === 'lomas'),
          supplyCatalog: state.supplyCatalog?.filter((s) => s.branchId === 'lomas'),
        },
      },
      {
        branch_id: 'trevino',
        version: 1,
        state: {
          expenses: state.expenses?.filter((e) => e.branchId === 'trevino'),
        },
      },
    ]);
    expect(combined.expenses).toHaveLength(3);
  });
});
