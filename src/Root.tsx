import { Suspense, lazy, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { createClient, FunctionsHttpError, type Session } from '@supabase/supabase-js';
import { Eye, EyeOff, WashingMachine } from 'lucide-react';
import type { Operation } from './domain/operations';
import {
  enqueueOfflineOperation,
  flushOfflineQueue,
  readOfflineQueue,
  readOfflineSnapshot,
  replayOfflineQueue,
  writeOfflineQueue,
  writeOfflineSnapshot,
  type QueuedOperation,
  type RemoteInvokeOutcome,
} from './domain/offlineQueue';
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

const App = lazy(() => import('./App').then((module) => ({ default: module.App })));

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
  isOnline: boolean;
  pendingSyncCount: number;
  syncing: boolean;
  syncWarning?: string;
  execute: (
    branch: BranchId,
    operation: Operation,
  ) => Promise<{ ok: boolean; error?: string; order?: Order; customer?: Customer }>;
  reload: () => Promise<'updated' | 'partial' | 'unavailable'>;
  syncNow: () => Promise<void>;
  signOut: () => void;
}

export function Root() {
  const { theme, setTheme } = useBrandTheme();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [rows, setRows] = useState<BranchRow[] | null>(null);
  const [globalRecords, setGlobalRecords] = useState<GlobalRecordsBundle>({});
  const [pendingQueue, setPendingQueue] = useState<QueuedOperation[]>([]);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [syncing, setSyncing] = useState(false);
  const [syncWarning, setSyncWarning] = useState('');
  const [errorKind, setErrorKind] = useState<'none' | 'credentials' | 'offline' | 'no-branch'>('none');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const interacting = useRef(false);
  const syncingRef = useRef(false);

  const persistSnapshot = useCallback(
    (
      userId: string,
      nextMemberships: Membership[],
      nextRows: BranchRow[],
      nextGlobal: GlobalRecordsBundle,
    ) => {
      writeOfflineSnapshot({
        userId,
        cachedAt: new Date().toISOString(),
        memberships: nextMemberships,
        rows: nextRows,
        globalRecords: nextGlobal,
      });
    },
    [],
  );

  useEffect(() => {
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  const fetchRemoteState = useCallback(async () => {
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
      return null;
    }
    const nextMemberships = access.data as Membership[];
    const nextRows = data.data as BranchRow[];
    const nextGlobal: GlobalRecordsBundle = {};
    if (custRes.data) nextGlobal.customers = (custRes.data as DbCustomerRow[]).map(mapDbCustomer);
    if (loyaltyRes.data) nextGlobal.loyaltyEvents = (loyaltyRes.data as DbLoyaltyEventRow[]).map(mapDbLoyaltyEvent);
    if (ticketsRes.data) nextGlobal.raffleTickets = (ticketsRes.data as DbRaffleTicketRow[]).map(mapDbRaffleTicket);
    if (drawsRes.data) nextGlobal.raffleDraws = (drawsRes.data as DbRaffleDrawRow[]).map(mapDbRaffleDraw);
    if (ncRes.data) nextGlobal.nightClosings = (ncRes.data as DbNightClosingRow[]).map(mapDbNightClosing);
    const complete = [custRes, loyaltyRes, ticketsRes, drawsRes, ncRes].every((result) => result.data !== null);
    return { memberships: nextMemberships, rows: nextRows, globalRecords: nextGlobal, complete };
  }, []);

  const reload = useCallback<SharedWorkspace['reload']>(async () => {
    const userId = session?.user.id;
    if (!userId) return 'unavailable';
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      return 'unavailable';
    }
    try {
      const fresh = await fetchRemoteState();
      if (!fresh) {
        setIsOnline(false);
        const cached = readOfflineSnapshot(userId);
        if (!cached) {
          setErrorKind('offline');
          setError('Sin conexión con el servidor. Revisa tu internet y vuelve a intentar.');
        }
        return 'unavailable';
      }
      setIsOnline(true);
      setError('');
      setMemberships(fresh.memberships);
      if (fresh.memberships.length === 0) {
        setErrorKind('no-branch');
      } else {
        setErrorKind('none');
      }
      setRows((prior) =>
        fresh.rows.map((freshRow) => {
          const current = prior?.find((row) => row.branch_id === freshRow.branch_id);
          return current && current.version > freshRow.version ? current : freshRow;
        }),
      );
      setGlobalRecords((prior) => ({ ...prior, ...fresh.globalRecords }));
      const cachedGlobal = fresh.complete ? undefined : readOfflineSnapshot(userId)?.globalRecords;
      persistSnapshot(userId, fresh.memberships, fresh.rows, { ...cachedGlobal, ...fresh.globalRecords });
      return fresh.complete ? 'updated' : 'partial';
    } catch {
      setIsOnline(false);
      if (!readOfflineSnapshot(userId)) {
        setErrorKind('offline');
        setError('Sin conexión con el servidor. Revisa tu internet y vuelve a intentar.');
      }
      return 'unavailable';
    }
  }, [fetchRemoteState, persistSnapshot, session?.user.id]);

  const invokeSingleRemote = useCallback(
    async (
      branch: BranchId,
      version: number,
      operationId: string,
      operation: Operation,
    ): Promise<RemoteInvokeOutcome> => {
      const body = { branch, version, operationId, operation };
      try {
        let response = await client.functions.invoke<OperationResponse>('horeb-operation', { body });
        if (response.error && !(response.error instanceof FunctionsHttpError)) {
          response = await client.functions.invoke<OperationResponse>('horeb-operation', { body });
        }
        if (response.error instanceof FunctionsHttpError) {
          const context = response.error.context as Response;
          const message = (await context.json().catch(() => ({}))) as OperationResponse;
          if (context.status === 409) {
            return {
              status: 'conflict',
              row: message.row,
              error: message.error ?? 'La sucursal cambió en otro equipo.',
            };
          }
          return {
            status: 'rejected',
            error: message.error ?? 'No se pudo completar la operación en Supabase.',
          };
        }
        if (response.error || !response.data?.row) {
          return {
            status: 'network_error',
            error: 'Sin conexión estable con Supabase.',
          };
        }
        return {
          status: 'ok',
          row: response.data.row,
          order: response.data.order,
          customer: response.data.customer,
          global: response.data.global,
        };
      } catch {
        return {
          status: 'network_error',
          error: 'Sin conexión con el servidor.',
        };
      }
    },
    [],
  );

  const syncNow = useCallback(async () => {
    const userId = session?.user.id;
    if (!userId || !rows?.length || syncingRef.current || interacting.current) return;
    const queue = readOfflineQueue(userId);
    if (queue.length === 0) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      return;
    }

    syncingRef.current = true;
    setSyncing(true);
    try {
      const flushed = await flushOfflineQueue({
        queue,
        baseRows: rows,
        baseGlobal: globalRecords,
        invokeRemote: invokeSingleRemote,
        reloadRemote: async () => {
          const fresh = await fetchRemoteState();
          return fresh ? { rows: fresh.rows, globalRecords: { ...globalRecords, ...fresh.globalRecords } } : null;
        },
      });
      writeOfflineQueue(userId, flushed.queue);
      setPendingQueue(flushed.queue);
      setRows(flushed.rows);
      setGlobalRecords(flushed.globalRecords);
      persistSnapshot(userId, memberships, flushed.rows, flushed.globalRecords);

      if (flushed.stoppedOffline) {
        setIsOnline(false);
      } else {
        setIsOnline(true);
      }

      if (flushed.rejected.length > 0) {
        setSyncWarning(
          `${flushed.rejected.length} operación(es) local(es) no pudo(ieron) aplicarse al reconectar: ${flushed.rejected[0].error}`,
        );
      } else if (flushed.syncedCount > 0) {
        setSyncWarning('');
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [fetchRemoteState, globalRecords, invokeSingleRemote, memberships, persistSnapshot, rows, session?.user.id]);

  useEffect(() => {
    const onOffline = () => {
      setIsOnline(false);
      if (!rows?.length) {
        setErrorKind('offline');
        setError('Sin conexión con el servidor. Revisa tu conexión a internet e intenta de nuevo.');
      }
    };
    const onOnline = () => {
      setIsOnline(true);
      setErrorKind((prev) => (prev === 'offline' ? 'none' : prev));
      setError((prev) => (prev.startsWith('Sin conexión') ? '' : prev));
      void syncNow().then(() => reload());
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [reload, rows?.length, syncNow]);

  const refreshWorkspace = useEffectEvent((userId: string) => {
    if (interacting.current || syncingRef.current) return;
    if (readOfflineQueue(userId).length > 0) {
      void syncNow();
    } else {
      void reload();
    }
  });

  useEffect(() => {
    setRows(null);
    setMemberships([]);
    setGlobalRecords({});
    setPendingQueue([]);
    setSyncWarning('');
    const userId = session?.user.id;
    if (!userId) return;

    const cachedQueue = readOfflineQueue(userId);
    setPendingQueue(cachedQueue);

    const cachedSnapshot = readOfflineSnapshot(userId);
    if (cachedSnapshot && cachedSnapshot.rows.length > 0 && cachedSnapshot.memberships.length > 0) {
      setMemberships(cachedSnapshot.memberships);
      setRows(cachedSnapshot.rows);
      setGlobalRecords(cachedSnapshot.globalRecords);
      setErrorKind('none');
      setError('');
    }

    void reload();
    const interval = window.setInterval(() => refreshWorkspace(userId), 8000);
    return () => window.clearInterval(interval);
  }, [reload, session?.user.id]);

  function merge(row: BranchRow) {
    setRows((prior) => {
      const next =
        prior?.map((item) =>
          item.branch_id === row.branch_id && item.version <= row.version ? row : item,
        ) ?? null;
      if (next && session?.user.id) {
        persistSnapshot(session.user.id, memberships, next, globalRecords);
      }
      return next;
    });
  }

  function runLocallyOffline(branch: BranchId, operation: Operation, operationId: string) {
    const userId = session?.user.id;
    if (!userId || !rows?.length) {
      return { ok: false, error: 'Sin caché local disponible para operar sin internet.' };
    }
    const rolesMap = Object.fromEntries(memberships.map((entry) => [entry.branch_id, entry.role]));
    const actorLabel = session.user.email ?? userId;
    const queued = enqueueOfflineOperation({
      baseRows: rows,
      baseGlobal: globalRecords,
      queue: pendingQueue,
      roles: rolesMap,
      branchId: branch,
      operation,
      operationId,
      actorLabel,
    });
    if (!queued.ok) return queued;
    writeOfflineQueue(userId, queued.nextQueue);
    setPendingQueue(queued.nextQueue);
    return { ok: true, order: queued.order, customer: queued.customer };
  }

  async function execute(branch: BranchId, operation: Operation) {
    const base = rows?.find((row) => row.branch_id === branch);
    if (!base) return { ok: false, error: 'Esta sucursal no está disponible para tu cuenta.' };
    if (interacting.current) return { ok: false, error: 'Espera a que termine la operación anterior.' };
    interacting.current = true;
    try {
      const operationId = crypto.randomUUID();
      const browserOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (browserOffline || !isOnline || pendingQueue.length > 0) {
        return runLocallyOffline(branch, operation, operationId);
      }

      const outcome = await invokeSingleRemote(branch, base.version, operationId, operation);
      if (outcome.status === 'network_error') {
        setIsOnline(false);
        return runLocallyOffline(branch, operation, operationId);
      }
      if (outcome.status === 'conflict') {
        if (outcome.row) merge(outcome.row);
        else await reload();
        return { ok: false, error: outcome.error };
      }
      if (outcome.status === 'rejected') {
        return { ok: false, error: outcome.error };
      }

      const nextGlobal = outcome.global ?? globalRecords;
      if (outcome.global) {
        setGlobalRecords(outcome.global);
      }
      setRows((prior) => {
        const nextRows =
          prior?.map((item) =>
            item.branch_id === outcome.row.branch_id && item.version <= outcome.row.version
              ? outcome.row
              : item,
          ) ?? null;
        if (nextRows && session?.user.id) {
          persistSnapshot(session.user.id, memberships, nextRows, nextGlobal);
        }
        return nextRows;
      });
      const order =
        outcome.order ??
        (operation.action === 'create'
          ? outcome.row.state.orders?.find(
              (item) => item.folio === operation.input.folio?.trim().toUpperCase(),
            )
          : undefined);
      return { ok: true, order, customer: outcome.customer };
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
    const roles: Partial<Record<BranchId, BranchRole>> = Object.fromEntries(
      memberships.map((entry) => [entry.branch_id, entry.role]),
    );
    const effective =
      pendingQueue.length > 0
        ? replayOfflineQueue(
            rows,
            globalRecords,
            pendingQueue,
            roles,
            session.user.email ?? session.user.id,
          )
        : { combinedState: combineBranches(rows, globalRecords) };

    return (
      <Suspense fallback={<main className="auth-panel"><p role="status">Cargando panel…</p></main>}>
        <App
          shared={{
            state: effective.combinedState,
            roles,
            isOnline,
            pendingSyncCount: pendingQueue.length,
            syncing,
            syncWarning: syncWarning || undefined,
            execute,
            reload,
            syncNow,
            signOut: () => void signOut(),
          }}
          sharedNotice={error}
          theme={theme}
          onSetTheme={setTheme}
        />
      </Suspense>
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
