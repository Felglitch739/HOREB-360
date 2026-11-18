import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  PackageCheck,
  Receipt,
  Sparkles,
} from 'lucide-react';
import { formatMxn } from '../domain/money';
import { ENCARGO_STAGES, getOrderLineItems } from '../domain/rules';
import type { EncargoStage, Order, PaymentLine, TicketState } from '../domain/types';

interface OrderCardProps {
  order: Order;
  paymentLines: PaymentLine[];
  ticket?: TicketState;
  pendingCents: number;
  deliverCheck: { allowed: boolean; reason?: string };
  hasOpenShift: boolean;
  onStartCheckout: (order: Order) => void;
  onConfirmPaymentLine: (lineId: string, reference?: string) => Promise<void>;
  onOpenTicket: (orderId: string) => void;
  onAdvanceEncargo: (orderId: string) => Promise<void>;
  onDeliverEncargo: (orderId: string) => Promise<void>;
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
  paymentLines,
  ticket,
  pendingCents,
  deliverCheck,
  hasOpenShift,
  onStartCheckout,
  onConfirmPaymentLine,
  onOpenTicket,
  onAdvanceEncargo,
  onDeliverEncargo,
}: OrderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [refDrafts, setRefDrafts] = useState<Record<string, string>>({});
  const currentStageIndex = order.encargoStage
    ? ENCARGO_STAGES.findIndex((s) => s.id === order.encargoStage)
    : -1;
  const lineItems = getOrderLineItems(order);

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
    if (paymentLines.length === 0 && order.serviceType === 'encargo') {
      return (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!hasOpenShift}
          onClick={() => onStartCheckout(order)}
        >
          Cobrar
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
    <article className={`order-card ${expanded ? 'expanded' : 'collapsed'} ${isFinished ? 'finished' : ''}`}>
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
            {pendingCents > 0 && (
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

          <div className="order-actions">
            {paymentLines.length === 0 && order.serviceType === 'encargo' && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!hasOpenShift}
                onClick={() => onStartCheckout(order)}
              >
                Cobrar encargo
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
                onClick={() => void runBusy('advance', () => onAdvanceEncargo(order.id))}
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
