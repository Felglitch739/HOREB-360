import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, FunctionsHttpError, type Session } from '@supabase/supabase-js';
import { Eye, EyeOff, WashingMachine } from 'lucide-react';
import { App } from './App';
import type { Operation } from './domain/operations';
import {
  combineBranches,
  mapDbCustomer,
  mapDbLoyaltyEvent,
  mapDbNightClosing,
  mapDbRaffleDraw,
  mapDbRaffleTicket,
  type BranchRole,
  type BranchRow,
  type DbCustomerRow,
  type DbLoyaltyEventRow,
  type DbNightClosingRow,
  type DbRaffleDrawRow,
  type DbRaffleTicketRow,
  type GlobalRecordsBundle,
} from './domain/sharedState';
import type { BranchId, Customer, Order } from './domain/types';
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
  customer?: Customer;
  global?: GlobalRecordsBundle;
  error?: string;
}

export interface SharedWorkspace {
  state: ReturnType<typeof combineBranches>;
  roles: Partial<Record<BranchId, BranchRole>>;
  execute: (
    branch: BranchId,
    operation: Operation,
  ) => Promise<{ ok: boolean; error?: string; order?: Order; customer?: Customer }>;
  reload: () => Promise<void>;
  signOut: () => void;
}

export function Root() {
  const { theme, setTheme } = useBrandTheme();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [rows, setRows] = useState<BranchRow[] | null>(null);
  const [globalRecords, setGlobalRecords] = useState<GlobalRecordsBundle>({});
  const [errorKind, setErrorKind] = useState<'none' | 'credentials' | 'offline' | 'no-branch'>('none');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const interacting = useRef(false);

  useEffect(() => {
    const onOffline = () => {
      setErrorKind('offline');
      setError('Sin conexión con el servidor. Revisa tu conexión a internet e intenta de nuevo.');
    };
    const onOnline = () => {
      setErrorKind((prev) => (prev === 'offline' ? 'none' : prev));
      setError((prev) => (prev.startsWith('Sin conexión') ? '' : prev));
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    if (!session?.user.id) return;
    const [access, data, custRes, loyaltyRes, ticketsRes, drawsRes, ncRes] = await Promise.all([
      client.from('horeb_memberships').select('branch_id,role'),
      client.from('horeb_branch_state').select('branch_id,version,updated_at,state').order('branch_id'),
      client.from('horeb_customers').select('*').order('name'),
      client.from('horeb_loyalty_events').select('*').order('created_at', { ascending: false }).limit(400),
      client.from('horeb_raffle_tickets').select('*').order('issued_at', { ascending: false }),
      client.from('horeb_raffle_draws').select('*').order('drawn_at', { ascending: false }),
      client.from('horeb_night_closings').select('*').order('closing_date', { ascending: false }),
    ]);
    if (access.error || data.error) {
      setErrorKind('offline');
      setError('Sin conexión con el servidor. Revisa tu internet y vuelve a intentar.');
      return;
    }
    setError('');
    setMemberships(access.data as Membership[]);
    if ((access.data as Membership[]).length === 0) {
      setErrorKind('no-branch');
    } else {
      setErrorKind('none');
    }
    setRows((prior) =>
      (data.data as BranchRow[]).map((fresh) => {
        const current = prior?.find((row) => row.branch_id === fresh.branch_id);
        return current && current.version > fresh.version ? current : fresh;
      }),
    );
    setGlobalRecords({
      customers: custRes.data ? (custRes.data as DbCustomerRow[]).map(mapDbCustomer) : [],
      loyaltyEvents: loyaltyRes.data ? (loyaltyRes.data as DbLoyaltyEventRow[]).map(mapDbLoyaltyEvent) : [],
      raffleTickets: ticketsRes.data ? (ticketsRes.data as DbRaffleTicketRow[]).map(mapDbRaffleTicket) : [],
      raffleDraws: drawsRes.data ? (drawsRes.data as DbRaffleDrawRow[]).map(mapDbRaffleDraw) : [],
      nightClosings: ncRes.data ? (ncRes.data as DbNightClosingRow[]).map(mapDbNightClosing) : [],
    });
  }, [session?.user.id]);

  useEffect(() => {
    setRows(null);
    setMemberships([]);
    setGlobalRecords({});
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
      if (response.data.global) {
        setGlobalRecords(response.data.global);
      }
      const order =
        response.data.order ??
        (operation.action === 'create'
          ? response.data.row.state.orders?.find(
              (item) => item.folio === operation.input.folio?.trim().toUpperCase(),
            )
          : undefined);
      return { ok: true, order, customer: response.data.customer };
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
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setErrorKind('offline');
      setError('Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.');
      return;
    }
    setLoading(true);
    setError('');
    setErrorKind('none');
    try {
      const { error: authError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        const msg = authError.message.toLowerCase();
        if (msg.includes('fetch') || msg.includes('network') || authError.status === 0) {
          setErrorKind('offline');
          setError('Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.');
        } else {
          setErrorKind('credentials');
          setError('Correo o contraseña incorrectos. Verifica tus datos o contacta a tu supervisor.');
        }
      }
    } catch {
      setErrorKind('offline');
      setError('Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.');
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

  if (session && rows?.length && memberships.length > 0) {
    const roles = Object.fromEntries(memberships.map((entry) => [entry.branch_id, entry.role]));
    return (
      <App
        shared={{ state: combineBranches(rows, globalRecords), roles, execute, reload, signOut: () => void signOut() }}
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
          <div className="auth-brand auth-showcase-badge">
            <span className="brand-mark">
              <WashingMachine size={24} aria-hidden="true" />
            </span>
            <div>
              <strong>
                HOREB <span>360</span>
              </strong>
              <small>Panel de operación de Lavandería Horeb</small>
            </div>
          </div>
        </div>
      </section>

      <section className="auth-panel" aria-label="Inicia sesión">
        <div className="auth-form-wrap">
          <div className="auth-panel-header">
            <div className="auth-mobile-brand">
              <span className="brand-mark">
                <WashingMachine size={22} aria-hidden="true" />
              </span>
              <strong>HOREB 360</strong>
            </div>
            <h1>Inicia sesión</h1>
            <p>Panel de operación de Lavandería Horeb</p>
          </div>

          {error && (
            <div className="alert alert-error" role="alert" data-error-kind={errorKind}>
              {error}
            </div>
          )}

          {!session && session !== undefined && (
            <>
              <form className="auth-form" onSubmit={signIn}>
                <label className="field">
                  Correo
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
                  {loading ? 'Validando…' : 'Entrar'}
                </button>
              </form>
              <p className="auth-help-text">¿Problemas para entrar? Contacta a tu supervisor</p>
            </>
          )}

          {session === undefined && <p role="status">Comprobando sesión…</p>}
          {session && !rows && !error && <p role="status">Cargando tus sucursales…</p>}
          {session && rows && (rows.length === 0 || memberships.length === 0) && (
            <div className="alert alert-error" role="alert" data-error-kind="no-branch">
              Tu cuenta aún no tiene una sucursal asignada. Contacta a tu supervisor para habilitar tu acceso.
            </div>
          )}
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
