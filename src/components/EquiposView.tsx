import { useState } from 'react';
import { CheckCircle2, Edit3, Plus, Trash2, Unlock, WashingMachine, Wrench } from 'lucide-react';
import { getBranchInfo, getBranchMachines } from '../domain/rules';
import type { BranchRole } from '../domain/sharedState';
import type { BranchId, DemoState, Machine, MachineKind, MachineStatus } from '../domain/types';
import { CustomSelect } from './CustomSelect';

interface EquiposViewProps {
  state: DemoState;
  branchId: BranchId;
  role: BranchRole;
  onUpsertMachine: (
    branchId: BranchId,
    machine: { id?: string; code: string; name: string; kind: MachineKind },
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
  const branch = getBranchInfo(branchId);
  const machines = getBranchMachines(state, branchId);
  const washers = machines.filter((m) => m.kind === 'lavadora');
  const dryers = machines.filter((m) => m.kind === 'secadora');

  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<MachineKind>('lavadora');
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const countAvailable = machines.filter((m) => m.status === 'disponible').length;
  const countInUse = machines.filter((m) => m.status === 'en_uso').length;
  const countOffline = machines.filter((m) => m.status === 'fuera_de_servicio').length;

  function startEdit(machine: Machine) {
    setEditingId(machine.id);
    setCode(machine.code);
    setName(machine.name);
    setKind(machine.kind);
    setFeedback(null);
  }

  function resetForm() {
    setEditingId(undefined);
    setCode('');
    setName('');
    setKind('lavadora');
  }

  async function handleSaveMachine(event: React.FormEvent) {
    event.preventDefault();
    if (!isSupervisor || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await onUpsertMachine(branchId, { id: editingId, code, name, kind });
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error ?? 'No se pudo guardar el equipo.' });
        return;
      }
      setFeedback({
        type: 'success',
        text: editingId ? `Equipo ${code.toUpperCase()} actualizado.` : `Equipo ${code.toUpperCase()} agregado a ${branch.name}.`,
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
                {machine.status === 'en_uso' && machine.currentOrderFolio && (
                  <span>Folio: <strong>{machine.currentOrderFolio}</strong></span>
                )}
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
      <div className="kpi-strip">
        <div className="kpi-cell">
          <span className="kpi-label">Disponibles</span>
          <strong className="kpi-value" style={{ color: 'var(--success)' }}>{countAvailable}</strong>
          <span className="kpi-note">Listos para asignar</span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">En uso</span>
          <strong className="kpi-value" style={{ color: 'var(--primary)' }}>{countInUse}</strong>
          <span className="kpi-note">Ocupados por un folio</span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Fuera de servicio</span>
          <strong className="kpi-value" style={{ color: countOffline > 0 ? 'var(--danger)' : 'inherit' }}>{countOffline}</strong>
          <span className="kpi-note">Bloqueados en mostrador</span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Total padrón · {branch.name}</span>
          <strong className="kpi-value">{machines.length}</strong>
          <span className="kpi-note">{washers.length} lav. · {dryers.length} sec.</span>
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
              Inventario pendiente de confirmar · {branch.name}
            </span>
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Aún no hay lavadoras ni secadoras registradas en {branch.name}. Captura el padrón real confirmado por administración para comenzar a asignar equipos a cada folio.
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
              Cargar equipos ficticios de prueba (solo desarrollo)
            </button>
          )}
        </div>
      )}

      {isSupervisor && (
        <form className="card" onSubmit={handleSaveMachine}>
          <h2 className="card-title">
            <span>{editingId ? 'Editar equipo del padrón' : `Agregar equipo al padrón · ${branch.name}`}</span>
          </h2>
          <div className="cash-controls">
            <label className="field" style={{ maxWidth: 130 }}>
              Código
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
              Nombre / modelo
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
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Plus size={16} />
              {editingId ? 'Guardar cambios' : 'Agregar equipo'}
            </button>
            {editingId && (
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      <section className="card">
        <h2 className="card-title">
          <span>Lavadoras · {branch.name}</span>
          <span className="badge badge-info">{washers.length}</span>
        </h2>
        {renderMachineGrid(washers, 'Sin lavadoras registradas en esta sucursal.')}
      </section>

      <section className="card">
        <h2 className="card-title">
          <span>Secadoras · {branch.name}</span>
          <span className="badge badge-info">{dryers.length}</span>
        </h2>
        {renderMachineGrid(dryers, 'Sin secadoras registradas en esta sucursal.')}
      </section>
    </div>
  );
}
