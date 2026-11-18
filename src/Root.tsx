import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, FunctionsHttpError, type Session } from '@supabase/supabase-js';
import { ArrowLeft, Cloud, WashingMachine } from 'lucide-react';
import { App } from './App';
import type { Operation } from './domain/operations';
import { combineBranches, type BranchRole, type BranchRow } from './domain/sharedState';
import type { BranchId, Order } from './domain/types';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const client = url && key ? createClient(url, key) : null;

interface Membership { branch_id: BranchId; role: BranchRole }
interface OperationResponse { row?: BranchRow; order?: Order; error?: string }

export interface SharedWorkspace {
  state: ReturnType<typeof combineBranches>;
  roles: Partial<Record<BranchId, BranchRole>>;
  execute: (branch: BranchId, operation: Operation) => Promise<{ ok: boolean; error?: string; order?: Order }>;
  reload: () => Promise<void>;
  signOut: () => void;
}

export function Root() {
  const [online, setOnline] = useState(window.location.hash === '#compartido');
  function switchMode(next: boolean) {
    window.history.replaceState(null, '', next ? '#compartido' : window.location.pathname);
    setOnline(next);
  }
  if (online && client) return <ConnectedWorkspace onLocal={() => switchMode(false)} />;
  return <App onSwitchMode={client ? () => switchMode(true) : undefined} />;
}

function ConnectedWorkspace({ onLocal }: { onLocal: () => void }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [rows, setRows] = useState<BranchRow[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const interacting = useRef(false);

  useEffect(() => {
    const { data: { subscription } } = client!.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    if (!session?.user.id) return;
    const [access, data] = await Promise.all([
      client!.from('horeb_memberships').select('branch_id,role'),
      client!.from('horeb_branch_state').select('branch_id,version,updated_at,state').order('branch_id'),
    ]);
    if (access.error || data.error) {
      setError('No se pudo cargar Supabase. Revisa la conexión y vuelve a intentar.');
      return;
    }
    setError('');
    setMemberships(access.data as Membership[]);
    setRows((prior) => (data.data as BranchRow[]).map((fresh) => {
      const current = prior?.find((row) => row.branch_id === fresh.branch_id);
      return current && current.version > fresh.version ? current : fresh;
    }));
  }, [session?.user.id]);

  useEffect(() => {
    setRows(null);
    setMemberships([]);
    if (!session?.user.id) return;
    void reload();
    const interval = window.setInterval(() => {
      if (!interacting.current) void reload();
    }, 8000);
    return () => window.clearInterval(interval);
  }, [session?.user.id, reload]);

  function merge(row: BranchRow) {
    setRows((prior) => prior?.map((item) => item.branch_id === row.branch_id && item.version <= row.version ? row : item) ?? null);
  }

  async function execute(branch: BranchId, operation: Operation) {
    const base = rows?.find((row) => row.branch_id === branch);
    if (!base) return { ok: false, error: 'Esta sucursal no está disponible para tu cuenta.' };
    if (interacting.current) return { ok: false, error: 'Espera a que termine la operación anterior.' };
    interacting.current = true;
    const body = { branch, version: base.version, operationId: crypto.randomUUID(), operation };
    try {
      let response = await client!.functions.invoke<OperationResponse>('horeb-operation', { body });
      if (response.error && !(response.error instanceof FunctionsHttpError)) {
        response = await client!.functions.invoke<OperationResponse>('horeb-operation', { body });
      }
      if (response.error instanceof FunctionsHttpError) {
        const context = response.error.context as Response;
        const message = await context.json().catch(() => ({})) as OperationResponse;
        if (message.row) merge(message.row);
        else if (context.status === 409) await reload();
        return { ok: false, error: message.error ?? 'No se pudo completar la operación en Supabase.' };
      }
      if (response.error || !response.data?.row) {
        await reload();
        return { ok: false, error: 'No se pudo comprobar el guardado. Revisa el folio o el corte antes de intentar otra vez.' };
      }
      merge(response.data.row);
      const order = response.data.order ?? (operation.action === 'create'
        ? response.data.row.state.orders?.find((item) => item.folio === operation.input.folio?.trim().toUpperCase())
        : undefined);
      return { ok: true, order };
    } catch {
      return { ok: false, error: 'No se pudo comprobar el guardado. Actualiza y revisa el folio o corte antes de intentar otra vez.' };
    } finally {
      interacting.current = false;
    }
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setLoading(true);
    setError('');
    try {
      const { error: authError } = await client!.auth.signInWithPassword({
        email: String(fields.get('email') ?? '').trim(), password: String(fields.get('password') ?? ''),
      });
      if (authError) setError('No se pudo iniciar sesión. Revisa el correo y la contraseña.');
    } catch {
      setError('No se pudo contactar a Supabase para iniciar sesión.');
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    const { error: signOutError } = await client!.auth.signOut({ scope: 'local' });
    if (signOutError) setError('No se pudo cerrar la sesión. Vuelve a intentar.');
  }

  if (session && rows?.length) {
    const roles = Object.fromEntries(memberships.map((entry) => [entry.branch_id, entry.role]));
    return <App shared={{ state: combineBranches(rows), roles, execute, reload, signOut: () => void signOut() }}
      sharedNotice={error} onSwitchMode={onLocal} />;
  }

  return <main className="cloud-auth">
    <section className="card cloud-auth-card">
      <span className="brand-mark"><WashingMachine size={24} aria-hidden="true" /></span>
      <h1>HOREB 360</h1><p><Cloud size={16} aria-hidden="true" /> Demo compartida</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {!session && session !== undefined && <form onSubmit={signIn}>
        <label className="field">Correo <input name="email" className="input" type="email" autoComplete="username" required /></label>
        <label className="field">Contraseña <input name="password" className="input" type="password" autoComplete="current-password" required /></label>
        <button className="btn btn-primary btn-full" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</button>
      </form>}
      {session === undefined && <p role="status">Comprobando sesión…</p>}
      {session && !rows && !error && <p role="status">Cargando tus sucursales…</p>}
      {session && rows?.length === 0 && <p>Tu cuenta aún no tiene una sucursal asignada.</p>}
      {session && <div className="order-actions">
        <button className="btn btn-secondary" onClick={() => void reload()}>Actualizar</button>
        <button className="btn btn-secondary" onClick={() => void signOut()}>Cerrar sesión</button>
      </div>}
      <button className="btn btn-secondary btn-full" onClick={onLocal}><ArrowLeft size={16} /> Demo local</button>
    </section>
  </main>;
}
