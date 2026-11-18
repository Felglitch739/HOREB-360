import { useState } from 'react';
import { ArrowRight, CheckCircle2, Clock, PackageCheck, Receipt, Sparkles } from 'lucide-react';
import { formatMxn } from '../domain/money';
import { ENCARGO_STAGES } from '../domain/rules';
import type { EncargoStage, Order, PaymentLine, TicketState } from '../domain/types';

interface OrderCardProps {
  order: Order;
  paymentLines: PaymentLine[];
  ticket?: TicketState;
  pendingCents: number;
  deliverCheck: { allowed: boolean; reason?: string };
  hasOpenShift: boolean;
  onStartCheckout: (order: Order) => void;
  onConfirmPaymentLine: (lineId: string) => Promise<void>;
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
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const currentStageIndex = order.encargoStage
    ? ENCARGO_STAGES.findIndex((s) => s.id === order.encargoStage)
    : -1;

  async function runBusy(key: string, action: () => Promise<void>) {
    if (busyAction) return;
    setBusyAction(key);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <article className="order-card">
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
          Combo x{order.comboCount} ·{' '}
          {new Date(order.createdAt).toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
          })}
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

      {pendingCents > 0 && (
        <p className="muted" style={{ margin: '0 0 8px', fontWeight: 600 }}>
          Saldo pendiente: {formatMxn(pendingCents)}
        </p>
      )}

      {paymentLines.length > 0 && (
        <div className="payment-chips">
          {paymentLines.map((line) => (
            <div key={line.id} className="payment-chip">
              <span>
                {METHOD_LABEL[line.method]} {formatMxn(line.amountCents)}
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
                    disabled={busyAction !== null}
                    onClick={() => void runBusy(`confirm-${line.id}`, () => onConfirmPaymentLine(line.id))}
                  >
                    Confirmar
                  </button>
                </>
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
          title={pendingCents > 0 ? 'Confirma el pago completo antes de emitir el comprobante.' : undefined}
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
          NEXT_STAGE_LABEL[order.encargoStage] && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busyAction !== null}
              onClick={() => void runBusy('advance', () => onAdvanceEncargo(order.id))}
            >
              <Sparkles size={16} />
              {NEXT_STAGE_LABEL[order.encargoStage]}
              <ArrowRight size={14} />
            </button>
          )}

        {order.serviceType === 'encargo' && order.encargoStage !== 'entregado' && (
          <button
            type="button"
            className="btn btn-success btn-sm"
            disabled={!deliverCheck.allowed || busyAction !== null}
            title={deliverCheck.reason}
            onClick={() => void runBusy('deliver', () => onDeliverEncargo(order.id))}
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
            Entrega pendiente: {deliverCheck.reason}
          </div>
        )}
    </article>
  );
}
