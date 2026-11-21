import { useEffect, useEffectEvent, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Compass,
  MoveVertical,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  WALKTHROUGH_FLOWS,
  type AdminTourTabId,
  type TourTabId,
} from '../domain/sandboxManual';
import type { BranchId, DemoState } from '../domain/types';
import './AppTour.css';
import { useModalFocus } from './useModalFocus';

export type { TourTabId };

interface AppTourProps {
  mode?: 'pos' | 'admin';
  branchId: BranchId;
  isPracticeMode?: boolean;
  onStartPractice?: () => void;
  onExitPractice?: () => void;
  onResetPractice?: () => void;
  onSimulateStep?: (updater: (prev: DemoState) => DemoState) => void;
  onNavigate: (tab: TourTabId) => void;
  onNavigateAdmin?: (tab: AdminTourTabId) => void;
  onClose: () => void;
}

export function AppTour({
  mode = 'pos',
  branchId,
  isPracticeMode = false,
  onStartPractice,
  onExitPractice,
  onResetPractice,
  onSimulateStep,
  onNavigate,
  onNavigateAdmin,
  onClose,
}: AppTourProps) {
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [dockTop, setDockTop] = useState(false);
  const [simulatedKey, setSimulatedKey] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<React.CSSProperties>();

  const dialogRef = useModalFocus(activeFlowId === null, onClose);
  const navigatePos = useEffectEvent(onNavigate);
  const navigateAdmin = useEffectEvent((tab: AdminTourTabId) => onNavigateAdmin?.(tab));
  const ensurePractice = useEffectEvent(() => onStartPractice?.());

  const activeFlow = WALKTHROUGH_FLOWS.find((f) => f.id === activeFlowId) ?? null;
  const step = activeFlow ? activeFlow.steps[stepIndex] : null;
  const isLast = activeFlow ? stepIndex === activeFlow.steps.length - 1 : false;

  useEffect(() => {
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
    let target: HTMLElement | null = null;
    let frame = 0;

    function measure() {
      if (!target) return;
      const box = target.getBoundingClientRect();
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
      const candidate = document.querySelector<HTMLElement>(step!.selector);
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
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', scheduleMeasure, true);
    };
  }, [activeFlow?.id, stepIndex, mode]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function startFlow(flowId: string) {
    onStartPractice?.();
    setActiveFlowId(flowId);
    setStepIndex(0);
    setSimulatedKey(null);
  }

  function handleSimulate() {
    if (!step?.simulate || !onSimulateStep) return;
    onStartPractice?.();
    onSimulateStep((prev) => step.simulate!(prev, branchId));
    setSimulatedKey(`${activeFlowId}:${stepIndex}`);
  }

  // ================= CATALOG VIEW (MENU DE FLUJOS) =================
  if (!activeFlow || !step) {
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
              <BookOpen size={18} aria-hidden="true" /> Manual Interactivo de HOREB 360
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
              <strong>Modo Práctica Seguro (Datos Demo)</strong>
              <p>
                Al iniciar cualquier guía se activan datos ficticios de demostración (órdenes activas, saldos pendientes, clientes y máquinas). Puedes tocar botones reales y simular pasos sin guardar nada en la base de datos.
              </p>
            </div>
          </div>

          <div className="app-tour-flow-grid">
            {WALKTHROUGH_FLOWS.map((flow) => (
              <button
                key={flow.id}
                type="button"
                className="app-tour-flow-btn"
                onClick={() => startFlow(flow.id)}
              >
                <div className="app-tour-flow-top">
                  <span className="badge badge-info">{flow.badge}</span>
                  <small className="muted">{flow.durationLabel}</small>
                </div>
                <strong>{flow.title}</strong>
                <p>{flow.subtitle}</p>
                <span className="app-tour-flow-cta">
                  Iniciar recorrido interactivo <ChevronRight size={15} aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>

          <div className="app-tour-catalog-footer">
            {isPracticeMode ? (
              <div className="order-actions">
                {onResetPractice && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={onResetPractice}
                  >
                    <RotateCcw size={14} aria-hidden="true" /> Reiniciar datos demo
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
                    Salir de práctica (ir a datos reales)
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
                <Sparkles size={14} aria-hidden="true" /> Entrar a Modo Práctica libre
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
      {highlight && <div className="app-tour-spotlight" style={highlight} aria-hidden="true" />}

      <div className="app-tour-card">
        <div className="app-tour-head">
          <span>
            <Compass size={16} aria-hidden="true" /> {activeFlow.badge}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ minHeight: 34, padding: '4px 8px', fontSize: '0.76rem' }}
              title={dockTop ? 'Mover guía abajo' : 'Mover guía arriba'}
              onClick={() => setDockTop((prev) => !prev)}
            >
              <MoveVertical size={14} aria-hidden="true" />
              {dockTop ? 'Abajo' : 'Arriba'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm app-tour-close"
              onClick={onClose}
              aria-label="Cerrar guía"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="app-tour-flow-crumb">
          <button
            type="button"
            className="ticket-fallback-link"
            style={{ padding: 0, textAlign: 'left' }}
            onClick={() => setActiveFlowId(null)}
          >
            ← Todos los flujos
          </button>
          <span className="badge badge-warning">Datos demo</span>
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

        {step.simulate && onSimulateStep && (
          <div className="app-tour-sim-box">
            <button
              type="button"
              className={`btn btn-sm btn-full ${isSimulated ? 'btn-success' : 'btn-primary'}`}
              onClick={handleSimulate}
            >
              {isSimulated ? (
                <>
                  <CheckCircle2 size={15} aria-hidden="true" /> ¡Paso simulado en pantalla!
                </>
              ) : (
                <>
                  <Sparkles size={15} aria-hidden="true" /> {step.simLabel ?? 'Simular este paso por mí'}
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
