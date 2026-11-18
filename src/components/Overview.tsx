import { ArrowRight, ArrowUpRight, Banknote, CalendarDays, CircleDollarSign, Clock3, PackageCheck, Plus, ScrollText, WashingMachine } from 'lucide-react';
import { formatMxn } from '../domain/money';
import { ENCARGO_STAGES, getBranchInfo, getBranchSummary, getOrderPendingCents } from '../domain/rules';
import type { BranchId, DemoState } from '../domain/types';

const weekday = new Intl.DateTimeFormat('es-MX', { weekday: 'short' });
const dayLabel = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

interface Props {
  state: DemoState;
  branchId: BranchId;
  onNew: () => void;
  onOrders: (filter?: string, query?: string) => void;
  onLoadExamples: () => void;
  canLoadExamples: boolean;
}

export function Overview({ state, branchId, onNew, onOrders, onLoadExamples, canLoadExamples }: Props) {
  const branch = getBranchInfo(branchId);
  const summary = getBranchSummary(state, branchId);
  const orders = state.orders.filter((order) => order.branchId === branchId);
  const ready = orders.filter((order) => order.encargoStage === 'listo').length;
  const today = new Date();
  const ids = new Set(orders.map((order) => order.id));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const total = state.paymentLines.reduce((sum, line) => {
      if (!line.confirmedAt || !ids.has(line.orderId)) return sum;
      const timestamp = new Date(line.confirmedAt);
      return timestamp >= date && timestamp < end ? sum + line.amountCents : sum;
    }, 0);
    return { date, total };
  });
  const max = Math.max(1, ...days.map((day) => day.total));
  const stats = [
    { label: 'Cobrado', value: formatMxn(summary.totalConfirmedCents), icon: CircleDollarSign, tone: 'green', note: 'Pagos confirmados', filter: undefined },
    { label: 'Por cobrar', value: formatMxn(summary.pendingCents), icon: Clock3, tone: 'amber', note: 'Consultar saldos', filter: 'pendientes' },
    { label: 'Listos para entregar', value: String(ready), icon: PackageCheck, tone: 'blue', note: 'Consultar encargos', filter: 'listo' },
    { label: 'Órdenes registradas', value: String(orders.length), icon: ScrollText, tone: 'violet', note: 'Consultar órdenes', filter: 'todas' },
  ];

  return <div className="dashboard">
    <div className="page-intro"><div><h1>Resumen de operación</h1><p>{branch.name} <span aria-hidden="true">·</span> {dayLabel.format(today)}</p></div></div>
    <section className="welcome">
      <div className="welcome-image" />
      <div className="welcome-copy">
        <div className="welcome-branch"><WashingMachine size={17} aria-hidden="true" /> {branch.name}</div>
        <h2>Tu lavandería, al día.</h2>
        <p>Registra órdenes y da seguimiento a los encargos de la sucursal.</p>
        <div className="welcome-actions">
          <button className="btn hero-primary" onClick={onNew}><Plus size={17} /> Nueva orden</button>
          {canLoadExamples && <button className="btn hero-secondary" onClick={onLoadExamples}>Cargar ejemplos</button>}
        </div>
      </div>
    </section>

    <div className="stat-grid">
      {stats.map(({ label, value, icon: Icon, tone, note, filter }) => {
        const content = <><div className="stat-top"><span className={'stat-icon ' + tone}><Icon size={19} aria-hidden="true" /></span>{filter && <ArrowUpRight size={16} className="stat-arrow" aria-hidden="true" />}</div><span className="stat-label">{label}</span><strong>{value}</strong><small>{note}</small></>;
        return filter ? <button key={label} className="stat-card" onClick={() => onOrders(filter)}>{content}</button> : <div key={label} className="stat-card">{content}</div>;
      })}
    </div>

    <div className="insight-grid">
      <section className="card insight-card">
        <div className="section-head"><div><h2>Cobros de la semana</h2><p>Importes confirmados por día</p></div><span className="date-chip"><CalendarDays size={15} /> Últimos 7 días</span></div>
        <div className="chart-summary"><Banknote size={17} aria-hidden="true" /><strong>{formatMxn(days.reduce((sum, day) => sum + day.total, 0))}</strong><span>MXN</span></div>
        <div className="histogram" aria-label="Importes por día">
          {days.map((day, index) => <div key={day.date.toISOString()} className="chart-column" title={dayLabel.format(day.date) + ' · ' + formatMxn(day.total)}>
            <div className="bar-track"><div className={'bar-fill' + (index === 6 ? ' current' : '')} style={{ height: Math.max(day.total ? 5 : 2, day.total / max * 100) + '%' }} /></div>
            <span>{weekday.format(day.date).replace('.', '')}</span><span className="sr-only">{formatMxn(day.total)}</span>
          </div>)}
        </div>
      </section>
      <section className="card insight-card">
        <div className="section-head"><div><h2>Encargos por etapa</h2><p>Órdenes activas de {branch.name}</p></div><WashingMachine size={20} aria-hidden="true" /></div>
        <div className="stage-list">{ENCARGO_STAGES.filter((stage) => stage.id !== 'entregado').map((stage) => (
          <button key={stage.id} className="stage-row" onClick={() => onOrders(stage.id)}>
            <span className={'stage-dot ' + stage.id} /><span>{stage.label}</span><strong>{orders.filter((order) => order.encargoStage === stage.id).length}</strong><ArrowRight size={15} aria-hidden="true" />
          </button>
        ))}</div>
      </section>
    </div>

    <section className="card insight-card">
      <div className="section-head"><div><h2>Órdenes recientes</h2><p>Últimos movimientos de {branch.name}</p></div><button className="btn btn-secondary btn-sm" onClick={() => onOrders()}>Ver órdenes <ArrowRight size={15} /></button></div>
      {orders.length === 0 ? <p className="empty-section">Aún no hay órdenes en esta sucursal.</p> : <div className="recent-list">
        {orders.slice(0, 5).map((order) => {
          const balance = getOrderPendingCents(state, order.id);
          const stage = ENCARGO_STAGES.find((item) => item.id === order.encargoStage)?.label ?? 'Autoservicio';
          return <button key={order.id} className="recent-row" onClick={() => onOrders('todas', order.folio)}>
            <span className="stat-icon green"><ScrollText size={17} /></span><span><strong>{order.folio}</strong><small>{order.customerAlias}</small></span><span className="recent-stage">{stage}</span><span><strong>{formatMxn(order.totalCents)}</strong><small>{balance ? formatMxn(balance) + ' pendientes' : 'Pagado'}</small></span><ArrowRight size={15} />
          </button>;
        })}
      </div>}
    </section>
  </div>;
}
