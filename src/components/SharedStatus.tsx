import { useState } from 'react';
import { LogOut, RefreshCw, ShieldCheck, UserCheck } from 'lucide-react';
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
      <div className="shared-status-meta">
        <span className={`shared-status-role ${isSupervisor ? 'supervisor' : 'operator'}`}>
          {isSupervisor ? (
            <ShieldCheck size={13} aria-hidden="true" />
          ) : (
            <UserCheck size={13} aria-hidden="true" />
          )}
          {isSupervisor ? 'Supervisión · Carlos' : 'Caja · Empleado'}
        </span>

        <div className="shared-status-line">
          <i className="shared-live-dot" aria-hidden="true" />
          <span>En línea · {branchName}</span>
        </div>

        <p className="shared-status-note">
          {isSupervisor
            ? 'Dueños / gerencia: turnos y cortes. Caja opera su sucursal.'
            : 'Caja opera su sucursal en mostrador, órdenes y cobros.'}
        </p>
      </div>

      <div className="shared-status-actions">
        <button
          type="button"
          className="shared-status-btn"
          onClick={() => void handleReload()}
          disabled={reloading}
          aria-busy={reloading}
          title="Actualizar datos"
        >
          <RefreshCw
            size={14}
            aria-hidden="true"
            className={reloading ? 'shared-status-spin' : undefined}
          />
          Actualizar
        </button>
        <button
          type="button"
          className="shared-status-btn"
          onClick={onSignOut}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          <LogOut size={14} aria-hidden="true" />
          Salir
        </button>
      </div>
    </section>
  );
}
