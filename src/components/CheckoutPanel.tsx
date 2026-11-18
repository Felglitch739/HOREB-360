import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { COMBO_PRICE_CENTS, calculateTender, formatMxn } from '../domain/money';
import type { CreateOrderInput, PaymentInputLine } from '../domain/rules';
import type { Order, ServiceType } from '../domain/types';

interface CheckoutPanelProps {
  branchName: string;
  openShift: boolean;
  suggestedFolio: string;
  checkoutOrder: Order | null;
  feedback: { type: 'error' | 'success'; text: string } | null;
  onFeedback: (next: { type: 'error' | 'success'; text: string } | null) => void;
  onCancelCheckout: () => void;
  onCreateOrder: (
    input: Omit<CreateOrderInput, 'branchId'>,
  ) => Promise<{ ok: boolean; error?: string; order?: Order }>;
  onCapturePayment: (
    orderId: string,
    lines: PaymentInputLine[],
  ) => Promise<{ ok: boolean; error?: string; order?: Order }>;
}

const COMBO_PRESETS = [1, 2, 3, 5] as const;

export function CheckoutPanel({
  branchName,
  openShift,
  suggestedFolio,
  checkoutOrder,
  feedback,
  onFeedback,
  onCancelCheckout,
  onCreateOrder,
  onCapturePayment,
}: CheckoutPanelProps) {
  const [serviceType, setServiceType] = useState<ServiceType>('autoservicio');
  const [folio, setFolio] = useState(suggestedFolio);
  const [customerAlias, setCustomerAlias] = useState('');
  const [comboCount, setComboCount] = useState(1);
  const [payAtPickup, setPayAtPickup] = useState(true);

  const [cashInput, setCashInput] = useState('');
  const [cardInput, setCardInput] = useState('0');
  const [transferInput, setTransferInput] = useState('0');
  const [confirmCardNow, setConfirmCardNow] = useState(false);
  const [confirmTransferNow, setConfirmTransferNow] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setFolio(suggestedFolio);
  }, [suggestedFolio]);

  useEffect(() => {
    if (checkoutOrder) {
      setCashInput('');
      setCardInput('0');
      setTransferInput('0');
      setConfirmCardNow(false);
      setConfirmTransferNow(false);
    }
  }, [checkoutOrder?.id]);

  const deferPayment = !checkoutOrder && serviceType === 'encargo' && payAtPickup;
  const totalCents = checkoutOrder?.totalCents ?? comboCount * COMBO_PRICE_CENTS;
  const tender = calculateTender(totalCents, cashInput, cardInput, transferInput);

  function resetPaymentInputs() {
    setCashInput('');
    setCardInput('0');
    setTransferInput('0');
    setConfirmCardNow(false);
    setConfirmTransferNow(false);
  }

  function setSingleMethod(method: 'efectivo' | 'tarjeta' | 'transferencia') {
    const pesos = String(totalCents / 100);
    setCashInput(method === 'efectivo' ? pesos : '0');
    setCardInput(method === 'tarjeta' ? pesos : '0');
    setTransferInput(method === 'transferencia' ? pesos : '0');
    onFeedback(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    onFeedback(null);

    const paymentLines: PaymentInputLine[] = [];
    let change = 0;

    if (!deferPayment) {
      if (!tender.ok) {
        onFeedback({ type: 'error', text: tender.error });
        return;
      }
      if (tender.remaining > 0) {
        onFeedback({
          type: 'error',
          text: `Faltan ${formatMxn(tender.remaining)} para el total de ${formatMxn(totalCents)}.`,
        });
        return;
      }
      change = tender.change;
      if (tender.cashApplied > 0) {
        paymentLines.push({
          method: 'efectivo',
          amountCents: tender.cashApplied,
          cashReceivedCents: tender.cash,
        });
      }
      if (tender.card > 0) {
        paymentLines.push({
          method: 'tarjeta',
          amountCents: tender.card,
          confirmImmediately: confirmCardNow,
        });
      }
      if (tender.transfer > 0) {
        paymentLines.push({
          method: 'transferencia',
          amountCents: tender.transfer,
          confirmImmediately: confirmTransferNow,
        });
      }
    }

    setSubmitting(true);
    try {
      const res = checkoutOrder
        ? await onCapturePayment(checkoutOrder.id, paymentLines)
        : await onCreateOrder({
            serviceType,
            folio,
            customerAlias,
            comboCount,
            paymentLines: deferPayment ? [] : paymentLines,
          });

      if (!res.ok) {
        onFeedback({ type: 'error', text: res.error ?? 'No se pudo registrar la orden.' });
        return;
      }

      onFeedback({
        type: 'success',
        text:
          (checkoutOrder
            ? `Cobro registrado en ${checkoutOrder.folio}.`
            : `Orden ${res.order?.folio} guardada en ${branchName}.`) +
          (change > 0 ? ` Entrega ${formatMxn(change)} de cambio.` : ''),
      });
      if (checkoutOrder) onCancelCheckout();
      setCustomerAlias('');
      setComboCount(1);
      resetPaymentInputs();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="checkout-form" className="card" aria-label="Registrar orden en mostrador">
      <h2 className="card-title">
        <span>{checkoutOrder ? `Cobrar ${checkoutOrder.folio}` : `Mostrador · ${branchName}`}</span>
        <span className="badge badge-info">Combo {formatMxn(COMBO_PRICE_CENTS)}</span>
      </h2>

      {!openShift && (
        <div className="alert alert-error">
          No hay turno abierto en {branchName}. Ve a <strong>Caja</strong> para abrir un turno antes de cobrar.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {checkoutOrder ? (
          <p className="muted">
            Encargo de <strong>{checkoutOrder.customerAlias}</strong> · {formatMxn(checkoutOrder.totalCents)}
          </p>
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
              <label htmlFor="folio-input">Folio de orden</label>
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
                <label htmlFor="alias-input">Cliente / referencia</label>
                <input
                  id="alias-input"
                  className="input"
                  value={customerAlias}
                  onChange={(e) => setCustomerAlias(e.target.value)}
                  placeholder="Ej. María López"
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="combo-count">
                Combo Lavado + Secado ({formatMxn(COMBO_PRICE_CENTS)} c/u)
              </label>
              <div className="combo-presets" role="group" aria-label="Cantidad rápida de combos">
                {COMBO_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`combo-preset-chip ${comboCount === preset ? 'active' : ''}`}
                    onClick={() => setComboCount(preset)}
                  >
                    x{preset}
                  </button>
                ))}
              </div>
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

        {deferPayment ? (
          <div className="alert alert-info">
            El encargo se registrará con saldo pendiente ({formatMxn(totalCents)}) para cobrarse al entregar.
          </div>
        ) : (
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
                  <strong>Tarjeta</strong>
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
                  <strong>Transferencia</strong>
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
              {tender.ok && (
                <strong style={{ color: tender.remaining > 0 ? 'var(--warning)' : 'var(--success)' }}>
                  {tender.remaining > 0
                    ? `Falta ${formatMxn(tender.remaining)}`
                    : `Cambio ${formatMxn(tender.change)}`}
                </strong>
              )}
            </div>
          </>
        )}

        {feedback && (
          <div
            role={feedback.type === 'error' ? 'alert' : 'status'}
            className={`alert ${feedback.type === 'error' ? 'alert-error' : 'alert-success'}`}
          >
            {feedback.text}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-full" disabled={!openShift || submitting}>
          <Plus size={18} />
          {checkoutOrder
            ? 'Guardar cobro'
            : deferPayment
              ? 'Guardar encargo'
              : 'Guardar folio y pago'}{' '}
          ({formatMxn(totalCents)})
        </button>

        {checkoutOrder && (
          <button
            type="button"
            className="btn btn-secondary btn-full"
            style={{ marginTop: 8 }}
            onClick={() => {
              onCancelCheckout();
              resetPaymentInputs();
              onFeedback(null);
            }}
          >
            Cancelar cobro
          </button>
        )}
      </form>
    </section>
  );
}
