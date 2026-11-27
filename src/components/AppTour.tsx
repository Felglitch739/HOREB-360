import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Compass,
  MoveVertical,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  WALKTHROUGH_FLOWS,
  type AdminTourTabId,
  type GuidedAction,
  type TourTabId,
} from '../domain/sandboxManual';
import type { BranchId, DemoState } from '../domain/types';
import './AppTour.css';
import { useModalFocus } from './useModalFocus';

export type { TourTabId };

interface AppTourProps {
  mode?: 'pos' | 'admin';
  branchId: BranchId;
  initialFlowId?: string | null;
  onClearInitialFlow?: () => void;
  onSwitchModeAndLaunch?: (flowId: string) => void;
  isPracticeMode?: boolean;
  onStartPractice?: () => void;
  onExitPractice?: () => void;
  onResetPractice?: () => void;
  onSimulateStep?: (updater: (prev: DemoState) => DemoState) => void;
  onNavigate: (tab: TourTabId) => void;
  onNavigateAdmin?: (tab: AdminTourTabId) => void;
  onClose: () => void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function waitForElement(selector: string, signal: AbortSignal, timeoutMs = 2000): Promise<HTMLElement | null> {
  const start = performance.now();
  while (!signal.aborted && performance.now() - start < timeoutMs) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && el.getClientRects().length > 0) return el;
    await sleep(60, signal);
  }
  return null;
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function AppTour({
  mode = 'pos',
  branchId,
  initialFlowId = null,
  onClearInitialFlow,
  onSwitchModeAndLaunch,
  isPracticeMode = false,
  onStartPractice,
  onExitPractice,
  onResetPractice,
  onSimulateStep,
  onNavigate,
  onNavigateAdmin,
  onClose,
}: AppTourProps) {
  const [activeFlowId, setActiveFlowId] = useState<string | null>(initialFlowId);
  const [stepIndex, setStepIndex] = useState(0);
  const [dockTop, setDockTop] = useState(false);
  const [simulatedKey, setSimulatedKey] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [liveCaption, setLiveCaption] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<React.CSSProperties>();

  const dialogRef = useModalFocus(activeFlowId === null, onClose);
  const navigatePos = useEffectEvent(onNavigate);
  const navigateAdmin = useEffectEvent((tab: AdminTourTabId) => onNavigateAdmin?.(tab));
  const ensurePractice = useEffectEvent(() => onStartPractice?.());
  const clearInitial = useEffectEvent(() => onClearInitialFlow?.());
  const actionAbortRef = useRef<AbortController | null>(null);
  const activeElementRef = useRef<HTMLElement | null>(null);

  const activeFlow = WALKTHROUGH_FLOWS.find((f) => f.id === activeFlowId) ?? null;
  const step = activeFlow ? activeFlow.steps[stepIndex] : null;
  const isLast = activeFlow ? stepIndex === activeFlow.steps.length - 1 : false;

  useEffect(() => {
    if (initialFlowId) {
      ensurePractice();
      setActiveFlowId(initialFlowId);
      setStepIndex(0);
      setSimulatedKey(null);
      clearInitial();
    }
  }, [initialFlowId]);

  function clearFlashElement() {
    if (activeElementRef.current) {
      activeElementRef.current.classList.remove('tour-action-flash');
      activeElementRef.current = null;
    }
  }

  function highlightElement(el: HTMLElement | null) {
    clearFlashElement();
    if (!el) return;
    activeElementRef.current = el;
    el.classList.add('tour-action-flash');
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    const box = el.getBoundingClientRect();
    const top = Math.max(4, box.top - 5);
    const left = Math.max(4, box.left - 5);
    const right = Math.min(document.documentElement.clientWidth - 4, box.right + 5);
    const bottom = Math.min(window.innerHeight - 4, box.bottom + 5);
    if (right > left && bottom > top) {
      setHighlight({ top, left, width: right - left, height: bottom - top });
    }
  }

  useEffect(() => {
    // Cancel any running animation cleanly on step or flow change
    actionAbortRef.current?.abort();
    clearFlashElement();
    setActing(false);
    setLiveCaption(null);

    if (!activeFlow || !step) {
      setHighlight(undefined);
      return;
    }

    ensurePractice();
    setHighlight(undefined);
    setSimulatedKey(null);

    if (mode === 'admin' && onNavigateAdmin) {
      navigateAdmin(step.adminTab ?? 'resumen');
    } else {
      navigatePos(step.tab);
    }

    const expectedTabValue = mode === 'admin' ? (step.adminTab ?? 'resumen') : step.tab;
    const selectorToUse = mode === 'admin' && step.adminSelector ? step.adminSelector : step.selector;
    let target: HTMLElement | null = null;
    let frame = 0;

    function measure() {
      const targetEl = activeElementRef.current ?? target;
      if (!targetEl || !targetEl.getClientRects().length) return;
      const box = targetEl.getBoundingClientRect();
      const top = Math.max(4, box.top - 5);
      const left = Math.max(4, box.left - 5);
      const right = Math.min(document.documentElement.clientWidth - 4, box.right + 5);
      const bottom = Math.min(window.innerHeight - 4, box.bottom + 5);
      setHighlight(
        right > left && bottom > top
          ? { top, left, width: right - left, height: bottom - top }
          : undefined,
      );
    }

    function scheduleMeasure() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }

    function findTarget() {
      const currentTab = document.querySelector<HTMLElement>('.main-content')?.dataset.workspaceTab;
      if (currentTab !== expectedTabValue) return;
      const candidate = document.querySelector<HTMLElement>(selectorToUse);
      if (!candidate?.getClientRects().length) return;
      target = candidate;
      observer.disconnect();
      const box = candidate.getBoundingClientRect();
      if (box.top < 8 || box.bottom > window.innerHeight * 0.65) {
        window.scrollBy({ top: box.top - 84, behavior: 'instant' });
      }
      measure();
    }

    const observer = new MutationObserver(findTarget);
    const workspace = document.querySelector('.workspace');
    if (workspace) {
      observer.observe(workspace, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-workspace-tab', 'style'],
      });
    }
    frame = requestAnimationFrame(findTarget);
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', scheduleMeasure, true);
    return () => {
      actionAbortRef.current?.abort();
      clearFlashElement();
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', scheduleMeasure, true);
    };
  }, [activeFlow?.id, stepIndex, mode]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        actionAbortRef.current?.abort();
        clearFlashElement();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function startFlow(flowId: string) {
    const flow = WALKTHROUGH_FLOWS.find((f) => f.id === flowId);
    if (!flow) return;

    // Auto-switch between Portal de Dirección and Mostrador POS when needed
    const needsPos = flow.scope === 'pos' && mode === 'admin';
    const needsAdmin = flow.scope === 'admin' && mode === 'pos';
    if ((needsPos || needsAdmin) && onSwitchModeAndLaunch) {
      onSwitchModeAndLaunch(flowId);
      return;
    }

    onStartPractice?.();
    setActiveFlowId(flowId);
    setStepIndex(0);
    setSimulatedKey(null);
  }

  async function runDemoActions(actions: GuidedAction[], stepKey: string) {
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    const { signal } = controller;

    setActing(true);
    setLiveCaption('Iniciando demostración paso a paso...');

    try {
      for (const action of actions) {
        if (signal.aborted) return;

        if (action.type === 'pause') {
          if (action.caption) setLiveCaption(action.caption);
          await sleep(action.ms, signal);
          continue;
        }

        if (action.type === 'click') {
          if (action.onlyIfMissingSelector && document.querySelector(action.onlyIfMissingSelector)) {
            continue;
          }
          setLiveCaption(action.caption);
          const el = await waitForElement(action.selector, signal);
          if (!el || signal.aborted) continue;
          highlightElement(el);
          await sleep(action.delayMs ?? 380, signal);
          if (signal.aborted) return;
          el.click();
          await sleep(260, signal);
          continue;
        }

        if (action.type === 'type') {
          setLiveCaption(action.caption);
          const el = await waitForElement(action.selector, signal);
          if (!el || !(el instanceof HTMLInputElement) || signal.aborted) continue;
          highlightElement(el);
          el.focus();
          setNativeInputValue(el, '');
          await sleep(160, signal);
          const perChar = action.charDelayMs ?? Math.max(28, Math.min(55, Math.round(900 / Math.max(1, action.text.length))));
          for (let idx = 1; idx <= action.text.length; idx += 1) {
            if (signal.aborted) return;
            setNativeInputValue(el, action.text.slice(0, idx));
            await sleep(perChar, signal);
          }
          await sleep(220, signal);
          continue;
        }

        if (action.type === 'check') {
          setLiveCaption(action.caption);
          const el = await waitForElement(action.selector, signal);
          if (!el || !(el instanceof HTMLInputElement) || signal.aborted) continue;
          highlightElement(el);
          await sleep(action.delayMs ?? 320, signal);
          if (signal.aborted) return;
          if (el.checked !== action.checked) {
            el.click();
          }
          await sleep(260, signal);
        }
      }

      if (!signal.aborted) {
        setSimulatedKey(stepKey);
        setLiveCaption('¡Demostración completada en pantalla!');
        await sleep(900, signal);
      }
    } finally {
      if (!signal.aborted) {
        setActing(false);
        clearFlashElement();
      }
    }
  }

  function handleSimulate() {
    if (!step) return;
    const stepKey = `${activeFlowId}:${stepIndex}`;
    if (step.demoActions && step.demoActions.length > 0) {
      onStartPractice?.();
      void runDemoActions(step.demoActions, stepKey);
      return;
    }
    if (!step.simulate || !onSimulateStep) return;
    onStartPractice?.();
    onSimulateStep((prev) => step.simulate!(prev, branchId));
    setSimulatedKey(stepKey);
  }

  // ================= CATALOG VIEW (MENU DE FLUJOS) =================
  if (!activeFlow || !step) {
    const generalFlow =
      WALKTHROUGH_FLOWS.find((f) => f.featured && f.scope === mode) ??
      WALKTHROUGH_FLOWS.find((f) => f.featured);
    const sameViewFlows = WALKTHROUGH_FLOWS.filter(
      (f) => !f.featured && (f.scope === mode || f.scope === 'both'),
    );
    const otherViewFlows = WALKTHROUGH_FLOWS.filter(
      (f) => f.scope !== mode && f.scope !== 'both',
    );
    const currentViewLabel = mode === 'admin' ? 'Portal de Dirección' : 'Mostrador POS';
    const otherViewLabel = mode === 'admin' ? 'Mostrador (Empleado)' : 'Portal de Dirección';

    return (
      <div
        ref={dialogRef}
        className="app-tour-catalog-backdrop"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="Manual interactivo y guías de práctica"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="app-tour-catalog-card">
          <div className="app-tour-head">
            <span>
              <BookOpen size={18} aria-hidden="true" /> Manual Interactivo · HOREB 360
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm app-tour-close"
              onClick={onClose}
              aria-label="Cerrar manual"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="app-tour-sandbox-notice">
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <strong>Modo Práctica Seguro</strong>
              <p>
                Usa datos de demostración sin tocar tu base real. Si eliges un flujo de otra vista, la plataforma cambia automáticamente para enseñártelo en vivo.
              </p>
            </div>
          </div>

          {generalFlow && (
            <div className="app-tour-section-block">
              <span className="app-tour-section-label">1. Empieza aquí · Vista general</span>
              <button
                type="button"
                className="app-tour-featured-btn"
                onClick={() => startFlow(generalFlow.id)}
              >
                <div className="app-tour-featured-copy">
                  <div className="app-tour-flow-top">
                    <span className="app-tour-flow-badge">{generalFlow.badge}</span>
                    <span>{generalFlow.durationLabel}</span>
                  </div>
                  <strong>{generalFlow.title}</strong>
                  <p>{generalFlow.subtitle}</p>
                </div>
                <span className="btn btn-primary btn-sm" style={{ flex: 'none' }}>
                  <Play size={14} aria-hidden="true" /> Ver tour
                </span>
              </button>
            </div>
          )}

          <div className="app-tour-section-block">
            <span className="app-tour-section-label">2. Guías prácticas en {currentViewLabel}</span>
            <div className="app-tour-flow-grid">
              {sameViewFlows.map((flow) => (
                <button
                  key={flow.id}
                  type="button"
                  className="app-tour-flow-btn"
                  onClick={() => startFlow(flow.id)}
                >
                  <div className="app-tour-flow-top">
                    <span className="app-tour-flow-badge">{flow.badge}</span>
                    <span>{flow.durationLabel}</span>
                  </div>
                  <strong>{flow.title}</strong>
                  <p>{flow.subtitle}</p>
                  <span className="app-tour-flow-cta">
                    Iniciar guía <ChevronRight size={15} aria-hidden="true" />
                  </span>
                </button>
              ))}
            </div>
          </div>

          {otherViewFlows.length > 0 && (
            <div className="app-tour-section-block">
              <span className="app-tour-section-label">
                3. Guías de {otherViewLabel} {onSwitchModeAndLaunch ? '(cambia automático)' : ''}
              </span>
              <div className="app-tour-flow-grid">
                {otherViewFlows.map((flow) => (
                  <button
                    key={flow.id}
                    type="button"
                    className="app-tour-flow-btn"
                    onClick={() => startFlow(flow.id)}
                  >
                    <div className="app-tour-flow-top">
                      <span className="app-tour-flow-badge">{flow.badge}</span>
                      <span>{flow.durationLabel}</span>
                    </div>
                    <strong>{flow.title}</strong>
                    <p>{flow.subtitle}</p>
                    <span className="app-tour-flow-cta">
                      {onSwitchModeAndLaunch ? `Abrir en ${otherViewLabel}` : 'Iniciar guía'}{' '}
                      <ChevronRight size={15} aria-hidden="true" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="app-tour-catalog-footer">
            {isPracticeMode ? (
              <div className="order-actions">
                {onResetPractice && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={onResetPractice}
                  >
                    <RotateCcw size={14} aria-hidden="true" /> Reiniciar demo
                  </button>
                )}
                {onExitPractice && (
                  <button
                    type="button"
                    className="btn btn-warning btn-sm"
                    onClick={() => {
                      onExitPractice();
                      onClose();
                    }}
                  >
                    Salir a datos reales
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  onStartPractice?.();
                  onClose();
                }}
              >
                <Sparkles size={14} aria-hidden="true" /> Modo Práctica libre
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ================= ACTIVE NON-BLOCKING GUIDED VIEW =================
  const stepSimKey = `${activeFlowId}:${stepIndex}`;
  const isSimulated = simulatedKey === stepSimKey;
  const hasSim = Boolean((step.demoActions && step.demoActions.length > 0) || (step.simulate && onSimulateStep));

  return (
    <div
      className={`app-tour-overlay non-blocking${dockTop ? ' dock-top' : ''}`}
      role="region"
      aria-label={`Guía interactiva: ${activeFlow.title}`}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' && !isLast) {
          setStepIndex((index) => Math.min(index + 1, activeFlow.steps.length - 1));
        }
        if (event.key === 'ArrowLeft' && stepIndex > 0) {
          setStepIndex((index) => Math.max(index - 1, 0));
        }
      }}
    >
      {highlight && (
        <div
          className={`app-tour-spotlight${acting ? ' is-acting' : ''}`}
          style={highlight}
          aria-hidden="true"
        />
      )}

      <div className="app-tour-card">
        <div className="app-tour-head">
          <span>
            <Compass size={16} aria-hidden="true" /> {activeFlow.badge}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ minHeight: 32, padding: '4px 8px', fontSize: '0.75rem' }}
              title={dockTop ? 'Mover guía abajo' : 'Mover guía arriba'}
              onClick={() => setDockTop((prev) => !prev)}
            >
              <MoveVertical size={13} aria-hidden="true" />
              {dockTop ? 'Abajo' : 'Arriba'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm app-tour-close"
              onClick={() => {
                actionAbortRef.current?.abort();
                clearFlashElement();
                onClose();
              }}
              aria-label="Cerrar guía"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="app-tour-flow-crumb">
          <button
            type="button"
            className="ticket-fallback-link"
            style={{ padding: 0, textAlign: 'left', fontSize: '0.8rem' }}
            onClick={() => {
              actionAbortRef.current?.abort();
              clearFlashElement();
              setActiveFlowId(null);
            }}
          >
            ← Todos los flujos
          </button>
          <span className="badge badge-info" style={{ fontSize: '0.72rem' }}>Modo práctica</span>
        </div>

        <div className="app-tour-copy" aria-live="polite" aria-atomic="true">
          <h2>{step.title}</h2>
          <p>{step.description}</p>
          {step.tip && (
            <div className="app-tour-tip">
              <strong>Tip:</strong> {step.tip}
            </div>
          )}
        </div>

        {liveCaption && (
          <div className="app-tour-live-caption" role="status">
            <span className="app-tour-live-dot" aria-hidden="true" />
            <span>{liveCaption}</span>
          </div>
        )}

        {hasSim && (
          <div className="app-tour-sim-box">
            <button
              type="button"
              className={`btn btn-sm btn-full ${isSimulated ? 'btn-success' : 'btn-primary'}`}
              disabled={acting}
              onClick={handleSimulate}
            >
              {acting ? (
                <>
                  <Play size={14} aria-hidden="true" /> Ejecutando animación…
                </>
              ) : isSimulated ? (
                <>
                  <CheckCircle2 size={15} aria-hidden="true" /> Repetir animación de este paso
                </>
              ) : (
                <>
                  <Sparkles size={15} aria-hidden="true" /> {step.simLabel ?? 'Ver demostración animada'}
                </>
              )}
            </button>
          </div>
        )}

        <div className="app-tour-progress">
          <label htmlFor="tour-progress">
            Paso {stepIndex + 1} de {activeFlow.steps.length} · {activeFlow.title}
          </label>
          <progress id="tour-progress" value={stepIndex + 1} max={activeFlow.steps.length} />
        </div>

        <div className="app-tour-nav">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          >
            <ArrowLeft size={15} aria-hidden="true" /> Atrás
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              isLast
                ? setActiveFlowId(null)
                : setStepIndex((i) => Math.min(activeFlow.steps.length - 1, i + 1))
            }
          >
            {isLast ? 'Elegir otro flujo' : 'Siguiente'}
            {!isLast && <ArrowRight size={15} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}
