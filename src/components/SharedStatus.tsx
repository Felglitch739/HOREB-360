import type { BranchRole } from '../domain/sharedState';
import './SharedStatus.css';

interface SharedStatusProps {
  branchName: string;
  role: BranchRole;
  userEmail?: string;
  isOnline?: boolean;
  pendingSyncCount?: number;
  syncing?: boolean;
}

export function SharedStatus({
  branchName,
  role,
  userEmail,
  isOnline = true,
  pendingSyncCount = 0,
  syncing = false,
}: SharedStatusProps) {
  const roleLabel = role === 'supervisor' ? 'Supervisión' : 'Operación / Caja';
  const connLabel = !isOnline
    ? 'Sin internet (modo local)'
    : syncing || pendingSyncCount > 0
      ? `Sincronizando (${pendingSyncCount})`
      : 'En línea';

  return (
    <div
      className={`shared-status ${!isOnline ? 'offline' : pendingSyncCount > 0 ? 'syncing' : ''}`}
      role="status"
      aria-label="Estado de conexión"
    >
      <div className="shared-status-row">
        <i className="shared-live-dot" aria-hidden="true" />
        <span className="shared-status-text">
          {roleLabel} · {connLabel} · {branchName}
        </span>
      </div>
      {userEmail && (
        <span className="shared-status-email" title={userEmail}>
          {userEmail}
        </span>
      )}
    </div>
  );
}
