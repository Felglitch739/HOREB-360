import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  PackageCheck,
  Plus,
  Receipt,
  Search,
  Sparkles,
} from 'lucide-react';
import { COMBO_PRICE_CENTS, calculateTender, formatMxn } from '../domain/money';
import {
  ENCARGO_STAGES,
  canDeliverOrder,
  getBranchInfo,
  getOpenShift,
  getOrderPaymentLines,
  getOrderPendingCents,
  suggestNextFolio,
  type CreateOrderInput,
  type PaymentInputLine,
} from '../domain/rules';
import type { BranchId, DemoState, Order, ServiceType } from '../domain/types';

interface MostradorViewProps {
  state: DemoState;
  branchId: BranchId;
  ordersOnly: boolean;
  initialFilter: string;
  initialQuery: string;
  onCreateOrder: (input: CreateOrderInput) => { ok: boolean; error?: string; order?: Order };
  onCapturePayment: (orderId: string, lines: PaymentInputLine[]) => { ok: boolean; error?: string; order?: Order };
  onConfirmPaymentLine: (lineId: string) => { ok: boolean; error?: string };
  onAdvanceEncargo: (orderId: string) => { ok: boolean; error?: string };
  onDeliverEncargo: (orderId: string) => { ok: boolean; error?: string };
  onOpenTicket: (orderId: string) => void;
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase('es-MX').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const STAGE_LABELS = Object.fromEntries(ENCARGO_STAGES.map((s) => [s.id, s.label]));

export function MostradorView({
  state,
  branchId,
  ordersOnly,
  initialFilter,
  initialQuery,
  onCreateOrder,
  onCapturePayment,
  onConfirmPaymentLine,
  onAdvanceEncargo,
  onDeliverEncargo,
  onOpenTicket,
}: MostradorViewProps) {
  const branch = getBranchInfo(branchId);
  const openShift = getOpenShift(state, branchId);

  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState(initialFilter);
  const [serviceType, setServiceType] = useState<ServiceType>('autoservicio');
  const [folio, setFolio] = useState(() => suggestNextFolio(state, branchId));
  const [customerAlias, setCustomerAlias] = useState('');
  const [comboCount, setComboCount] = useState(1);
  const [payAtPickup, setPayAtPickup] = useState(true);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);

  const [cashInput, setCashInput] = useState('');
  const [cardInput, setCardInput] = useState('0');
  const [transferInput, setTransferInput] = useState('0');
  const [confirmCardNow, setConfirmCardNow] = useState(false);
  const [confirmTransferNow, setConfirmTransferNow] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    setFolio(suggestNextFolio(state, branchId));
  }, [branchId, state.nextFolioSeq[branchId]]);

  const checkout = state.orders.find((order) => order.id === checkoutId);
  const deferPayment = !checkout && serviceType === 'encargo' && payAtPickup;
  const totalCents = checkout?.totalCents ?? comboCount * COMBO_PRICE_CENTS;
  const tender = calculateTender(totalCents, cashInput, cardInput, transferInput);

  const term = normalizeSearch(query.trim());
  const branchOrders = state.orders.filter((order) => order.branchId === branchId);
  const matchingOrders = branchOrders.filter((order) => {
    if (term && !normalizeSearch(order.folio + ' ' + order.customerAlias).includes(term)) return false;
    if (filter === 'todas') return true;
    if (filter === 'pendientes') return getOrderPendingCents(state, order.id) > 0;
    if (filter === 'autoservicio') return order.serviceType === 'autoservicio';
    return order.encargoStage === filter;
  });

  function setSingleMethod(method: 'efectivo' | 'tarjeta' | 'transferencia') {
    const pesos = String(totalCents / 100);
    setCashInput(method === 'efectivo' ? pesos : '0');
    setCardInput(method === 'tarjeta' ? pesos : '0');
    setTransferInput(method === 'transferencia' ? pesos : '0');
    setFeedback(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const paymentLines: PaymentInputLine[] = [];
    let change = 0;
    if (!deferPayment) {
      if (!tender.ok) {
        setFeedback({ type: 'error', text: tender.error });
        return;
      }
      if (tender.remaining > 0) {
        setFeedback({ type: 'error', text: `Faltan ${formatMxn(tender.remaining)} para el total de ${formatMxn(totalCents)}.` });
        return;
      }
      change = tender.change;
      if (tender.cashApplied > 0) {
        paymentLines.push({ method: 'efectivo', amountCents: tender.cashApplied, cashReceivedCents: tender.cash });
      }
      if (tender.card > 0) {
        paymentLines.push({ method: 'tarjeta', amountCents: tender.card, confirmImmediately: confirmCardNow });
      }
      if (tender.transfer > 0) {
        paymentLines.push({ method: 'transferencia', amountCents: tender.transfer, confirmImmediately: confirmTransferNow });
      }
    }

    const res = checkout
      ? onCapturePayment(checkout.id, paymentLines)
      : onCreateOrder({
          branchId,
          serviceType,
          folio,
          customerAlias,
          comboCount,
          paymentLines: deferPayment ? [] : paymentLines,
        });

    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'No se pudo registrar la orden.' });
      return;
    }

    setFeedback({
      type: 'success',
      text: (checkout ? `Cobro registrado en ${checkout.folio}.` : `Orden ${res.order?.folio} guardada en ${branch.name}.`)
        + (change > 0 ? ` Entrega ${formatMxn(change)} de cambio.` : ''),
    });
    setCheckoutId(null);
    setCustomerAlias('');
    setComboCount(1);
    setCashInput('');
    setCardInput('0');
    setTransferInput('0');
    setConfirmCardNow(false);
    setConfirmTransferNow(false);
  }

  return (
    <div className={ordersOnly && !checkout ? 'orders-page' : 'two-col'}>
      {/* Formulario de venta */}
      {(!ordersOnly || checkout) && <section id="checkout-form" className="card" aria-label="Registrar orden en mostrador">
        <h2 className="card-title">
          <span>{checkout ? `Cobrar ${checkout.folio}` : `Mostrador · ${branch.name}`}</span>
          <span className="badge badge-info">Combo {formatMxn(COMBO_PRICE_CENTS)}</span>
        </h2>

        {!openShift && (
          <div className="alert alert-error">
            No hay turno abierto en {branch.name}. Ve a <strong>Caja</strong> para abrir un turno antes de cobrar.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {checkout ? (
            <p className="muted">Encargo de {checkout.customerAlias} · {formatMxn(checkout.totalCents)}</p>
          ) : (
            <>
              <div className="field">
                <label>Tipo de servicio</label>
                <div className="segmented">
                  <button
                    type="button"
                    className={`seg-btn ${serviceType === 'autoservicio' ? 'active' : ''}`}
                    onClick={() => setServiceType('autoservicio')}
                  >
                    Autoservicio
                  </button>
                  <button
                    type="button"
                    className={`seg-btn ${serviceType === 'encargo' ? 'active' : ''}`}
                    onClick={() => setServiceType('encargo')}
                  >
                    Encargo
                  </button>
                </div>
              </div>

              <div className="field">
                <label htmlFor="folio-input">Folio de prueba</label>
                <input
                  id="folio-input"
                  className="input"
                  value={folio}
                  onChange={(e) => setFolio(e.target.value)}
                  placeholder="Ej. TRE-0001"
                />
              </div>

              {serviceType === 'encargo' && (
                <div className="field">
                  <label htmlFor="alias-input">Alias ficticio del cliente</label>
                  <input
                    id="alias-input"
                    className="input"
                    value={customerAlias}
                    onChange={(e) => setCustomerAlias(e.target.value)}
                    placeholder="Ej. Cliente Demo Norte"
                  />
                </div>
              )}

              <div className="field">
                <label htmlFor="combo-count">Combo Lavado + Secado ({formatMxn(COMBO_PRICE_CENTS)} c/u)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setComboCount((c) => Math.max(1, c - 1))}
                    aria-label="Disminuir combos"
                  >
                    -
                  </button>
                  <input
                    id="combo-count"
                    className="input"
                    type="number"
                    min={1}
                    value={comboCount}
                    onChange={(e) => setComboCount(Math.max(1, Number.parseInt(e.target.value || '1', 10)))}
                    style={{ textAlign: 'center', fontWeight: 700 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setComboCount((c) => c + 1)}
                    aria-label="Aumentar combos"
                  >
                    +
                  </button>
                </div>
              </div>
              {serviceType === 'encargo' && (
                <label className="checkbox-row field">
                  <input
                    type="checkbox"
                    checked={payAtPickup}
                    onChange={(event) => setPayAtPickup(event.target.checked)}
                  />
                  Cobrar al recoger
                </label>
              )}
            </>
          )}

          {!deferPayment && (
            <>
              <div className="field">
                <label>Atajos de pago único</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSingleMethod('efectivo')}>
                    Todo Efectivo
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSingleMethod('tarjeta')}>
                    Todo Tarjeta
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSingleMethod('transferencia')}>
                    Todo Transferencia
                  </button>
                </div>
              </div>

              <div className="split-grid">
                <div className="split-row">
                  <div className="split-row-top">
                    <strong>Efectivo recibido</strong>
                    <div className="split-amount-wrap">
                      <span>$</span>
                      <input
                        aria-label="Monto efectivo MXN"
                        placeholder="0.00"
                        inputMode="decimal"
                        className="input"
                        value={cashInput}
                        onChange={(e) => setCashInput(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="split-row">
                  <div className="split-row-top">
                    <strong>Tarjeta simulada</strong>
                    <div className="split-amount-wrap">
                      <span>$</span>
                      <input
                        aria-label="Monto tarjeta MXN"
                        inputMode="decimal"
                        className="input"
                        value={cardInput}
                        onChange={(e) => setCardInput(e.target.value)}
                      />
                    </div>
                  </div>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={confirmCardNow}
                      onChange={(e) => setConfirmCardNow(e.target.checked)}
                    />
                    Confirmar cobro de tarjeta al guardar
                  </label>
                </div>

                <div className="split-row">
                  <div className="split-row-top">
                    <strong>Transferencia simulada</strong>
                    <div className="split-amount-wrap">
                      <span>$</span>
                      <input
                        aria-label="Monto transferencia MXN"
                        inputMode="decimal"
                        className="input"
                        value={transferInput}
                        onChange={(e) => setTransferInput(e.target.value)}
                      />
                    </div>
                  </div>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={confirmTransferNow}
                      onChange={(e) => setConfirmTransferNow(e.target.checked)}
                    />
                    Confirmar transferencia al guardar
                  </label>
                </div>
              </div>

              <div className="summary-bar" aria-live="polite">
                <span>Total {formatMxn(totalCents)}</span>
                {tender.ok && <strong style={{ color: tender.remaining > 0 ? 'var(--warning)' : 'var(--success)' }}>
                  {tender.remaining > 0
                    ? `Falta ${formatMxn(tender.remaining)}`
                    : `Cambio ${formatMxn(tender.change)}`}
                </strong>}
              </div>
            </>
          )}

          {feedback && (
            <div role={feedback.type === 'error' ? 'alert' : 'status'} className={`alert ${feedback.type === 'error' ? 'alert-error' : 'alert-success'}`}>
              {feedback.text}
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-full" disabled={!openShift}>
            <Plus size={18} />
            {checkout ? 'Guardar cobro' : deferPayment ? 'Guardar encargo' : 'Guardar folio y pago'} ({formatMxn(totalCents)})
          </button>
          {checkout && (
            <button type="button" className="btn btn-secondary btn-full" onClick={() => {
              setCheckoutId(null);
              setCashInput('');
              setCardInput('0');
              setTransferInput('0');
              setConfirmCardNow(false);
              setConfirmTransferNow(false);
              setFeedback(null);
            }}>
              Cancelar cobro
            </button>
          )}
        </form>
      </section>}

      {/* Órdenes de la sucursal */}
      <section className="card" aria-label="Órdenes registradas">
        <h2 className="card-title">
          <span>{ordersOnly ? "Seguimiento" : "Órdenes de la sucursal"}</span>
          <span className="badge badge-info">{matchingOrders.length} de {branchOrders.length}</span>
        </h2>

        <div className="order-toolbar">
          <label className="search-field"><Search size={17} aria-hidden="true" /><span className="sr-only">Buscar por folio o cliente</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por folio o cliente" /></label>
          <select className="input" aria-label="Filtrar órdenes" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="todas">Todas las órdenes</option><option value="pendientes">Por cobrar</option><option value="autoservicio">Autoservicio</option>
            {ENCARGO_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
          </select>
        </div>
        {ordersOnly && !checkout && feedback && <div className={`alert alert-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.text}</div>}
        {matchingOrders.length === 0 ? (
          <p className="muted">
            {branchOrders.length ? 'No hay órdenes que coincidan con la búsqueda.' : 'Aún no hay órdenes en esta sucursal.'}
          </p>
        ) : (
          <div className="order-list">
            {matchingOrders.map((order) => {
              const lines = getOrderPaymentLines(state, order.id);
              const ticket = state.tickets[order.id];
              const pendingCents = getOrderPendingCents(state, order.id);
              const deliverCheck = canDeliverOrder(state, order.id);

              return (
                <article key={order.id} className="order-card">
                  <div className="order-header">
                    <div>
                      <span className="order-folio">{order.folio}</span>{' '}
                      <span className="badge badge-info">
                        {order.serviceType === 'encargo' ? 'Encargo' : 'Autoservicio'}
                      </span>{' '}
                      {order.serviceType === 'encargo' && order.encargoStage && (
                        <span
                          className={`badge ${
                            order.encargoStage === 'entregado'
                              ? 'badge-success'
                              : order.encargoStage === 'listo'
                                ? 'badge-info'
                                : 'badge-warning'
                          }`}
                        >
                          {STAGE_LABELS[order.encargoStage]}
                        </span>
                      )}
                    </div>
                    <strong>{formatMxn(order.totalCents)}</strong>
                  </div>

                  <div className="order-meta">
                    {order.serviceType === 'encargo' && (
                      <span>
                        Cliente: <strong>{order.customerAlias}</strong> ·{' '}
                      </span>
                    )}
                    <span>
                      Combo x{order.comboCount} · {new Date(order.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {pendingCents > 0 && (
                    <p className="muted">Saldo pendiente {formatMxn(pendingCents)}</p>
                  )}
                  <div className="payment-chips">
                    {lines.map((line) => (
                      <div key={line.id} className="payment-chip">
                        <span>
                          {line.method === 'efectivo'
                            ? 'Efectivo'
                            : line.method === 'tarjeta'
                              ? 'Tarjeta'
                              : 'Transferencia'}{' '}
                          {formatMxn(line.amountCents)}
                        </span>
                        {line.status === 'confirmado' ? (
                          <span className="badge badge-success">
                            <CheckCircle2 size={12} /> Confirmado
                          </span>
                        ) : (
                          <>
                            <span className="badge badge-warning">
                              <Clock size={12} /> Pendiente
                            </span>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                const r = onConfirmPaymentLine(line.id);
                                if (!r.ok && r.error) setFeedback({ type: 'error', text: r.error });
                              }}
                            >
                              Confirmar
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="order-actions">
                    {lines.length === 0 && order.serviceType === 'encargo' && (
                      <button type="button" className="btn btn-primary btn-sm" disabled={!openShift} onClick={() => {
                        setCheckoutId(order.id);
                        setCashInput('');
                        setCardInput('0');
                        setTransferInput('0');
                        setConfirmCardNow(false);
                        setConfirmTransferNow(false);
                        setFeedback(null);
                        requestAnimationFrame(() => document.getElementById('checkout-form')?.scrollIntoView({ block: 'start' }));
                      }}>
                        Cobrar encargo
                      </button>
                    )}
                    <button
                      type="button"
                      className={`btn btn-sm ${
                        ticket?.status === 'fallo'
                          ? 'btn-danger'
                          : ticket?.status === 'emitido'
                            ? 'btn-secondary'
                            : 'btn-primary'
                      }`}
                      disabled={pendingCents > 0}
                      title={pendingCents > 0 ? 'Confirma el pago completo antes de emitir el ticket.' : undefined}
                      onClick={() => onOpenTicket(order.id)}
                    >
                      <Receipt size={16} />
                      {ticket?.status === 'emitido'
                        ? 'Ver ticket (emitido)'
                        : ticket?.status === 'fallo'
                          ? 'Reintentar ticket (falló)'
                          : 'Emitir ticket'}
                    </button>

                    {order.serviceType === 'encargo' &&
                      order.encargoStage &&
                      order.encargoStage !== 'listo' &&
                      order.encargoStage !== 'entregado' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            const r = onAdvanceEncargo(order.id);
                            if (!r.ok && r.error) setFeedback({ type: 'error', text: r.error });
                          }}
                        >
                          <Sparkles size={16} />
                          {order.encargoStage === 'recibido' ? 'Iniciar lavado' : order.encargoStage === 'lavado' ? 'Pasar a secado' : 'Marcar listo'}
                          <ArrowRight size={14} />
                        </button>
                      )}

                    {order.serviceType === 'encargo' && order.encargoStage !== 'entregado' && (
                      <button
                        type="button"
                        className="btn btn-success btn-sm"
                        disabled={!deliverCheck.allowed}
                        title={deliverCheck.reason}
                        onClick={() => {
                          const r = onDeliverEncargo(order.id);
                          if (!r.ok && r.error) setFeedback({ type: 'error', text: r.error });
                        }}
                      >
                        <PackageCheck size={16} />
                        Entregar orden
                      </button>
                    )}
                  </div>
                  {order.serviceType === 'encargo' &&
                    order.encargoStage !== 'entregado' &&
                    !deliverCheck.allowed &&
                    deliverCheck.reason && (
                      <div className="muted" style={{ fontSize: '0.8rem', marginTop: 6 }}>
                        Entrega bloqueada: {deliverCheck.reason}
                      </div>
                    )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
