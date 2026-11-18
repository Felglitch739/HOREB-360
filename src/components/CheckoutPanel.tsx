import { useEffect, useState } from 'react';
import { Gift, Minus, Plus, Receipt, UserPlus } from 'lucide-react';
import { calculateTender, formatMxn } from '../domain/money';
import type { CreateOrderInput, PaymentInputLine } from '../domain/rules';
import type { BranchId, CatalogItem, Customer, Machine, Order, ServiceType } from '../domain/types';
import { CustomSelect } from './CustomSelect';

interface CheckoutPanelProps {
  branchId: BranchId;
  branchName: string;
  catalog: CatalogItem[];
  machines: Machine[];
  customers: Customer[];
  openShift: boolean;
  suggestedFolio: string;
  checkoutOrder: Order | null;
  feedback: { type: 'error' | 'success'; text: string; orderId?: string } | null;
  onFeedback: (next: { type: 'error' | 'success'; text: string; orderId?: string } | null) => void;
  onCancelCheckout: () => void;
  onCreateOrder: (
    input: Omit<CreateOrderInput, 'branchId'>,
  ) => Promise<{ ok: boolean; error?: string; order?: Order }>;
  onCapturePayment: (
    orderId: string,
    lines: PaymentInputLine[],
  ) => Promise<{ ok: boolean; error?: string; order?: Order }>;
  onUpsertCustomer: (
    branchId: BranchId,
    customer: { id?: string; name: string; phone: string; contactConsent: boolean },
  ) => Promise<{ ok: boolean; error?: string; customer?: Customer }>;
  onOpenTicket: (orderId: string) => void;
}

export function CheckoutPanel({
  branchId,
  branchName,
  catalog,
  machines,
  customers,
  openShift,
  suggestedFolio,
  checkoutOrder,
  feedback,
  onFeedback,
  onCancelCheckout,
  onCreateOrder,
  onCapturePayment,
  onUpsertCustomer,
  onOpenTicket,
}: CheckoutPanelProps) {
  const activeCatalog = catalog.filter((item) => item.active);
  const [serviceType, setServiceType] = useState<ServiceType>('autoservicio');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustConsent, setNewCustConsent] = useState(true);
  const [savingCustomer, setSavingCustomer] = useState(false);

  const [customerAlias, setCustomerAlias] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>(() => ({
    [activeCatalog[0]?.id ?? 'combo']: 1,
  }));
  const [redeemFreeCombo, setRedeemFreeCombo] = useState(false);
  const [selectedMachineIds, setSelectedMachineIds] = useState<string[]>([]);
  const [payAtPickup, setPayAtPickup] = useState(true);

  const [cashInput, setCashInput] = useState('');
  const [cardInput, setCardInput] = useState('0');
  const [transferInput, setTransferInput] = useState('0');
  const [confirmCardNow, setConfirmCardNow] = useState(false);
  const [cardReference, setCardReference] = useState('');
  const [confirmTransferNow, setConfirmTransferNow] = useState(false);
  const [transferReference, setTransferReference] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? null;

  useEffect(() => {
    if (checkoutOrder) {
      setCashInput('');
      setCardInput('0');
      setTransferInput('0');
      setConfirmCardNow(false);
      setCardReference('');
      setConfirmTransferNow(false);
      setTransferReference('');
    }
  }, [checkoutOrder?.id]);

  const selectedItems = activeCatalog
    .map((item) => ({ item, quantity: quantities[item.id] ?? 0 }))
    .filter((entry) => entry.quantity > 0);

  const comboEntry = selectedItems.find((entry) => (entry.item.loyaltyCredits ?? 0) > 0);
  const canRedeemFreeCombo =
    Boolean(selectedCustomer && selectedCustomer.freeCombosAvailable >= 1 && comboEntry);

  const loyaltyDiscountCents =
    !checkoutOrder && redeemFreeCombo && canRedeemFreeCombo && comboEntry
      ? comboEntry.item.priceCents
      : 0;

  const cartTotalCents = Math.max(
    0,
    selectedItems.reduce((sum, entry) => sum + entry.item.priceCents * entry.quantity, 0) -
      loyaltyDiscountCents,
  );

  const deferPayment = !checkoutOrder && serviceType === 'encargo' && payAtPickup && cartTotalCents > 0;
  const totalCents = checkoutOrder?.totalCents ?? cartTotalCents;
  const freeCoverAll = !checkoutOrder && cartTotalCents === 0 && loyaltyDiscountCents > 0;
  const tender = calculateTender(totalCents, cashInput, cardInput, transferInput);

  function resetPaymentInputs() {
    setCashInput('');
    setCardInput('0');
    setTransferInput('0');
    setConfirmCardNow(false);
    setCardReference('');
    setConfirmTransferNow(false);
    setTransferReference('');
  }

  function updateItemQuantity(itemId: string, delta: number) {
    setQuantities((prev) => {
      const nextQty = Math.max(0, Math.min(99, (prev[itemId] ?? 0) + delta));
      return { ...prev, [itemId]: nextQty };
    });
    onFeedback(null);
  }

  function setSingleMethod(method: 'efectivo' | 'tarjeta' | 'transferencia') {
    if (totalCents <= 0) return;
    const pesos = (totalCents / 100).toFixed(totalCents % 100 === 0 ? 0 : 2);
    setCashInput(method === 'efectivo' ? pesos : '0');
    setCardInput(method === 'tarjeta' ? pesos : '0');
    setTransferInput(method === 'transferencia' ? pesos : '0');
    onFeedback(null);
  }

  const washers = machines.filter((m) => m.kind === 'lavadora');
  const needsMachine = selectedItems.some((entry) => entry.item.requiresMachine);

  function toggleMachine(machineId: string) {
    setSelectedMachineIds((prev) =>
      prev.includes(machineId) ? prev.filter((id) => id !== machineId) : [...prev, machineId],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    onFeedback(null);

    if (!checkoutOrder && selectedItems.length === 0) {
      onFeedback({ type: 'error', text: 'Agrega al menos un servicio o producto al carrito.' });
      return;
    }

    const paymentLines: PaymentInputLine[] = [];
    let change = 0;

    if (!deferPayment && !freeCoverAll) {
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
          reference: cardReference.trim() || undefined,
        });
      }
      if (tender.transfer > 0) {
        paymentLines.push({
          method: 'transferencia',
          amountCents: tender.transfer,
          confirmImmediately: confirmTransferNow,
          reference: transferReference.trim() || undefined,
        });
      }
    }

    setSubmitting(true);
    try {
      const res = checkoutOrder
        ? await onCapturePayment(checkoutOrder.id, paymentLines)
        : await onCreateOrder({
            serviceType,
            customerAlias: customerAlias.trim() || selectedCustomer?.name,
            customerId: selectedCustomer?.id,
            redeemFreeCombo: Boolean(canRedeemFreeCombo && redeemFreeCombo),
            items: selectedItems.map(({ item, quantity }) => ({
              itemId: item.id,
              quantity,
            })),
            machineIds: needsMachine && selectedMachineIds.length > 0 ? selectedMachineIds : undefined,
            paymentLines: deferPayment || freeCoverAll ? [] : paymentLines,
          });

      if (!res.ok) {
        onFeedback({ type: 'error', text: res.error ?? 'No se pudo registrar la orden.' });
        return;
      }

      const savedOrder = res.order ?? checkoutOrder;
      const savedFolio = savedOrder?.folio ?? '';
      onFeedback({
        type: 'success',
        orderId: savedOrder?.id,
        text:
          (checkoutOrder
            ? `Cobro registrado en folio ${savedFolio}.`
            : `Orden guardada · Folio ${savedFolio} (${branchName}).`) +
          (change > 0 ? ` Entrega ${formatMxn(change)} de cambio.` : ''),
      });
      if (checkoutOrder) onCancelCheckout();
      setCustomerAlias('');
      setSelectedCustomerId('');
      setRedeemFreeCombo(false);
      setQuantities({ [activeCatalog[0]?.id ?? 'combo']: 1 });
      setSelectedMachineIds([]);
      resetPaymentInputs();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="checkout-form" className="card" aria-label="Registrar orden en mostrador">
      <h2 className="card-title">
        <span>{checkoutOrder ? `Cobrar ${checkoutOrder.folio}` : `Mostrador · ${branchName}`}</span>
        <span className="badge badge-info">
          {checkoutOrder ? 'Cobro pendiente' : `Sig. folio ${suggestedFolio}`}
        </span>
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
              <div className="catalog-head-row">
                <label style={{ marginBottom: 0 }}>Cliente / Lealtad</label>
                <button
                  type="button"
                  className="ticket-fallback-link"
                  style={{ padding: 0 }}
                  onClick={() => setShowNewCustomer((prev) => !prev)}
                >
                  <UserPlus size={13} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
                  {showNewCustomer ? 'Cerrar alta' : '+ Nuevo cliente'}
                </button>
              </div>

              <CustomSelect
                ariaLabel="Cliente para la orden"
                value={selectedCustomerId}
                options={[
                  { value: '', label: 'Cobro rápido (sin ficha de cliente)' },
                  ...customers.map((c) => ({
                    value: c.id,
                    label: `${c.name} (${c.combosTowardFree}/10${c.freeCombosAvailable > 0 ? ` · ${c.freeCombosAvailable} gratis` : ''})`,
                  })),
                ]}
                onChange={(val) => {
                  setSelectedCustomerId(val);
                  setRedeemFreeCombo(false);
                }}
              />

              {selectedCustomer && (
                <div className="loyalty-inline-pill">
                  <span>
                    Lealtad: <strong>{selectedCustomer.combosTowardFree}/10 combos</strong>
                    {selectedCustomer.freeCombosAvailable > 0
                      ? ` · ¡Tiene ${selectedCustomer.freeCombosAvailable} combo(s) gratis!`
                      : ''}
                  </span>
                </div>
              )}

              {showNewCustomer && (
                <div className="quick-customer-box">
                  <input
                    className="input input-sm"
                    placeholder="Nombre del cliente *"
                    value={newCustName}
                    onChange={(e) => setNewCustName(e.target.value)}
                    maxLength={80}
                  />
                  <input
                    className="input input-sm"
                    type="tel"
                    placeholder="Teléfono 10 dígitos *"
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    maxLength={20}
                  />
                  <label className="checkbox-row" style={{ minHeight: 34, padding: '4px 8px' }}>
                    <input
                      type="checkbox"
                      checked={newCustConsent}
                      onChange={(e) => setNewCustConsent(e.target.checked)}
                    />
                    Autoriza avisos por WhatsApp
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={savingCustomer}
                    onClick={async () => {
                      setSavingCustomer(true);
                      const res = await onUpsertCustomer(branchId, {
                        name: newCustName,
                        phone: newCustPhone,
                        contactConsent: newCustConsent,
                      });
                      setSavingCustomer(false);
                      if (!res.ok) {
                        onFeedback({ type: 'error', text: res.error ?? 'No se pudo registrar el cliente.' });
                        return;
                      }
                      if (res.customer) {
                        setSelectedCustomerId(res.customer.id);
                      }
                      setNewCustName('');
                      setNewCustPhone('');
                      setShowNewCustomer(false);
                    }}
                  >
                    Guardar ficha y seleccionar
                  </button>
                </div>
              )}
            </div>

            {serviceType === 'encargo' && (
              <div className="field">
                <label htmlFor="alias-input">Referencia de encargo</label>
                <input
                  id="alias-input"
                  className="input"
                  value={customerAlias}
                  onChange={(e) => setCustomerAlias(e.target.value)}
                  placeholder={selectedCustomer ? selectedCustomer.name : 'Ej. María López'}
                />
              </div>
            )}

            <div className="field">
              <div className="catalog-head-row">
                <label style={{ marginBottom: 0 }}>Servicios y productos</label>
                <small className="muted">Folio único asignado al guardar</small>
              </div>

              <div className="catalog-grid">
                {activeCatalog.map((item) => {
                  const qty = quantities[item.id] ?? 0;
                  return (
                    <div key={item.id} className={`catalog-row ${qty > 0 ? 'selected' : ''}`}>
                      <div className="catalog-row-info">
                        <strong>{item.name}</strong>
                        <small>
                          {formatMxn(item.priceCents)} c/u
                          {item.pricePendingConfirmation ? ' · Precio ref.' : ''}
                        </small>
                      </div>
                      <div className="catalog-qty-controls">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm qty-btn"
                          onClick={() => updateItemQuantity(item.id, -1)}
                          disabled={qty === 0}
                          aria-label={`Quitar ${item.name}`}
                        >
                          <Minus size={14} />
                        </button>
                        <span className="qty-value" aria-live="polite">
                          {qty}
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm qty-btn"
                          onClick={() => updateItemQuantity(item.id, 1)}
                          aria-label={`Agregar ${item.name}`}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {canRedeemFreeCombo && comboEntry && (
              <label className="checkbox-row field" style={{ border: '1px solid var(--success-border)', background: 'var(--success-soft)' }}>
                <input
                  type="checkbox"
                  checked={redeemFreeCombo}
                  onChange={(event) => setRedeemFreeCombo(event.target.checked)}
                />
                <Gift size={16} aria-hidden="true" />
                Aplicar 1 combo gratis disponible (-{formatMxn(comboEntry.item.priceCents)}) y generar boleto rifa al completar
              </label>
            )}

            {needsMachine && washers.length > 0 && (
              <div className="field">
                <label>Asignar lavadora (opcional)</label>
                <div className="machine-picker" role="group" aria-label="Lavadoras de la sucursal">
                  {washers.map((machine) => {
                    const available = machine.status === 'disponible';
                    const active = selectedMachineIds.includes(machine.id);
                    return (
                      <button
                        key={machine.id}
                        type="button"
                        disabled={!available}
                        aria-pressed={active}
                        className={`machine-chip ${active ? 'active' : ''} status-${machine.status}`}
                        onClick={() => toggleMachine(machine.id)}
                      >
                        <strong>{machine.code}</strong>
                        <small>
                          {machine.status === 'disponible'
                            ? 'Disponible'
                            : machine.status === 'en_uso'
                              ? `En uso (${machine.currentOrderFolio ?? ''})`
                              : 'Fuera de serv.'}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
        ) : freeCoverAll ? (
          <div className="alert alert-success">
            Orden cubierta al 100% con <strong>1 combo gratis de lealtad ($0.00)</strong>. Al completar la orden se emitirá su boleto de rifa.
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
                  <strong>Tarjeta (terminal)</strong>
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
                  Registrar pago aprobado en terminal
                </label>
                {confirmCardNow && (
                  <input
                    className="input input-sm"
                    aria-label="Referencia de pago en terminal"
                    placeholder="Referencia / folio terminal (opcional)"
                    value={cardReference}
                    onChange={(e) => setCardReference(e.target.value)}
                    maxLength={60}
                  />
                )}
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
                  Marcar transferencia verificada
                </label>
                {confirmTransferNow && (
                  <input
                    className="input input-sm"
                    aria-label="Referencia de transferencia verificada"
                    placeholder="Referencia bancaria / clave rastreo (opcional)"
                    value={transferReference}
                    onChange={(e) => setTransferReference(e.target.value)}
                    maxLength={60}
                  />
                )}
              </div>
            </div>
          </>
        )}

        {feedback && (
          <div
            role={feedback.type === 'error' ? 'alert' : 'status'}
            className={`alert ${feedback.type === 'error' ? 'alert-error' : 'alert-success'}`}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>{feedback.text}</span>
              {feedback.type === 'success' && feedback.orderId && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onOpenTicket(feedback.orderId!)}
                >
                  <Receipt size={15} />
                  Ver / emitir comprobante
                </button>
              )}
            </div>
          </div>
        )}

        <div className="checkout-footer-bar">
          <div className="summary-bar" aria-live="polite">
            <span>Total {formatMxn(totalCents)}</span>
            {deferPayment ? (
              <strong>Por cobrar</strong>
            ) : freeCoverAll ? (
              <strong style={{ color: 'var(--success)' }}>Lealtad 10+1</strong>
            ) : tender.ok ? (
              <strong style={{ color: tender.remaining > 0 ? 'var(--warning)' : 'var(--success)' }}>
                {tender.remaining > 0
                  ? `Falta ${formatMxn(tender.remaining)}`
                  : `Cambio ${formatMxn(tender.change)}`}
              </strong>
            ) : null}
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full checkout-submit-btn"
            disabled={!openShift || submitting || (!checkoutOrder && totalCents <= 0 && !freeCoverAll)}
          >
            <Plus size={18} />
            {checkoutOrder
              ? 'Guardar cobro'
              : deferPayment
                ? 'Guardar encargo'
                : 'Guardar folio y pago'}{' '}
            ({formatMxn(totalCents)})
          </button>
        </div>

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
