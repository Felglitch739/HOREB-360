import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, FunctionsHttpError, type Session } from '@supabase/supabase-js';
import { CheckCircle2, Eye, EyeOff, Lock, ShieldCheck, UserCheck, WashingMachine } from 'lucide-react';
import { App } from './App';
import type { Operation } from './domain/operations';
import { combineBranches, type BranchRole, type BranchRow } from './domain/sharedState';
import type { BranchId, Order } from './domain/types';
import { useBrandTheme } from './theme';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://mekjctargwhadpyezqjc.supabase.co';
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_u2CIBe8MXfvEQprucn0pHQ_fKbUtW0E';
const client = createClient(url, key);

interface Membership {
  branch_id: BranchId;
  role: BranchRole;
}

interface OperationResponse {
  row?: BranchRow;
  order?: Order;
  error?: string;
}

export interface SharedWorkspace {
  state: ReturnType<typeof combineBranches>;
  roles: Partial<Record<BranchId, BranchRole>>;
  execute: (branch: BranchId, operation: Operation) => Promise<{ ok: boolean; error?: string; order?: Order }>;
  reload: () => Promise<void>;
  signOut: () => void;
}

const QUICK_ACCOUNTS = [
  {
    label: 'Supervisión · Carlos',
    subtitle: '3 sucursales, turnos y cortes',
    email: 'admin@horeb.mx',
    password: 'horeb123',
    role: 'supervisor' as const,
  },
  {
    label: 'Caja · Mostrador Lomas',
    subtitle: 'Mostrador, órdenes y cobros en Lomas',
    email: 'caja@horeb.mx',
    password: 'horeb123',
    role: 'operator' as const,
  },
] as const;

export function Root() {
  const { theme, setTheme } = useBrandTheme();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [rows, setRows] = useState<BranchRow[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const interacting = useRef(false);

  useEffect(() => {
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    if (!session?.user.id) return;
    const [access, data] = await Promise.all([
      client.from('horeb_memberships').select('branch_id,role'),
      client.from('horeb_branch_state').select('branch_id,version,updated_at,state').order('branch_id'),
    ]);
    if (access.error || data.error) {
      setError('No se pudo cargar Supabase. Revisa la conexión y vuelve a intentar.');
      return;
    }
    setError('');
    setMemberships(access.data as Membership[]);
    setRows((prior) =>
      (data.data as BranchRow[]).map((fresh) => {
        const current = prior?.find((row) => row.branch_id === fresh.branch_id);
        return current && current.version > fresh.version ? current : fresh;
      }),
    );
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
    setRows(
      (prior) =>
        prior?.map((item) =>
          item.branch_id === row.branch_id && item.version <= row.version ? row : item,
        ) ?? null,
    );
  }

  async function execute(branch: BranchId, operation: Operation) {
    const base = rows?.find((row) => row.branch_id === branch);
    if (!base) return { ok: false, error: 'Esta sucursal no está disponible para tu cuenta.' };
    if (interacting.current) return { ok: false, error: 'Espera a que termine la operación anterior.' };
    interacting.current = true;
    const body = { branch, version: base.version, operationId: crypto.randomUUID(), operation };
    try {
      let response = await client.functions.invoke<OperationResponse>('horeb-operation', { body });
      if (response.error && !(response.error instanceof FunctionsHttpError)) {
        response = await client.functions.invoke<OperationResponse>('horeb-operation', { body });
      }
      if (response.error instanceof FunctionsHttpError) {
        const context = response.error.context as Response;
        const message = (await context.json().catch(() => ({}))) as OperationResponse;
        if (message.row) merge(message.row);
        else if (context.status === 409) await reload();
        return { ok: false, error: message.error ?? 'No se pudo completar la operación en Supabase.' };
      }
      if (response.error || !response.data?.row) {
        await reload();
        return {
          ok: false,
          error: 'No se pudo comprobar el guardado. Revisa el folio o el corte antes de intentar otra vez.',
        };
      }
      merge(response.data.row);
      const order =
        response.data.order ??
        (operation.action === 'create'
          ? response.data.row.state.orders?.find(
              (item) => item.folio === operation.input.folio?.trim().toUpperCase(),
            )
          : undefined);
      return { ok: true, order };
    } catch {
      return {
        ok: false,
        error: 'No se pudo comprobar el guardado. Actualiza y revisa el folio o corte antes de intentar otra vez.',
      };
    } finally {
      interacting.current = false;
    }
  }

  async function signInWithCredentials(email: string, password: string) {
    setLoading(true);
    setError('');
    try {
      const { error: authError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) setError('No se pudo iniciar sesión. Revisa el correo y la contraseña.');
    } catch {
      setError('No se pudo contactar a Supabase para iniciar sesión.');
    } finally {
      setLoading(false);
    }
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    await signInWithCredentials(
      String(fields.get('email') ?? ''),
      String(fields.get('password') ?? ''),
    );
  }

  async function signOut() {
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
    if (signOutError) setError('No se pudo cerrar la sesión. Vuelve a intentar.');
  }

  if (session && rows?.length) {
    const roles = Object.fromEntries(memberships.map((entry) => [entry.branch_id, entry.role]));
    return (
      <App
        shared={{ state: combineBranches(rows), roles, execute, reload, signOut: () => void signOut() }}
        sharedNotice={error}
        theme={theme}
        onSetTheme={setTheme}
      />
    );
  }

  return (
    <main className="auth-layout">
      <section className="auth-showcase" aria-label="Lavandería Horeb">
        <div className="auth-showcase-bg" aria-hidden="true" />
        <div className="auth-showcase-inner">
          <div className="auth-brand">
            <span className="brand-mark">
              <WashingMachine size={24} aria-hidden="true" />
            </span>
            <div>
              <strong>
                HOREB <span>360</span>
              </strong>
              <small>Gestión de lavandería</small>
            </div>
          </div>

          <div className="auth-hero-copy">
            <h2>Control claro de mostrador, encargos y corte de caja.</h2>
            <p>
              Opera Lomas, Treviño y Sucursal 3 desde un mismo panel en línea con seguimiento por
              etapas, ticket térmico y cierre por turno.
            </p>
            <ul className="auth-pillars">
              <li>
                <CheckCircle2 size={17} aria-hidden="true" />
                <span>Autoservicio y encargos con cobro mixto y cambio exacto</span>
              </li>
              <li>
                <CheckCircle2 size={17} aria-hidden="true" />
                <span>Comprobantes térmicos 80 mm / 58 mm con código de barras</span>
              </li>
              <li>
                <CheckCircle2 size={17} aria-hidden="true" />
                <span>Cortes de turno auditables y reportes consolidados en vivo</span>
              </li>
            </ul>
          </div>

          <div className="auth-showcase-foot">
            <Lock size={14} aria-hidden="true" />
            <span>Acceso protegido por sucursal y rol</span>
          </div>
        </div>
      </section>

      <section className="auth-panel" aria-label="Iniciar sesión">
        <div className="auth-form-wrap">
          <div className="auth-panel-header">
            <div className="auth-mobile-brand">
              <span className="brand-mark">
                <WashingMachine size={22} aria-hidden="true" />
              </span>
              <strong>HOREB 360</strong>
            </div>
            <h1>Iniciar sesión</h1>
            <p>Ingresa con tu cuenta de sucursal para continuar.</p>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          {!session && session !== undefined && (
            <>
              <form className="auth-form" onSubmit={signIn}>
                <label className="field">
                  Correo electrónico
                  <input
                    name="email"
                    className="input"
                    type="email"
                    autoComplete="username"
                    placeholder="nombre@horeb.mx"
                    required
                  />
                </label>

                <div className="field">
                  <label htmlFor="login-password">Contraseña</label>
                  <div className="password-input-wrap">
                    <input
                      id="login-password"
                      name="password"
                      className="input"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                      onClick={() => setShowPassword((prev) => !prev)}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                  {loading ? 'Entrando…' : 'Entrar al panel'}
                </button>
              </form>

              <div className="quick-login-box">
                <div className="quick-login-title">Acceso rápido</div>
                <div className="quick-login-grid">
                  {QUICK_ACCOUNTS.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      className="quick-login-btn"
                      disabled={loading}
                      onClick={() => void signInWithCredentials(account.email, account.password)}
                    >
                      <span className="quick-login-head">
                        {account.role === 'supervisor' ? (
                          <ShieldCheck size={16} aria-hidden="true" />
                        ) : (
                          <UserCheck size={16} aria-hidden="true" />
                        )}
                        <strong>{account.label}</strong>
                      </span>
                      <small>{account.subtitle}</small>
                      <span className="quick-login-email">{account.email}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {session === undefined && <p role="status">Comprobando sesión…</p>}
          {session && !rows && !error && <p role="status">Cargando tus sucursales…</p>}
          {session && rows?.length === 0 && <p>Tu cuenta aún no tiene una sucursal asignada.</p>}
          {session && (
            <div className="order-actions">
              <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
                Actualizar
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
