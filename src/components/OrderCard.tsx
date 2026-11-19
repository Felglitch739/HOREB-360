import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  MessageCircle,
  PackageCheck,
  Receipt,
  Sparkles,
} from 'lucide-react';
import { formatMxn } from '../domain/money';
import { ENCARGO_STAGES, buildOrderReadyWhatsappMessage, getBranchInfo, getOrderLineItems } from '../domain/rules';
import type { EncargoStage, Machine, Order, PaymentLine, TicketState } from '../domain/types';

interface OrderCardProps {
  order: Order;
  branchMachines: Machine[];
  paymentLines: PaymentLine[];
  ticket?: TicketState;
  pendingCents: number;
  deliverCheck: { allowed: boolean; reason?: string };
  hasOpenShift: boolean;
  activeCheckout?: boolean;
  onStartCheckout: (order: Order, sourceElement?: HTMLElement | null) => void;
  onConfirmPaymentLine: (lineId: string, reference?: string) => Promise<void>;
  onOpenTicket: (orderId: string) => void;
  onAdvanceEncargo: (orderId: string, machineIds?: string[]) => Promise<void>;
  onDeliverEncargo: (orderId: string) => Promise<void>;
  onRecordWhatsappSent: (orderId: string) => Promise<void>;
}

const STAGE_LABELS = Object.fromEntries(ENCARGO_STAGES.map((s) => [s.id, s.label])) as Record<
  EncargoStage,
  string
>;

const NEXT_STAGE_LABEL: Partial<Record<EncargoStage, string>> = {
  recibido: 'Iniciar lavado',
  lavado: 'Pasar a secado',
  secado: 'Marcar listo',
};

const METHOD_LABEL: Record<PaymentLine['method'], string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
};

export function OrderCard({
  order,
  branchMachines,
  paymentLines,
  ticket,
  pendingCents,
  deliverCheck,
  hasOpenShift,
  activeCheckout = false,
  onStartCheckout,
  onConfirmPaymentLine,
  onOpenTicket,
  onAdvanceEncargo,
  onDeliverEncargo,
  onRecordWhatsappSent,
}: OrderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [refDrafts, setRefDrafts] = useState<Record<string, string>>({});
  const [selectedNextMachines, setSelectedNextMachines] = useState<string[]>([]);
  const currentStageIndex = order.encargoStage
    ? ENCARGO_STAGES.findIndex((s) => s.id === order.encargoStage)
    : -1;
  const lineItems = getOrderLineItems(order);

  const nextMachineKind =
    order.encargoStage === 'recibido'
      ? 'lavadora'
      : order.encargoStage === 'lavado'
        ? 'secadora'
        : null;
  const candidateMachines = nextMachineKind
    ? branchMachines.filter((m) => m.kind === nextMachineKind)
    : [];

  const whatsappMessage =
    order.whatsappMessage ??
    buildOrderReadyWhatsappMessage(order, getBranchInfo(order.branchId).name, pendingCents);
  const waDigits = order.customerPhone ? order.customerPhone.replace(/\D/g, '') : '';
  const whatsappUrl = waDigits
    ? `https://wa.me/52${waDigits}?text=${encodeURIComponent(whatsappMessage)}`
    : `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`;

  const firstPendingLine = paymentLines.find((line) => line.status === 'pendiente');
  const nextStageLabel = order.encargoStage ? NEXT_STAGE_LABEL[order.encargoStage] : undefined;
  const isFinished =
    (order.serviceType === 'encargo' && order.encargoStage === 'entregado') ||
    (order.serviceType === 'autoservicio' && pendingCents === 0 && ticket?.status === 'emitido');

  async function runBusy(key: string, action: () => Promise<void>) {
    if (busyAction) return;
    setBusyAction(key);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  }

  function renderQuickAction() {
    if (paymentLines.length === 0 && order.serviceType === 'encargo' && order.totalCents > 0) {
      return (
        <button
          type="button"
          className={`btn btn-sm ${activeCheckout ? 'btn-secondary' : 'btn-primary'}`}
          disabled={!hasOpenShift && !activeCheckout}
          aria-controls={activeCheckout ? 'checkout-form' : undefined}
          onClick={(event) => onStartCheckout(order, event.currentTarget)}
        >
          {activeCheckout ? 'Ir al cobro' : 'Cobrar'}
        </button>
      );
    }
    if (firstPendingLine) {
      return (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busyAction !== null}
          onClick={() =>
            void runBusy(`confirm-${firstPendingLine.id}`, () =>
              onConfirmPaymentLine(firstPendingLine.id),
            )
          }
        >
          Confirmar {formatMxn(firstPendingLine.amountCents)}
        </button>
      );
    }
    if (order.serviceType === 'encargo' && nextStageLabel) {
      return (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busyAction !== null}
          onClick={() => void runBusy('advance', () => onAdvanceEncargo(order.id))}
        >
          {nextStageLabel}
        </button>
      );
    }
    if (pendingCents === 0 && (!ticket || ticket.status !== 'emitido')) {
      return (
        <button
          type="button"
          className={`btn btn-sm ${ticket?.status === 'fallo' ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => onOpenTicket(order.id)}
        >
          <Receipt size={15} />
          {ticket?.status === 'fallo' ? 'Reintentar ticket' : 'Emitir ticket'}
        </button>
      );
    }
    if (deliverCheck.allowed) {
      return (
        <button
          type="button"
          className="btn btn-success btn-sm"
          disabled={busyAction !== null}
          onClick={() => void runBusy('deliver', () => onDeliverEncargo(order.id))}
        >
          <PackageCheck size={15} />
          Entregar
        </button>
      );
    }
    return null;
  }

  const quickAction = !expanded ? renderQuickAction() : null;
  const timeStr = new Date(order.createdAt).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <article
      className={`order-card ${expanded ? 'expanded' : 'collapsed'} ${isFinished ? 'finished' : ''} ${
        activeCheckout ? 'charging' : ''
      }`}
    >
      <div className="order-summary-row">
        <button
          type="button"
          className="order-summary-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <div className="order-summary-top">
            <span className="order-folio">{order.folio}</span>
            {order.serviceType === 'encargo' && order.encargoStage ? (
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
            ) : (
              <span className="badge badge-info">Autoservicio</span>
            )}
            {activeCheckout ? (
              <span className="badge badge-info">Cobro en curso</span>
            ) : pendingCents > 0 && (
              <span className="badge badge-warning">Pendiente {formatMxn(pendingCents)}</span>
            )}
          </div>
          <div className="order-summary-sub">
            <span className="order-client">
              {order.serviceType === 'encargo' ? order.customerAlias : 'Mostrador autoservicio'}
            </span>
            <span className="muted">· {timeStr}</span>
          </div>
        </button>

        <div className="order-summary-right">
          <strong className="order-total">{formatMxn(order.totalCents)}</strong>
          {quickAction}
          <button
            type="button"
            className="order-expand-btn"
            aria-label={expanded ? `Ocultar detalle de ${order.folio}` : `Ver detalle de ${order.folio}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
          >
            <ChevronDown
              size={16}
              aria-hidden="true"
              style={{
                transform: expanded ? 'rotate(180deg)' : undefined,
                transition: 'transform 0.16s ease',
              }}
            />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="order-details">
          <div className="order-meta">
            <span>
              {order.serviceType === 'encargo' ? 'Encargo' : 'Autoservicio'} ·{' '}
              {lineItems.map((item) => `${item.name} x${item.quantity}`).join(' · ')} · {timeStr}
            </span>
            {order.assignedMachineLabels && order.assignedMachineLabels.length > 0 && (
              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {order.assignedMachineLabels.map((label) => (
                  <span key={label} className="badge badge-info">
                    Equipo: {label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {order.serviceType === 'encargo' && order.encargoStage && (
            <ol className="stage-stepper" aria-label="Progreso del encargo">
              {ENCARGO_STAGES.map((stage, index) => {
                const stateClass =
                  index < currentStageIndex
                    ? 'done'
                    : index === currentStageIndex
                      ? 'current'
                      : 'upcoming';
                return (
                  <li key={stage.id} className={`stage-step ${stateClass}`}>
                    <span className="stage-step-dot" aria-hidden="true" />
                    <span>{stage.label}</span>
                  </li>
                );
              })}
            </ol>
          )}

          {paymentLines.length > 0 && (
            <div className="payment-chips">
              {paymentLines.map((line) => (
                <div key={line.id} className="payment-chip">
                  <div className="payment-chip-main">
                    <span>
                      {METHOD_LABEL[line.method]} {formatMxn(line.amountCents)}
                    </span>
                    {line.status === 'confirmado' ? (
                      <span className="badge badge-success">
                        <CheckCircle2 size={12} /> Confirmado
                      </span>
                    ) : (
                      <span className="badge badge-warning">
                        <Clock size={12} /> Pendiente
                      </span>
                    )}
                  </div>

                  {line.status === 'confirmado' && (line.reference || line.confirmedBy) && (
                    <small className="payment-chip-meta">
                      {line.reference ? `Ref: ${line.reference} · ` : ''}
                      {line.confirmedBy ? `Confirmado por ${line.confirmedBy}` : ''}
                      {line.confirmedAt
                        ? ` (${new Date(line.confirmedAt).toLocaleString('es-MX', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })})`
                        : ''}
                    </small>
                  )}

                  {line.status === 'pendiente' && (
                    <div className="payment-confirm-inline">
                      <input
                        className="input input-sm"
                        placeholder={
                          line.method === 'tarjeta'
                            ? 'Ref. terminal (opcional)'
                            : 'Ref. bancaria (opcional)'
                        }
                        aria-label={`Referencia de ${METHOD_LABEL[line.method]} para ${order.folio}`}
                        value={refDrafts[line.id] ?? ''}
                        onChange={(event) =>
                          setRefDrafts((prev) => ({ ...prev, [line.id]: event.target.value }))
                        }
                        maxLength={60}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyAction !== null}
                        onClick={() =>
                          void runBusy(`confirm-${line.id}`, () =>
                            onConfirmPaymentLine(line.id, refDrafts[line.id]?.trim() || undefined),
                          )
                        }
                      >
                        {line.method === 'tarjeta'
                          ? 'Registrar pago aprobado en terminal'
                          : 'Marcar transferencia verificada'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {order.serviceType === 'encargo' && nextStageLabel && candidateMachines.length > 0 && (
            <div className="field" style={{ marginTop: 8 }}>
              <label style={{ fontSize: '0.82rem' }}>
                Asignar {nextMachineKind === 'lavadora' ? 'lavadora(s)' : 'secadora(s)'} al avanzar (libera el equipo previo)
              </label>
              <div className="machine-picker">
                {candidateMachines.map((machine) => {
                  const available = machine.status === 'disponible';
                  const active = selectedNextMachines.includes(machine.id);
                  return (
                    <button
                      key={machine.id}
                      type="button"
                      disabled={!available}
                      aria-pressed={active}
                      className={`machine-chip ${active ? 'active' : ''} status-${machine.status}`}
                      onClick={() =>
                        setSelectedNextMachines((prev) =>
                          prev.includes(machine.id)
                            ? prev.filter((id) => id !== machine.id)
                            : [...prev, machine.id],
                        )
                      }
                    >
                      <strong>{machine.code}</strong>
                      <small>
                        {machine.status === 'disponible'
                          ? 'Libre'
                          : machine.status === 'en_uso'
                            ? `En uso (${machine.currentOrderFolio ?? ''})`
                            : 'Fuera serv.'}
                      </small>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {order.serviceType === 'encargo' && order.encargoStage === 'listo' && (
            <div className="whatsapp-box">
              <div className="whatsapp-box-head">
                <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <MessageCircle size={15} />
                  Aviso al cliente · Folio {order.folio}
                </strong>
                {order.whatsappSentAt ? (
                  <span className="badge badge-success">
                    Aviso enviado ({new Date(order.whatsappSentAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })})
                  </span>
                ) : (
                  <span className="badge badge-warning">Pendiente de enviar</span>
                )}
              </div>
              <p className="whatsapp-preview">{whatsappMessage}</p>
              <div className="order-actions">
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm"
                >
                  <ExternalLink size={14} />
                  Abrir WhatsApp
                </a>
                {!order.whatsappSentAt && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busyAction !== null}
                    onClick={() => void runBusy('wa-sent', () => onRecordWhatsappSent(order.id))}
                  >
                    <CheckCircle2 size={14} />
                    Registrar aviso enviado
                  </button>
                )}
              </div>
              {order.whatsappSentBy && (
                <small className="muted" style={{ display: 'block', marginTop: 4 }}>
                  Registrado por {order.whatsappSentBy}
                </small>
              )}
            </div>
          )}

          <div className="order-actions">
            {paymentLines.length === 0 && order.serviceType === 'encargo' && order.totalCents > 0 && (
              <button
                type="button"
                className={`btn btn-sm ${activeCheckout ? 'btn-secondary' : 'btn-primary'}`}
                disabled={!hasOpenShift && !activeCheckout}
                aria-controls={activeCheckout ? 'checkout-form' : undefined}
                onClick={(event) => onStartCheckout(order, event.currentTarget)}
              >
                {activeCheckout ? 'Ir al cobro' : 'Cobrar encargo'}
              </button>
            )}

            {pendingCents === 0 && (
              <button
                type="button"
                className={`btn btn-sm ${
                  ticket?.status === 'fallo'
                    ? 'btn-danger'
                    : ticket?.status === 'emitido'
                      ? 'btn-secondary'
                      : 'btn-primary'
                }`}
                onClick={() => onOpenTicket(order.id)}
              >
                <Receipt size={16} />
                {ticket?.status === 'emitido'
                  ? 'Ver ticket (emitido)'
                  : ticket?.status === 'fallo'
                    ? 'Reintentar ticket (falló)'
                    : 'Emitir ticket'}
              </button>
            )}

            {order.serviceType === 'encargo' && nextStageLabel && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busyAction !== null}
                onClick={() =>
                  void runBusy('advance', async () => {
                    const machinesToAssign = selectedNextMachines.length > 0 ? selectedNextMachines : undefined;
                    await onAdvanceEncargo(order.id, machinesToAssign);
                    setSelectedNextMachines([]);
                  })
                }
              >
                <Sparkles size={16} />
                {nextStageLabel}
                <ArrowRight size={14} />
              </button>
            )}

            {deliverCheck.allowed && (
              <button
                type="button"
                className="btn btn-success btn-sm"
                disabled={busyAction !== null}
                onClick={() => void runBusy('deliver', () => onDeliverEncargo(order.id))}
              >
                <PackageCheck size={16} />
                Entregar orden
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
