import type { BranchRole } from '../domain/sharedState';
import './SharedStatus.css';

interface SharedStatusProps {
  branchName: string;
  role: BranchRole;
}

export function SharedStatus({ branchName, role }: SharedStatusProps) {
  const roleLabel = role === 'supervisor' ? 'Supervisión' : 'Caja';

  return (
    <div className="shared-status" role="status" aria-label="Estado de conexión">
      <i className="shared-live-dot" aria-hidden="true" />
      <span className="shared-status-text">
        {roleLabel} - En línea - {branchName}
      </span>
    </div>
  );
}
