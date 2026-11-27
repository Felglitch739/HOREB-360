import { useEffect, useState } from 'react';
import {
  Check,
  Compass,
  History,
  KeyRound,
  LogOut,
  Palette,
  Plus,
  Printer,
  RefreshCw,
  Save,
  ShieldCheck,
  Tag,
  UserCheck,
} from 'lucide-react';
import { parsePesosToCents } from '../domain/money';
import type { SharedWorkspace } from '../Root';
import type { BranchRole } from '../domain/sharedState';
import type { BranchAuditEntry, BranchId, BranchSettings, CatalogItem } from '../domain/types';
import type { BrandTheme } from '../theme';

interface AjustesViewProps {
  branchId: BranchId;
  branchName: string;
  role: BranchRole;
  userEmail?: string;
  isOnline: boolean;
  settings: BranchSettings;
  catalog: CatalogItem[];
  auditLogs: BranchAuditEntry[];
  theme: BrandTheme;
  onSetTheme: (theme: BrandTheme) => void;
  onSaveSettings: (
    branchId: BranchId,
    patch: Partial<BranchSettings>,
  ) => Promise<{ ok: boolean; error?: string }>;
  onStartTour: () => void;
  onReload: SharedWorkspace['reload'];
  onSignOut: () => void;
  onUpdatePassword?: (newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  modeSwitcher?: {
    title: string;
    description: string;
    buttonLabel: string;
    onSwitch: () => void;
  };
}

export function AjustesView({
  branchId,
  branchName,
  role,
  userEmail,
  isOnline,
  settings,
  catalog,
  auditLogs,
  theme,
  onSetTheme,
  onSaveSettings,
  onStartTour,
  onReload,
  onSignOut,
  onUpdatePassword,
  modeSwitcher,
}: AjustesViewProps) {
  const isSupervisor = role === 'supervisor';

  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(catalog.map((item) => [item.id, (item.priceCents / 100).toFixed(2)])),
  );
  const [confirmedFlags, setConfirmedFlags] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(catalog.map((item) => [item.id, !item.pricePendingConfirmation])),
  );
  const [allowOperatorReprint, setAllowOperatorReprint] = useState(
    Boolean(settings.allowOperatorReprint),
  );
  const [branchDisplayName, setBranchDisplayName] = useState(settings.branchDisplayName ?? '');
  const [branchAddress, setBranchAddress] = useState(settings.branchAddress ?? '');
  const [businessName, setBusinessName] = useState(settings.businessName);
  const [branchPhone, setBranchPhone] = useState(settings.branchPhone);
  const [scheduleText, setScheduleText] = useState(settings.scheduleText);
  const [ticketFooter, setTicketFooter] = useState(settings.ticketFooter);
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>(settings.defaultPaperWidth);

  const [showNewProduct, setShowNewProduct] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdPrice, setNewProdPrice] = useState('');
  const [newProdRequiresMachine, setNewProdRequiresMachine] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updatingPwd, setUpdatingPwd] = useState(false);
  const [pwdFeedback, setPwdFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadFeedback, setReloadFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    setPriceDrafts(
      Object.fromEntries(catalog.map((item) => [item.id, (item.priceCents / 100).toFixed(2)])),
    );
    setConfirmedFlags(
      Object.fromEntries(catalog.map((item) => [item.id, !item.pricePendingConfirmation])),
    );
    setAllowOperatorReprint(Boolean(settings.allowOperatorReprint));
    setBranchDisplayName(settings.branchDisplayName ?? '');
    setBranchAddress(settings.branchAddress ?? '');
    setBusinessName(settings.businessName);
    setBranchPhone(settings.branchPhone);
    setScheduleText(settings.scheduleText);
    setTicketFooter(settings.ticketFooter);
    setPaperWidth(settings.defaultPaperWidth);
    setFeedback(null);
  }, [branchId, settings, catalog]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!isSupervisor || saving) return;
    setFeedback(null);

    const updatedCatalog: CatalogItem[] = [];
    for (const item of catalog) {
      const parsedCents = parsePesosToCents(priceDrafts[item.id] ?? '');
      if (parsedCents === null || parsedCents < 100) {
        setFeedback({
          type: 'error',
          text: `Captura un precio válido en MXN para "${item.name}" (mínimo $1.00).`,
        });
        return;
      }
      updatedCatalog.push({
        ...item,
        priceCents: parsedCents,
        pricePendingConfirmation: !confirmedFlags[item.id],
      });
    }

    const comboPriceCents =
      updatedCatalog.find((item) => item.id === 'combo')?.priceCents ?? settings.comboPriceCents;

    setSaving(true);
    try {
      const result = await onSaveSettings(branchId, {
        comboPriceCents,
        catalog: updatedCatalog,
        allowOperatorReprint,
        branchDisplayName,
        branchAddress,
        businessName,
        branchPhone,
        scheduleText,
        ticketFooter,
        defaultPaperWidth: paperWidth,
      });
      if (!result.ok) {
        setFeedback({ type: 'error', text: result.error ?? 'No se pudieron guardar los ajustes.' });
        return;
      }
      setFeedback({
        type: 'success',
        text: `Tarifas y ficha actualizadas para ${branchName}. Las órdenes previas conservan su precio original.`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddProduct() {
    if (!isSupervisor || saving) return;
    setFeedback(null);
    const cleanName = newProdName.trim();
    const parsedCents = parsePesosToCents(newProdPrice);
    if (!cleanName) {
      setFeedback({ type: 'error', text: 'Captura el nombre del nuevo servicio o producto.' });
      return;
    }
    if (parsedCents === null || parsedCents < 100) {
      setFeedback({ type: 'error', text: 'Captura un precio válido en MXN (mínimo $1.00).' });
      return;
    }
    const id = `prod-${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) || 'item'}-${Date.now().toString(36).slice(-4)}`;
    const nextCatalog: CatalogItem[] = [
      ...catalog,
      {
        id,
        name: cleanName,
        priceCents: parsedCents,
        requiresMachine: newProdRequiresMachine,
        loyaltyCredits: 0,
        pricePendingConfirmation: false,
        active: true,
      },
    ];
    setSaving(true);
    try {
      const res = await onSaveSettings(branchId, { catalog: nextCatalog });
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error ?? 'No se pudo agregar el producto.' });
        return;
      }
      setNewProdName('');
      setNewProdPrice('');
      setNewProdRequiresMachine(false);
      setShowNewProduct(false);
      setFeedback({ type: 'success', text: `Producto "${cleanName}" agregado al catálogo de ${branchName}.` });
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordUpdate(event: React.FormEvent) {
    event.preventDefault();
    if (!onUpdatePassword || updatingPwd) return;
    setPwdFeedback(null);
    if (newPassword.length < 8) {
      setPwdFeedback({ type: 'error', text: 'La nueva contraseña debe tener al menos 8 caracteres.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdFeedback({ type: 'error', text: 'Las contraseñas no coinciden.' });
      return;
    }
    setUpdatingPwd(true);
    try {
      const res = await onUpdatePassword(newPassword);
      if (!res.ok) {
        setPwdFeedback({ type: 'error', text: res.error ?? 'No se pudo actualizar la contraseña.' });
        return;
      }
      setNewPassword('');
      setConfirmPassword('');
      setPwdFeedback({ type: 'success', text: 'Contraseña actualizada correctamente.' });
    } finally {
      setUpdatingPwd(false);
    }
  }

  async function handleReload() {
    if (reloading) return;
    setReloading(true);
    setReloadFeedback(null);
    try {
      const result = await onReload();
      if (result === 'updated') {
        setReloadFeedback({ type: 'success', text: 'Datos actualizados desde Supabase.' });
      } else {
        setReloadFeedback({
          type: 'error',
          text: result === 'partial'
            ? 'Algunos datos no se pudieron actualizar. Conservamos los últimos datos disponibles.'
            : 'No se pudieron actualizar los datos. Revisa la conexión e inténtalo de nuevo.',
        });
      }
    } finally {
      setReloading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 15 }} data-tour="settings-panel">
      {modeSwitcher && (
        <section className="card mode-switcher-card">
          <div>
            <h2 className="card-title" style={{ marginBottom: 4 }}>
              <span>{modeSwitcher.title}</span>
            </h2>
            <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
              {modeSwitcher.description}
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={modeSwitcher.onSwitch}>
            {modeSwitcher.buttonLabel}
          </button>
        </section>
      )}

      {feedback && (
        <div
          className={`alert alert-${feedback.type}`}
          role={feedback.type === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </div>
      )}

      {!isSupervisor && (
        <div className="alert alert-info">
          Tu cuenta opera como <strong>Caja</strong> en {branchName}. La edición de precios, catálogo y permisos está reservada para <strong>Supervisión</strong>.
        </div>
      )}

      <div className="two-col">
        <form className="card" onSubmit={handleSave}>
          <h2 className="card-title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Tag size={18} aria-hidden="true" />
              Catálogo, tarifas y comprobantes · {branchName}
            </span>
            <span className={`badge ${isSupervisor ? 'badge-success' : 'badge-warning'}`}>
              {isSupervisor ? 'Editable' : 'Solo lectura'}
            </span>
          </h2>

          <div className="catalog-settings-list">
            {catalog.map((item) => (
              <div key={item.id} className="catalog-setting-row">
                <div className="catalog-setting-top">
                  <div>
                    <strong>{item.name}</strong>
                    {!confirmedFlags[item.id] && (
                      <span
                        className="badge badge-warning"
                        style={{ marginLeft: 8 }}
                        title="Precio de referencia provisional: márcalo como confirmado cuando Dirección valide la tarifa final."
                      >
                        Precio referencial · Por confirmar
                      </span>
                    )}
                  </div>
                  <div className="split-amount-wrap">
                    <span>$</span>
                    <input
                      aria-label={`Precio de ${item.name} MXN`}
                      className="input input-sm"
                      inputMode="decimal"
                      value={priceDrafts[item.id] ?? ''}
                      disabled={!isSupervisor}
                      onChange={(event) =>
                        setPriceDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))
                      }
                    />
                  </div>
                </div>
                {isSupervisor && (
                  <label className="checkbox-row" style={{ minHeight: 36, padding: '4px 8px' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(confirmedFlags[item.id])}
                      onChange={(event) =>
                        setConfirmedFlags((prev) => ({ ...prev, [item.id]: event.target.checked }))
                      }
                    />
                    Precio confirmado para operación
                  </label>
                )}
              </div>
            ))}
          </div>

          <small className="muted" style={{ display: 'block', marginBottom: 14 }}>
            Los cambios aplican únicamente a nuevas órdenes en {branchName}; los folios previos conservan el precio capturado al venderse. Los precios marcados como referenciales pueden confirmarse arriba con la casilla correspondiente.
          </small>

          {isSupervisor && (
            <div style={{ marginBottom: 16 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-expanded={showNewProduct}
                onClick={() => setShowNewProduct((prev) => !prev)}
              >
                <Plus size={15} aria-hidden="true" />
                {showNewProduct ? 'Cerrar nuevo producto' : 'Agregar nuevo servicio / producto'}
              </button>

              {showNewProduct && (
                <div className="quick-customer-box" style={{ marginTop: 10 }}>
                  <div className="quick-customer-inputs">
                    <input
                      className="input input-sm"
                      placeholder="Nombre (ej. Suavizante 1L) *"
                      value={newProdName}
                      onChange={(e) => setNewProdName(e.target.value)}
                      maxLength={80}
                    />
                    <input
                      className="input input-sm"
                      inputMode="decimal"
                      placeholder="Precio MXN (ej. 25.00) *"
                      value={newProdPrice}
                      onChange={(e) => setNewProdPrice(e.target.value)}
                    />
                  </div>
                  <div className="quick-customer-actions">
                    <label className="checkbox-row" style={{ minHeight: 36, padding: '4px 10px' }}>
                      <input
                        type="checkbox"
                        checked={newProdRequiresMachine}
                        onChange={(e) => setNewProdRequiresMachine(e.target.checked)}
                      />
                      Requiere asignar lavadora/secadora
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={saving}
                      onClick={() => void handleAddProduct()}
                    >
                      Agregar al catálogo
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="settings-branch-display-name">Nombre visible de la sucursal</label>
            <input
              id="settings-branch-display-name"
              className="input"
              value={branchDisplayName}
              disabled={!isSupervisor}
              onChange={(event) => setBranchDisplayName(event.target.value)}
              placeholder={`Ej. ${branchName}`}
              maxLength={60}
            />
          </div>

          <div className="field">
            <label htmlFor="settings-branch-address">Dirección de la sucursal</label>
            <input
              id="settings-branch-address"
              className="input"
              value={branchAddress}
              disabled={!isSupervisor}
              onChange={(event) => setBranchAddress(event.target.value)}
              placeholder="Calle, número y colonia (opcional)"
              maxLength={120}
            />
          </div>

          <div className="field">
            <label htmlFor="settings-business-name">Nombre comercial en el ticket</label>
            <input
              id="settings-business-name"
              className="input"
              value={businessName}
              disabled={!isSupervisor}
              onChange={(event) => setBusinessName(event.target.value)}
              maxLength={80}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="settings-branch-phone">Teléfono de la sucursal (en ticket)</label>
            <input
              id="settings-branch-phone"
              className="input"
              value={branchPhone}
              disabled={!isSupervisor}
              onChange={(event) => setBranchPhone(event.target.value)}
              placeholder="Ej. 81 1234 5678"
              maxLength={40}
            />
          </div>

          <div className="field">
            <label htmlFor="settings-schedule">Horario mostrado en el ticket</label>
            <input
              id="settings-schedule"
              className="input"
              value={scheduleText}
              disabled={!isSupervisor}
              onChange={(event) => setScheduleText(event.target.value)}
              maxLength={80}
            />
          </div>

          <div className="field">
            <label>Tamaño de rollo térmico predeterminado</label>
            <div className="ticket-width-group">
              <button
                type="button"
                disabled={!isSupervisor}
                className={`seg-btn ${paperWidth === '80mm' ? 'active' : ''}`}
                style={{ minHeight: 44, fontSize: '0.86rem' }}
                onClick={() => setPaperWidth('80mm')}
              >
                <Printer size={15} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                80 mm (Estándar)
              </button>
              <button
                type="button"
                disabled={!isSupervisor}
                className={`seg-btn ${paperWidth === '58mm' ? 'active' : ''}`}
                style={{ minHeight: 44, fontSize: '0.86rem' }}
                onClick={() => setPaperWidth('58mm')}
              >
                <Printer size={15} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                58 mm (Compacto)
              </button>
            </div>
          </div>

          <label className="checkbox-row field">
            <input
              type="checkbox"
              disabled={!isSupervisor}
              checked={allowOperatorReprint}
              onChange={(event) => setAllowOperatorReprint(event.target.checked)}
            />
            Permitir que Caja reimprima comprobantes ya emitidos
          </label>

          <div className="field">
            <label htmlFor="settings-footer">Mensaje al pie del ticket</label>
            <input
              id="settings-footer"
              className="input"
              value={ticketFooter}
              disabled={!isSupervisor}
              onChange={(event) => setTicketFooter(event.target.value)}
              maxLength={160}
            />
          </div>

          {isSupervisor && (
            <button type="submit" className="btn btn-primary btn-full" disabled={saving}>
              <Save size={17} />
              {saving ? 'Guardando…' : `Guardar ajustes de ${branchName}`}
            </button>
          )}
        </form>

        <div style={{ display: 'grid', gap: 15, alignContent: 'start' }}>
          <section className="card">
            <h2 className="card-title">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Palette size={18} aria-hidden="true" />
                Apariencia de marca
              </span>
            </h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Elige la paleta de color del sistema para adaptarla a la identidad de tu lavandería.
            </p>
            <div className="segmented">
              <button
                type="button"
                className={`seg-btn ${theme === 'green' ? 'active' : ''}`}
                onClick={() => onSetTheme('green')}
              >
                <span className="theme-swatch green" style={{ marginRight: 7 }} aria-hidden="true" />
                Verde
                {theme === 'green' && <Check size={15} style={{ marginLeft: 6, verticalAlign: 'text-bottom' }} />}
              </button>
              <button
                type="button"
                className={`seg-btn ${theme === 'blue' ? 'active' : ''}`}
                onClick={() => onSetTheme('blue')}
              >
                <span className="theme-swatch blue" style={{ marginRight: 7 }} aria-hidden="true" />
                Azul Horeb
                {theme === 'blue' && <Check size={15} style={{ marginLeft: 6, verticalAlign: 'text-bottom' }} />}
              </button>
            </div>
          </section>

          <section className="card">
            <h2 className="card-title">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {isSupervisor ? <ShieldCheck size={18} aria-hidden="true" /> : <UserCheck size={18} aria-hidden="true" />}
                Sesión y sincronización
              </span>
              <span className="badge badge-info">{isSupervisor ? 'Supervisión' : 'Caja'}</span>
            </h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {userEmail && (
                <>
                  Cuenta activa: <strong>{userEmail}</strong>
                  <br />
                </>
              )}
              {isOnline
                ? <>Conectado con <strong>{branchName}</strong>. El panel se actualiza automáticamente.</>
                : <>Sin conexión con el servidor. Se muestran los últimos datos disponibles de <strong>{branchName}</strong>.</>}
            </p>
            {reloadFeedback && (
              <div className={`alert alert-${reloadFeedback.type}`} role={reloadFeedback.type === 'error' ? 'alert' : 'status'}>
                {reloadFeedback.text}
              </div>
            )}
            <div className="order-actions">
              <button type="button" className="btn btn-secondary" onClick={onStartTour}>
                <Compass size={16} />
                Manual interactivo
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={reloading}
                onClick={() => void handleReload()}
              >
                <RefreshCw size={16} />
                {reloading ? 'Actualizando…' : 'Actualizar datos'}
              </button>
              <button type="button" className="btn btn-danger" onClick={onSignOut}>
                <LogOut size={16} />
                Cerrar sesión
              </button>
            </div>
          </section>

          {isSupervisor && onUpdatePassword && (
            <section className="card">
              <h2 className="card-title">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <KeyRound size={18} aria-hidden="true" />
                  Seguridad de cuenta y accesos
                </span>
              </h2>
              {pwdFeedback && (
                <div className={`alert alert-${pwdFeedback.type}`} role={pwdFeedback.type === 'error' ? 'alert' : 'status'}>
                  {pwdFeedback.text}
                </div>
              )}
              <form onSubmit={handlePasswordUpdate} style={{ display: 'grid', gap: 10 }}>
                <label className="field" style={{ marginBottom: 0 }}>
                  Nueva contraseña (mínimo 8 caracteres)
                  <input
                    type="password"
                    className="input"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Confirmar contraseña
                  <input
                    type="password"
                    className="input"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </label>
                <button type="submit" className="btn btn-secondary btn-sm" disabled={updatingPwd}>
                  {updatingPwd ? 'Actualizando…' : 'Actualizar mi contraseña'}
                </button>
              </form>
              <small className="muted" style={{ display: 'block', marginTop: 10 }}>
                El alta de nuevas cuentas de empleados y asignación de roles por sucursal (<code>horeb_memberships</code>) se gestiona desde Supabase Auth por seguridad.
              </small>
            </section>
          )}

          <section className="card">
            <h2 className="card-title">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <History size={18} aria-hidden="true" />
                Auditoría reciente · {branchName}
              </span>
            </h2>
            {auditLogs.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Aún no hay cambios de precios, confirmaciones externas o reimpresiones registradas en {branchName}.
              </p>
            ) : (
              <div className="audit-list">
                {auditLogs.slice(0, 12).map((entry) => (
                  <div key={entry.id} className="audit-row">
                    <div>
                      <strong>{entry.message}</strong>
                      <small className="muted">
                        {entry.actor} ·{' '}
                        {new Date(entry.createdAt).toLocaleString('es-MX', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
