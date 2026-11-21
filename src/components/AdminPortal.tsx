import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Building2,
  FileSpreadsheet,
  LayoutDashboard,
  MapPin,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Store,
  Users,
  WashingMachine,
  X,
} from 'lucide-react';
import { exportAdminConsolidatedToExcel } from '../domain/excelExport';
import { formatMxn } from '../domain/money';
import {
  BRANCHES,
  getBranchCatalog,
  getBranchInfo,
  getBranchMachines,
  getBranchSettings,
  getBranchSummary,
  getGlobalAdminTotals,
  getOpenShift,
} from '../domain/rules';
import type { BranchId, BranchSettings, CashMovement, MachineKind, MachineStatus } from '../domain/types';
import type { Operation } from '../domain/operations';
import type { SharedWorkspace } from '../Root';
import type { BrandTheme } from '../theme';
import { CustomSelect } from './CustomSelect';
import { SharedStatus } from './SharedStatus';

const AdminView = lazy(() => import('./AdminView').then((m) => ({ default: m.AdminView })));
const AjustesView = lazy(() => import('./AjustesView').then((m) => ({ default: m.AjustesView })));
const CajaView = lazy(() => import('./CajaView').then((m) => ({ default: m.CajaView })));
const ClientesView = lazy(() => import('./ClientesView').then((m) => ({ default: m.ClientesView })));
const EquiposView = lazy(() => import('./EquiposView').then((m) => ({ default: m.EquiposView })));

const ADMIN_NAV = [
  { id: 'resumen', label: 'Ejecutivo', icon: LayoutDashboard },
  { id: 'finanzas', label: 'Finanzas y Cortes', icon: BarChart3 },
  { id: 'equipos', label: 'Equipos', icon: WashingMachine },
  { id: 'clientes', label: 'Clientes y Rifa', icon: Users },
] as const;

type AdminTabId = (typeof ADMIN_NAV)[number]['id'] | 'ajustes';

const weekdayFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'short' });
const dayLabelFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

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
  const [selectedBranch, setSelectedBranch] = useState<BranchId>(state.activeBranchId);
  const [activeTab, setActiveTab] = useState<AdminTabId>('resumen');
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

  const activeBranchId =
    visibleBranches.find((branch) => branch.id === selectedBranch)?.id ??
    visibleBranches[0]?.id ??
    state.activeBranchId;
  const activeBranch = getBranchInfo(activeBranchId);
  const activeRole = shared.roles[activeBranchId] ?? 'supervisor';
  const activeSettings = getBranchSettings(state, activeBranchId);
  const branchIds = visibleBranches.map((b) => b.id);
  const { byBranch, totals } = getGlobalAdminTotals(state, branchIds);

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

  const today = new Date();
  const allowedBranchSet = new Set(branchIds);
  const allowedOrderIds = new Set(
    state.orders.filter((o) => allowedBranchSet.has(o.branchId)).map((o) => o.id),
  );
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const total = state.paymentLines.reduce((sum, line) => {
      if (!line.confirmedAt || !allowedOrderIds.has(line.orderId)) return sum;
      const ts = new Date(line.confirmedAt);
      return ts >= date && ts < end ? sum + line.amountCents : sum;
    }, 0);
    return { date, total };
  });
  const maxDayTotal = Math.max(1, ...days.map((d) => d.total));

  const activeLabel =
    activeTab === 'ajustes'
      ? 'Ajustes'
      : ADMIN_NAV.find((entry) => entry.id === activeTab)?.label ?? 'Ejecutivo';

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside
        className="sidebar"
        data-menu-open={menuOpen ? '' : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menuOpen && menuButton.current?.getClientRects().length) {
            setMenuOpen(false);
            menuButton.current.focus();
          }
        }}
      >
        <div className="brand-block">
          <span className="brand-mark">
            <ShieldCheck size={23} aria-hidden="true" />
          </span>
          <div>
            <strong>
              HOREB <span>Admin</span>
            </strong>
            <small>Portal de administración</small>
          </div>
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
          <div className="nav-heading">Administración</div>
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
            branchName={activeBranch.name}
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

      <div className="workspace">
        <header className="workspace-header">
          <div className="workspace-header-left">
            <button
              type="button"
              className="sidebar-collapse-btn"
              aria-label={sidebarCollapsed ? 'Mostrar menú lateral' : 'Ocultar menú lateral'}
              aria-expanded={!sidebarCollapsed}
              title={sidebarCollapsed ? 'Mostrar menú' : 'Ocultar menú'}
              onClick={() => setSidebarCollapsed((c) => !c)}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={19} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={19} aria-hidden="true" />
              )}
            </button>
            <div className="breadcrumb">
              Portal Admin <span>/</span> <strong>{activeLabel}</strong>
            </div>
          </div>

          <div className="workspace-actions">
            <CustomSelect
              ariaLabel="Sucursal seleccionada"
              compact
              icon={<MapPin size={16} aria-hidden="true" />}
              value={activeBranchId}
              options={visibleBranches.map((branch) => ({ value: branch.id, label: branch.name }))}
              onChange={(value) => setSelectedBranch(value)}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => exportAdminConsolidatedToExcel(state, branchIds)}
            >
              <FileSpreadsheet size={16} aria-hidden="true" />
              Excel ejecutivo
            </button>
          </div>
        </header>

        <main ref={mainContent} tabIndex={-1} className="main-content" data-workspace-tab={activeTab}>
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

          {activeTab === 'resumen' && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div className="page-intro">
                <div>
                  <h1>Resumen ejecutivo</h1>
                  <p style={{ textTransform: 'capitalize' }}>
                    {dayLabelFmt.format(today)} · {visibleBranches.length} sucursal(es)
                  </p>
                </div>
                <button type="button" className="btn btn-secondary" onClick={onSwitchToEmployeeView}>
                  <Store size={17} aria-hidden="true" /> Vista de mostrador
                </button>
              </div>

              <div className="kpi-strip">
                <div className="kpi-cell">
                  <span className="kpi-label">Total confirmado</span>
                  <strong className="kpi-value">{formatMxn(totals.totalConfirmedCents)}</strong>
                  <span className="kpi-note">{totals.orderCount} órdenes registradas</span>
                </div>
                <div className="kpi-cell">
                  <span className="kpi-label">Efectivo</span>
                  <strong className="kpi-value">{formatMxn(totals.cashCents)}</strong>
                  <span className="kpi-note">En caja consolidada</span>
                </div>
                <div className="kpi-cell">
                  <span className="kpi-label">Tarjeta + Transf.</span>
                  <strong className="kpi-value">
                    {formatMxn(totals.cardCents + totals.transferCents)}
                  </strong>
                  <span className="kpi-note">
                    {formatMxn(totals.cardCents)} tarj. · {formatMxn(totals.transferCents)} transf.
                  </span>
                </div>
                <button
                  type="button"
                  className="kpi-cell interactive"
                  onClick={() => navigate('finanzas')}
                >
                  <span className="kpi-label">Saldo pendiente</span>
                  <strong
                    className="kpi-value"
                    style={{ color: totals.pendingCents > 0 ? 'var(--warning)' : 'inherit' }}
                  >
                    {formatMxn(totals.pendingCents)}
                  </strong>
                  <span className="kpi-note">Ver detalle financiero →</span>
                </button>
              </div>

              <section className="card">
                <div className="section-head">
                  <div>
                    <h2>Semáforo de sucursales</h2>
                    <p>Estado en tiempo real de cajas, equipos y encargos listos</p>
                  </div>
                  <Building2 size={19} aria-hidden="true" />
                </div>
                <div className="admin-branch-grid">
                  {byBranch.map((row) => {
                    const bId = row.branch.id;
                    const shift = getOpenShift(state, bId);
                    const bSummary = getBranchSummary(state, bId);
                    const bMachines = getBranchMachines(state, bId);
                    const avail = bMachines.filter((m) => m.status === 'disponible').length;
                    const inUse = bMachines.filter((m) => m.status === 'en_uso').length;
                    const offline = bMachines.filter((m) => m.status === 'fuera_de_servicio').length;
                    const pendingTransfers = state.paymentLines.filter((l) => {
                      if (l.status !== 'pendiente') return false;
                      const ord = state.orders.find((o) => o.id === l.orderId);
                      return ord?.branchId === bId;
                    }).length;
                    const readyCount = state.orders.filter(
                      (o) => o.branchId === bId && o.encargoStage === 'listo',
                    ).length;

                    return (
                      <article
                        key={bId}
                        className={`admin-branch-card${bId === activeBranchId ? ' selected' : ''}`}
                      >
                        <div className="admin-branch-card-head">
                          <strong>{row.branch.name}</strong>
                          <span className={`badge ${shift ? 'badge-success' : 'badge-warning'}`}>
                            {shift ? `Turno #${shift.number}` : 'Caja cerrada'}
                          </span>
                        </div>
                        <div className="admin-branch-stats">
                          <div>
                            <small>Confirmado</small>
                            <strong>{formatMxn(bSummary.totalConfirmedCents)}</strong>
                          </div>
                          <div>
                            <small>Por cobrar</small>
                            <strong style={{ color: bSummary.pendingCents > 0 ? 'var(--warning)' : 'inherit' }}>
                              {formatMxn(bSummary.pendingCents)}
                            </strong>
                          </div>
                          <div>
                            <small>Equipos</small>
                            <strong>
                              {avail} lib. · {inUse} uso{offline > 0 ? ` · ${offline} f/s` : ''}
                            </strong>
                          </div>
                          <div>
                            <small>Pendientes</small>
                            <strong>
                              {readyCount} listos · {pendingTransfers} p/conciliar
                            </strong>
                          </div>
                        </div>
                        <div className="order-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setSelectedBranch(bId);
                              navigate('finanzas');
                            }}
                          >
                            Ver cortes y caja
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setSelectedBranch(bId);
                              navigate('equipos');
                            }}
                          >
                            Equipos
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
                    <h2>Ingresos consolidados (últimos 7 días)</h2>
                    <p>Pagos confirmados sumando todas las sucursales visibles</p>
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
                      ? `MXN · ${dayLabelFmt.format(days[selectedDayIdx].date)}`
                      : 'MXN · 7 días (toca un día para ver detalle)'}
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
                              'bar-fill' + (index === 6 ? ' current' : '') + (isSelected ? ' selected' : '')
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
          )}

          {activeTab !== 'resumen' && (
            <div className="page-intro">
              <div>
                <h1>{activeLabel}</h1>
                <p>{activeTab === 'finanzas' ? `Consolidado y detalle de ${activeBranch.name}` : activeBranch.name}</p>
              </div>
            </div>
          )}

          <Suspense fallback={<p className="muted" role="status">Cargando sección…</p>}>
            {activeTab === 'finanzas' && (
              <div style={{ display: 'grid', gap: 16 }}>
                <AdminView
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
              </div>
            )}

            {activeTab === 'equipos' && (
              <EquiposView
                key={activeBranchId}
                state={state}
                branchId={activeBranchId}
                role={activeRole}
                onUpsertMachine={(
                  branch,
                  machine: { id?: string; code: string; name: string; kind: MachineKind },
                ) => run(branch, { action: 'upsertMachine', machine })}
                onDeleteMachine={(branch, machineId) =>
                  run(branch, { action: 'deleteMachine', machineId })
                }
                onSeedSampleMachines={(branch) => run(branch, { action: 'seedSampleMachines' })}
                onSetMachineStatus={(
                  branch,
                  machineId,
                  status: Extract<MachineStatus, 'disponible' | 'fuera_de_servicio'>,
                  reason?: string,
                ) => run(branch, { action: 'setMachineStatus', machineId, status, reason })}
              />
            )}

            {activeTab === 'clientes' && (
              <ClientesView
                state={state}
                branchId={activeBranchId}
                role={activeRole}
                onUpsertCustomer={(branch, customer) =>
                  run(branch, { action: 'upsertCustomer', customer })
                }
                onSeedSampleCustomers={(branch) => run(branch, { action: 'seedSampleCustomers' })}
              />
            )}

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
                    'Cambia a la interfaz operativa de Mostrador (POS, seguimiento de órdenes y entrega) que usan los operadores en tienda.',
                  buttonLabel: 'Pasar a vista de Mostrador (Empleado)',
                  onSwitch: onSwitchToEmployeeView,
                }}
              />
            )}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
