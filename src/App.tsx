import { useState } from 'react';
import { BarChart3, ClipboardList, Compass, LayoutDashboard, MapPin, Palette, Plus, Settings, Store, Wallet, WashingMachine } from 'lucide-react';
import { AdminView } from './components/AdminView';
import { AjustesView } from './components/AjustesView';
import { AppTour, type TourTabId } from './components/AppTour';
import { CajaView } from './components/CajaView';
import { CustomSelect } from './components/CustomSelect';
import { MostradorView } from './components/MostradorView';
import { Overview } from './components/Overview';
import { SharedStatus } from './components/SharedStatus';
import { TicketModal } from './components/TicketModal';
import {
  BRANCHES,
  getBranchInfo,
  getBranchSettings,
  getOpenShift,
  getOrderPaymentLines,
  type CreateOrderInput,
  type PaymentInputLine,
} from './domain/rules';
import { type Operation } from './domain/operations';
import type { SharedWorkspace } from './Root';
import type { BranchId, BranchSettings, CashMovement } from './domain/types';
import type { BrandTheme } from './theme';

const navigation = [
  { id: 'inicio', label: 'Inicio', icon: LayoutDashboard },
  { id: 'mostrador', label: 'Mostrador', icon: Store },
  { id: 'ordenes', label: 'Órdenes', icon: ClipboardList },
  { id: 'caja', label: 'Caja', icon: Wallet },
  { id: 'admin', label: 'Reportes', icon: BarChart3 },
  { id: 'ajustes', label: 'Ajustes', icon: Settings },
] as const;

type TabId = (typeof navigation)[number]['id'];

export function App({ shared, sharedNotice, theme, onSetTheme, onToggleTheme }: {
  shared: SharedWorkspace;
  sharedNotice?: string;
  theme: BrandTheme;
  onSetTheme: (theme: BrandTheme) => void;
  onToggleTheme: () => void;
}) {
  const [selectedBranch, setSelectedBranch] = useState(shared.state.activeBranchId);
  const state = shared.state;
  const visibleBranches = BRANCHES.filter((branch) => shared.roles[branch.id]);
  const [activeTab, setActiveTab] = useState<TabId>('inicio');
  const [orderFilter, setOrderFilter] = useState('todas');
  const [orderQuery, setOrderQuery] = useState('');
  const [ticketOrderId, setTicketOrderId] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

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

  function showOrders(filter = 'todas', query = '') {
    navigate('ordenes');
    setOrderFilter(filter);
    setOrderQuery(query);
  }

  function run(branch: BranchId, operation: Operation) {
    return shared.execute(branch, operation);
  }

  function handleCreateOrder({ branchId, ...input }: CreateOrderInput) {
    return run(branchId, { action: 'create', input });
  }

  function handleCapturePayment(orderId: string, lines: PaymentInputLine[]) {
    return run(activeBranchId, { action: 'capture', orderId, lines });
  }

  function handleConfirmPaymentLine(lineId: string) {
    return run(activeBranchId, { action: 'confirm', lineId });
  }

  function handleAdvanceEncargo(orderId: string) {
    return run(activeBranchId, { action: 'advance', orderId });
  }

  function handleDeliverEncargo(orderId: string) {
    return run(activeBranchId, { action: 'deliver', orderId });
  }

  function handleEmitTicket(orderId: string, simulateFailure: boolean) {
    const order = state.orders.find((item) => item.id === orderId);
    if (!order) return Promise.resolve({ ok: false, error: 'No encontramos el folio.' });
    return run(order.branchId, { action: 'emit', orderId, simulateFailure });
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
      <aside className="sidebar">
        <div className="brand-block">
          <span className="brand-mark"><WashingMachine size={23} aria-hidden="true" /></span>
          <div><strong>HOREB <span>360</span></strong><small>Gestión de lavandería</small></div>
        </div>
        <div className="nav-heading">Operación</div>
        <nav className="workspace-nav" aria-label="Secciones principales">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={activeTab === id ? 'active' : ''} aria-current={activeTab === id ? 'page' : undefined} onClick={() => navigate(id)}>
              <Icon size={19} aria-hidden="true" /><span>{label}</span>
            </button>
          ))}
        </nav>
        <SharedStatus branchName={activeBranch.name} role={activeRole} />
        <div className="sidebar-footer">
          <button type="button" className="reset-button" onClick={() => setTourOpen(true)}>
            <Compass size={16} aria-hidden="true" /> Guía interactiva
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <div className="breadcrumb">Operación <span>/</span> <strong>{navigation.find((entry) => entry.id === activeTab)?.label}</strong></div>
          <div className="workspace-actions" data-tour="branch-bar">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onToggleTheme} title="Cambiar color del tema">
              <Palette size={15} aria-hidden="true" />
              <span className={`theme-swatch ${theme === 'blue' ? 'green' : 'blue'}`} aria-hidden="true" />
              {theme === 'blue' ? 'Color verde' : 'Color azul'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTourOpen(true)}>
              <Compass size={15} aria-hidden="true" /> Guía interactiva
            </button>
            <span className={'shift-pill' + (openShift ? ' open' : '')}><i aria-hidden="true" />{openShift ? 'Turno ' + openShift.number + ' abierto' : 'Caja cerrada'}</span>
            <CustomSelect
              ariaLabel="Sucursal"
              compact
              icon={<MapPin size={16} aria-hidden="true" />}
              value={activeBranchId}
              options={visibleBranches.map((branch) => ({ value: branch.id, label: branch.name }))}
              onChange={(value) => setSelectedBranch(value)}
            />
          </div>
        </header>
      <main className="main-content">
        {sharedNotice && <div className="alert alert-error" role="alert">{sharedNotice}</div>}
        {activeTab === 'inicio' && (
          <Overview
            state={state}
            branchId={activeBranchId}
            onNew={() => navigate('mostrador')}
            onOrders={showOrders}
            onStartTour={() => setTourOpen(true)}
          />
        )}
        {activeTab !== 'inicio' && <div className="page-intro">
          <div>
            <h1>{navigation.find((entry) => entry.id === activeTab)?.label}</h1>
            <p>{activeTab === 'admin' ? 'Consolidado de sucursales disponibles' : activeBranch.name}</p>
          </div>
          {activeTab === 'ordenes' && <button type="button" className="btn btn-primary" onClick={() => navigate('mostrador')}><Plus size={17} /> Nueva orden</button>}
        </div>}
        {(activeTab === 'mostrador' || activeTab === 'ordenes') && (
          <MostradorView
            key={activeBranchId + activeTab}
            ordersOnly={activeTab === 'ordenes'}
            initialFilter={orderFilter}
            initialQuery={orderQuery}
            state={state}
            branchId={activeBranchId}
            onCreateOrder={handleCreateOrder}
            onCapturePayment={handleCapturePayment}
            onConfirmPaymentLine={handleConfirmPaymentLine}
            onAdvanceEncargo={handleAdvanceEncargo}
            onDeliverEncargo={handleDeliverEncargo}
            onOpenTicket={(id) => setTicketOrderId(id)}
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
          />
        )}

        {activeTab === 'admin' && <AdminView state={state} branches={visibleBranches.map((branch) => branch.id)} />}

        {activeTab === 'ajustes' && (
          <AjustesView
            branchId={activeBranchId}
            branchName={activeBranch.name}
            role={activeRole}
            settings={activeSettings}
            theme={theme}
            onSetTheme={onSetTheme}
            onSaveSettings={handleSaveSettings}
            onReload={shared.reload}
            onSignOut={shared.signOut}
          />
        )}
      </main>
      </div>

      {ticketOrder && ticketState && (
        <TicketModal
          order={ticketOrder}
          paymentLines={getOrderPaymentLines(state, ticketOrder.id)}
          ticket={ticketState}
          branchSettings={getBranchSettings(state, ticketOrder.branchId)}
          onEmit={handleEmitTicket}
          onClose={() => setTicketOrderId(null)}
        />
      )}

      <AppTour
        open={tourOpen}
        onNavigate={(tab: TourTabId) => navigate(tab)}
        onClose={() => setTourOpen(false)}
      />
    </div>
  );
}
