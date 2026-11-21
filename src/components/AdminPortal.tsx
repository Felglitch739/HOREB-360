import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  LayoutDashboard,
  Menu,
  MoonStar,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Store,
  Users,
  WashingMachine,
  X,
} from 'lucide-react';
import { exportAdminConsolidatedToExcel, exportShiftsToExcel } from '../domain/excelExport';
import { formatMxn } from '../domain/money';
import {
  BRANCHES,
  ENCARGO_STAGES,
  getBranchCatalog,
  getBranchInfo,
  getBranchMachines,
  getBranchSettings,
  getBranchSummary,
  getGlobalAdminTotals,
  getOpenShift,
  getOrderPendingCents,
  getShiftMetrics,
} from '../domain/rules';
import type { BranchId, BranchSettings, CashMovement, EncargoStage, MachineKind, MachineStatus } from '../domain/types';
import type { Operation } from '../domain/operations';
import type { SharedWorkspace } from '../Root';
import type { BrandTheme } from '../theme';
import { AdminFloorPlan } from './AdminFloorPlan';
import { SharedStatus } from './SharedStatus';

const AdminView = lazy(() => import('./AdminView').then((m) => ({ default: m.AdminView })));
const AjustesView = lazy(() => import('./AjustesView').then((m) => ({ default: m.AjustesView })));
const CajaView = lazy(() => import('./CajaView').then((m) => ({ default: m.CajaView })));
const ClientesView = lazy(() => import('./ClientesView').then((m) => ({ default: m.ClientesView })));

const ADMIN_NAV = [
  { id: 'resumen', label: 'Centro de Control', icon: LayoutDashboard },
  { id: 'equipos', label: 'Mapa de Equipos', icon: WashingMachine },
  { id: 'finanzas', label: 'Finanzas y Cortes', icon: BarChart3 },
  { id: 'clientes', label: 'Clientes y Rifa', icon: Users },
] as const;

type AdminTabId = (typeof ADMIN_NAV)[number]['id'] | 'ajustes';
type PipelineFilter = 'activas' | 'recibido' | 'lavado' | 'secado' | 'listo' | 'por_cobrar';
type InspectorTab = 'caja' | 'ordenes' | 'equipos';

const weekdayFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'short' });
const dayLabelFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
function formatSpanishDate(date: Date): string {
  const raw = dayLabelFmt.format(date);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
const STAGE_LABELS = Object.fromEntries(ENCARGO_STAGES.map((s) => [s.id, s.label])) as Record<
  EncargoStage,
  string
>;

interface AdminPortalProps {
  shared: SharedWorkspace;
  sharedNotice?: string;
  theme: BrandTheme;
  onSetTheme: (theme: BrandTheme) => void;
  onSwitchToEmployeeView: () => void;
}

export function AdminPortal({
  shared,
  sharedNotice,
  theme,
  onSetTheme,
  onSwitchToEmployeeView,
}: AdminPortalProps) {
  const state = shared.state;
  const visibleBranches = BRANCHES.filter((branch) => shared.roles[branch.id]);
  const branchIds = visibleBranches.map((b) => b.id);

  const [scopeBranch, setScopeBranch] = useState<BranchId | 'all'>('all');
  const [focusedBranch, setFocusedBranch] = useState<BranchId>(
    visibleBranches[0]?.id ?? state.activeBranchId,
  );
  const [activeTab, setActiveTab] = useState<AdminTabId>('resumen');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>('activas');
  const [inspectBranchId, setInspectBranchId] = useState<BranchId | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('caja');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('horeb-admin-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const mainContent = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem('horeb-admin-sidebar-collapsed', String(sidebarCollapsed));
    } catch {
      // ignore storage errors
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!inspectBranchId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setInspectBranchId(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inspectBranchId]);

  const activeBranchId: BranchId =
    scopeBranch !== 'all'
      ? scopeBranch
      : visibleBranches.find((b) => b.id === focusedBranch)?.id ??
        visibleBranches[0]?.id ??
        state.activeBranchId;
  const activeBranch = getBranchInfo(activeBranchId);
  const activeRole = shared.roles[activeBranchId] ?? 'supervisor';
  const activeSettings = getBranchSettings(state, activeBranchId);

  const scopedBranchIds = scopeBranch === 'all' ? branchIds : [scopeBranch];
  const { byBranch, totals } = getGlobalAdminTotals(state, scopedBranchIds);
  const { byBranch: allBranchRows } = getGlobalAdminTotals(state, branchIds);

  const scopedSet = new Set(scopedBranchIds);
  const scopedOrders = state.orders.filter((o) => scopedSet.has(o.branchId));
  const scopedMachines = scopedBranchIds.flatMap((id) => getBranchMachines(state, id));

  // Live pipeline counts
  const activeEncargos = scopedOrders.filter(
    (o) => o.serviceType === 'encargo' && o.encargoStage && o.encargoStage !== 'entregado',
  );
  const countRecibido = activeEncargos.filter((o) => o.encargoStage === 'recibido').length;
  const countLavado = activeEncargos.filter((o) => o.encargoStage === 'lavado').length;
  const countSecado = activeEncargos.filter((o) => o.encargoStage === 'secado').length;
  const countListo = activeEncargos.filter((o) => o.encargoStage === 'listo').length;
  const pendingPaymentOrders = scopedOrders.filter((o) => getOrderPendingCents(state, o.id) > 0);

  const pipelineOrders = (() => {
    if (pipelineFilter === 'activas') return activeEncargos;
    if (pipelineFilter === 'por_cobrar') return pendingPaymentOrders;
    return activeEncargos.filter((o) => o.encargoStage === pipelineFilter);
  })();

  // Executive exceptions / alerts
  const closedBranches = scopedBranchIds.filter((id) => !getOpenShift(state, id));
  const offlineMachines = scopedMachines.filter((m) => m.status === 'fuera_de_servicio');
  const pendingTransfersCount = state.paymentLines.filter((l) => {
    if (l.status !== 'pendiente') return false;
    const ord = state.orders.find((o) => o.id === l.orderId);
    return ord ? scopedSet.has(ord.branchId) : false;
  }).length;

  // Payment Mix percentages
  const mixTotal = Math.max(1, totals.cashCents + totals.cardCents + totals.transferCents);
  const cashPct = Math.round((totals.cashCents / mixTotal) * 100);
  const cardPct = Math.round((totals.cardCents / mixTotal) * 100);
  const transferPct = Math.max(0, 100 - cashPct - cardPct);
  const avgTicketCents =
    totals.orderCount > 0 ? Math.round(totals.totalConfirmedCents / totals.orderCount) : 0;

  // 7-day consolidated chart
  const today = new Date();
  const scopedOrderIds = new Set(scopedOrders.map((o) => o.id));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const total = state.paymentLines.reduce((sum, line) => {
      if (!line.confirmedAt || !scopedOrderIds.has(line.orderId)) return sum;
      const ts = new Date(line.confirmedAt);
      return ts >= date && ts < end ? sum + line.amountCents : sum;
    }, 0);
    return { date, total };
  });
  const maxDayTotal = Math.max(1, ...days.map((d) => d.total));

  function navigate(tab: AdminTabId) {
    setActiveTab(tab);
    setMenuOpen(false);
    window.scrollTo(0, 0);
    if (menuButton.current?.getClientRects().length) {
      mainContent.current?.focus({ preventScroll: true });
    }
  }

  function run(branch: BranchId, operation: Operation) {
    return shared.execute(branch, operation);
  }

  function openBranchInspector(branchId: BranchId, initialTab: InspectorTab = 'caja') {
    setFocusedBranch(branchId);
    setInspectBranchId(branchId);
    setInspectorTab(initialTab);
  }

  const activeLabel =
    activeTab === 'ajustes'
      ? 'Ajustes'
      : ADMIN_NAV.find((entry) => entry.id === activeTab)?.label ?? 'Centro de Control';

  const maxBranchRevenue = Math.max(1, ...allBranchRows.map((r) => r.totalConfirmedCents));

  // Inspector data when open
  const inspectedInfo = inspectBranchId ? getBranchInfo(inspectBranchId) : null;
  const inspectedShift = inspectBranchId ? getOpenShift(state, inspectBranchId) : null;
  const inspectedShiftMetrics = inspectedShift ? getShiftMetrics(state, inspectedShift.id) : null;
  const inspectedSummary = inspectBranchId ? getBranchSummary(state, inspectBranchId) : null;
  const inspectedActiveOrders = inspectBranchId
    ? state.orders.filter(
        (o) =>
          o.branchId === inspectBranchId &&
          ((o.serviceType === 'encargo' && o.encargoStage !== 'entregado') ||
            getOrderPendingCents(state, o.id) > 0),
      )
    : [];
  const inspectedMachines = inspectBranchId ? getBranchMachines(state, inspectBranchId) : [];
  const inspectedLastClosing = inspectBranchId
    ? (state.nightClosings ?? [])
        .filter((nc) => nc.branchId === inspectBranchId)
        .sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0] ?? null
    : null;

  return (
    <div className={`app-shell admin-portal-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside
        className="sidebar admin-sidebar"
        data-menu-open={menuOpen ? '' : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menuOpen && menuButton.current?.getClientRects().length) {
            setMenuOpen(false);
            menuButton.current.focus();
          }
        }}
      >
        <div className="admin-sidebar-top">
          <div className="brand-block admin-brand-compact">
            <span className="brand-mark">
              <WashingMachine size={22} aria-hidden="true" />
            </span>
            <strong>
              HOREB <span>360</span>
            </strong>
          </div>
          <button
            type="button"
            className="admin-sidebar-fold-btn"
            aria-label="Ocultar barra lateral"
            title="Ocultar menú"
            onClick={() => setSidebarCollapsed(true)}
          >
            <PanelLeftClose size={17} aria-hidden="true" />
          </button>
        </div>

        <button
          ref={menuButton}
          type="button"
          className="mobile-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="admin-workspace-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          Menú
        </button>

        <div className="workspace-menu" id="admin-workspace-menu">
          <div className="nav-heading">Dirección</div>
          <nav className="workspace-nav" aria-label="Secciones de administración">
            {ADMIN_NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={activeTab === id ? 'active' : ''}
                aria-current={activeTab === id ? 'page' : undefined}
                onClick={() => navigate(id)}
              >
                <Icon size={19} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <SharedStatus
            branchName={scopeBranch === 'all' ? `${visibleBranches.length} sucursales` : activeBranch.name}
            role={activeRole}
            isOnline={shared.isOnline}
            pendingSyncCount={shared.pendingSyncCount}
            syncing={shared.syncing}
          />

          <div className="sidebar-footer">
            <button
              type="button"
              className={`reset-button ${activeTab === 'ajustes' ? 'active' : ''}`}
              aria-current={activeTab === 'ajustes' ? 'page' : undefined}
              onClick={() => navigate('ajustes')}
            >
              <Settings size={17} aria-hidden="true" /> Ajustes
            </button>
          </div>
        </div>
      </aside>

      <div className="workspace admin-workspace">
        <main ref={mainContent} tabIndex={-1} className="main-content admin-main" data-workspace-tab={activeTab}>
          {sharedNotice && (
            <div className="alert alert-error" role="alert">
              {sharedNotice}
            </div>
          )}
          {shared.syncWarning && (
            <div className="alert alert-error" role="alert">
              {shared.syncWarning}
            </div>
          )}

          {/* Integrated Hero Header (No redundant white top bar!) */}
          <div className="admin-hero-bar">
            <div className="admin-hero-title-row">
              {sidebarCollapsed && (
                <button
                  type="button"
                  className="sidebar-collapse-btn"
                  aria-label="Mostrar barra lateral"
                  title="Mostrar menú"
                  onClick={() => setSidebarCollapsed(false)}
                >
                  <PanelLeftOpen size={19} aria-hidden="true" />
                </button>
              )}
              <div>
                <h1 className="admin-hero-h1">{activeLabel}</h1>
                <p className="admin-hero-sub">
                  {formatSpanishDate(today)} ·{' '}
                  {scopeBranch === 'all' && (activeTab === 'resumen' || activeTab === 'equipos' || activeTab === 'finanzas')
                    ? `Todas las sucursales (${visibleBranches.length})`
                    : `Sucursal ${activeBranch.name}`}
                </p>
              </div>
            </div>

            <div className="admin-hero-controls">
              {/* Branch scope pills */}
              <div className="admin-branch-pills" role="group" aria-label="Alcance de sucursal">
                {(activeTab === 'resumen' || activeTab === 'equipos' || activeTab === 'finanzas') && (
                  <button
                    type="button"
                    className={`admin-branch-pill${scopeBranch === 'all' ? ' active' : ''}`}
                    aria-pressed={scopeBranch === 'all'}
                    onClick={() => setScopeBranch('all')}
                  >
                    Todas ({visibleBranches.length})
                  </button>
                )}
                {visibleBranches.map((branch) => {
                  const isActive =
                    activeTab === 'resumen' || activeTab === 'equipos' || activeTab === 'finanzas'
                      ? scopeBranch === branch.id
                      : activeBranchId === branch.id;
                  return (
                    <button
                      key={branch.id}
                      type="button"
                      className={`admin-branch-pill${isActive ? ' active' : ''}`}
                      aria-pressed={isActive}
                      onClick={() => {
                        setFocusedBranch(branch.id);
                        setScopeBranch(branch.id);
                      }}
                    >
                      {branch.name}
                    </button>
                  );
                })}
              </div>

              {activeTab === 'resumen' && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => exportAdminConsolidatedToExcel(state, scopedBranchIds)}
                >
                  <FileSpreadsheet size={15} aria-hidden="true" />
                  Excel (.xlsx)
                </button>
              )}
            </div>
          </div>

          {/* ================= TAB 1: CENTRO DE CONTROL (EJECUTIVO) ================= */}
          {activeTab === 'resumen' && (
            <div style={{ display: 'grid', gap: 16 }}>
              {/* Actionable Alert Strip */}
              {(closedBranches.length > 0 ||
                offlineMachines.length > 0 ||
                pendingTransfersCount > 0 ||
                countListo > 0) && (
                <div className="admin-alerts-strip" role="region" aria-label="Atención inmediata">
                  {closedBranches.length > 0 && (
                    <button
                      type="button"
                      className="admin-alert-pill warn"
                      onClick={() => openBranchInspector(closedBranches[0], 'caja')}
                    >
                      <AlertTriangle size={14} aria-hidden="true" />
                      <span>
                        <strong>{closedBranches.length}</strong> sucursal(es) con caja cerrada
                      </span>
                    </button>
                  )}
                  {pendingTransfersCount > 0 && (
                    <button
                      type="button"
                      className="admin-alert-pill warn"
                      onClick={() => navigate('finanzas')}
                    >
                      <Clock size={14} aria-hidden="true" />
                      <span>
                        <strong>{pendingTransfersCount}</strong> pago(s) por conciliar
                      </span>
                    </button>
                  )}
                  {offlineMachines.length > 0 && (
                    <button
                      type="button"
                      className="admin-alert-pill danger"
                      onClick={() => navigate('equipos')}
                    >
                      <WashingMachine size={14} aria-hidden="true" />
                      <span>
                        <strong>{offlineMachines.length}</strong> equipo(s) fuera de servicio
                      </span>
                    </button>
                  )}
                  {countListo > 0 && (
                    <button
                      type="button"
                      className="admin-alert-pill info"
                      onClick={() => setPipelineFilter('listo')}
                    >
                      <PackageCheck size={14} aria-hidden="true" />
                      <span>
                        <strong>{countListo}</strong> encargo(s) listos para entregar
                      </span>
                    </button>
                  )}
                </div>
              )}

              {/* Executive KPI Strip */}
              <div className="admin-kpi-grid">
                <div className="admin-kpi-card accent">
                  <span className="admin-eyebrow">Ingresos confirmados</span>
                  <strong className="admin-kpi-number">{formatMxn(totals.totalConfirmedCents)}</strong>
                  <span className="admin-kpi-meta">
                    {totals.orderCount} órdenes · Ticket prom. {formatMxn(avgTicketCents)}
                  </span>
                </div>

                <div className="admin-kpi-card">
                  <span className="admin-eyebrow">En proceso ahora</span>
                  <strong className="admin-kpi-number">{activeEncargos.length}</strong>
                  <span className="admin-kpi-meta">
                    {countLavado} lavando · {countSecado} secando · {countListo} listos
                  </span>
                </div>

                <div className="admin-kpi-card">
                  <span className="admin-eyebrow">Por cobrar</span>
                  <strong
                    className="admin-kpi-number"
                    style={{ color: totals.pendingCents > 0 ? 'var(--warning)' : 'inherit' }}
                  >
                    {formatMxn(totals.pendingCents)}
                  </strong>
                  <span className="admin-kpi-meta">
                    {pendingPaymentOrders.length} orden(es) con saldo pendiente
                  </span>
                </div>

                <div className="admin-kpi-card">
                  <span className="admin-eyebrow">Mezcla de cobro</span>
                  <div className="stacked-bar-track compact" style={{ marginTop: 6 }}>
                    <div className="stacked-bar-seg seg-cash" style={{ width: `${cashPct}%` }} title={`Efectivo ${cashPct}%`} />
                    <div className="stacked-bar-seg seg-card" style={{ width: `${cardPct}%` }} title={`Tarjeta ${cardPct}%`} />
                    <div className="stacked-bar-seg seg-transfer" style={{ width: `${transferPct}%` }} title={`Transferencia ${transferPct}%`} />
                  </div>
                  <div className="payment-mix-legend">
                    <span><i className="legend-dot dot-cash" />Efec. {cashPct}%</span>
                    <span><i className="legend-dot dot-card" />Tarj. {cardPct}%</span>
                    <span><i className="legend-dot dot-transfer" />Transf. {transferPct}%</span>
                  </div>
                </div>
              </div>

              {/* Live Operations Pipeline (Recibido / Lavado / Secado / Listo / Por Cobrar) */}
              <section className="card">
                <div className="section-head" style={{ marginBottom: 12 }}>
                  <div>
                    <h2>Operación en vivo · Órdenes activas</h2>
                    <p>Supervisa en tiempo real qué se está lavando, secando o esperando entrega</p>
                  </div>
                  <span className="badge badge-info">{pipelineOrders.length} en vista</span>
                </div>

                <div className="pipeline-stage-strip" role="group" aria-label="Filtrar pipeline de órdenes">
                  {(
                    [
                      { id: 'activas', label: 'Activas', count: activeEncargos.length, tone: 'primary' },
                      { id: 'recibido', label: 'Recibido', count: countRecibido, tone: 'amber' },
                      { id: 'lavado', label: 'Lavando', count: countLavado, tone: 'blue' },
                      { id: 'secado', label: 'Secando', count: countSecado, tone: 'purple' },
                      { id: 'listo', label: 'Listas entrega', count: countListo, tone: 'green' },
                      { id: 'por_cobrar', label: 'Por cobrar', count: pendingPaymentOrders.length, tone: 'warn' },
                    ] as const
                  ).map((step) => (
                    <button
                      key={step.id}
                      type="button"
                      className={`pipeline-stage-pill tone-${step.tone}${pipelineFilter === step.id ? ' active' : ''}`}
                      aria-pressed={pipelineFilter === step.id}
                      onClick={() => setPipelineFilter(step.id)}
                    >
                      <span>{step.label}</span>
                      <strong>{step.count}</strong>
                    </button>
                  ))}
                </div>

                {pipelineOrders.length === 0 ? (
                  <p className="muted" style={{ margin: '8px 0 0', fontSize: '0.88rem' }}>
                    Sin órdenes en esta etapa para el alcance seleccionado.
                  </p>
                ) : (
                  <div className="admin-live-orders-grid">
                    {pipelineOrders.slice(0, 12).map((order) => {
                      const pending = getOrderPendingCents(state, order.id);
                      const branchName = getBranchInfo(order.branchId).name;
                      const stageLabel = order.encargoStage
                        ? STAGE_LABELS[order.encargoStage]
                        : 'Autoservicio';
                      const timeStr = new Date(order.createdAt).toLocaleTimeString('es-MX', {
                        hour: '2-digit',
                        minute: '2-digit',
                      });

                      return (
                        <button
                          key={order.id}
                          type="button"
                          className="admin-live-order-card"
                          onClick={() => openBranchInspector(order.branchId, 'ordenes')}
                        >
                          <div className="admin-live-order-top">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <strong>{order.folio}</strong>
                              <span className="badge badge-info">{branchName}</span>
                            </div>
                            <span
                              className={`badge ${
                                order.encargoStage === 'listo'
                                  ? 'badge-success'
                                  : order.encargoStage === 'lavado' || order.encargoStage === 'secado'
                                    ? 'badge-info'
                                    : 'badge-warning'
                              }`}
                            >
                              {stageLabel}
                            </span>
                          </div>
                          <div className="admin-live-order-mid">
                            <span>{order.customerAlias || 'Mostrador'}</span>
                            <strong>{formatMxn(order.totalCents)}</strong>
                          </div>
                          <div className="admin-live-order-foot">
                            <small className="muted">{timeStr}</small>
                            {order.assignedMachineLabels && order.assignedMachineLabels.length > 0 && (
                              <small className="badge badge-info">
                                {order.assignedMachineLabels.join(', ')}
                              </small>
                            )}
                            {pending > 0 ? (
                              <small className="badge badge-warning">Pend. {formatMxn(pending)}</small>
                            ) : (
                              <small style={{ color: 'var(--success)', fontWeight: 700 }}>Pagado</small>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Branch Health Cards + 7-Day Trend side by side */}
              <div className="admin-two-col-exec">
                <section className="card">
                  <div className="section-head">
                    <div>
                      <h2>Salud por sucursal</h2>
                      <p>Toca una sucursal para inspeccionar caja, cortes y órdenes activas</p>
                    </div>
                    <Building2 size={18} aria-hidden="true" />
                  </div>

                  <div className="admin-branch-grid">
                    {byBranch.map((row) => {
                      const bId = row.branch.id;
                      const shift = getOpenShift(state, bId);
                      const bSummary = getBranchSummary(state, bId);
                      const bMachines = getBranchMachines(state, bId);
                      const bOrders = state.orders.filter((o) => o.branchId === bId);
                      const bWashing = bOrders.filter((o) => o.encargoStage === 'lavado').length;
                      const bDrying = bOrders.filter((o) => o.encargoStage === 'secado').length;
                      const bReady = bOrders.filter((o) => o.encargoStage === 'listo').length;
                      const sharePct = Math.round((row.totalConfirmedCents / maxBranchRevenue) * 100);

                      return (
                        <article key={bId} className="admin-branch-card">
                          <div className="admin-branch-card-head">
                            <strong>{row.branch.name}</strong>
                            <span className={`badge ${shift ? 'badge-success' : 'badge-warning'}`}>
                              {shift ? `Turno #${shift.number}` : 'Cerrada'}
                            </span>
                          </div>

                          {/* Revenue bar */}
                          <div className="branch-rev-bar-wrap">
                            <div className="branch-rev-bar-head">
                              <strong>{formatMxn(bSummary.totalConfirmedCents)}</strong>
                              <small className="muted">{row.orderCount} folios</small>
                            </div>
                            <div className="loyalty-progress-track">
                              <div
                                className="loyalty-progress-fill"
                                style={{ width: `${Math.max(4, sharePct)}%` }}
                              />
                            </div>
                          </div>

                          {/* Visual machine dots */}
                          <div className="branch-machine-dots-row">
                            <small className="muted">Equipos ({bMachines.length}):</small>
                            {bMachines.length === 0 ? (
                              <small className="muted">Sin padrón</small>
                            ) : (
                              <div className="branch-machine-dots" aria-label="Estado visual de equipos">
                                {bMachines.map((m) => (
                                  <span
                                    key={m.id}
                                    className={`mini-machine-dot status-${m.status}`}
                                    title={`${m.code} (${m.name}): ${m.status}`}
                                  >
                                    {m.code}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="branch-pipeline-micro">
                            <span>Lavando: <strong>{bWashing}</strong></span>
                            <span>Secando: <strong>{bDrying}</strong></span>
                            <span>Listas: <strong>{bReady}</strong></span>
                          </div>

                          <div className="order-actions">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => openBranchInspector(bId, 'caja')}
                            >
                              Inspeccionar sucursal
                              <ArrowUpRight size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openBranchInspector(bId, 'ordenes')}
                            >
                              Órdenes activas
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section className="card insight-card">
                  <div className="section-head">
                    <div>
                      <h2>Tendencia de ingresos</h2>
                      <p>Últimos 7 días confirmados</p>
                    </div>
                  </div>
                  <div className="chart-summary">
                    <strong>
                      {formatMxn(
                        selectedDayIdx !== null
                          ? days[selectedDayIdx].total
                          : days.reduce((sum, day) => sum + day.total, 0),
                      )}
                    </strong>
                    <span>
                      {selectedDayIdx !== null
                        ? dayLabelFmt.format(days[selectedDayIdx].date)
                        : 'Total 7 días'}
                    </span>
                  </div>
                  <div className="histogram" aria-label="Ingresos consolidados por día">
                    {days.map((day, index) => {
                      const isSelected = selectedDayIdx === index;
                      return (
                        <button
                          type="button"
                          key={day.date.toISOString()}
                          className={`chart-column chart-column-btn${isSelected ? ' selected' : ''}`}
                          aria-pressed={isSelected}
                          title={dayLabelFmt.format(day.date) + ' · ' + formatMxn(day.total)}
                          onClick={() => setSelectedDayIdx((prev) => (prev === index ? null : index))}
                        >
                          <div className="bar-track">
                            <div
                              className={
                                'bar-fill' +
                                (index === 6 ? ' current' : '') +
                                (isSelected ? ' selected' : '')
                              }
                              style={{ height: Math.max(day.total ? 6 : 2, (day.total / maxDayTotal) * 100) + '%' }}
                            />
                          </div>
                          <span>{weekdayFmt.format(day.date).replace('.', '')}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* ================= TAB 2: MAPA VISUAL DE EQUIPOS ================= */}
          {activeTab === 'equipos' && (
            <AdminFloorPlan
              state={state}
              branchIds={branchIds}
              scopeBranch={scopeBranch}
              onScopeBranchChange={(next) => {
                setScopeBranch(next);
                if (next !== 'all') setFocusedBranch(next);
              }}
              onUpsertMachine={(branch, machine: { id?: string; code: string; name: string; kind: MachineKind }) =>
                run(branch, { action: 'upsertMachine', machine })
              }
              onDeleteMachine={(branch, machineId) => run(branch, { action: 'deleteMachine', machineId })}
              onSeedSampleMachines={(branch) => run(branch, { action: 'seedSampleMachines' })}
              onSetMachineStatus={(
                branch,
                machineId,
                status: Extract<MachineStatus, 'disponible' | 'fuera_de_servicio'>,
                reason?: string,
              ) => run(branch, { action: 'setMachineStatus', machineId, status, reason })}
            />
          )}

          {/* ================= TAB 3: FINANZAS Y CORTES ================= */}
          <Suspense fallback={<p className="muted" role="status">Cargando sección…</p>}>
            {activeTab === 'finanzas' && (
              <div style={{ display: 'grid', gap: 16 }}>
                <AdminView
                  section="finanzas"
                  state={state}
                  branches={scopedBranchIds}
                  activeBranchId={activeBranchId}
                  role={activeRole}
                  onRunRaffleDraw={(branch, options) =>
                    run(branch, {
                      action: 'runRaffleDraw',
                      year: options.year,
                      notes: options.notes,
                    })
                  }
                />

                {scopeBranch === 'all' ? (
                  <>
                    {/* Consolidado de turnos y cortes de todas las sucursales */}
                    <section className="card">
                      <h2 className="card-title">
                        <span>Turnos y cortes · Todas las sucursales</span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={state.shifts.filter((s) => scopedSet.has(s.branchId)).length === 0}
                          onClick={() =>
                            exportShiftsToExcel(
                              state,
                              state.shifts.filter((s) => scopedSet.has(s.branchId)),
                              'todas',
                            )
                          }
                        >
                          <FileSpreadsheet size={15} aria-hidden="true" /> Exportar turnos (.xlsx)
                        </button>
                      </h2>
                      <div className="table-wrap stacked-table">
                        <table role="table">
                          <thead role="rowgroup">
                            <tr role="row">
                              <th role="columnheader">Sucursal</th>
                              <th role="columnheader">Turno</th>
                              <th role="columnheader">Estado</th>
                              <th role="columnheader" className="num">Efectivo esp.</th>
                              <th role="columnheader" className="num">Contado</th>
                              <th role="columnheader" className="num">Diferencia</th>
                              <th role="columnheader" className="num">Tarjeta + Transf.</th>
                              <th role="columnheader" className="num">Acción</th>
                            </tr>
                          </thead>
                          <tbody role="rowgroup">
                            {state.shifts
                              .filter((s) => scopedSet.has(s.branchId))
                              .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
                              .map((shift) => {
                                const m = getShiftMetrics(state, shift.id);
                                return (
                                  <tr role="row" key={shift.id}>
                                    <td role="cell" data-row-heading>
                                      <strong>{getBranchInfo(shift.branchId).name}</strong>
                                    </td>
                                    <td role="cell" data-label="Turno">Turno #{shift.number}</td>
                                    <td role="cell" data-label="Estado">
                                      <span className={`badge ${shift.status === 'abierto' ? 'badge-success' : 'badge-info'}`}>
                                        {shift.status === 'abierto' ? 'Abierto' : 'Cerrado'}
                                      </span>
                                    </td>
                                    <td role="cell" data-label="Efectivo esp." className="num">
                                      {formatMxn(m.expectedCashCents)}
                                    </td>
                                    <td role="cell" data-label="Contado" className="num">
                                      {shift.status === 'cerrado' ? formatMxn(m.countedCashCents) : '—'}
                                    </td>
                                    <td
                                      role="cell"
                                      data-label="Diferencia"
                                      className={`num ${
                                        shift.status === 'cerrado'
                                          ? m.differenceCents < 0
                                            ? 'diff-neg'
                                            : m.differenceCents > 0
                                              ? 'diff-pos'
                                              : ''
                                          : ''
                                      }`}
                                    >
                                      {shift.status === 'cerrado'
                                        ? `${m.differenceCents > 0 ? '+' : ''}${formatMxn(m.differenceCents)}`
                                        : '—'}
                                    </td>
                                    <td role="cell" data-label="Tarjeta + Transf." className="num">
                                      {formatMxn(m.confirmedCardCents + m.confirmedTransferCents)}
                                    </td>
                                    <td role="cell" data-label="Acción" className="num">
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => {
                                          setFocusedBranch(shift.branchId);
                                          setScopeBranch(shift.branchId);
                                        }}
                                      >
                                        Abrir caja
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    {/* Cierres nocturnos consolidados (23:00) */}
                    <section className="card">
                      <h2 className="card-title">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <MoonStar size={18} aria-hidden="true" />
                          Cierres nocturnos (23:00) · Todas las sucursales
                        </span>
                        <span className="badge badge-info">
                          {(state.nightClosings ?? []).filter((nc) => scopedSet.has(nc.branchId)).length} reporte(s)
                        </span>
                      </h2>
                      {(state.nightClosings ?? []).filter((nc) => scopedSet.has(nc.branchId)).length === 0 ? (
                        <p className="muted" style={{ margin: 0 }}>
                          Aún no hay reportes de cierre nocturno guardados. Selecciona una sucursal arriba para gestionar su caja y cierres.
                        </p>
                      ) : (
                        <div style={{ display: 'grid', gap: 10 }}>
                          {(state.nightClosings ?? [])
                            .filter((nc) => scopedSet.has(nc.branchId))
                            .sort((a, b) => b.closingDate.localeCompare(a.closingDate))
                            .map((report) => (
                              <details key={report.id} className="night-closing-card">
                                <summary>
                                  <div>
                                    <strong>{report.closingDate}</strong> · {getBranchInfo(report.branchId).name}{' '}
                                    <span className={`badge ${report.wasAutoClosed ? 'badge-warning' : 'badge-success'}`}>
                                      {report.wasAutoClosed ? `Auto 23:00 (#${report.shiftNumber ?? '-'})` : 'Corte manual'}
                                    </span>
                                  </div>
                                  <strong>{formatMxn(report.totalConfirmedCents)} confirmado</strong>
                                </summary>
                                <pre className="night-report-pre">{report.reportText}</pre>
                                <small className="muted">
                                  Ejecutado: {new Date(report.executedAt).toLocaleString('es-MX')} · {report.executedBy}
                                </small>
                              </details>
                            ))}
                        </div>
                      )}
                    </section>
                  </>
                ) : (
                  <CajaView
                    key={activeBranchId}
                    state={state}
                    branchId={activeBranchId}
                    canManage={activeRole === 'supervisor'}
                    onCloseShift={(branch, amount) => run(branch, { action: 'closeShift', amount })}
                    onOpenNewShift={(branch, amount) => run(branch, { action: 'openShift', amount })}
                    onMovement={(branch, kind: CashMovement['kind'], amount, reason) =>
                      run(branch, { action: 'movement', kind, amount, reason })
                    }
                    onConfirmPaymentLine={(lineId, reference) => {
                      const line = state.paymentLines.find((item) => item.id === lineId);
                      const ordBranch = line
                        ? state.orders.find((o) => o.id === line.orderId)?.branchId ?? activeBranchId
                        : activeBranchId;
                      return run(ordBranch, { action: 'confirm', lineId, reference });
                    }}
                    onConfirmTransferBatch={(branch, items) =>
                      run(branch, { action: 'confirmTransferBatch', items })
                    }
                    onRunNightClosing={(branch, options) =>
                      run(branch, {
                        action: 'runNightClosing',
                        closingDate: options.closingDate,
                        enforce2300Rule: options.enforce2300Rule,
                      })
                    }
                  />
                )}
              </div>
            )}

            {/* ================= TAB 4: CLIENTES Y RIFA ================= */}
            {activeTab === 'clientes' && (
              <div style={{ display: 'grid', gap: 16 }}>
                <ClientesView
                  state={state}
                  branchId={activeBranchId}
                  role={activeRole}
                  onUpsertCustomer={(branch, customer) =>
                    run(branch, { action: 'upsertCustomer', customer })
                  }
                  onSeedSampleCustomers={(branch) => run(branch, { action: 'seedSampleCustomers' })}
                />
                <AdminView
                  section="rifa"
                  state={state}
                  branches={branchIds}
                  activeBranchId={activeBranchId}
                  role={activeRole}
                  onRunRaffleDraw={(branch, options) =>
                    run(branch, {
                      action: 'runRaffleDraw',
                      year: options.year,
                      notes: options.notes,
                    })
                  }
                />
              </div>
            )}

            {/* ================= TAB 5: AJUSTES ================= */}
            {activeTab === 'ajustes' && (
              <AjustesView
                key={activeBranchId}
                branchId={activeBranchId}
                branchName={activeBranch.name}
                role={activeRole}
                isOnline={shared.isOnline}
                settings={activeSettings}
                catalog={getBranchCatalog(state, activeBranchId)}
                auditLogs={(state.auditLogs ?? []).filter((entry) => entry.branchId === activeBranchId)}
                theme={theme}
                onSetTheme={onSetTheme}
                onSaveSettings={(branch, settings: Partial<BranchSettings>) =>
                  run(branch, { action: 'updateSettings', settings })
                }
                onStartTour={onSwitchToEmployeeView}
                onReload={shared.reload}
                onSignOut={shared.signOut}
                modeSwitcher={{
                  title: 'Vista de Empleado / Mostrador',
                  description:
                    'Cambia a la interfaz operativa de Mostrador (POS, creación rápida de órdenes y entrega) que usan los empleados en tienda.',
                  buttonLabel: 'Pasar a vista de Mostrador (Empleado)',
                  onSwitch: onSwitchToEmployeeView,
                }}
              />
            )}
          </Suspense>
        </main>
      </div>

      {/* ================= EXECUTIVE BRANCH INSPECTOR DRAWER ================= */}
      {inspectBranchId && inspectedInfo && inspectedSummary && (
        <div
          className="orders-drawer-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInspectBranchId(null);
          }}
        >
          <aside
            className="orders-drawer admin-inspector-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Inspector de ${inspectedInfo.name}`}
          >
            <div className="orders-drawer-head">
              <div className="orders-drawer-title-group">
                <h2>{inspectedInfo.name}</h2>
                <span className={`badge ${inspectedShift ? 'badge-success' : 'badge-warning'}`}>
                  {inspectedShift ? `Turno #${inspectedShift.number} abierto` : 'Caja cerrada'}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm orders-drawer-close"
                aria-label="Cerrar inspector"
                onClick={() => setInspectBranchId(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="inspector-tabs" role="tablist" aria-label="Vistas de sucursal">
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'caja'}
                className={`inspector-tab-btn${inspectorTab === 'caja' ? ' active' : ''}`}
                onClick={() => setInspectorTab('caja')}
              >
                Caja y cortes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'ordenes'}
                className={`inspector-tab-btn${inspectorTab === 'ordenes' ? ' active' : ''}`}
                onClick={() => setInspectorTab('ordenes')}
              >
                Órdenes activas ({inspectedActiveOrders.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'equipos'}
                className={`inspector-tab-btn${inspectorTab === 'equipos' ? ' active' : ''}`}
                onClick={() => setInspectorTab('equipos')}
              >
                Equipos ({inspectedMachines.length})
              </button>
            </div>

            <div className="orders-drawer-body" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
              {inspectorTab === 'caja' && (
                <>
                  <div className="metrics-grid" style={{ marginBottom: 0 }}>
                    <div className="metric-box">
                      <span className="metric-label">Confirmado</span>
                      <strong className="metric-value">{formatMxn(inspectedSummary.totalConfirmedCents)}</strong>
                    </div>
                    <div className="metric-box">
                      <span className="metric-label">Efectivo esperado</span>
                      <strong className="metric-value">
                        {inspectedShiftMetrics
                          ? formatMxn(inspectedShiftMetrics.expectedCashCents)
                          : formatMxn(inspectedSummary.cashCents)}
                      </strong>
                    </div>
                    <div className="metric-box">
                      <span className="metric-label">Tarjeta / Transf.</span>
                      <strong className="metric-value">
                        {formatMxn(inspectedSummary.cardCents + inspectedSummary.transferCents)}
                      </strong>
                    </div>
                    <div className="metric-box">
                      <span className="metric-label">Por cobrar</span>
                      <strong
                        className="metric-value"
                        style={{ color: inspectedSummary.pendingCents > 0 ? 'var(--warning)' : 'inherit' }}
                      >
                        {formatMxn(inspectedSummary.pendingCents)}
                      </strong>
                    </div>
                  </div>

                  {inspectedShift && (
                    <div className="card" style={{ padding: 12, background: 'var(--surface-alt)' }}>
                      <strong style={{ display: 'block', marginBottom: 6, fontSize: '0.9rem' }}>
                        Turno #{inspectedShift.number} en curso
                      </strong>
                      <small className="muted" style={{ display: 'block' }}>
                        Fondo inicial: <strong>{formatMxn(inspectedShift.openingCashCents ?? 0)}</strong> ·
                        Movimientos: <strong>{inspectedShift.cashMovements?.length ?? 0}</strong>
                      </small>
                      {(inspectedShift.cashMovements ?? []).length > 0 && (
                        <ul className="pos-summary-list" style={{ marginTop: 8 }}>
                          {(inspectedShift.cashMovements ?? []).map((mov, i) => (
                            <li key={mov.createdAt + i}>
                              <span>
                                {mov.kind === 'entrada' ? 'Entrada' : 'Retiro'}: {mov.reason}
                              </span>
                              <span>{formatMxn(mov.amountCents)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {inspectedLastClosing && (
                    <div className="card" style={{ padding: 12, background: 'var(--surface-alt)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <strong style={{ fontSize: '0.9rem' }}>Último cierre nocturno</strong>
                        <span className="badge badge-info">{inspectedLastClosing.closingDate}</span>
                      </div>
                      <small className="muted">
                        Total confirmado: <strong>{formatMxn(inspectedLastClosing.totalConfirmedCents)}</strong> ·{' '}
                        {inspectedLastClosing.wasAutoClosed ? 'Cierre automático 23:00' : 'Cierre manual'}
                      </small>
                    </div>
                  )}

                  <div className="order-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setFocusedBranch(inspectBranchId);
                        setScopeBranch(inspectBranchId);
                        setInspectBranchId(null);
                        navigate('finanzas');
                      }}
                    >
                      Gestionar cortes y conciliación
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setInspectBranchId(null);
                        onSwitchToEmployeeView();
                      }}
                    >
                      <Store size={14} /> Abrir mostrador
                    </button>
                  </div>
                </>
              )}

              {inspectorTab === 'ordenes' && (
                <>
                  {inspectedActiveOrders.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>
                      <CheckCircle2 size={15} style={{ verticalAlign: 'text-bottom', marginRight: 5 }} />
                      Sin encargos activos ni saldos pendientes en {inspectedInfo.name}.
                    </p>
                  ) : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {inspectedActiveOrders.map((order) => {
                        const pending = getOrderPendingCents(state, order.id);
                        return (
                          <div key={order.id} className="admin-live-order-card static">
                            <div className="admin-live-order-top">
                              <strong>{order.folio}</strong>
                              <span
                                className={`badge ${
                                  order.encargoStage === 'listo'
                                    ? 'badge-success'
                                    : order.encargoStage
                                      ? 'badge-info'
                                      : 'badge-warning'
                                }`}
                              >
                                {order.encargoStage ? STAGE_LABELS[order.encargoStage] : 'Autoservicio'}
                              </span>
                            </div>
                            <div className="admin-live-order-mid">
                              <span>{order.customerAlias || 'Mostrador'}</span>
                              <strong>{formatMxn(order.totalCents)}</strong>
                            </div>
                            <div className="admin-live-order-foot">
                              <small className="muted">
                                {new Date(order.createdAt).toLocaleTimeString('es-MX', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </small>
                              {order.assignedMachineLabels && order.assignedMachineLabels.length > 0 && (
                                <small className="badge badge-info">
                                  {order.assignedMachineLabels.join(', ')}
                                </small>
                              )}
                              {pending > 0 ? (
                                <small className="badge badge-warning">Pend. {formatMxn(pending)}</small>
                              ) : (
                                <small style={{ color: 'var(--success)', fontWeight: 700 }}>Pagado</small>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {inspectorTab === 'equipos' && (
                <>
                  {inspectedMachines.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>
                      No hay equipos registrados en {inspectedInfo.name}.
                    </p>
                  ) : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {inspectedMachines.map((m) => (
                        <div key={m.id} className={`machine-card status-${m.status}`} style={{ padding: 10 }}>
                          <div className="machine-card-head">
                            <div>
                              <strong className="machine-code">{m.code} · {m.name}</strong>
                              <span className="machine-name">{m.kind === 'lavadora' ? 'Lavadora' : 'Secadora'}</span>
                            </div>
                            <span
                              className={`badge ${
                                m.status === 'disponible'
                                  ? 'badge-success'
                                  : m.status === 'en_uso'
                                    ? 'badge-info'
                                    : 'badge-danger'
                              }`}
                            >
                              {m.status === 'disponible'
                                ? 'Disponible'
                                : m.status === 'en_uso'
                                  ? `En uso (${m.currentOrderFolio ?? ''})`
                                  : 'Fuera de serv.'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setScopeBranch(inspectBranchId);
                      setInspectBranchId(null);
                      navigate('equipos');
                    }}
                  >
                    Abrir Mapa Visual de Equipos
                  </button>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
