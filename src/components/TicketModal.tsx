import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Printer, RefreshCw, X } from 'lucide-react';
import { formatMxn } from '../domain/money';
import { ENCARGO_STAGES, getBranchInfo } from '../domain/rules';
import type { BranchSettings, Order, PaymentLine, TicketState } from '../domain/types';
import { Barcode } from './Barcode';

interface TicketModalProps {
  order: Order;
  paymentLines: PaymentLine[];
  ticket: TicketState;
  branchSettings: BranchSettings;
  onEmit: (orderId: string, simulateFailure: boolean) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

const METHOD_LABEL: Record<PaymentLine['method'], string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
};

const QUICK_NOTES = [
  'Ropa delicada',
  'Sin suavizante',
  'Entregar en gancho',
  'Doblar especial',
] as const;

const DEFAULT_FOOTER =
  '¡Gracias por su preferencia! Conserve este comprobante para recoger su encargo.';

export function TicketModal({
  order,
  paymentLines,
  ticket,
  branchSettings,
  onEmit,
  onClose,
}: TicketModalProps) {
  const branch = getBranchInfo(order.branchId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>(branchSettings.defaultPaperWidth);
  const [careNote, setCareNote] = useState('');
  const [footerMessage, setFooterMessage] = useState(
    branchSettings.ticketFooter || DEFAULT_FOOTER,
  );

  const stageLabel = order.encargoStage
    ? ENCARGO_STAGES.find((stage) => stage.id === order.encargoStage)?.label
    : null;

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

  function toggleQuickNote(note: string) {
    const items = careNote
      .split('·')
      .map((item) => item.trim())
      .filter(Boolean);
    const exists = items.includes(note);
    const next = exists ? items.filter((item) => item !== note) : [...items, note];
    setCareNote(next.join(' · '));
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

        <div className="ticket-customize">
          <div className="field">
            <label>Tamaño de papel térmico</label>
            <div className="ticket-width-group">
              <button
                type="button"
                className={`seg-btn ${paperWidth === '80mm' ? 'active' : ''}`}
                style={{ minHeight: 36, fontSize: '0.84rem' }}
                onClick={() => setPaperWidth('80mm')}
              >
                80 mm (Estándar)
              </button>
              <button
                type="button"
                className={`seg-btn ${paperWidth === '58mm' ? 'active' : ''}`}
                style={{ minHeight: 36, fontSize: '0.84rem' }}
                onClick={() => setPaperWidth('58mm')}
              >
                58 mm (Compacto)
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="ticket-care-note">Nota / indicaciones de prenda</label>
            <input
              id="ticket-care-note"
              className="input"
              style={{ minHeight: 38 }}
              value={careNote}
              onChange={(event) => setCareNote(event.target.value)}
              placeholder="Ej. Sin suavizante, entregar en gancho"
              maxLength={120}
            />
            <div className="ticket-note-chips">
              {QUICK_NOTES.map((note) => {
                const active = careNote
                  .split('·')
                  .map((item) => item.trim())
                  .includes(note);
                return (
                  <button
                    key={note}
                    type="button"
                    className={`combo-preset-chip ${active ? 'active' : ''}`}
                    onClick={() => toggleQuickNote(note)}
                  >
                    {note}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="field">
            <label htmlFor="ticket-footer-msg">Mensaje al pie</label>
            <input
              id="ticket-footer-msg"
              className="input"
              style={{ minHeight: 38 }}
              value={footerMessage}
              onChange={(event) => setFooterMessage(event.target.value)}
              maxLength={120}
            />
          </div>
        </div>

        <div className={`ticket-paper ticket-${paperWidth}`}>
          <div className="ticket-center">
            <strong>{branchSettings.businessName}</strong>
            <div>HOREB 360 · Comprobante de servicio</div>
            <div>Sucursal: {branch.name}</div>
            {branchSettings.branchPhone && <div>Tel: {branchSettings.branchPhone}</div>}
            {branchSettings.scheduleText && <div>Horario: {branchSettings.scheduleText}</div>}
            <div className="ticket-folio-box">FOLIO {order.folio}</div>
            <div>Fecha: {new Date(order.createdAt).toLocaleString('es-MX')}</div>
          </div>

          <div className="ticket-divider" />

          <div className="ticket-row">
            <span>Servicio:</span>
            <span>{order.serviceType === 'encargo' ? 'Encargo' : 'Autoservicio'}</span>
          </div>
          {order.serviceType === 'encargo' && (
            <div className="ticket-row">
              <span>Cliente:</span>
              <span>{order.customerAlias}</span>
            </div>
          )}
          {stageLabel && (
            <div className="ticket-row">
              <span>Etapa:</span>
              <span>{stageLabel}</span>
            </div>
          )}
          <div className="ticket-row">
            <span>Combo Lavado + Secado x{order.comboCount}</span>
            <span>{formatMxn(order.totalCents)}</span>
          </div>

          {careNote.trim() && (
            <>
              <div className="ticket-divider" />
              <div className="ticket-note-block">
                <strong>Indicaciones:</strong> {careNote.trim()}
              </div>
            </>
          )}

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
                ? 'EMITIDO'
                : ticket.status === 'fallo'
                  ? `FALLA DE IMPRESIÓN (intentos: ${ticket.attempts})`
                  : 'PENDIENTE DE EMISIÓN'}
            </span>
          </div>

          <div className="ticket-divider" />
          <Barcode value={order.folio} />
          {footerMessage.trim() && (
            <div className="ticket-footer-msg">{footerMessage.trim()}</div>
          )}
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
                Reportar falla de impresora
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
            <>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: '1 1 160px' }}
                onClick={() => window.print()}
              >
                <Printer size={18} />
                Imprimir ({paperWidth})
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: '1 1 120px' }}
                onClick={onClose}
              >
                Listo
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
