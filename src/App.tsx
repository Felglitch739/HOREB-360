import { useEffect, useState } from 'react';
import { BarChart3, ChevronDown, ClipboardList, LayoutDashboard, MapPin, Plus, RotateCcw, Store, Wallet, WashingMachine } from 'lucide-react';
import { AdminView } from './components/AdminView';
import { CajaView } from './components/CajaView';
import { MostradorView } from './components/MostradorView';
import { Overview } from './components/Overview';
import { TicketModal } from './components/TicketModal';
import { BRANCHES, getBranchInfo, getOpenShift, getOrderPaymentLines, type CreateOrderInput, type PaymentInputLine } from './domain/rules';
import { operate, type Operation } from './domain/operations';
import type { SharedWorkspace } from './Root';
import { createExampleState, hasPristineDemo } from './domain/examples';
import { clearDemoState, loadDemoState, saveDemoState } from './domain/storage';
import type { BranchId, CashMovement, DemoState } from './domain/types';

const navigation = [
  { id: 'inicio', label: 'Inicio', icon: LayoutDashboard },
  { id: 'mostrador', label: 'Mostrador', icon: Store },
  { id: 'ordenes', label: 'Órdenes', icon: ClipboardList },
  { id: 'caja', label: 'Caja', icon: Wallet },
  { id: 'admin', label: 'Reportes', icon: BarChart3 },
] as const;

type TabId = (typeof navigation)[number]['id'];

export function App({ shared, onSwitchMode, sharedNotice }: {
  shared?: SharedWorkspace;
  onSwitchMode?: () => void;
  sharedNotice?: string;
}) {
  const [localState, setState] = useState<DemoState>(() => loadDemoState());
  const [selectedBranch, setSelectedBranch] = useState(shared?.state.activeBranchId);
  const state = shared?.state ?? localState;
  const visibleBranches = shared ? BRANCHES.filter((branch) => shared.roles[branch.id]) : BRANCHES;
  const [activeTab, setActiveTab] = useState<TabId>('inicio');
  const [orderFilter, setOrderFilter] = useState('todas');
  const [orderQuery, setOrderQuery] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [ticketOrderId, setTicketOrderId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!shared) saveDemoState(localState);
  }, [localState, Boolean(shared)]);

  const activeBranchId = shared
    ? visibleBranches.find((branch) => branch.id === selectedBranch)?.id ?? state.activeBranchId
    : state.activeBranchId;
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

  function handleSelectBranch(branchId: BranchId) {
    if (shared) setSelectedBranch(branchId);
    else setState((prev) => ({ ...prev, activeBranchId: branchId }));
  }

  function handleResetDemo() {
    const fresh = clearDemoState();
    setState(fresh);
    setFormKey((value) => value + 1);
    navigate('inicio');
    setTicketOrderId(null);
    setConfirmReset(false);
  }

  async function run(branch: BranchId, operation: Operation) {
    if (shared) return shared.execute(branch, operation);
    const result = operate(localState, branch, operation);
    if (result.ok) setState(result.state);
    return result;
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
        <div className="sidebar-footer">
          <div className="demo-status"><i aria-hidden="true" /> {shared ? 'Demo compartida' : 'Demo local'}</div>
          {onSwitchMode && <button className="reset-button" onClick={onSwitchMode}>{shared ? 'Ir a demo local' : 'Abrir demo compartida'}</button>}
          {shared && <button className="reset-button" onClick={shared.signOut}>Cerrar sesión</button>}
          {!shared && (confirmReset ? <div className="reset-actions">
            <button className="btn btn-danger btn-sm" onClick={handleResetDemo}>Confirmar reinicio</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmReset(false)}>Cancelar</button>
          </div> : <button className="reset-button" onClick={() => setConfirmReset(true)}><RotateCcw size={16} aria-hidden="true" /> Reiniciar datos</button>)}
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <div className="breadcrumb">Operación <span>/</span> <strong>{navigation.find((entry) => entry.id === activeTab)?.label}</strong></div>
          <div className="workspace-actions">
            {shared && <button className="btn btn-secondary btn-sm" onClick={() => void shared.reload()}>Actualizar</button>}
            <span className={'shift-pill' + (openShift ? ' open' : '')}><i aria-hidden="true" />{openShift ? 'Turno ' + openShift.number + ' abierto' : 'Caja cerrada'}</span>
            <label className="branch-select"><MapPin size={17} aria-hidden="true" /><span className="sr-only">Sucursal</span>
              <select value={activeBranchId} onChange={(event) => handleSelectBranch(event.target.value as BranchId)}>
                {visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select><ChevronDown size={15} aria-hidden="true" />
            </label>
          </div>
        </header>
      <main className="main-content">
        {sharedNotice && <div className="alert alert-error" role="alert">{sharedNotice}</div>}
        {activeTab === 'inicio' && <Overview state={state} branchId={activeBranchId}
          onNew={() => navigate('mostrador')} onOrders={showOrders} canLoadExamples={!shared && hasPristineDemo(state)}
          onLoadExamples={() => setState((current) => hasPristineDemo(current) ? { ...createExampleState(), activeBranchId } : current)} />}
        {activeTab !== 'inicio' && <div className="page-intro">
          <div><h1>{navigation.find((entry) => entry.id === activeTab)?.label}</h1><p>{activeTab === 'admin' ? 'Consolidado de sucursales disponibles' : getBranchInfo(activeBranchId).name}</p></div>
          {activeTab === 'ordenes' && <button className="btn btn-primary" onClick={() => navigate('mostrador')}><Plus size={17} /> Nueva orden</button>}
        </div>}
        {(activeTab === 'mostrador' || activeTab === 'ordenes') && (
          <MostradorView
            key={activeBranchId + activeTab + formKey}
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
            canManage={!shared || shared.roles[activeBranchId] === 'supervisor'}
            onCloseShift={handleCloseShift}
            onOpenNewShift={handleOpenNewShift}
            onMovement={handleMovement}
          />
        )}

        {activeTab === 'admin' && <AdminView state={state} branches={visibleBranches.map((branch) => branch.id)} />}
      </main>
      </div>

      {ticketOrder && ticketState && (
        <TicketModal
          order={ticketOrder}
          paymentLines={getOrderPaymentLines(state, ticketOrder.id)}
          ticket={ticketState}
          onEmit={handleEmitTicket}
          onClose={() => setTicketOrderId(null)}
        />
      )}
    </div>
  );
}
