import { useEffect, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Edit3,
  FileSpreadsheet,
  Gift,
  Phone,
  Plus,
  Search,
  Ticket,
  UserPlus,
  X,
} from 'lucide-react';
import { exportCustomersToExcel } from '../domain/excelExport';
import { formatMxn, formatMxnCurrency } from '../domain/money';
import { BRANCHES, getBranchDisplayName, getCustomerOrders, getCustomers } from '../domain/rules';
import type { BranchRole } from '../domain/sharedState';
import type { BranchId, Customer, DemoState } from '../domain/types';
import { CustomSelect } from './CustomSelect';

interface ClientesViewProps {
  state: DemoState;
  branchId: BranchId;
  scopeBranch?: BranchId | 'all';
  visibleBranches?: BranchId[];
  role: BranchRole;
  onUpsertCustomer: (
    branchId: BranchId,
    customer: { id?: string; name: string; phone: string; contactConsent: boolean },
  ) => Promise<{ ok: boolean; error?: string; customer?: Customer }>;
  onSeedSampleCustomers: (branchId: BranchId) => Promise<{ ok: boolean; error?: string }>;
}

export function ClientesView({
  state,
  branchId,
  scopeBranch,
  visibleBranches,
  role,
  onUpsertCustomer,
  onSeedSampleCustomers,
}: ClientesViewProps) {
  const allCustomers = getCustomers(state);
  const raffleTickets = state.raffleTickets ?? [];
  const effectiveScope: BranchId | 'all' = scopeBranch ?? branchId;
  const branchOptions = (visibleBranches ?? BRANCHES.map((b) => b.id)).map((id) => ({
    value: id,
    label: getBranchDisplayName(state, id),
  }));

  const [showAllBranches, setShowAllBranches] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [formBranchId, setFormBranchId] = useState<BranchId>(branchId);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [contactConsent, setContactConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    setSelectedId(null);
    setQuery('');
    setShowAllBranches(false);
  }, [effectiveScope]);

  useEffect(() => {
    if (!formOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setFormOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [formOpen]);

  const branchScopedCustomers =
    effectiveScope === 'all' || showAllBranches
      ? allCustomers
      : allCustomers.filter((customer) => {
          if (customer.createdBranchId === effectiveScope) return true;
          return state.orders.some(
            (order) => order.customerId === customer.id && order.branchId === effectiveScope,
          );
        });

  const term = query.trim().toLowerCase();
  const filtered = branchScopedCustomers.filter(
    (c) => !term || c.name.toLowerCase().includes(term) || c.phone.includes(term),
  );
  const selectedCustomer =
    branchScopedCustomers.find((c) => c.id === selectedId) ?? filtered[0] ?? null;
  const historyOrders = selectedCustomer ? getCustomerOrders(state, selectedCustomer.id) : [];
  const customerTickets = selectedCustomer
    ? raffleTickets.filter((t) => t.customerId === selectedCustomer.id)
    : [];

  function openNewCustomer() {
    setEditingId(undefined);
    setFormBranchId(effectiveScope === 'all' ? branchId : effectiveScope);
    setName('');
    setPhone('');
    setContactConsent(false);
    setFeedback(null);
    setFormOpen(true);
  }

  function startEdit(customer: Customer) {
    setEditingId(customer.id);
    setFormBranchId(customer.createdBranchId ?? (effectiveScope === 'all' ? branchId : effectiveScope));
    setName(customer.name);
    setPhone(customer.phone);
    setContactConsent(customer.contactConsent);
    setFeedback(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(undefined);
    setName('');
    setPhone('');
    setContactConsent(false);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await onUpsertCustomer(formBranchId, {
        id: editingId,
        name,
        phone,
        contactConsent,
      });
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error ?? 'No se pudo guardar la ficha del cliente.' });
        return;
      }
      if (res.customer) setSelectedId(res.customer.id);
      setFeedback({
        type: 'success',
        text: editingId
          ? 'Ficha de cliente actualizada.'
          : `Cliente ${res.customer?.name ?? name} registrado en ${getBranchDisplayName(state, formBranchId)}.`,
      });
      closeForm();
    } finally {
      setBusy(false);
    }
  }

  const scopeLabel =
    effectiveScope === 'all' || showAllBranches
      ? 'Todas las sucursales'
      : getBranchDisplayName(state, effectiveScope);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <section className="card">
        <h2 className="card-title">
          <span className="card-title-main">
            <span>Directorio y lealtad 10+1 · {scopeLabel}</span>
            <span className="badge badge-info">{branchScopedCustomers.length} clientes</span>
          </span>
          <div className="card-title-actions">
            {effectiveScope !== 'all' && allCustomers.length > branchScopedCustomers.length && (
              <button
                type="button"
                className={`btn btn-secondary btn-sm${showAllBranches ? ' active' : ''}`}
                onClick={() => setShowAllBranches((prev) => !prev)}
              >
                {showAllBranches ? `Solo ${getBranchDisplayName(state, effectiveScope)}` : `Ver todas (${allCustomers.length})`}
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={branchScopedCustomers.length === 0}
              onClick={() => exportCustomersToExcel(state, branchScopedCustomers)}
            >
              <FileSpreadsheet size={15} aria-hidden="true" /> Exportar Excel
            </button>
            <button type="button" data-tour-id="clientes-new-btn" className="btn btn-primary btn-sm" onClick={openNewCustomer}>
              <UserPlus size={16} aria-hidden="true" /> Nuevo cliente
            </button>
          </div>
        </h2>

        <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: '0.86rem' }}>
          Por cada <strong>10 combos pagados y completados</strong> el cliente habilita <strong>1 combo gratis</strong>; al completarlo se emite <strong>1 boleto</strong> para la rifa anual.
        </p>

        {feedback && !formOpen && (
          <div className={`alert alert-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
            {feedback.text}
          </div>
        )}

        {branchScopedCustomers.length === 0 ? (
          <div className="empty-state-box">
            <p className="muted" style={{ margin: 0 }}>
              {allCustomers.length === 0
                ? 'Aún no hay fichas de clientes. Puedes cobrar rápido sin ficha desde Mostrador o registrar clientes frecuentes aquí.'
                : `Aún no hay clientes registrados en ${getBranchDisplayName(state, effectiveScope === 'all' ? branchId : effectiveScope)}.`}
            </p>
            <div className="order-actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={openNewCustomer}>
                <UserPlus size={15} /> Registrar cliente en {getBranchDisplayName(state, effectiveScope === 'all' ? branchId : effectiveScope)}
              </button>
              {import.meta.env.DEV && role === 'supervisor' && allCustomers.length === 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const res = await onSeedSampleCustomers(branchId);
                    setBusy(false);
                    if (!res.ok && res.error) setFeedback({ type: 'error', text: res.error });
                  }}
                >
                  Cargar clientes demo (desarrollo)
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="clientes-master-detail">
            <div className="clientes-list-col">
              <label className="search-field" style={{ marginBottom: 10 }}>
                <Search size={16} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por nombre o teléfono"
                />
                {query && (
                  <button
                    type="button"
                    className="search-clear-btn"
                    aria-label="Limpiar búsqueda"
                    onClick={() => setQuery('')}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </label>

              {filtered.length === 0 ? (
                <p className="muted" style={{ fontSize: '0.88rem' }}>
                  No hay clientes que coincidan con tu búsqueda.
                </p>
              ) : (
                <div className="customer-list clientes-list-scroll">
                  {filtered.map((customer) => {
                    const isActive = selectedCustomer?.id === customer.id;
                    const ticketsCount = raffleTickets.filter((t) => t.customerId === customer.id).length;
                    return (
                      <button
                        key={customer.id}
                        type="button"
                        className={`customer-row ${isActive ? 'active' : ''}`}
                        onClick={() => setSelectedId(customer.id)}
                      >
                        <div className="customer-row-top">
                          <strong>{customer.name}</strong>
                          <span className="badge badge-info">{customer.combosTowardFree}/10</span>
                        </div>
                        <div className="customer-row-sub">
                          <span><Phone size={12} /> {customer.phone}</span>
                          {customer.createdBranchId && (
                            <span className="muted">{getBranchDisplayName(state, customer.createdBranchId)}</span>
                          )}
                          {customer.freeCombosAvailable > 0 && (
                            <span className="badge badge-success">
                              <Gift size={12} /> {customer.freeCombosAvailable} gratis
                            </span>
                          )}
                          {ticketsCount > 0 && (
                            <span className="badge badge-warning">
                              <Ticket size={12} /> {ticketsCount} boleto(s)
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedCustomer && (
              <div className="clientes-detail-col">
                <div className="customer-detail-head">
                  <div>
                    <h3>{selectedCustomer.name}</h3>
                    <small className="muted">
                      Tel: {selectedCustomer.phone}
                      {selectedCustomer.createdBranchId
                        ? ` · Sucursal: ${getBranchDisplayName(state, selectedCustomer.createdBranchId)}`
                        : ''}{' '}
                      · {selectedCustomer.contactConsent ? 'Acepta avisos WhatsApp' : 'Sin consentimiento WA'}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => startEdit(selectedCustomer)}
                  >
                    <Edit3 size={14} /> Editar
                  </button>
                </div>

                <div className="loyalty-progress-wrap" aria-label={`Avance de lealtad ${selectedCustomer.combosTowardFree} de 10`}>
                  <div className="loyalty-progress-meta">
                    <span>Progreso hacia combo gratis</span>
                    <strong>{selectedCustomer.combosTowardFree} / 10 combos</strong>
                  </div>
                  <div className="loyalty-progress-track">
                    <div
                      className="loyalty-progress-fill"
                      style={{ width: `${Math.min(100, (selectedCustomer.combosTowardFree / 10) * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="metrics-grid" style={{ marginTop: 10 }}>
                  <div className="metric-box">
                    <span className="metric-label">Combos gratis</span>
                    <strong className="metric-value" style={{ color: selectedCustomer.freeCombosAvailable > 0 ? 'var(--success)' : 'inherit' }}>
                      {selectedCustomer.freeCombosAvailable}
                    </strong>
                  </div>
                  <div className="metric-box">
                    <span className="metric-label">Boletos rifa</span>
                    <strong className="metric-value">{customerTickets.length}</strong>
                  </div>
                  <div className="metric-box">
                    <span className="metric-label">Total consumido</span>
                    <strong className="metric-value">
                      {formatMxnCurrency(historyOrders.reduce((sum, o) => sum + o.totalCents, 0))}
                    </strong>
                  </div>
                </div>

                {customerTickets.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ fontSize: '0.86rem', display: 'block', marginBottom: 6 }}>
                      Boletos emitidos
                    </strong>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {customerTickets.map((ticket) => (
                        <span key={ticket.id} className="badge badge-success">
                          <Award size={12} /> {ticket.ticketCode} ({ticket.orderFolio})
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <strong style={{ fontSize: '0.86rem', display: 'block', marginBottom: 6 }}>
                  Historial por folio ({historyOrders.length})
                </strong>
                {historyOrders.length === 0 ? (
                  <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>
                    Aún no tiene órdenes asociadas.
                  </p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Folio</th>
                          <th>Sucursal</th>
                          <th className="num">Total</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyOrders.map((ord) => (
                          <tr key={ord.id}>
                            <td><strong>{ord.folio}</strong></td>
                            <td>{getBranchDisplayName(state, ord.branchId)}</td>
                            <td className="num">{formatMxn(ord.totalCents)}</td>
                            <td>
                              {ord.loyaltyProcessedAt ? (
                                <span className="badge badge-success">
                                  <CheckCircle2 size={12} /> Completado
                                </span>
                              ) : (
                                <span className="badge badge-warning">En proceso</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {formOpen && (
        <div
          className="orders-drawer-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeForm();
          }}
        >
          <aside
            className="orders-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-drawer-title"
          >
            <div className="orders-drawer-head">
              <div className="orders-drawer-title-group">
                <UserPlus size={18} aria-hidden="true" />
                <h2 id="customer-drawer-title">
                  {editingId ? 'Editar ficha de cliente' : 'Nuevo cliente · Lealtad 10+1'}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm orders-drawer-close"
                aria-label="Cerrar formulario de cliente"
                onClick={closeForm}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="orders-drawer-body">
              {feedback && (
                <div className={`alert alert-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
                  {feedback.text}
                </div>
              )}

              <form onSubmit={handleSave}>
                <div className="field">
                  <label>Sucursal de registro *</label>
                  <CustomSelect
                    ariaLabel="Sucursal del cliente"
                    value={formBranchId}
                    options={branchOptions}
                    onChange={(val) => setFormBranchId(val)}
                  />
                </div>
                <label className="field">
                  Nombre completo *
                  <input
                    className="input"
                    data-tour-id="clientes-name-input"
                    placeholder="Ej. María Fernanda López"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={80}
                  />
                </label>
                <label className="field">
                  Teléfono / WhatsApp *
                  <input
                    className="input"
                    data-tour-id="clientes-phone-input"
                    type="tel"
                    inputMode="tel"
                    placeholder="10 dígitos (ej. 8681234567)"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    maxLength={20}
                  />
                </label>
                <label className="checkbox-row field">
                  <input
                    type="checkbox"
                    data-tour-id="clientes-consent-checkbox"
                    checked={contactConsent}
                    onChange={(e) => setContactConsent(e.target.checked)}
                  />
                  El cliente autoriza recibir avisos de su servicio por WhatsApp
                </label>

                <div className="order-actions" style={{ marginTop: 14 }}>
                  <button type="submit" data-tour-id="clientes-save-btn" className="btn btn-primary" disabled={busy}>
                    <Plus size={16} />
                    {editingId ? 'Guardar cambios' : 'Guardar ficha de cliente'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={closeForm}>
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
