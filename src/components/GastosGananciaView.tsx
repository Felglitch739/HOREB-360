import { useMemo, useState } from 'react';
import {
  Calendar,
  Download,
  Edit3,
  FileSpreadsheet,
  Package,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { exportExpensesAndProfitToExcel } from '../domain/excelExport';
import { formatMxnCurrency, parsePesosToCents } from '../domain/money';
import {
  DEFAULT_SUPPLY_ITEMS,
  EXPENSE_CATEGORIES,
  calculateProfitAndLoss,
  getBranchDisplayName,
  getBranchExpenses,
  getBranchSupplies,
} from '../domain/rules';
import type { BranchRole } from '../domain/sharedState';
import type { BranchExpense, BranchId, DemoState, ExpenseCategory, SupplyItem } from '../domain/types';
import { CustomSelect } from './CustomSelect';

type PeriodPreset = 'semana' | 'mes' | 'fecha' | 'rango' | 'todo';

interface GastosGananciaViewProps {
  state: DemoState;
  branches: BranchId[];
  activeBranchId: BranchId;
  scopeBranch: BranchId | 'all';
  role: BranchRole;
  localFallbackActive?: boolean;
  onUpsertSupply: (
    branchId: BranchId,
    supply: { id?: string; name: string; unitLabel: string; unitCostCents: number; notes?: string },
  ) => Promise<{ ok: boolean; error?: string }>;
  onDeleteSupply: (branchId: BranchId, supplyId: string) => Promise<{ ok: boolean; error?: string }>;
  onUpsertExpense: (
    branchId: BranchId,
    expense: {
      id?: string;
      date: string;
      category: ExpenseCategory;
      concept: string;
      unitLabel?: string;
      quantity: number;
      unitCostCents: number;
      supplyItemId?: string | null;
      notes?: string;
    },
  ) => Promise<{ ok: boolean; error?: string }>;
  onDeleteExpense: (branchId: BranchId, expenseId: string) => Promise<{ ok: boolean; error?: string }>;
}

const CATEGORY_SHORT_LABEL: Record<ExpenseCategory, string> = {
  insumos: 'Insumos',
  renta: 'Renta',
  luz: 'Luz',
  agua: 'Agua',
  gas: 'Gas',
  sueldos: 'Sueldos',
  mantenimiento: 'Mantenimiento',
};

const localDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Matamoros',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getTodayDateKey(): string {
  return localDateFmt.format(new Date());
}

function getMondayOfCurrentWeek(todayKey: string): string {
  const [y, m, d] = todayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  dt.setUTCDate(dt.getUTCDate() - diffToMonday);
  return dt.toISOString().slice(0, 10);
}

function getMonthBounds(todayKey: string): { from: string; to: string } {
  const [y, m] = todayKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const escape = (cell: string | number) => {
    const str = String(cell ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function GastosGananciaView({
  state,
  branches,
  activeBranchId,
  scopeBranch,
  role,
  localFallbackActive,
  onUpsertSupply,
  onDeleteSupply,
  onUpsertExpense,
  onDeleteExpense,
}: GastosGananciaViewProps) {
  const todayKey = useMemo(() => getTodayDateKey(), []);
  const canEdit = role === 'supervisor';

  // Period filter state
  const [period, setPeriod] = useState<PeriodPreset>('mes');
  const [specificDate, setSpecificDate] = useState(todayKey);
  const [customFrom, setCustomFrom] = useState(() => getMonthBounds(todayKey).from);
  const [customTo, setCustomTo] = useState(todayKey);

  // Expense list filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExpenseCategory>('all');

  // Expense creation / edit form
  const [editingExpenseId, setEditingExpenseId] = useState<string | undefined>(undefined);
  const [expBranch, setExpBranch] = useState<BranchId>(activeBranchId);
  const [expDate, setExpDate] = useState(todayKey);
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('insumos');
  const [expConcept, setExpConcept] = useState('');
  const [expQuantity, setExpQuantity] = useState('1');
  const [expUnit, setExpUnit] = useState('garrafa');
  const [expUnitCost, setExpUnitCost] = useState('');
  const [expSupplyId, setExpSupplyId] = useState<string | null>(null);
  const [expNotes, setExpNotes] = useState('');
  const [expBusy, setExpBusy] = useState(false);
  const [expFeedback, setExpFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  // Supply catalog (QLAK style) form
  const [editingSupplyId, setEditingSupplyId] = useState<string | undefined>(undefined);
  const [supBranch, setSupBranch] = useState<BranchId>(activeBranchId);
  const [supName, setSupName] = useState('');
  const [supUnit, setSupUnit] = useState('unidad');
  const [supCost, setSupCost] = useState('');
  const [supNotes, setSupNotes] = useState('');
  const [supBusy, setSupBusy] = useState(false);
  const [supFeedback, setSupFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const effectiveFormBranch: BranchId = scopeBranch === 'all' ? expBranch : scopeBranch;
  const effectiveSupplyBranch: BranchId = scopeBranch === 'all' ? supBranch : scopeBranch;

  const periodRange = useMemo(() => {
    if (period === 'semana') {
      const from = getMondayOfCurrentWeek(todayKey);
      return { fromDate: from, toDate: todayKey, label: `Esta semana (${from} al ${todayKey})` };
    }
    if (period === 'mes') {
      const { from, to } = getMonthBounds(todayKey);
      return { fromDate: from, toDate: to, label: `Este mes (${from.slice(0, 7)})` };
    }
    if (period === 'fecha') {
      const d = specificDate || todayKey;
      return { fromDate: d, toDate: d, label: `Fecha ${d}` };
    }
    if (period === 'rango') {
      const from = customFrom || undefined;
      const to = customTo || undefined;
      return {
        fromDate: from,
        toDate: to,
        label: `Rango (${from ?? 'inicio'} – ${to ?? 'hoy'})`,
      };
    }
    return { fromDate: undefined, toDate: undefined, label: 'Todo el historial' };
  }, [customFrom, customTo, period, specificDate, todayKey]);

  const pnl = useMemo(
    () =>
      calculateProfitAndLoss(state, {
        branches,
        fromDate: periodRange.fromDate,
        toDate: periodRange.toDate,
      }),
    [branches, periodRange.fromDate, periodRange.toDate, state],
  );

  const periodExpenses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return getBranchExpenses(state, branches).filter((exp) => {
      if (periodRange.fromDate && exp.date < periodRange.fromDate) return false;
      if (periodRange.toDate && exp.date > periodRange.toDate) return false;
      if (categoryFilter !== 'all' && exp.category !== categoryFilter) return false;
      if (q) {
        const hay = `${exp.concept} ${exp.notes ?? ''} ${CATEGORY_SHORT_LABEL[exp.category]}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [branches, categoryFilter, periodRange.fromDate, periodRange.toDate, searchQuery, state]);

  const branchSupplies = useMemo(
    () => getBranchSupplies(state, [effectiveFormBranch]),
    [effectiveFormBranch, state],
  );

  const visibleCatalogSupplies = useMemo(
    () => getBranchSupplies(state, branches),
    [branches, state],
  );

  // Live expense total preview
  const parsedQty = Number.parseFloat(expQuantity);
  const parsedUnitCents = parsePesosToCents(expUnitCost);
  const previewTotalCents =
    Number.isFinite(parsedQty) && parsedQty > 0 && parsedUnitCents !== null && parsedUnitCents > 0
      ? Math.round(Math.round(parsedQty * 100) / 100 * parsedUnitCents)
      : null;

  const suppliesSharePct =
    pnl.expensesCents > 0 ? Math.round((pnl.suppliesCents / pnl.expensesCents) * 1000) / 10 : 0;
  const maxCategoryCents = Math.max(1, ...pnl.byCategory.map((c) => c.totalCents));

  function resetExpenseForm() {
    setEditingExpenseId(undefined);
    setExpConcept('');
    setExpQuantity('1');
    setExpUnitCost('');
    setExpSupplyId(null);
    setExpNotes('');
    const catMeta = EXPENSE_CATEGORIES.find((c) => c.id === expCategory);
    setExpUnit(catMeta?.defaultUnit ?? 'unidad');
  }

  function applySupplyToExpenseForm(item: SupplyItem) {
    setEditingExpenseId(undefined);
    setExpBranch(item.branchId);
    setExpCategory('insumos');
    setExpConcept(item.name);
    setExpUnit(item.unitLabel);
    setExpUnitCost((item.unitCostCents / 100).toFixed(2));
    setExpSupplyId(item.id);
    if (!expQuantity || Number.parseFloat(expQuantity) <= 0) setExpQuantity('1');
    setExpFeedback({
      type: 'ok',
      text: `Insumo "${item.name}" cargado (${formatMxnCurrency(item.unitCostCents)}/${item.unitLabel}). Ajusta cantidad y guarda.`,
    });
  }

  function startEditExpense(exp: BranchExpense) {
    setEditingExpenseId(exp.id);
    setExpBranch(exp.branchId);
    setExpDate(exp.date);
    setExpCategory(exp.category);
    setExpConcept(exp.concept);
    setExpQuantity(String(exp.quantity));
    setExpUnit(exp.unitLabel ?? 'unidad');
    setExpUnitCost((exp.unitCostCents / 100).toFixed(2));
    setExpSupplyId(exp.supplyItemId ?? null);
    setExpNotes(exp.notes ?? '');
    setExpFeedback(null);
  }

  function startEditSupply(item: SupplyItem) {
    setEditingSupplyId(item.id);
    setSupBranch(item.branchId);
    setSupName(item.name);
    setSupUnit(item.unitLabel);
    setSupCost((item.unitCostCents / 100).toFixed(2));
    setSupNotes(item.notes ?? '');
    setSupFeedback(null);
  }

  function resetSupplyForm() {
    setEditingSupplyId(undefined);
    setSupName('');
    setSupUnit('unidad');
    setSupCost('');
    setSupNotes('');
  }

  async function handleSaveExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    const qty = Number.parseFloat(expQuantity);
    const unitCents = parsePesosToCents(expUnitCost);
    if (!expConcept.trim()) {
      setExpFeedback({ type: 'error', text: 'Escribe el concepto del gasto (ej. Jabón líquido).' });
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setExpFeedback({ type: 'error', text: 'La cantidad debe ser mayor a 0.' });
      return;
    }
    if (unitCents === null || unitCents < 100) {
      setExpFeedback({ type: 'error', text: 'Ingresa un costo unitario válido de al menos $1.00 MXN.' });
      return;
    }

    setExpBusy(true);
    setExpFeedback(null);
    const res = await onUpsertExpense(effectiveFormBranch, {
      id: editingExpenseId,
      date: expDate || todayKey,
      category: expCategory,
      concept: expConcept.trim(),
      unitLabel: expUnit.trim() || undefined,
      quantity: qty,
      unitCostCents: unitCents,
      supplyItemId: expSupplyId,
      notes: expNotes.trim() || undefined,
    });
    setExpBusy(false);

    if (!res.ok) {
      setExpFeedback({ type: 'error', text: res.error ?? 'No se pudo guardar el gasto.' });
      return;
    }
    const savedTotal = Math.round((Math.round(qty * 100) / 100) * unitCents);
    setExpFeedback({
      type: 'ok',
      text: editingExpenseId
        ? `Gasto actualizado (${formatMxnCurrency(savedTotal)}).`
        : `Gasto registrado en ${getBranchDisplayName(state, effectiveFormBranch)} (${formatMxnCurrency(savedTotal)}).`,
    });
    resetExpenseForm();
  }

  async function handleDeleteExpense(exp: BranchExpense) {
    if (!canEdit) return;
    setExpBusy(true);
    const res = await onDeleteExpense(exp.branchId, exp.id);
    setExpBusy(false);
    if (!res.ok) {
      setExpFeedback({ type: 'error', text: res.error ?? 'No se pudo eliminar el gasto.' });
    } else {
      if (editingExpenseId === exp.id) resetExpenseForm();
      setExpFeedback({ type: 'ok', text: `Gasto "${exp.concept}" eliminado.` });
    }
  }

  async function handleSaveSupply(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    const costCents = parsePesosToCents(supCost);
    if (!supName.trim()) {
      setSupFeedback({ type: 'error', text: 'Ingresa el nombre del insumo (ej. Jabón para lavadora).' });
      return;
    }
    if (costCents === null || costCents < 100) {
      setSupFeedback({ type: 'error', text: 'El costo unitario debe ser al menos $1.00 MXN.' });
      return;
    }

    setSupBusy(true);
    setSupFeedback(null);
    const res = await onUpsertSupply(effectiveSupplyBranch, {
      id: editingSupplyId,
      name: supName.trim(),
      unitLabel: supUnit.trim() || 'unidad',
      unitCostCents: costCents,
      notes: supNotes.trim() || undefined,
    });
    setSupBusy(false);
    if (!res.ok) {
      setSupFeedback({ type: 'error', text: res.error ?? 'No se pudo guardar el insumo.' });
      return;
    }
    setSupFeedback({
      type: 'ok',
      text: editingSupplyId
        ? `Insumo "${supName.trim()}" actualizado.`
        : `Insumo "${supName.trim()}" agregado al catálogo (${formatMxnCurrency(costCents)}/${supUnit.trim() || 'unidad'}).`,
    });
    resetSupplyForm();
  }

  async function handleSeedDefaultSupplies() {
    if (!canEdit) return;
    setSupBusy(true);
    setSupFeedback(null);
    let added = 0;
    for (const def of DEFAULT_SUPPLY_ITEMS) {
      const res = await onUpsertSupply(effectiveSupplyBranch, def);
      if (res.ok) added += 1;
    }
    setSupBusy(false);
    setSupFeedback({
      type: added > 0 ? 'ok' : 'error',
      text:
        added > 0
          ? `Se cargaron ${added} insumo(s) sugeridos en ${getBranchDisplayName(state, effectiveSupplyBranch)}.`
          : 'Los insumos sugeridos ya están registrados en esta sucursal.',
    });
  }

  function handleExportCsv() {
    const slug = branches.length === 1 ? branches[0] : 'consolidadas';
    downloadCsv(
      `horeb360-gastos-ganancia-${slug}-${todayKey}.csv`,
      [
        'Fecha',
        'Sucursal',
        'Categoría',
        'Concepto',
        'Cantidad',
        'Unidad',
        'Costo unitario MXN',
        'Total MXN',
        'Notas',
      ],
      [
        ...periodExpenses.map((exp) => [
          exp.date,
          getBranchDisplayName(state, exp.branchId),
          CATEGORY_SHORT_LABEL[exp.category],
          exp.concept,
          exp.quantity,
          exp.unitLabel ?? 'unidad',
          (exp.unitCostCents / 100).toFixed(2),
          (exp.totalCents / 100).toFixed(2),
          exp.notes ?? '',
        ]),
        [
          periodRange.label,
          branches.length === 1 ? getBranchDisplayName(state, branches[0]) : 'Consolidado',
          'RESUMEN',
          `Ingresos: ${(pnl.revenueCents / 100).toFixed(2)} MXN | Gastos: ${(pnl.expensesCents / 100).toFixed(2)} MXN`,
          '',
          'GANANCIA NETA',
          '',
          (pnl.netProfitCents / 100).toFixed(2),
          pnl.marginPct !== null ? `Margen ${pnl.marginPct}%` : '',
        ],
      ],
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Barra superior de periodo, alcance y exportación */}
      <section className="card" style={{ padding: '14px 18px' }}>
        <div className="section-head" style={{ marginBottom: 10 }}>
          <div>
            <h2>Gastos y Ganancia Neta</h2>
            <p>
              Control de insumos, gastos operativos por sucursal y utilidad real (ingresos confirmados − gastos).
            </p>
          </div>
          <div className="export-btn-group">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() =>
                exportExpensesAndProfitToExcel(state, {
                  branches,
                  fromDate: periodRange.fromDate,
                  toDate: periodRange.toDate,
                  periodLabel: periodRange.label,
                })
              }
            >
              <FileSpreadsheet size={15} />
              Exportar Excel (.xlsx)
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportCsv}>
              <Download size={14} />
              CSV
            </button>
          </div>
        </div>

        <div className="report-filters-bar" style={{ marginBottom: 0 }}>
          <div className="filter-row" role="group" aria-label="Periodo de análisis">
            {(
              [
                { id: 'semana', label: 'Esta semana' },
                { id: 'mes', label: 'Este mes' },
                { id: 'fecha', label: 'Fecha específica' },
                { id: 'rango', label: 'Rango' },
                { id: 'todo', label: 'Todo' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`filter-pill${period === opt.id ? ' active' : ''}`}
                aria-pressed={period === opt.id}
                onClick={() => setPeriod(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {period === 'fecha' && (
            <label className="inline-filter-date">
              <Calendar size={14} />
              <span>Día:</span>
              <input
                type="date"
                className="input"
                value={specificDate}
                onChange={(e) => setSpecificDate(e.target.value)}
              />
            </label>
          )}

          {period === 'rango' && (
            <div className="inline-filter-range">
              <label className="inline-filter-date">
                <span>Desde:</span>
                <input
                  type="date"
                  className="input"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </label>
              <label className="inline-filter-date">
                <span>Hasta:</span>
                <input
                  type="date"
                  className="input"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </label>
            </div>
          )}

          <span className="badge badge-info" style={{ marginLeft: 'auto' }}>
            {periodRange.label}
          </span>
        </div>

        {localFallbackActive && (
          <div className="alert alert-warning" role="status" style={{ marginTop: 10 }}>
            <span>
              Nota técnica: la Edge Function de nube aún no se ha actualizado con la acción de gastos, por lo que los
              cambios nuevos en esta sección se resguardan localmente en este navegador hasta publicar el backend.
            </span>
          </div>
        )}
      </section>

      {/* 4 KPIs ejecutivos */}
      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <span className="admin-eyebrow">Ingresos confirmados</span>
          <strong className="admin-kpi-number">{formatMxnCurrency(pnl.revenueCents)}</strong>
          <span className="admin-kpi-meta">{pnl.confirmedLinesCount} cobro(s) confirmado(s)</span>
        </div>

        <div className="admin-kpi-card">
          <span className="admin-eyebrow">Total de gastos</span>
          <strong className="admin-kpi-number" style={{ color: 'var(--warning)' }}>
            {formatMxnCurrency(pnl.expensesCents)}
          </strong>
          <span className="admin-kpi-meta">{pnl.expenseCount} gasto(s) registrado(s)</span>
        </div>

        <div className={`admin-kpi-card ${pnl.netProfitCents >= 0 ? 'accent' : ''}`}>
          <span className="admin-eyebrow">Ganancia neta</span>
          <strong
            className={`admin-kpi-number ${
              pnl.netProfitCents >= 0 ? 'net-profit-positive' : 'net-profit-negative'
            }`}
          >
            {pnl.netProfitCents < 0 ? '-' : ''}
            {formatMxnCurrency(Math.abs(pnl.netProfitCents))}
          </strong>
          <span className="admin-kpi-meta">
            {pnl.marginPct !== null ? (
              <>
                {pnl.netProfitCents >= 0 ? (
                  <TrendingUp size={13} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
                ) : (
                  <TrendingDown size={13} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
                )}
                Margen neto: {pnl.marginPct}%
              </>
            ) : (
              'Ingresos − Gastos'
            )}
          </span>
        </div>

        <div className="admin-kpi-card">
          <span className="admin-eyebrow">Gasto en insumos</span>
          <strong className="admin-kpi-number">{formatMxnCurrency(pnl.suppliesCents)}</strong>
          <span className="admin-kpi-meta">{suppliesSharePct}% del total de gastos</span>
        </div>
      </div>

      {/* Cuerpo principal: 2 columnas proporción áurea */}
      <div className="admin-two-col-exec">
        {/* COLUMNA IZQUIERDA: Formulario de gasto + Historial */}
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <section className="card">
            <div className="section-head" style={{ marginBottom: 12 }}>
              <div>
                <h2>
                  <Wallet size={17} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                  {editingExpenseId ? 'Editar gasto registrado' : 'Registrar gasto o compra de insumos'}
                </h2>
                <p>
                  Ejemplo: jabón líquido, 4 garrafas × $180.00 MXN — el sistema calcula el gasto total automáticamente.
                </p>
              </div>
              {editingExpenseId && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={resetExpenseForm}>
                  Cancelar edición
                </button>
              )}
            </div>

            {!canEdit ? (
              <div className="alert alert-warning">
                Solo las cuentas con perfil de Administrador / Supervisión pueden registrar o editar gastos.
              </div>
            ) : (
              <form className="grid-form" onSubmit={handleSaveExpense}>
                <div className="field-row">
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="exp-branch">Sucursal *</label>
                    {scopeBranch === 'all' ? (
                      <CustomSelect
                        id="exp-branch"
                        value={expBranch}
                        options={branches.map((b) => ({
                          value: b,
                          label: getBranchDisplayName(state, b),
                        }))}
                        onChange={(next) => {
                          setExpBranch(next as BranchId);
                          setExpSupplyId(null);
                        }}
                      />
                    ) : (
                      <input
                        id="exp-branch"
                        className="input"
                        value={getBranchDisplayName(state, effectiveFormBranch)}
                        disabled
                      />
                    )}
                  </div>

                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="exp-date">Fecha *</label>
                    <input
                      id="exp-date"
                      type="date"
                      className="input"
                      value={expDate}
                      onChange={(e) => setExpDate(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="exp-category">Categoría *</label>
                  <CustomSelect
                    id="exp-category"
                    value={expCategory}
                    options={EXPENSE_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))}
                    onChange={(next) => {
                      const nextCat = next as ExpenseCategory;
                      setExpCategory(nextCat);
                      setExpSupplyId(null);
                      const meta = EXPENSE_CATEGORIES.find((c) => c.id === nextCat);
                      if (meta) setExpUnit(meta.defaultUnit);
                    }}
                  />
                </div>

                {/* Chips rápidos del catálogo de insumos (estilo QLAK) */}
                {expCategory === 'insumos' && branchSupplies.length > 0 && (
                  <div>
                    <small className="muted" style={{ display: 'block', marginBottom: 6 }}>
                      Atajos del catálogo de insumos ({getBranchDisplayName(state, effectiveFormBranch)}):
                    </small>
                    <div className="supply-quick-chips">
                      {branchSupplies.map((sup) => (
                        <button
                          key={sup.id}
                          type="button"
                          className={`filter-pill${expSupplyId === sup.id ? ' active' : ''}`}
                          onClick={() => applySupplyToExpenseForm(sup)}
                        >
                          {sup.name} · {formatMxnCurrency(sup.unitCostCents)}/{sup.unitLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="field-row">
                  <div className="field" style={{ flex: 2 }}>
                    <label htmlFor="exp-concept">Concepto / Insumo *</label>
                    <input
                      id="exp-concept"
                      className="input"
                      type="text"
                      placeholder="Ej. Jabón líquido para lavadora"
                      value={expConcept}
                      onChange={(e) => setExpConcept(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="exp-unit">Unidad</label>
                    <input
                      id="exp-unit"
                      className="input"
                      type="text"
                      placeholder="garrafa / unidad / recibo"
                      value={expUnit}
                      onChange={(e) => setExpUnit(e.target.value)}
                    />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="exp-qty">Cantidad *</label>
                    <input
                      id="exp-qty"
                      className="input"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="10000"
                      value={expQuantity}
                      onChange={(e) => setExpQuantity(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="exp-cost">Costo unitario ($ MXN) *</label>
                    <input
                      id="exp-cost"
                      className="input"
                      type="number"
                      step="0.01"
                      min="1"
                      placeholder="180.00"
                      value={expUnitCost}
                      onChange={(e) => setExpUnitCost(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="exp-notes">Notas / proveedor (opcional)</label>
                  <input
                    id="exp-notes"
                    className="input"
                    type="text"
                    placeholder="Ej. Compra en distribuidora o folio de nota"
                    value={expNotes}
                    onChange={(e) => setExpNotes(e.target.value)}
                  />
                </div>

                <div className="expense-preview-banner" aria-live="polite">
                  <span>Cálculo total del gasto:</span>
                  <strong>
                    {previewTotalCents !== null
                      ? `${Number.parseFloat(expQuantity)} ${expUnit || 'unidad'} × ${formatMxnCurrency(
                          parsedUnitCents!,
                        )} = ${formatMxnCurrency(previewTotalCents)}`
                      : 'Ingresa cantidad y costo unitario para calcular'}
                  </strong>
                </div>

                {expFeedback && (
                  <div
                    className={`alert ${expFeedback.type === 'ok' ? 'alert-success' : 'alert-error'}`}
                    role="status"
                  >
                    {expFeedback.text}
                  </div>
                )}

                <div className="order-actions">
                  <button type="submit" className="btn btn-primary" disabled={expBusy}>
                    <Plus size={15} />
                    {expBusy
                      ? 'Guardando…'
                      : editingExpenseId
                        ? 'Guardar cambios'
                        : 'Registrar gasto'}
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* Tabla / historial de gastos */}
          <section className="card">
            <div className="section-head" style={{ marginBottom: 12 }}>
              <div>
                <h2>Historial de gastos ({periodExpenses.length})</h2>
                <p>Registros filtrados por el periodo y sucursales seleccionadas</p>
              </div>
            </div>

            <div className="report-filters-bar">
              <label className="search-input-wrap" style={{ flex: '1 1 200px', margin: 0 }}>
                <Search size={15} />
                <input
                  type="search"
                  className="input"
                  placeholder="Buscar por concepto o nota…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </label>
              <div style={{ minWidth: 210 }}>
                <CustomSelect
                  ariaLabel="Filtrar gastos por categoría"
                  value={categoryFilter}
                  options={[
                    { value: 'all', label: 'Todas las categorías' },
                    ...EXPENSE_CATEGORIES.map((c) => ({ value: c.id, label: CATEGORY_SHORT_LABEL[c.id] })),
                  ]}
                  onChange={(next) => setCategoryFilter(next as 'all' | ExpenseCategory)}
                />
              </div>
            </div>

            {periodExpenses.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No hay gastos registrados en este periodo con los filtros actuales.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table" role="table">
                  <thead>
                    <tr role="row">
                      <th role="columnheader">Fecha</th>
                      <th role="columnheader">Sucursal</th>
                      <th role="columnheader">Categoría</th>
                      <th role="columnheader">Concepto</th>
                      <th role="columnheader" className="num">Cantidad × Costo</th>
                      <th role="columnheader" className="num">Total MXN</th>
                      {canEdit && <th role="columnheader" className="num">Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {periodExpenses.map((exp) => (
                      <tr role="row" key={exp.id}>
                        <td role="cell" data-row-heading>
                          <strong>{exp.date}</strong>
                        </td>
                        <td role="cell" data-label="Sucursal">
                          {getBranchDisplayName(state, exp.branchId)}
                        </td>
                        <td role="cell" data-label="Categoría">
                          <span className="badge badge-info">{CATEGORY_SHORT_LABEL[exp.category]}</span>
                        </td>
                        <td role="cell" data-label="Concepto">
                          <div>{exp.concept}</div>
                          {exp.notes && <small className="muted">{exp.notes}</small>}
                        </td>
                        <td role="cell" data-label="Detalle" className="num">
                          {exp.quantity} {exp.unitLabel ?? 'u'} × {formatMxnCurrency(exp.unitCostCents)}
                        </td>
                        <td role="cell" data-label="Total MXN" className="num">
                          <strong>{formatMxnCurrency(exp.totalCents)}</strong>
                        </td>
                        {canEdit && (
                          <td role="cell" data-label="Acciones" className="num">
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                title="Editar gasto"
                                aria-label={`Editar ${exp.concept}`}
                                onClick={() => startEditExpense(exp)}
                              >
                                <Edit3 size={13} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                title="Eliminar gasto"
                                aria-label={`Eliminar ${exp.concept}`}
                                disabled={expBusy}
                                onClick={() => void handleDeleteExpense(exp)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* COLUMNA DERECHA: Desglose por categoría, Rentabilidad por sucursal y Catálogo de Insumos */}
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <section className="card">
            <div className="section-head" style={{ marginBottom: 10 }}>
              <div>
                <h2>Desglose por categoría</h2>
                <p>Distribución de gastos en el periodo seleccionado</p>
              </div>
            </div>

            <div className="category-breakdown-list">
              {pnl.byCategory.map((cat) => {
                const widthPct = cat.totalCents > 0 ? Math.max(4, Math.round((cat.totalCents / maxCategoryCents) * 100)) : 0;
                return (
                  <div key={cat.category} className="category-breakdown-row">
                    <div className="category-breakdown-head">
                      <span>
                        <strong>{CATEGORY_SHORT_LABEL[cat.category]}</strong>{' '}
                        <small className="muted">({cat.count})</small>
                      </span>
                      <span>
                        <strong>{formatMxnCurrency(cat.totalCents)}</strong>{' '}
                        <small className="muted">({cat.sharePct}%)</small>
                      </span>
                    </div>
                    <div className="category-bar-track">
                      <div className="category-bar-fill" style={{ width: `${widthPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {pnl.byBranch.length > 1 && (
            <section className="card">
              <div className="section-head" style={{ marginBottom: 10 }}>
                <div>
                  <h2>Utilidad por sucursal</h2>
                  <p>Comparativo ingresos vs gastos en el periodo</p>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {pnl.byBranch.map((row) => (
                  <div key={row.branchId} className="branch-pnl-row">
                    <div className="branch-pnl-head">
                      <strong>{row.branchName}</strong>
                      <strong
                        className={row.netProfitCents >= 0 ? 'net-profit-positive' : 'net-profit-negative'}
                      >
                        {row.netProfitCents < 0 ? '-' : ''}
                        {formatMxnCurrency(Math.abs(row.netProfitCents))}
                      </strong>
                    </div>
                    <div className="branch-pnl-meta">
                      <span>Ingresos: {formatMxnCurrency(row.revenueCents)}</span>
                      <span>Gastos: {formatMxnCurrency(row.expensesCents)}</span>
                      <span>Insumos: {formatMxnCurrency(row.suppliesCents)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Catálogo de insumos (estilo QLAK) */}
          <section className="card">
            <div className="section-head" style={{ marginBottom: 10 }}>
              <div>
                <h2>
                  <Package size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                  Catálogo de Insumos (estilo QLAK)
                </h2>
                <p>
                  Define costo unitario por insumo (ej. jabón para lavadora $70.00 MXN/unidad) para registrar compras en un clic.
                </p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={supBusy}
                  onClick={() => void handleSeedDefaultSupplies()}
                >
                  <Sparkles size={13} />
                  Cargar sugeridos
                </button>
              )}
            </div>

            {canEdit && (
              <form className="grid-form" style={{ marginBottom: 14 }} onSubmit={handleSaveSupply}>
                {scopeBranch === 'all' && (
                  <div className="field">
                    <label htmlFor="sup-branch">Sucursal del insumo *</label>
                    <CustomSelect
                      id="sup-branch"
                      value={supBranch}
                      options={branches.map((b) => ({
                        value: b,
                        label: getBranchDisplayName(state, b),
                      }))}
                      onChange={(next) => setSupBranch(next as BranchId)}
                    />
                  </div>
                )}

                <div className="field-row">
                  <div className="field" style={{ flex: 2 }}>
                    <label htmlFor="sup-name">Nombre del insumo *</label>
                    <input
                      id="sup-name"
                      className="input"
                      type="text"
                      placeholder="Ej. Jabón para lavadora"
                      value={supName}
                      onChange={(e) => setSupName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="sup-unit">Unidad *</label>
                    <input
                      id="sup-unit"
                      className="input"
                      type="text"
                      placeholder="unidad / garrafa"
                      value={supUnit}
                      onChange={(e) => setSupUnit(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="sup-cost">Costo unitario ($ MXN) *</label>
                    <input
                      id="sup-cost"
                      className="input"
                      type="number"
                      step="0.01"
                      min="1"
                      placeholder="70.00"
                      value={supCost}
                      onChange={(e) => setSupCost(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field" style={{ flex: 2 }}>
                    <label htmlFor="sup-notes">Nota (opcional)</label>
                    <input
                      id="sup-notes"
                      className="input"
                      type="text"
                      placeholder="Marca / proveedor"
                      value={supNotes}
                      onChange={(e) => setSupNotes(e.target.value)}
                    />
                  </div>
                </div>

                {supFeedback && (
                  <div
                    className={`alert ${supFeedback.type === 'ok' ? 'alert-success' : 'alert-error'}`}
                    role="status"
                  >
                    {supFeedback.text}
                  </div>
                )}

                <div className="order-actions">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={supBusy}>
                    <Plus size={14} />
                    {editingSupplyId ? 'Actualizar insumo' : 'Agregar insumo'}
                  </button>
                  {editingSupplyId && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={resetSupplyForm}>
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            )}

            {visibleCatalogSupplies.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
                Sin insumos guardados aún. Usa &ldquo;Cargar sugeridos&rdquo; o agrega tu primer insumo arriba.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {visibleCatalogSupplies.map((sup) => (
                  <div key={sup.id} className="supply-catalog-item">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <strong>{sup.name}</strong>
                        <span className="badge badge-info">{getBranchDisplayName(state, sup.branchId)}</span>
                      </div>
                      <small className="muted">
                        {formatMxnCurrency(sup.unitCostCents)} / {sup.unitLabel}
                        {sup.notes ? ` · ${sup.notes}` : ''}
                      </small>
                    </div>
                    <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => applySupplyToExpenseForm(sup)}
                          >
                            Usar
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            aria-label={`Editar insumo ${sup.name}`}
                            onClick={() => startEditSupply(sup)}
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            aria-label={`Eliminar insumo ${sup.name}`}
                            disabled={supBusy}
                            onClick={() => void onDeleteSupply(sup.branchId, sup.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
