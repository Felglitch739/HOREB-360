import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, Clock, Edit3, Plus, Trash2, Unlock, WashingMachine, Wrench, X } from 'lucide-react';
import { getBranchDisplayName, getBranchMachines } from '../domain/rules';
import { buildMockThinqPreviewFeed, formatThinqStateLabel } from '../domain/telemetry';
import type { BranchRole } from '../domain/sharedState';
import type { BranchId, DemoState, Machine, MachineKind, MachineStatus } from '../domain/types';
import { CustomSelect } from './CustomSelect';

const TYPICAL_CYCLE_MINUTES = 45;

interface EquiposViewProps {
  state: DemoState;
  branchId: BranchId;
  role: BranchRole;
  onUpsertMachine: (
    branchId: BranchId,
    machine: {
      id?: string;
      code: string;
      name: string;
      kind: MachineKind;
      model?: string;
      serialNumber?: string;
      capacityKg?: number;
    },
  ) => Promise<{ ok: boolean; error?: string }>;
  onDeleteMachine: (
    branchId: BranchId,
    machineId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  onSeedSampleMachines: (branchId: BranchId) => Promise<{ ok: boolean; error?: string }>;
  onSetMachineStatus: (
    branchId: BranchId,
    machineId: string,
    status: Extract<MachineStatus, 'disponible' | 'fuera_de_servicio'>,
    reason?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

const STATUS_META: Record<MachineStatus, { label: string; badgeClass: string }> = {
  disponible: { label: 'Disponible', badgeClass: 'badge-success' },
  en_uso: { label: 'En uso', badgeClass: 'badge-info' },
  fuera_de_servicio: { label: 'Fuera de servicio', badgeClass: 'badge-danger' },
};

export function EquiposView({
  state,
  branchId,
  role,
  onUpsertMachine,
  onDeleteMachine,
  onSeedSampleMachines,
  onSetMachineStatus,
}: EquiposViewProps) {
  const isSupervisor = role === 'supervisor';
  const branchName = getBranchDisplayName(state, branchId);
  const machines = getBranchMachines(state, branchId);

  const [statusFilter, setStatusFilter] = useState<'todos' | MachineStatus>('todos');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<MachineKind>('lavadora');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [capacityInput, setCapacityInput] = useState('');
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  const filteredMachines =
    statusFilter === 'todos' ? machines : machines.filter((m) => m.status === statusFilter);
  const washers = filteredMachines.filter((m) => m.kind === 'lavadora');
  const dryers = filteredMachines.filter((m) => m.kind === 'secadora');
  const totalWashers = machines.filter((m) => m.kind === 'lavadora').length;
  const totalDryers = machines.filter((m) => m.kind === 'secadora').length;

  const countAvailable = machines.filter((m) => m.status === 'disponible').length;
  const countInUse = machines.filter((m) => m.status === 'en_uso').length;
  const countOffline = machines.filter((m) => m.status === 'fuera_de_servicio').length;

  function startEdit(machine: Machine) {
    setEditingId(machine.id);
    setCode(machine.code);
    setName(machine.name);
    setKind(machine.kind);
    setModel(machine.model ?? '');
    setSerialNumber(machine.serialNumber ?? '');
    setCapacityInput(machine.capacityKg ? String(machine.capacityKg) : '');
    setShowAddForm(true);
    setFeedback(null);
  }

  function resetForm() {
    setEditingId(undefined);
    setCode('');
    setName('');
    setKind('lavadora');
    setModel('');
    setSerialNumber('');
    setCapacityInput('');
    setShowAddForm(false);
  }

  async function handleSaveMachine(event: React.FormEvent) {
    event.preventDefault();
    if (!isSupervisor || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const parsedCap = capacityInput.trim() ? Number.parseFloat(capacityInput) : undefined;
      const res = await onUpsertMachine(branchId, {
        id: editingId,
        code,
        name,
        kind,
        model: model.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        capacityKg: parsedCap && Number.isFinite(parsedCap) ? parsedCap : undefined,
      });
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error ?? 'No se pudo guardar el equipo.' });
        return;
      }
      setFeedback({
        type: 'success',
        text: editingId ? `Equipo ${code.toUpperCase()} actualizado.` : `Equipo ${code.toUpperCase()} agregado a ${branchName}.`,
      });
      resetForm();
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(
    machine: Machine,
    status: Extract<MachineStatus, 'disponible' | 'fuera_de_servicio'>,
  ) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await onSetMachineStatus(branchId, machine.id, status, reasonDrafts[machine.id]);
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error ?? 'No se pudo cambiar el estado del equipo.' });
        return;
      }
      setReasonDrafts((prev) => ({ ...prev, [machine.id]: '' }));
    } finally {
      setBusy(false);
    }
  }

  function renderMachineGrid(list: Machine[], emptyLabel: string) {
    if (list.length === 0) {
      return <p className="muted">{emptyLabel}</p>;
    }
    return (
      <div className="machine-grid">
        {list.map((machine) => {
          const meta = STATUS_META[machine.status];
          return (
            <article key={machine.id} className={`machine-card status-${machine.status}`}>
              <div className="machine-card-head">
                <div>
                  <strong className="machine-code">{machine.code}</strong>
                  <span className="machine-name">{machine.name}</span>
                </div>
                <span className={`badge ${meta.badgeClass}`}>{meta.label}</span>
              </div>

              <div className="machine-card-meta">
                {machine.status === 'en_uso' && machine.currentOrderFolio ? (
                  <span>Orden asignada: <strong>{machine.currentOrderFolio}</strong></span>
                ) : (
                  <span className="muted">Sin orden asignada</span>
                )}
                {(machine.model || machine.capacityKg || machine.serialNumber) && (
                  <span className="muted">
                    {[
                      machine.model,
                      machine.capacityKg ? `${machine.capacityKg} kg` : null,
                      machine.serialNumber ? `Serie ${machine.serialNumber}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
                {machine.status === 'en_uso' && (() => {
                  const elapsedMin = Math.max(0, Math.floor((nowMs - new Date(machine.updatedAt).getTime()) / 60000));
                  const remainingMin = Math.max(0, TYPICAL_CYCLE_MINUTES - elapsedMin);
                  const pct = Math.min(100, Math.round((elapsedMin / TYPICAL_CYCLE_MINUTES) * 100));
                  return (
                    <div className="machine-timer">
                      <div className="machine-timer-label">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={12} aria-hidden="true" />
                          {elapsedMin} min transcurridos
                        </span>
                        <strong>{remainingMin > 0 ? `~${remainingMin} min rest.` : 'Ciclo por concluir'}</strong>
                      </div>
                      <div className="machine-timer-track">
                        <div className="machine-timer-fill" style={{ width: `${Math.max(8, pct)}%` }} />
                      </div>
                    </div>
                  );
                })()}
                {machine.status === 'fuera_de_servicio' && machine.outOfServiceReason && (
                  <span>Motivo: {machine.outOfServiceReason}</span>
                )}
                <span className="muted">Ciclos registrados: {machine.cycles}</span>
              </div>

              <div className="machine-card-actions">
                {machine.status === 'disponible' && (
                  <div className="machine-offline-row">
                    <input
                      className="input input-sm"
                      placeholder="Motivo (opcional)"
                      aria-label={`Motivo fuera de servicio para ${machine.code}`}
                      value={reasonDrafts[machine.id] ?? ''}
                      onChange={(e) => setReasonDrafts((prev) => ({ ...prev, [machine.id]: e.target.value }))}
                      maxLength={100}
                    />
                    <button
                      type="button"
                      className="btn btn-warning btn-sm"
                      disabled={busy}
                      onClick={() => void handleStatusChange(machine, 'fuera_de_servicio')}
                    >
                      <Wrench size={14} />
                      Fuera de servicio
                    </button>
                  </div>
                )}

                {machine.status === 'fuera_de_servicio' && (
                  <button
                    type="button"
                    className="btn btn-success btn-sm"
                    disabled={busy}
                    onClick={() => void handleStatusChange(machine, 'disponible')}
                  >
                    <CheckCircle2 size={14} />
                    Marcar disponible
                  </button>
                )}

                {machine.status === 'en_uso' && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => void handleStatusChange(machine, 'disponible')}
                  >
                    <Unlock size={14} />
                    Liberar equipo
                  </button>
                )}

                {isSupervisor && (
                  <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      aria-label={`Editar ${machine.code}`}
                      onClick={() => startEdit(machine)}
                    >
                      <Edit3 size={14} />
                    </button>
                    {machine.status !== 'en_uso' && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        aria-label={`Eliminar ${machine.code}`}
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          const res = await onDeleteMachine(branchId, machine.id);
                          setBusy(false);
                          if (!res.ok && res.error) setFeedback({ type: 'error', text: res.error });
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 15 }}>
      <div className="kpi-strip" role="group" aria-label="Filtrar equipos por estado">
        <button
          type="button"
          className={`kpi-cell interactive${statusFilter === 'disponible' ? ' active-filter' : ''}`}
          aria-pressed={statusFilter === 'disponible'}
          onClick={() => setStatusFilter((prev) => (prev === 'disponible' ? 'todos' : 'disponible'))}
        >
          <span className="kpi-label">Disponibles</span>
          <strong className="kpi-value" style={{ color: 'var(--success)' }}>{countAvailable}</strong>
          <span className="kpi-note">Listos para asignar</span>
        </button>
        <button
          type="button"
          className={`kpi-cell interactive${statusFilter === 'en_uso' ? ' active-filter' : ''}`}
          aria-pressed={statusFilter === 'en_uso'}
          onClick={() => setStatusFilter((prev) => (prev === 'en_uso' ? 'todos' : 'en_uso'))}
        >
          <span className="kpi-label">En uso</span>
          <strong className="kpi-value" style={{ color: 'var(--primary)' }}>{countInUse}</strong>
          <span className="kpi-note">Ocupados por un folio</span>
        </button>
        <button
          type="button"
          className={`kpi-cell interactive${statusFilter === 'fuera_de_servicio' ? ' active-filter' : ''}`}
          aria-pressed={statusFilter === 'fuera_de_servicio'}
          onClick={() => setStatusFilter((prev) => (prev === 'fuera_de_servicio' ? 'todos' : 'fuera_de_servicio'))}
        >
          <span className="kpi-label">Fuera de servicio</span>
          <strong className="kpi-value" style={{ color: countOffline > 0 ? 'var(--danger)' : 'inherit' }}>{countOffline}</strong>
          <span className="kpi-note">Bloqueados en mostrador</span>
        </button>
        <button
          type="button"
          className={`kpi-cell interactive${statusFilter === 'todos' ? ' active-filter' : ''}`}
          aria-pressed={statusFilter === 'todos'}
          onClick={() => setStatusFilter('todos')}
        >
          <span className="kpi-label">Total padrón · {branchName}</span>
          <strong className="kpi-value">{machines.length}</strong>
          <span className="kpi-note">{totalWashers} lav. · {totalDryers} sec.</span>
        </button>
      </div>

      <div className="equipos-toolbar">
        <span className="muted" style={{ fontSize: '0.86rem' }}>
          {statusFilter === 'todos'
            ? `Mostrando todos los equipos (${filteredMachines.length})`
            : `Filtro activo: ${STATUS_META[statusFilter].label} (${filteredMachines.length})`}
        </span>
        <div className="card-title-actions">
          {statusFilter !== 'todos' && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatusFilter('todos')}>
              Ver todos
            </button>
          )}
          {isSupervisor && (
            <button
              type="button"
              className={`btn ${showAddForm ? 'btn-secondary' : 'btn-primary'} btn-sm`}
              aria-expanded={showAddForm}
              onClick={() => {
                if (showAddForm) resetForm();
                else setShowAddForm(true);
              }}
            >
              {showAddForm ? <X size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
              {showAddForm ? 'Cerrar formulario' : 'Agregar equipo'}
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`alert alert-${feedback.type}`}
          role={feedback.type === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </div>
      )}

      {machines.length === 0 && (
        <div className="card">
          <h2 className="card-title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <WashingMachine size={18} aria-hidden="true" />
              Inventario pendiente de confirmar · {branchName}
            </span>
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Aún no hay lavadoras ni secadoras registradas en {branchName}. Captura el padrón real confirmado por administración para comenzar a asignar equipos a cada folio.
          </p>
          {import.meta.env.DEV && isSupervisor && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await onSeedSampleMachines(branchId);
                setBusy(false);
                if (!res.ok && res.error) setFeedback({ type: 'error', text: res.error });
              }}
            >
              Cargar equipos de prueba (desarrollo)
            </button>
          )}
        </div>
      )}

      {isSupervisor && showAddForm && (
        <form className="card" onSubmit={handleSaveMachine}>
          <h2 className="card-title">
            <span>{editingId ? 'Editar equipo del padrón' : `Agregar equipo al padrón · ${branchName}`}</span>
          </h2>
          <div className="cash-controls">
            <label className="field" style={{ maxWidth: 120 }}>
              Código *
              <input
                className="input"
                placeholder="Ej. L1, S1"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                maxLength={12}
              />
            </label>
            <label className="field">
              Nombre *
              <input
                className="input"
                placeholder="Ej. Lavadora #1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={50}
              />
            </label>
            <div className="field">
              <label>Tipo</label>
              <CustomSelect
                ariaLabel="Tipo de equipo"
                value={kind}
                options={[
                  { value: 'lavadora', label: 'Lavadora' },
                  { value: 'secadora', label: 'Secadora' },
                ]}
                onChange={setKind}
              />
            </div>
            <label className="field">
              Modelo (opcional)
              <input
                className="input"
                placeholder="Ej. LG Giant C Max"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                maxLength={60}
              />
            </label>
            <label className="field" style={{ maxWidth: 120 }}>
              Cap. kg (opc.)
              <input
                className="input"
                inputMode="decimal"
                placeholder="Ej. 15"
                value={capacityInput}
                onChange={(e) => setCapacityInput(e.target.value)}
              />
            </label>
            <label className="field">
              No. de serie (opcional)
              <input
                className="input"
                placeholder="Serie de fábrica"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                maxLength={50}
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Plus size={16} />
              {editingId ? 'Guardar cambios' : 'Agregar equipo'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={resetForm}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <section className="card">
        <h2 className="card-title">
          <span>Lavadoras · {branchName}</span>
          <span className="badge badge-info">{washers.length}</span>
        </h2>
        {renderMachineGrid(washers, 'Sin lavadoras registradas en esta sucursal.')}
      </section>

      <section className="card">
        <h2 className="card-title">
          <span>Secadoras · {branchName}</span>
          <span className="badge badge-info">{dryers.length}</span>
        </h2>
        {renderMachineGrid(dryers, 'Sin secadoras registradas en esta sucursal.')}
      </section>

      <section className="card">
        <h2 className="card-title">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Activity size={18} aria-hidden="true" />
            Telemetría LG ThinQ Connect
          </span>
          <span className="badge badge-warning">MockUp / Demo · Etapa futura</span>
        </h2>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>
          Vista previa preparada con el esquema oficial de eventos y estados de <strong>LG Smart Solution / ThinQ Connect API</strong> (perfil <code>Washer</code> y <code>Dryer</code>, autenticación por Personal Access Token). Actualmente muestra datos <strong>MockUp / Demo</strong> sin conexión real con máquinas hasta validar modelos compatibles con Carlos.
        </p>
        <div className="machine-grid">
          {buildMockThinqPreviewFeed(
            machines,
            state.orders.filter((o) => o.branchId === branchId),
          ).map((snap) => (
            <article key={snap.machineId} className="machine-card">
              <div className="machine-card-head">
                <div>
                  <strong className="machine-code">{snap.code}</strong>
                  <span className="machine-name">{snap.name} · {snap.deviceProfile}</span>
                </div>
                <span className="badge badge-warning">MockUp / Demo</span>
              </div>
              <div className="machine-card-meta">
                <span>
                  Estado ThinQ: <strong>{formatThinqStateLabel(snap)}</strong>
                </span>
                <span className="muted">
                  {snap.remainingMinutes > 0
                    ? `Tiempo restante estimado: ${snap.remainingMinutes} min`
                    : 'Sin ciclo activo'}
                  {snap.linkedFolio ? ` · Folio ${snap.linkedFolio}` : ''}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
