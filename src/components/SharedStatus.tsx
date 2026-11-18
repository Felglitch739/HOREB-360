import { useState } from 'react';
import { Cloud, LogOut, MapPin, RefreshCw, ShieldCheck, UserCheck } from 'lucide-react';
import type { BranchRole } from '../domain/sharedState';
import './SharedStatus.css';

interface SharedStatusProps {
  branchName: string;
  role: BranchRole;
  onReload: () => Promise<void>;
  onSignOut: () => void;
}

export function SharedStatus({ branchName, role, onReload, onSignOut }: SharedStatusProps) {
  const [reloading, setReloading] = useState(false);
  const isSupervisor = role === 'supervisor';
  const roleLabel = isSupervisor ? 'Supervisión' : 'Caja';

  async function handleReload() {
    if (reloading) return;
    setReloading(true);
    try {
      await onReload();
    } finally {
      setReloading(false);
    }
  }

  return (
    <section className="shared-status" aria-label="Estado de la sesión en línea">
      <div className="shared-status-info">
        <div className="shared-status-tags">
          <span className="shared-status-badge mode">
            <Cloud size={14} aria-hidden="true" />
            En línea · Sincronizado
          </span>
          <span className="shared-status-badge branch">
            <MapPin size={14} aria-hidden="true" />
            Sucursal: {branchName}
          </span>
          <span
            className={`shared-status-badge ${isSupervisor ? 'role-supervisor' : 'role-operator'}`}
          >
            {isSupervisor ? (
              <ShieldCheck size={14} aria-hidden="true" />
            ) : (
              <UserCheck size={14} aria-hidden="true" />
            )}
            Rol: {roleLabel}
          </span>
        </div>
        <p className="shared-status-note">
          {isSupervisor
            ? 'Supervisión gestiona turnos y cortes; Caja opera su sucursal.'
            : 'Caja opera su sucursal en mostrador, órdenes y cobros; Supervisión gestiona turnos y cortes.'}
        </p>
      </div>

      <div className="shared-status-actions">
        <button
          type="button"
          className="shared-status-btn"
          onClick={() => void handleReload()}
          disabled={reloading}
          aria-busy={reloading}
        >
          <RefreshCw
            size={15}
            aria-hidden="true"
            className={reloading ? 'shared-status-spin' : undefined}
          />
          Actualizar
        </button>
        <button type="button" className="shared-status-btn" onClick={onSignOut}>
          <LogOut size={15} aria-hidden="true" />
          Cerrar sesión
        </button>
      </div>
    </section>
  );
}
