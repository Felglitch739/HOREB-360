import { Suspense, lazy, useRef, useState } from 'react';
import { BarChart3, ClipboardList, Compass, LayoutDashboard, MapPin, Menu, Plus, Settings, Store, Users, Wallet, WashingMachine, X } from 'lucide-react';
import type { TourTabId } from './components/AppTour';
import { CustomSelect } from './components/CustomSelect';
import { MostradorView } from './components/MostradorView';
import { Overview } from './components/Overview';
import { SharedStatus } from './components/SharedStatus';
import {
  BRANCHES,
  getBranchCatalog,
  getBranchInfo,
  getBranchSettings,
  getOpenShift,
  getOrderPaymentLines,
  type CreateOrderInput,
  type PaymentInputLine,
} from './domain/rules';
import { type Operation } from './domain/operations';
import type { SharedWorkspace } from './Root';
import type { BranchId, BranchSettings, CashMovement, MachineKind, MachineStatus } from './domain/types';
import type { BrandTheme } from './theme';

const AdminView = lazy(() => import('./components/AdminView').then((m) => ({ default: m.AdminView })));
const AjustesView = lazy(() => import('./components/AjustesView').then((m) => ({ default: m.AjustesView })));
const AppTour = lazy(() => import('./components/AppTour').then((m) => ({ default: m.AppTour })));
const CajaView = lazy(() => import('./components/CajaView').then((m) => ({ default: m.CajaView })));
const ClientesView = lazy(() => import('./components/ClientesView').then((m) => ({ default: m.ClientesView })));
const EquiposView = lazy(() => import('./components/EquiposView').then((m) => ({ default: m.EquiposView })));
const TicketModal = lazy(() => import('./components/TicketModal').then((m) => ({ default: m.TicketModal })));

const navigation = [
  { id: 'inicio', label: 'Inicio', icon: LayoutDashboard },
  { id: 'mostrador', label: 'Mostrador', icon: Store },
  { id: 'ordenes', label: 'Órdenes', icon: ClipboardList },
  { id: 'equipos', label: 'Equipos', icon: WashingMachine },
  { id: 'clientes', label: 'Clientes', icon: Users },
  { id: 'caja', label: 'Caja', icon: Wallet },
  { id: 'admin', label: 'Reportes', icon: BarChart3 },
] as const;

type TabId = (typeof navigation)[number]['id'] | 'ajustes';

export function App({ shared, sharedNotice, theme, onSetTheme }: {
  shared: SharedWorkspace;
  sharedNotice?: string;
  theme: BrandTheme;
  onSetTheme: (theme: BrandTheme) => void;
}) {
  const [selectedBranch, setSelectedBranch] = useState(shared.state.activeBranchId);
  const state = shared.state;
  const visibleBranches = BRANCHES.filter((branch) => shared.roles[branch.id]);
  const [activeTab, setActiveTab] = useState<TabId>('inicio');
  const [orderFilter, setOrderFilter] = useState('todas');
  const [orderQuery, setOrderQuery] = useState('');
  const [ticketOrderId, setTicketOrderId] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const mainContent = useRef<HTMLElement>(null);

  const activeBranchId =
    visibleBranches.find((branch) => branch.id === selectedBranch)?.id ??
    visibleBranches[0]?.id ??
    state.activeBranchId;
  const activeBranch = getBranchInfo(activeBranchId);
  const activeRole = shared.roles[activeBranchId] ?? 'operator';
  const activeSettings = getBranchSettings(state, activeBranchId);
  const openShift = getOpenShift(state, activeBranchId);

  function navigate(tab: TabId) {
    setActiveTab(tab);
    if (tab === 'ordenes') {
      setOrderFilter('todas');
      setOrderQuery('');
    }
    window.scrollTo(0, 0);
  }

  function chooseSection(tab: TabId) {
    navigate(tab);
    setMenuOpen(false);
    if (menuButton.current?.getClientRects().length) {
      mainContent.current?.focus({ preventScroll: true });
    }
  }

  function showOrders(filter = 'todas', query = '') {
    navigate('ordenes');
    setOrderFilter(filter);
    setOrderQuery(query);
  }

  function run(branch: BranchId, operation: Operation) {
    return shared.execute(branch, operation);
  }

  function resolveOrderBranch(orderId: string): BranchId {
    return state.orders.find((item) => item.id === orderId)?.branchId ?? activeBranchId;
  }

  function handleCreateOrder({ branchId, ...input }: CreateOrderInput) {
    return run(branchId, { action: 'create', input });
  }

  function handleCapturePayment(orderId: string, lines: PaymentInputLine[]) {
    return run(resolveOrderBranch(orderId), { action: 'capture', orderId, lines });
  }

  function handleConfirmPaymentLine(lineId: string, reference?: string) {
    const line = state.paymentLines.find((item) => item.id === lineId);
    const branch = line ? resolveOrderBranch(line.orderId) : activeBranchId;
    return run(branch, { action: 'confirm', lineId, reference });
  }

  function handleAdvanceEncargo(orderId: string, machineIds?: string[]) {
    return run(resolveOrderBranch(orderId), { action: 'advance', orderId, machineIds });
  }

  function handleDeliverEncargo(orderId: string) {
    return run(resolveOrderBranch(orderId), { action: 'deliver', orderId });
  }

  function handleRecordWhatsappSent(orderId: string) {
    return run(resolveOrderBranch(orderId), { action: 'recordWhatsappSent', orderId });
  }

  function handleUpsertMachine(
    branch: BranchId,
    machine: { id?: string; code: string; name: string; kind: MachineKind },
  ) {
    return run(branch, { action: 'upsertMachine', machine });
  }

  function handleDeleteMachine(branch: BranchId, machineId: string) {
    return run(branch, { action: 'deleteMachine', machineId });
  }

  function handleSeedSampleMachines(branch: BranchId) {
    return run(branch, { action: 'seedSampleMachines' });
  }

  function handleSetMachineStatus(
    branch: BranchId,
    machineId: string,
    status: Extract<MachineStatus, 'disponible' | 'fuera_de_servicio'>,
    reason?: string,
  ) {
    return run(branch, { action: 'setMachineStatus', machineId, status, reason });
  }

  function handleUpsertCustomer(
    branch: BranchId,
    customer: { id?: string; name: string; phone: string; contactConsent: boolean },
  ) {
    return run(branch, { action: 'upsertCustomer', customer });
  }

  function handleSeedSampleCustomers(branch: BranchId) {
    return run(branch, { action: 'seedSampleCustomers' });
  }

  function handleRunRaffleDraw(
    branch: BranchId,
    options: { year?: number; notes?: string },
  ) {
    return run(branch, { action: 'runRaffleDraw', year: options.year, notes: options.notes });
  }

  function handleConfirmTransferBatch(
    branch: BranchId,
    items: Array<{ lineId: string; reference?: string }>,
  ) {
    return run(branch, { action: 'confirmTransferBatch', items });
  }

  function handleRunNightClosing(
    branch: BranchId,
    options: { closingDate?: string; enforce2300Rule?: boolean },
  ) {
    return run(branch, {
      action: 'runNightClosing',
      closingDate: options.closingDate,
      enforce2300Rule: options.enforce2300Rule,
    });
  }

  function handleEmitTicket(orderId: string, simulateFailure: boolean) {
    const order = state.orders.find((item) => item.id === orderId);
    if (!order) return Promise.resolve({ ok: false, error: 'No encontramos el folio.' });
    return run(order.branchId, { action: 'emit', orderId, simulateFailure });
  }

  function handleReprintTicket(orderId: string) {
    const order = state.orders.find((item) => item.id === orderId);
    if (!order) return Promise.resolve({ ok: false, error: 'No encontramos el folio.' });
    return run(order.branchId, { action: 'reprint', orderId });
  }

  function handleCloseShift(branch: BranchId, amount: number) {
    return run(branch, { action: 'closeShift', amount });
  }

  function handleMovement(branch: BranchId, kind: CashMovement['kind'], amount: number, reason: string) {
    return run(branch, { action: 'movement', kind, amount, reason });
  }

  function handleOpenNewShift(branch: BranchId, amount: number) {
    return run(branch, { action: 'openShift', amount });
  }

  function handleSaveSettings(branch: BranchId, settings: Partial<BranchSettings>) {
    return run(branch, { action: 'updateSettings', settings });
  }

  const ticketOrder = ticketOrderId ? state.orders.find((o) => o.id === ticketOrderId) : null;
  const ticketState = ticketOrderId ? state.tickets[ticketOrderId] : null;

  return (
    <div className="app-shell">
      <aside className="sidebar" data-menu-open={menuOpen ? '' : undefined} onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen && menuButton.current?.getClientRects().length) {
          setMenuOpen(false);
          menuButton.current.focus();
        }
      }}>
        <div className="brand-block">
          <span className="brand-mark"><WashingMachine size={23} aria-hidden="true" /></span>
          <div><strong>HOREB <span>360</span></strong><small>Gestión de lavandería</small></div>
        </div>
        <button
          ref={menuButton}
          type="button"
          className="mobile-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="workspace-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          Menú
        </button>
        <div className="workspace-menu" id="workspace-menu">
          <div className="nav-heading">Operación</div>
          <nav className="workspace-nav" aria-label="Secciones principales">
            {navigation.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" className={activeTab === id ? 'active' : ''} aria-current={activeTab === id ? 'page' : undefined} onClick={() => chooseSection(id)}>
                <Icon size={19} aria-hidden="true" /><span>{label}</span>
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
              onClick={() => chooseSection('ajustes')}
            >
              <Settings size={17} aria-hidden="true" /> Ajustes
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <div className="breadcrumb">
            Operación <span>/</span>{' '}
            <strong>
              {activeTab === 'ajustes'
                ? 'Ajustes'
                : navigation.find((entry) => entry.id === activeTab)?.label}
            </strong>
          </div>
          <div className="workspace-actions" data-tour="branch-bar">
            <span className={'shift-pill' + (openShift ? ' open' : '')}><i aria-hidden="true" />{openShift ? 'Turno ' + openShift.number + ' abierto' : 'Caja cerrada'}</span>
            <CustomSelect
              ariaLabel="Sucursal"
              compact
              icon={<MapPin size={16} aria-hidden="true" />}
              value={activeBranchId}
              options={visibleBranches.map((branch) => ({ value: branch.id, label: branch.name }))}
              onChange={(value) => setSelectedBranch(value)}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTourOpen(true)}>
              <Compass size={16} aria-hidden="true" /> Guía
            </button>
          </div>
        </header>
        <main ref={mainContent} tabIndex={-1} className="main-content" data-workspace-tab={activeTab}>
          {sharedNotice && <div className="alert alert-error" role="alert">{sharedNotice}</div>}
          {shared.syncWarning && <div className="alert alert-error" role="alert">{shared.syncWarning}</div>}
          {(!shared.isOnline || shared.pendingSyncCount > 0) && (
            <div className="alert alert-info offline-sync-bar" role="status">
              <span>
                {!shared.isOnline ? (
                  <>
                    <strong>Sin internet · Modo local activo.</strong> Órdenes, entregas y efectivo se guardan en este equipo y se sincronizarán al reconectar
                    {shared.pendingSyncCount > 0 ? ` (${shared.pendingSyncCount} pendiente(s))` : ''}. Terminal y transferencias requieren validación manual.
                  </>
                ) : (
                  <>
                    <strong>{shared.pendingSyncCount} cambio(s) local(es)</strong> por sincronizar con Supabase.
                  </>
                )}
              </span>
              {shared.isOnline && shared.pendingSyncCount > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={shared.syncing}
                  onClick={() => void shared.syncNow()}
                >
                  {shared.syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
                </button>
              )}
            </div>
          )}
          {activeTab === 'inicio' && (
            <Overview
              state={state}
              branchId={activeBranchId}
              onNew={() => navigate('mostrador')}
              onOrders={showOrders}
            />
          )}
          {activeTab !== 'inicio' && (
            <div className="page-intro">
              <div>
                <h1 data-tour-page={activeTab}>
                  {activeTab === 'ajustes'
                    ? 'Ajustes'
                    : navigation.find((entry) => entry.id === activeTab)?.label}
                </h1>
                <p>{activeTab === 'admin' ? 'Consolidado de sucursales disponibles' : activeBranch.name}</p>
              </div>
              {activeTab === 'ordenes' && (
                <button type="button" className="btn btn-primary" onClick={() => navigate('mostrador')}>
                  <Plus size={17} /> Nueva orden
                </button>
              )}
            </div>
          )}
          {(activeTab === 'mostrador' || activeTab === 'ordenes') && (
            <MostradorView
              key={activeBranchId + activeTab}
              ordersOnly={activeTab === 'ordenes'}
              initialFilter={orderFilter}
              initialQuery={orderQuery}
              state={state}
              branchId={activeBranchId}
              isOffline={!shared.isOnline}
              onCreateOrder={handleCreateOrder}
              onCapturePayment={handleCapturePayment}
              onConfirmPaymentLine={handleConfirmPaymentLine}
              onAdvanceEncargo={handleAdvanceEncargo}
              onDeliverEncargo={handleDeliverEncargo}
              onRecordWhatsappSent={handleRecordWhatsappSent}
              onUpsertCustomer={handleUpsertCustomer}
              onOpenTicket={(id) => setTicketOrderId(id)}
            />
          )}

          <Suspense fallback={<p className="muted" role="status">Cargando sección…</p>}>
            {activeTab === 'equipos' && (
              <EquiposView
                key={activeBranchId}
                state={state}
                branchId={activeBranchId}
                role={activeRole}
                onUpsertMachine={handleUpsertMachine}
                onDeleteMachine={handleDeleteMachine}
                onSeedSampleMachines={handleSeedSampleMachines}
                onSetMachineStatus={handleSetMachineStatus}
              />
            )}

            {activeTab === 'clientes' && (
              <ClientesView
                state={state}
                branchId={activeBranchId}
                role={activeRole}
                onUpsertCustomer={handleUpsertCustomer}
                onSeedSampleCustomers={handleSeedSampleCustomers}
              />
            )}

            {activeTab === 'caja' && (
              <CajaView
                key={activeBranchId}
                state={state}
                branchId={activeBranchId}
                canManage={activeRole === 'supervisor'}
                onCloseShift={handleCloseShift}
                onOpenNewShift={handleOpenNewShift}
                onMovement={handleMovement}
                onConfirmPaymentLine={handleConfirmPaymentLine}
                onConfirmTransferBatch={handleConfirmTransferBatch}
                onRunNightClosing={handleRunNightClosing}
              />
            )}

            {activeTab === 'admin' && (
              <AdminView
                state={state}
                branches={visibleBranches.map((branch) => branch.id)}
                activeBranchId={activeBranchId}
                role={activeRole}
                onRunRaffleDraw={handleRunRaffleDraw}
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
                onSaveSettings={handleSaveSettings}
                onStartTour={() => setTourOpen(true)}
                onReload={shared.reload}
                onSignOut={shared.signOut}
              />
            )}
          </Suspense>
        </main>
      </div>

      <Suspense fallback={null}>
        {ticketOrder && ticketState && (
          <TicketModal
            order={ticketOrder}
            paymentLines={getOrderPaymentLines(state, ticketOrder.id)}
            ticket={ticketState}
            branchSettings={getBranchSettings(state, ticketOrder.branchId)}
            actorRole={shared.roles[ticketOrder.branchId] ?? activeRole}
            onEmit={handleEmitTicket}
            onReprint={handleReprintTicket}
            onClose={() => setTicketOrderId(null)}
          />
        )}

        {tourOpen && (
          <AppTour
            onNavigate={(tab: TourTabId) => navigate(tab)}
            onClose={() => setTourOpen(false)}
          />
        )}
      </Suspense>
    </div>
  );
}
