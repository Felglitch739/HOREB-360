import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Edit3,
  Plus,
  Trash2,
  Unlock,
  Wrench,
  X,
} from 'lucide-react';
import { BRANCHES, getBranchDisplayName, getBranchMachines } from '../domain/rules';
import { buildMockThinqPreviewFeed, formatThinqStateLabel } from '../domain/telemetry';
import type { BranchId, DemoState, Machine, MachineKind, MachineStatus } from '../domain/types';
import { CustomSelect } from './CustomSelect';

const TYPICAL_CYCLE_MINUTES = 45;

interface AdminFloorPlanProps {
  state: DemoState;
  branchIds: BranchId[];
  scopeBranch: BranchId | 'all';
  onScopeBranchChange: (next: BranchId | 'all') => void;
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
  onDeleteMachine: (branchId: BranchId, machineId: string) => Promise<{ ok: boolean; error?: string }>;
  onSeedSampleMachines: (branchId: BranchId) => Promise<{ ok: boolean; error?: string }>;
  onSetMachineStatus: (
    branchId: BranchId,
    machineId: string,
    status: Extract<MachineStatus, 'disponible' | 'fuera_de_servicio'>,
    reason?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

function MachineDrumSvg({
  kind,
  status,
  progressPct,
}: {
  kind: MachineKind;
  status: MachineStatus;
  progressPct: number;
}) {
  const radius = 23;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * Math.min(100, Math.max(6, progressPct))) / 100;

  return (
    <div className={`floor-drum-visual status-${status} kind-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" width="60" height="60">
        {/* Outer machine cabinet silhouette */}
        <rect x="6" y="4" width="52" height="56" rx="10" className="drum-body" />
        {/* Control bar */}
        <line x1="14" y1="12" x2="28" y2="12" className="drum-panel-line" />
        <circle cx="46" cy="12" r="2.2" className="drum-led" />
        <circle cx="51" cy="12" r="1.6" className="drum-led-muted" />

        {/* Drum track */}
        <circle cx="32" cy="36" r={radius} className="drum-ring-bg" />

        {/* Progress ring when running */}
        {status === 'en_uso' && (
          <circle
            cx="32"
            cy="36"
            r={radius}
            className="drum-ring-progress"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 32 36)"
          />
        )}

        {/* Inner glass */}
        <circle cx="32" cy="36" r="16" className="drum-glass" />

        {/* Inner motion / symbol */}
        {status === 'en_uso' ? (
          <g className="drum-spin-group">
            {kind === 'lavadora' ? (
              <>
                <path d="M21 36 Q26 30 32 36 T43 36" className="drum-wave" />
                <path d="M23 41 Q28 36 33 41 T42 41" className="drum-wave secondary" />
              </>
            ) : (
              <>
                <path d="M25 29 A10 10 0 0 1 39 29" className="drum-heat" />
                <path d="M39 43 A10 10 0 0 1 25 43" className="drum-heat" />
                <circle cx="32" cy="36" r="3" className="drum-wave" />
              </>
            )}
          </g>
        ) : status === 'fuera_de_servicio' ? (
          <g className="drum-offline-x">
            <line x1="25" y1="29" x2="39" y2="43" />
            <line x1="39" y1="29" x2="25" y2="43" />
          </g>
        ) : (
          <circle cx="32" cy="36" r="7" className="drum-idle-dot" />
        )}
      </svg>
    </div>
  );
}

export function AdminFloorPlan({
  state,
  branchIds,
  scopeBranch,
  onScopeBranchChange,
  onUpsertMachine,
  onDeleteMachine,
  onSeedSampleMachines,
  onSetMachineStatus,
}: AdminFloorPlanProps) {
  const [statusFilter, setStatusFilter] = useState<'todos' | MachineStatus>('todos');
  const [kindFilter, setKindFilter] = useState<'todos' | MachineKind>('todos');
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [formBranch, setFormBranch] = useState<BranchId>(
    scopeBranch === 'all' ? branchIds[0] : scopeBranch,
  );
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<MachineKind>('lavadora');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [capacityInput, setCapacityInput] = useState('');
  const [showThinq, setShowThinq] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (scopeBranch !== 'all') setFormBranch(scopeBranch);
  }, [scopeBranch]);

  const targetBranches = scopeBranch === 'all' ? branchIds : [scopeBranch];
  const allMachines = targetBranches.flatMap((bId) => getBranchMachines(state, bId));

  const totalCount = allMachines.length;
  const availCount = allMachines.filter((m) => m.status === 'disponible').length;
  const inUseCount = allMachines.filter((m) => m.status === 'en_uso').length;
  const offlineCount = allMachines.filter((m) => m.status === 'fuera_de_servicio').length;
  const activePool = Math.max(1, totalCount - offlineCount);
  const occupancyPct = totalCount > 0 ? Math.round((inUseCount / activePool) * 100) : 0;

  const visibleMachines = allMachines.filter((m) => {
    if (statusFilter !== 'todos' && m.status !== statusFilter) return false;
    if (kindFilter !== 'todos' && m.kind !== kindFilter) return false;
    return true;
  });

  const selectedMachine = allMachines.find((m) => m.id === selectedMachineId) ?? null;
  const selectedOrder = selectedMachine?.currentOrderId
    ? state.orders.find((o) => o.id === selectedMachine.currentOrderId) ?? null
    : null;

  function openNewMachine() {
    setEditingId(undefined);
    setCode('');
    setName('');
    setKind('lavadora');
    setModel('');
    setSerialNumber('');
    setCapacityInput('');
    setFormBranch(scopeBranch === 'all' ? branchIds[0] : scopeBranch);
    setShowAddModal(true);
    setFeedback(null);
  }

  function openEditMachine(machine: Machine) {
    setEditingId(machine.id);
    setCode(machine.code);
    setName(machine.name);
    setKind(machine.kind);
    setModel(machine.model ?? '');
    setSerialNumber(machine.serialNumber ?? '');
    setCapacityInput(machine.capacityKg ? String(machine.capacityKg) : '');
    setFormBranch(machine.branchId);
    setSelectedMachineId(null);
    setShowAddModal(true);
    setFeedback(null);
  }

  async function handleSaveMachine(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const parsedCap = capacityInput.trim() ? Number.parseFloat(capacityInput) : undefined;
      const res = await onUpsertMachine(formBranch, {
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
        text: editingId
          ? `Equipo ${code.toUpperCase()} actualizado.`
          : `Equipo ${code.toUpperCase()} agregado a ${getBranchDisplayName(state, formBranch)}.`,
      });
      setShowAddModal(false);
      setEditingId(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(
    machine: Machine,
    status: Extract<MachineStatus, 'disponible' | 'fuera_de_servicio'>,
    reason?: string,
  ) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await onSetMachineStatus(machine.branchId, machine.id, status, reason);
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error ?? 'No se pudo actualizar el estado.' });
        return;
      }
      setReasonDraft('');
      setFeedback({
        type: 'success',
        text:
          status === 'disponible'
            ? `Equipo ${machine.code} marcado como disponible.`
            : `Equipo ${machine.code} marcado fuera de servicio.`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Visual Occupancy Summary Bar */}
      <section className="card admin-floor-summary" data-tour-id="floor-summary">
        <div className="admin-floor-summary-top">
          <div>
            <span className="admin-eyebrow">Ocupación operativa</span>
            <div className="admin-occupancy-headline">
              <strong>{occupancyPct}%</strong>
              <span>en uso ahora ({inUseCount} de {totalCount - offlineCount} operativos)</span>
            </div>
          </div>
          <div className="card-title-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowThinq((prev) => !prev)}
            >
              <Activity size={15} aria-hidden="true" />
              {showThinq ? 'Ocultar ThinQ' : 'Vista ThinQ'}
            </button>
            <button type="button" data-tour-id="floor-add-machine-btn" className="btn btn-primary btn-sm" onClick={openNewMachine}>
              <Plus size={15} aria-hidden="true" /> Agregar equipo
            </button>
          </div>
        </div>

        {/* Stacked proportional bar */}
        <div className="stacked-bar-track" role="img" aria-label={`Disponibles ${availCount}, en uso ${inUseCount}, fuera de servicio ${offlineCount}`}>
          {totalCount > 0 && (
            <>
              <div
                className="stacked-bar-seg seg-available"
                style={{ width: `${(availCount / totalCount) * 100}%` }}
                title={`Disponibles: ${availCount}`}
              />
              <div
                className="stacked-bar-seg seg-inuse"
                style={{ width: `${(inUseCount / totalCount) * 100}%` }}
                title={`En uso: ${inUseCount}`}
              />
              <div
                className="stacked-bar-seg seg-offline"
                style={{ width: `${(offlineCount / totalCount) * 100}%` }}
                title={`Fuera de servicio: ${offlineCount}`}
              />
            </>
          )}
        </div>

        <div className="floor-legend-filters">
          <div className="filter-pills-bar" style={{ marginBottom: 0 }} role="group" aria-label="Filtrar por estado">
            {(
              [
                { id: 'todos', label: `Todos (${totalCount})`, dot: '' },
                { id: 'disponible', label: `Disponibles (${availCount})`, dot: 'dot-available' },
                { id: 'en_uso', label: `En uso (${inUseCount})`, dot: 'dot-inuse' },
                { id: 'fuera_de_servicio', label: `Fuera de serv. (${offlineCount})`, dot: 'dot-offline' },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                data-tour-id={`floor-filter-${pill.id}`}
                className={`filter-pill${statusFilter === pill.id ? ' active' : ''}`}
                aria-pressed={statusFilter === pill.id}
                onClick={() => setStatusFilter(pill.id)}
              >
                {pill.dot && <span className={`legend-dot ${pill.dot}`} aria-hidden="true" />}
                {pill.label}
              </button>
            ))}
          </div>

          <div className="view-toggle-group" role="group" aria-label="Filtrar por tipo">
            {(
              [
                { id: 'todos', label: 'Todos' },
                { id: 'lavadora', label: 'Lavadoras' },
                { id: 'secadora', label: 'Secadoras' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                className={`view-toggle-btn${kindFilter === item.id ? ' active' : ''}`}
                aria-pressed={kindFilter === item.id}
                onClick={() => setKindFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {feedback && (
        <div
          className={`alert alert-${feedback.type}`}
          role={feedback.type === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </div>
      )}

      {/* Visual Floor Plan grouped by branch */}
      {targetBranches.map((bId) => {
        const bName = getBranchDisplayName(state, bId);
        const bMachines = visibleMachines.filter((m) => m.branchId === bId);
        const bTotal = getBranchMachines(state, bId).length;
        const bWashers = bMachines.filter((m) => m.kind === 'lavadora');
        const bDryers = bMachines.filter((m) => m.kind === 'secadora');
        const unlinkedActiveCount = state.orders.filter(
          (o) =>
            o.branchId === bId &&
            (o.encargoStage === 'lavado' || o.encargoStage === 'secado') &&
            (o.assignedMachineIds ?? []).length === 0,
        ).length;

        return (
          <section key={bId} className="card admin-floor-branch">
            <div className="admin-floor-branch-head">
              <div>
                <h2 style={{ margin: 0, fontSize: '1.08rem' }}>{bName}</h2>
                <small className="muted">
                  {bWashers.length} lavadora(s) · {bDryers.length} secadora(s) visibles
                  {unlinkedActiveCount > 0 ? ` · ${unlinkedActiveCount} orden(es) en lavado/secado sin máquina asignada` : ''}
                </small>
              </div>
              {scopeBranch === 'all' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onScopeBranchChange(bId)}
                >
                  Enfocar sucursal
                </button>
              )}
            </div>

            {bTotal === 0 ? (
              <div className="empty-state-box">
                <p className="muted" style={{ margin: 0 }}>
                  Aún no hay equipos dados de alta en {bName}.
                </p>
                <div className="order-actions" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setFormBranch(bId);
                      setEditingId(undefined);
                      setCode('');
                      setName('');
                      setKind('lavadora');
                      setShowAddModal(true);
                    }}
                  >
                    <Plus size={14} /> Agregar primer equipo
                  </button>
                  {import.meta.env.DEV && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const res = await onSeedSampleMachines(bId);
                        setBusy(false);
                        if (!res.ok && res.error) setFeedback({ type: 'error', text: res.error });
                      }}
                    >
                      Cargar equipos de prueba (dev)
                    </button>
                  )}
                </div>
              </div>
            ) : bMachines.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
                No hay equipos en {bName} que coincidan con los filtros activos.
              </p>
            ) : (
              <div className="floor-zones">
                {bWashers.length > 0 && (
                  <div className="floor-zone">
                    <div className="floor-zone-label">Zona de Lavado</div>
                    <div className="floor-tile-grid">
                      {bWashers.map((machine) => {
                        const elapsedMin =
                          machine.status === 'en_uso'
                            ? Math.max(0, Math.floor((nowMs - new Date(machine.updatedAt).getTime()) / 60000))
                            : 0;
                        const remainingMin = Math.max(0, TYPICAL_CYCLE_MINUTES - elapsedMin);
                        const pct = Math.min(100, Math.round((elapsedMin / TYPICAL_CYCLE_MINUTES) * 100));
                        const linkedOrder = machine.currentOrderId
                          ? state.orders.find((o) => o.id === machine.currentOrderId)
                          : null;

                        return (
                          <button
                            key={machine.id}
                            type="button"
                            className={`floor-tile status-${machine.status}`}
                            onClick={() => {
                              setSelectedMachineId(machine.id);
                              setReasonDraft('');
                            }}
                          >
                            <div className="floor-tile-head">
                              <strong className="floor-tile-code">{machine.code}</strong>
                              <span className={`floor-status-dot status-${machine.status}`} />
                            </div>
                            <MachineDrumSvg kind={machine.kind} status={machine.status} progressPct={pct} />
                            <div className="floor-tile-foot">
                              {machine.status === 'en_uso' ? (
                                <>
                                  <strong className="floor-tile-folio">{machine.currentOrderFolio ?? 'En ciclo'}</strong>
                                  <small className="floor-tile-sub">
                                    {linkedOrder?.customerAlias ? `${linkedOrder.customerAlias} · ` : ''}
                                    {remainingMin > 0 ? `~${remainingMin}m` : 'Por terminar'}
                                  </small>
                                </>
                              ) : machine.status === 'fuera_de_servicio' ? (
                                <>
                                  <strong style={{ color: 'var(--danger)' }}>Fuera de serv.</strong>
                                  <small className="floor-tile-sub">
                                    {machine.outOfServiceReason || 'Mantenimiento'}
                                  </small>
                                </>
                              ) : (
                                <>
                                  <strong style={{ color: 'var(--success)' }}>Disponible</strong>
                                  <small className="floor-tile-sub">{machine.cycles} ciclos</small>
                                </>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {bDryers.length > 0 && (
                  <div className="floor-zone">
                    <div className="floor-zone-label">Zona de Secado</div>
                    <div className="floor-tile-grid">
                      {bDryers.map((machine) => {
                        const elapsedMin =
                          machine.status === 'en_uso'
                            ? Math.max(0, Math.floor((nowMs - new Date(machine.updatedAt).getTime()) / 60000))
                            : 0;
                        const remainingMin = Math.max(0, TYPICAL_CYCLE_MINUTES - elapsedMin);
                        const pct = Math.min(100, Math.round((elapsedMin / TYPICAL_CYCLE_MINUTES) * 100));
                        const linkedOrder = machine.currentOrderId
                          ? state.orders.find((o) => o.id === machine.currentOrderId)
                          : null;

                        return (
                          <button
                            key={machine.id}
                            type="button"
                            className={`floor-tile status-${machine.status}`}
                            onClick={() => {
                              setSelectedMachineId(machine.id);
                              setReasonDraft('');
                            }}
                          >
                            <div className="floor-tile-head">
                              <strong className="floor-tile-code">{machine.code}</strong>
                              <span className={`floor-status-dot status-${machine.status}`} />
                            </div>
                            <MachineDrumSvg kind={machine.kind} status={machine.status} progressPct={pct} />
                            <div className="floor-tile-foot">
                              {machine.status === 'en_uso' ? (
                                <>
                                  <strong className="floor-tile-folio">{machine.currentOrderFolio ?? 'En ciclo'}</strong>
                                  <small className="floor-tile-sub">
                                    {linkedOrder?.customerAlias ? `${linkedOrder.customerAlias} · ` : ''}
                                    {remainingMin > 0 ? `~${remainingMin}m` : 'Por terminar'}
                                  </small>
                                </>
                              ) : machine.status === 'fuera_de_servicio' ? (
                                <>
                                  <strong style={{ color: 'var(--danger)' }}>Fuera de serv.</strong>
                                  <small className="floor-tile-sub">
                                    {machine.outOfServiceReason || 'Mantenimiento'}
                                  </small>
                                </>
                              ) : (
                                <>
                                  <strong style={{ color: 'var(--success)' }}>Disponible</strong>
                                  <small className="floor-tile-sub">{machine.cycles} ciclos</small>
                                </>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}

      {/* Optional LG ThinQ preview */}
      {showThinq && (
        <section className="card">
          <h2 className="card-title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Activity size={18} aria-hidden="true" />
              Telemetría LG ThinQ Connect
            </span>
            <span className="badge badge-warning">MockUp / Demo · Etapa futura</span>
          </h2>
          <div className="machine-grid">
            {buildMockThinqPreviewFeed(
              allMachines,
              state.orders.filter((o) => targetBranches.includes(o.branchId)),
            ).map((snap) => (
              <article key={snap.machineId} className="machine-card">
                <div className="machine-card-head">
                  <div>
                    <strong className="machine-code">{snap.code}</strong>
                    <span className="machine-name">{snap.name} · {snap.deviceProfile}</span>
                  </div>
                  <span className="badge badge-warning">Demo</span>
                </div>
                <div className="machine-card-meta">
                  <span>Estado ThinQ: <strong>{formatThinqStateLabel(snap)}</strong></span>
                  <span className="muted">
                    {snap.remainingMinutes > 0 ? `~${snap.remainingMinutes} min restantes` : 'Sin ciclo activo'}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Machine Inspector Drawer */}
      {selectedMachine && (
        <div
          className="orders-drawer-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedMachineId(null);
          }}
        >
          <aside className="orders-drawer" role="dialog" aria-modal="true" aria-label={`Detalle equipo ${selectedMachine.code}`}>
            <div className="orders-drawer-head">
              <div className="orders-drawer-title-group">
                <h2>
                  {selectedMachine.code} · {selectedMachine.name}
                </h2>
                <span className="badge badge-info">{getBranchDisplayName(state, selectedMachine.branchId)}</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm orders-drawer-close"
                aria-label="Cerrar detalle"
                onClick={() => setSelectedMachineId(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="orders-drawer-body" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
              <div className="floor-inspector-hero">
                <MachineDrumSvg
                  kind={selectedMachine.kind}
                  status={selectedMachine.status}
                  progressPct={
                    selectedMachine.status === 'en_uso'
                      ? Math.min(
                          100,
                          Math.round(
                            (Math.max(0, Math.floor((nowMs - new Date(selectedMachine.updatedAt).getTime()) / 60000)) /
                              TYPICAL_CYCLE_MINUTES) *
                              100,
                          ),
                        )
                      : 0
                  }
                />
                <div>
                  <span className="admin-eyebrow">{selectedMachine.kind === 'lavadora' ? 'Lavadora' : 'Secadora'}</span>
                  <h3 style={{ margin: '2px 0 4px' }}>
                    {selectedMachine.status === 'disponible'
                      ? 'Disponible para operar'
                      : selectedMachine.status === 'en_uso'
                        ? `En uso · ${selectedMachine.currentOrderFolio ?? ''}`
                        : 'Fuera de servicio'}
                  </h3>
                  <small className="muted">
                    Ciclos acumulados: <strong>{selectedMachine.cycles}</strong>
                  </small>
                  {(selectedMachine.model || selectedMachine.capacityKg || selectedMachine.serialNumber) && (
                    <small className="muted" style={{ display: 'block', marginTop: 2 }}>
                      {[
                        selectedMachine.model,
                        selectedMachine.capacityKg ? `${selectedMachine.capacityKg} kg` : null,
                        selectedMachine.serialNumber ? `Serie: ${selectedMachine.serialNumber}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  )}
                </div>
              </div>

              {selectedOrder ? (
                <div className="card" style={{ padding: 12, background: 'var(--surface-alt)' }}>
                  <span className="admin-eyebrow">Orden asignada</span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <strong>{selectedOrder.folio}</strong>
                    <span>{selectedOrder.customerAlias}</span>
                  </div>
                  <small className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <Clock size={12} /> Actualizado:{' '}
                    {new Date(selectedMachine.updatedAt).toLocaleTimeString('es-MX', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                </div>
              ) : (
                <div className="card" style={{ padding: 10, background: 'var(--surface-alt)' }}>
                  <small className="muted">Orden asignada: <strong>Sin orden asignada</strong></small>
                </div>
              )}

              {selectedMachine.status === 'fuera_de_servicio' && selectedMachine.outOfServiceReason && (
                <div className="alert alert-error" style={{ marginBottom: 0 }}>
                  Motivo: {selectedMachine.outOfServiceReason}
                </div>
              )}

              <div style={{ display: 'grid', gap: 10 }}>
                {selectedMachine.status === 'disponible' && (
                  <>
                    <label className="field" style={{ marginBottom: 0 }}>
                      Motivo fuera de servicio (opcional)
                      <input
                        className="input"
                        placeholder="Ej. Fuga en válvula / mantenimiento"
                        value={reasonDraft}
                        onChange={(e) => setReasonDraft(e.target.value)}
                        maxLength={100}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-warning btn-full"
                      disabled={busy}
                      onClick={() => void handleStatusChange(selectedMachine, 'fuera_de_servicio', reasonDraft)}
                    >
                      <Wrench size={16} /> Marcar fuera de servicio
                    </button>
                  </>
                )}

                {selectedMachine.status === 'fuera_de_servicio' && (
                  <button
                    type="button"
                    className="btn btn-success btn-full"
                    disabled={busy}
                    onClick={() => void handleStatusChange(selectedMachine, 'disponible')}
                  >
                    <CheckCircle2 size={16} /> Marcar disponible nuevamente
                  </button>
                )}

                {selectedMachine.status === 'en_uso' && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-full"
                    disabled={busy}
                    onClick={() => void handleStatusChange(selectedMachine, 'disponible')}
                  >
                    <Unlock size={16} /> Liberar equipo manualmente
                  </button>
                )}

                <div className="order-actions" style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => openEditMachine(selectedMachine)}
                  >
                    <Edit3 size={14} /> Editar datos
                  </button>
                  {selectedMachine.status !== 'en_uso' && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const res = await onDeleteMachine(selectedMachine.branchId, selectedMachine.id);
                        setBusy(false);
                        if (!res.ok && res.error) {
                          setFeedback({ type: 'error', text: res.error });
                        } else {
                          setSelectedMachineId(null);
                        }
                      }}
                    >
                      <Trash2 size={14} /> Eliminar
                    </button>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Add / Edit Machine Drawer */}
      {showAddModal && (
        <div
          className="orders-drawer-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddModal(false);
          }}
        >
          <aside className="orders-drawer" role="dialog" aria-modal="true" aria-label="Formulario de equipo">
            <div className="orders-drawer-head">
              <div className="orders-drawer-title-group">
                <h2>{editingId ? 'Editar equipo' : 'Nuevo equipo'}</h2>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm orders-drawer-close"
                aria-label="Cerrar"
                onClick={() => setShowAddModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="orders-drawer-body">
              <form onSubmit={handleSaveMachine}>
                <div className="field">
                  <label>Sucursal</label>
                  <CustomSelect
                    ariaLabel="Sucursal del equipo"
                    value={formBranch}
                    options={BRANCHES.filter((b) => branchIds.includes(b.id)).map((b) => ({
                      value: b.id,
                      label: b.name,
                    }))}
                    onChange={setFormBranch}
                  />
                </div>
                <label className="field">
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
                    placeholder="Ej. Lavadora Industrial #1"
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
                <div className="quick-customer-inputs" style={{ marginBottom: 12 }}>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Capacidad kg (opcional)
                    <input
                      className="input"
                      inputMode="decimal"
                      placeholder="Ej. 15"
                      value={capacityInput}
                      onChange={(e) => setCapacityInput(e.target.value)}
                    />
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Número de serie (opcional)
                    <input
                      className="input"
                      placeholder="Serie de fábrica"
                      value={serialNumber}
                      onChange={(e) => setSerialNumber(e.target.value)}
                      maxLength={50}
                    />
                  </label>
                </div>
                <div className="order-actions" style={{ marginTop: 14 }}>
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    <Plus size={16} />
                    {editingId ? 'Guardar cambios' : 'Agregar equipo'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowAddModal(false)}
                  >
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
