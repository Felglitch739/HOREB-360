import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Printer, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { formatMxn, formatMxnCurrency } from '../domain/money';
import { ENCARGO_STAGES, getBranchInfo, getOrderLineItems } from '../domain/rules';
import type { BranchRole } from '../domain/sharedState';
import type { BranchSettings, Order, PaymentLine, TicketState } from '../domain/types';
import { useModalFocus } from './useModalFocus';

interface TicketModalProps {
  order: Order;
  paymentLines: PaymentLine[];
  ticket: TicketState;
  branchSettings: BranchSettings;
  actorRole: BranchRole;
  onEmit: (orderId: string, simulateFailure: boolean) => Promise<{ ok: boolean; error?: string }>;
  onReprint: (orderId: string) => Promise<{ ok: boolean; error?: string }>;
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
  actorRole,
  onEmit,
  onReprint,
  onClose,
}: TicketModalProps) {
  const branch = getBranchInfo(order.branchId);
  const lineItems = getOrderLineItems(order);
  const canReprint = actorRole === 'supervisor' || Boolean(branchSettings.allowOperatorReprint);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [justIssued, setJustIssued] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>(branchSettings.defaultPaperWidth);
  const [careNote, setCareNote] = useState('');
  const [footerMessage, setFooterMessage] = useState(
    branchSettings.ticketFooter || DEFAULT_FOOTER,
  );
  const dialogRef = useModalFocus(true, onClose);

  const stageLabel = order.encargoStage
    ? ENCARGO_STAGES.find((stage) => stage.id === order.encargoStage)?.label
    : null;

  async function issue(fails: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await onEmit(order.id, fails);
      if (!result.ok) {
        setError(result.error ?? 'No se pudo emitir el comprobante.');
      } else if (!fails) {
        setJustIssued(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleReprint() {
    if (!canReprint || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await onReprint(order.id);
      if (!result.ok) {
        setError(result.error ?? 'No tienes permiso para reimprimir este comprobante.');
        return;
      }
      window.print();
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
    <div
      ref={dialogRef}
      className="modal-backdrop"
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby="ticket-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <style>{`@media print { @page { size: ${paperWidth} auto; margin: 0; } }`}</style>
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

        <div className="ticket-customize-wrap">
          <button
            type="button"
            className="ticket-customize-toggle"
            aria-expanded={showCustomize}
            onClick={() => setShowCustomize((open) => !open)}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <SlidersHorizontal size={15} aria-hidden="true" />
              Personalizar nota o papel ({paperWidth})
            </span>
            <ChevronDown
              size={16}
              aria-hidden="true"
              style={{ transform: showCustomize ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease' }}
            />
          </button>

          {showCustomize && (
            <div className="ticket-customize">
              <div className="field">
                <label>Tamaño de papel térmico</label>
                <div className="ticket-width-group">
                  <button
                    type="button"
                    className={`seg-btn ${paperWidth === '80mm' ? 'active' : ''}`}
                    style={{ minHeight: 44, fontSize: '0.84rem' }}
                    onClick={() => setPaperWidth('80mm')}
                  >
                    80 mm (Estándar)
                  </button>
                  <button
                    type="button"
                    className={`seg-btn ${paperWidth === '58mm' ? 'active' : ''}`}
                    style={{ minHeight: 44, fontSize: '0.84rem' }}
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
                  value={footerMessage}
                  onChange={(event) => setFooterMessage(event.target.value)}
                  maxLength={160}
                />
              </div>
            </div>
          )}
        </div>

        <div className={`ticket-paper ticket-${paperWidth}`}>
          <div className="ticket-center">
            <strong>{branchSettings.businessName}</strong>
            <div>HOREB 360 · Comprobante de servicio</div>
            <div>Sucursal: {branchSettings.branchDisplayName?.trim() || branch.name}</div>
            {branchSettings.branchAddress && <div>{branchSettings.branchAddress}</div>}
            {branchSettings.branchPhone && <div>Tel: {branchSettings.branchPhone}</div>}
            {branchSettings.scheduleText && <div>Horario: {branchSettings.scheduleText}</div>}
            <div className="ticket-folio-box">
              FOLIO {order.folio}
              {(ticket.reprintCount ?? 0) > 0 && (
                <div style={{ fontSize: '0.78em', fontWeight: 700, marginTop: 2 }}>
                  REIMPRESIÓN #{ticket.reprintCount}
                </div>
              )}
            </div>
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
          {lineItems.map((item) => (
            <div className="ticket-row" key={item.itemId}>
              <span>{item.name} x{item.quantity} ({formatMxn(item.unitPriceCents)})</span>
              <span>{formatMxn(item.lineTotalCents)}</span>
            </div>
          ))}

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
            <div key={line.id}>
              <div className="ticket-row">
                <span>
                  {METHOD_LABEL[line.method]} ({line.status === 'confirmado' ? 'Confirmado' : 'Pendiente'})
                </span>
                <span>{formatMxn(line.amountCents)}</span>
              </div>
              {line.reference && (
                <div className="ticket-row" style={{ fontSize: '0.84em', color: '#475569' }}>
                  <span>Ref: {line.reference}</span>
                  <span>{line.confirmedBy ?? ''}</span>
                </div>
              )}
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
            <strong>{formatMxnCurrency(order.totalCents)}</strong>
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
          {footerMessage.trim() && (
            <div className="ticket-footer-msg">{footerMessage.trim()}</div>
          )}
          <div className="ticket-footer-msg" style={{ fontSize: '0.78em', opacity: 0.78 }}>
            Comprobante comercial · No sustituye CFDI fiscal
          </div>
        </div>

        {!branchSettings.branchPhone.trim() && (
          <div className="alert alert-info" style={{ fontSize: '0.82rem' }}>
            El teléfono de la sucursal aún no está capturado. Configúralo en <strong>Ajustes</strong> para imprimirlo en los tickets.
          </div>
        )}

        {ticket.status === 'fallo' && ticket.lastError && (
          <div className="alert alert-error">
            <AlertTriangle size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
            {ticket.lastError}
          </div>
        )}

        {ticket.status === 'emitido' && (
          <div className="alert alert-success">
            <CheckCircle2 size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
            Ticket emitido bajo el folio {ticket.folio}
            {(ticket.reprintCount ?? 0) > 0 ? ` · Reimpresiones: ${ticket.reprintCount}` : ''}.
          </div>
        )}

        <div className="order-actions">
          {error && <p className="alert alert-error" role="alert" style={{ width: '100%' }}>{error}</p>}
          {ticket.status === 'no_emitido' && (
            <div style={{ width: '100%', display: 'grid', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-full"
                disabled={busy}
                onClick={() => void issue(false)}
              >
                <Printer size={18} />
                Emitir ticket
              </button>
              {import.meta.env.DEV && (
                <button
                  type="button"
                  className="ticket-fallback-link"
                  disabled={busy}
                  onClick={() => void issue(true)}
                >
                  Simular falla de impresora (entorno de prueba)
                </button>
              )}
            </div>
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
              {justIssued ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: '1 1 160px' }}
                  onClick={() => window.print()}
                >
                  <Printer size={18} />
                  Imprimir ({paperWidth})
                </button>
              ) : canReprint ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: '1 1 160px' }}
                  disabled={busy}
                  onClick={() => void handleReprint()}
                >
                  <Printer size={18} />
                  Reimprimir comprobante ({paperWidth})
                </button>
              ) : (
                <div className="alert alert-info" style={{ width: '100%', marginBottom: 4 }}>
                  Solo lectura: la reimpresión de comprobantes emitidos requiere permiso de Supervisión.
                </div>
              )}
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
