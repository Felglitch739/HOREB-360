import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Printer, RefreshCw, X } from 'lucide-react';
import { formatMxn } from '../domain/money';
import { getBranchInfo } from '../domain/rules';
import type { Order, PaymentLine, TicketState } from '../domain/types';

interface TicketModalProps {
  order: Order;
  paymentLines: PaymentLine[];
  ticket: TicketState;
  onEmit: (orderId: string, simulateFailure: boolean) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

const METHOD_LABEL: Record<PaymentLine['method'], string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta (sim.)',
  transferencia: 'Transferencia (sim.)',
};

export function TicketModal({
  order,
  paymentLines,
  ticket,
  onEmit,
  onClose,
}: TicketModalProps) {
  const branch = getBranchInfo(order.branchId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function issue(fails: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await onEmit(order.id, fails);
      if (!result.ok) setError(result.error ?? 'No se pudo emitir el comprobante.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ticket-modal-title">
      <div className="modal-card">
        <div className="card-title">
          <span id="ticket-modal-title">Comprobante · {order.folio}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            aria-label="Cerrar ticket"
          >
            <X size={18} />
          </button>
        </div>

        <div className="alert alert-info">
          Comprobante simulado en pantalla (sin validez fiscal). Folio y pago permanecen guardados aunque falle la emisión.
        </div>

        <div className="ticket-paper">
          <div className="ticket-center">
            <strong>HOREB 360 · COMPROBANTE SIMULADO</strong>
            <div>Sucursal: {branch.name}</div>
            <div>Folio: {order.folio}</div>
            <div>Fecha: {new Date(order.createdAt).toLocaleString('es-MX')}</div>
          </div>

          <div className="ticket-divider" />

          <div className="ticket-row">
            <span>Servicio:</span>
            <span>{order.serviceType === 'encargo' ? `Encargo (${order.customerAlias})` : 'Autoservicio'}</span>
          </div>
          <div className="ticket-row">
            <span>Combo Lavado + Secado x{order.comboCount}</span>
            <span>{formatMxn(order.totalCents)}</span>
          </div>

          <div className="ticket-divider" />
          <strong>Pagos registrados</strong>
          {paymentLines.map((line) => (
            <div className="ticket-row" key={line.id}>
              <span>
                {METHOD_LABEL[line.method]} ({line.status === 'confirmado' ? 'Confirmado' : 'Pendiente'})
              </span>
              <span>{formatMxn(line.amountCents)}</span>
            </div>
          ))}
          {paymentLines.map((line) => line.cashReceivedCents !== undefined && line.cashReceivedCents > line.amountCents && (
            <div key={line.id + '-change'}>
              <div className="ticket-row"><span>Efectivo recibido</span><span>{formatMxn(line.cashReceivedCents)}</span></div>
              <div className="ticket-row"><span>Cambio</span><span>{formatMxn(line.cashReceivedCents - line.amountCents)}</span></div>
            </div>
          ))}

          <div className="ticket-divider" />
          <div className="ticket-row">
            <strong>TOTAL</strong>
            <strong>{formatMxn(order.totalCents)}</strong>
          </div>
          <div className="ticket-row">
            <span>Estado ticket:</span>
            <span>
              {ticket.status === 'emitido'
                ? 'EMITIDO (SIMULADO)'
                : ticket.status === 'fallo'
                  ? `FALLA (intentos: ${ticket.attempts})`
                  : 'NO EMITIDO'}
            </span>
          </div>
        </div>

        {ticket.status === 'fallo' && ticket.lastError && (
          <div className="alert alert-error">
            <AlertTriangle size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
            {ticket.lastError}
          </div>
        )}

        {ticket.status === 'emitido' && (
          <div className="alert alert-success">
            <CheckCircle2 size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
            Ticket emitido bajo el folio {ticket.folio} (intentos: {ticket.attempts}).
          </div>
        )}

        <div className="order-actions">
          {error && <p className="alert alert-error" role="alert">{error}</p>}
          {ticket.status === 'no_emitido' && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void issue(false)}
              >
                <Printer size={18} />
                Emitir ticket
              </button>
              <button
                type="button"
                className="btn btn-warning"
                disabled={busy}
                onClick={() => void issue(true)}
              >
                <AlertTriangle size={18} />
                Simular falla de emisión
              </button>
            </>
          )}

          {ticket.status === 'fallo' && (
            <button
              type="button"
              className="btn btn-primary btn-full"
              disabled={busy}
                onClick={() => void issue(false)}
            >
              <RefreshCw size={18} />
              Reintentar mismo ticket ({order.folio})
            </button>
          )}

          {ticket.status === 'emitido' && (
            <button
              type="button"
              className="btn btn-secondary btn-full"
              onClick={onClose}
            >
              Listo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
