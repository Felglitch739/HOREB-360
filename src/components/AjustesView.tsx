import { useEffect, useState } from 'react';
import { Check, Compass, LogOut, Palette, Printer, RefreshCw, Save, ShieldCheck, Tag, UserCheck } from 'lucide-react';
import { formatMxn, parsePesosToCents } from '../domain/money';
import type { BranchRole } from '../domain/sharedState';
import type { BranchId, BranchSettings } from '../domain/types';
import type { BrandTheme } from '../theme';

interface AjustesViewProps {
  branchId: BranchId;
  branchName: string;
  role: BranchRole;
  settings: BranchSettings;
  theme: BrandTheme;
  onSetTheme: (theme: BrandTheme) => void;
  onSaveSettings: (
    branchId: BranchId,
    patch: Partial<BranchSettings>,
  ) => Promise<{ ok: boolean; error?: string }>;
  onStartTour: () => void;
  onReload: () => Promise<void>;
  onSignOut: () => void;
}

export function AjustesView({
  branchId,
  branchName,
  role,
  settings,
  theme,
  onSetTheme,
  onSaveSettings,
  onStartTour,
  onReload,
  onSignOut,
}: AjustesViewProps) {
  const isSupervisor = role === 'supervisor';

  const [priceInput, setPriceInput] = useState((settings.comboPriceCents / 100).toFixed(2));
  const [businessName, setBusinessName] = useState(settings.businessName);
  const [branchPhone, setBranchPhone] = useState(settings.branchPhone);
  const [scheduleText, setScheduleText] = useState(settings.scheduleText);
  const [ticketFooter, setTicketFooter] = useState(settings.ticketFooter);
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>(settings.defaultPaperWidth);

  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    setPriceInput((settings.comboPriceCents / 100).toFixed(2));
    setBusinessName(settings.businessName);
    setBranchPhone(settings.branchPhone);
    setScheduleText(settings.scheduleText);
    setTicketFooter(settings.ticketFooter);
    setPaperWidth(settings.defaultPaperWidth);
    setFeedback(null);
  }, [branchId, settings]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!isSupervisor || saving) return;
    setFeedback(null);

    const comboPriceCents = parsePesosToCents(priceInput);
    if (comboPriceCents === null || comboPriceCents < 100) {
      setFeedback({ type: 'error', text: 'Captura un precio válido en MXN (mínimo $1.00).' });
      return;
    }

    setSaving(true);
    try {
      const result = await onSaveSettings(branchId, {
        comboPriceCents,
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
        text: `Ajustes guardados para ${branchName}. Las nuevas órdenes usarán ${formatMxn(comboPriceCents)} por combo.`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    if (reloading) return;
    setReloading(true);
    try {
      await onReload();
      setFeedback({ type: 'success', text: 'Datos actualizados desde Supabase.' });
    } finally {
      setReloading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 15 }} data-tour="settings-panel">
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
          Tu cuenta opera como <strong>Caja</strong> en {branchName}. La edición de precios y formato de ticket está reservada para <strong>Supervisión</strong>.
        </div>
      )}

      <div className="two-col">
        <form className="card" onSubmit={handleSave}>
          <h2 className="card-title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Tag size={18} aria-hidden="true" />
              Tarifas y comprobantes · {branchName}
            </span>
            <span className={`badge ${isSupervisor ? 'badge-success' : 'badge-warning'}`}>
              {isSupervisor ? 'Editable' : 'Solo lectura'}
            </span>
          </h2>

          <div className="field">
            <label htmlFor="settings-combo-price">Precio del combo Lavado + Secado (MXN)</label>
            <input
              id="settings-combo-price"
              className="input"
              inputMode="decimal"
              value={priceInput}
              disabled={!isSupervisor}
              onChange={(event) => setPriceInput(event.target.value)}
            />
            <small className="muted">
              Aplica a nuevas órdenes de {branchName}. Los folios anteriores conservan su importe original.
            </small>
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
              Conectado en línea con la sucursal <strong>{branchName}</strong>. El panel sincroniza automáticamente cada 8 segundos.
            </p>
            <div className="order-actions">
              <button type="button" className="btn btn-secondary" onClick={onStartTour}>
                <Compass size={16} />
                Guía interactiva
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
        </div>
      </div>
    </div>
  );
}
