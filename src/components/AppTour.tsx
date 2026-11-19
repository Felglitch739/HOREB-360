import { useEffect, useEffectEvent, useState } from 'react';
import { ArrowLeft, ArrowRight, Compass, X } from 'lucide-react';
import './AppTour.css';
import { useModalFocus } from './useModalFocus';

export type TourTabId = 'inicio' | 'mostrador' | 'ordenes' | 'equipos' | 'clientes' | 'caja' | 'admin' | 'ajustes';

const TOUR_STEPS: readonly { tab: TourTabId; selector: string; title: string; description: string }[] = [
  {
    tab: 'inicio',
    selector: '[data-tour="branch-bar"]',
    title: 'Empieza por tu sucursal',
    description: 'Aquí eliges una sucursal y ves si su turno está abierto. En Inicio puedes revisar cuánto se ha cobrado, qué falta y cuáles encargos están listos.',
  },
  {
    tab: 'mostrador',
    selector: '#checkout-heading',
    title: 'Recibe una orden',
    description: 'Elige Autoservicio o Encargo, agrega los servicios y registra el pago recibido. Si el cliente deja ropa y pagará al recoger, guarda el encargo con su folio.',
  },
  {
    tab: 'ordenes',
    selector: '[data-tour="orders-panel"] .order-toolbar',
    title: 'Da seguimiento y cobra',
    description: 'Busca el folio y actualiza la etapa del encargo. Cobrar abre el panel con el cliente y el importe. Desde el detalle de la orden puedes abrir su comprobante.',
  },
  {
    tab: 'equipos',
    selector: '[data-tour-page="equipos"]',
    title: 'Consulta tus equipos',
    description: 'Revisa cuáles máquinas están disponibles, en uso o fuera de servicio, y qué folio ocupa cada equipo asignado.',
  },
  {
    tab: 'clientes',
    selector: '[data-tour-page="clientes"]',
    title: 'Lleva el historial del cliente',
    description: 'Registra la ficha y consulta sus beneficios de lealtad. El cliente puede acumular combos y recibir un boleto de rifa al completar un combo gratis.',
  },
  {
    tab: 'caja',
    selector: '[data-tour="caja-panel"] .card-title',
    title: 'Cuadra el turno',
    description: 'Compara el efectivo esperado con el contado. Desde Caja puedes revisar cortes y verificar transferencias pendientes. Las acciones de supervisión dependen de tu rol.',
  },
  {
    tab: 'admin',
    selector: '[data-tour="admin-panel"] .card-title',
    title: 'Compara los cobros',
    description: 'Revisa cuánto entró en efectivo, tarjeta y transferencia, y cuánto sigue pendiente en las sucursales a las que tienes acceso. Puedes descargar el resumen en CSV.',
  },
  {
    tab: 'ajustes',
    selector: '[data-tour-page="ajustes"]',
    title: 'Deja listo el mostrador',
    description: 'En Ajustes, Supervisión puede modificar el catálogo y los datos del comprobante. Desde el encabezado puedes volver a abrir esta guía cuando la necesites.',
  },
];

export function AppTour({ onNavigate, onClose }: {
  onNavigate: (tab: TourTabId) => void;
  onClose: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [highlight, setHighlight] = useState<React.CSSProperties>();
  const dialogRef = useModalFocus(true, onClose);
  const navigate = useEffectEvent(onNavigate);
  const step = TOUR_STEPS[stepIndex];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  useEffect(() => {
    setHighlight(undefined);
    navigate(step.tab);

    let target: HTMLElement | null = null;
    let frame = 0;
    function measure() {
      if (!target) return;
      const box = target.getBoundingClientRect();
      const top = Math.max(4, box.top - 5);
      const left = Math.max(4, box.left - 5);
      const right = Math.min(document.documentElement.clientWidth - 4, box.right + 5);
      const bottom = Math.min(window.innerHeight - 4, box.bottom + 5);
      setHighlight(right > left && bottom > top ? { top, left, width: right - left, height: bottom - top } : undefined);
    }

    function scheduleMeasure() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }

    function findTarget() {
      if (document.querySelector<HTMLElement>('.main-content')?.dataset.workspaceTab !== step.tab) return;
      const candidate = document.querySelector<HTMLElement>(step.selector);
      if (!candidate?.getClientRects().length) return;
      target = candidate;
      observer.disconnect();
      const box = candidate.getBoundingClientRect();
      if (box.top < 8 || box.bottom > window.innerHeight * 0.5) {
        window.scrollBy({ top: box.top - 24, behavior: 'instant' });
      }
      measure();
    }

    const observer = new MutationObserver(findTarget);
    const workspace = document.querySelector('.workspace');
    if (workspace) observer.observe(workspace, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-workspace-tab', 'style'],
    });
    frame = requestAnimationFrame(findTarget);
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', scheduleMeasure, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', scheduleMeasure, true);
    };
  }, [step]);

  return (
    <div
      ref={dialogRef}
      className="app-tour-overlay"
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-label="Guía interactiva"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' && !isLast) setStepIndex((index) => Math.min(index + 1, TOUR_STEPS.length - 1));
        if (event.key === 'ArrowLeft' && stepIndex > 0) setStepIndex((index) => Math.max(index - 1, 0));
      }}
    >
      <div className="app-tour-backdrop" data-highlight={highlight ? '' : undefined} />
      {highlight && <div className="app-tour-spotlight" style={highlight} aria-hidden="true" />}
      <div className="app-tour-card">
        <div className="app-tour-head">
          <span><Compass size={16} aria-hidden="true" /> Guía de HOREB</span>
          <button type="button" className="btn btn-secondary app-tour-close" onClick={onClose} aria-label="Cerrar guía">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="app-tour-copy" aria-live="polite" aria-atomic="true">
          <h2>{step.title}</h2>
          <p>{step.description}</p>
        </div>
        <div className="app-tour-progress">
          <label htmlFor="tour-progress">Paso {stepIndex + 1} de {TOUR_STEPS.length}</label>
          <progress id="tour-progress" value={stepIndex + 1} max={TOUR_STEPS.length} />
        </div>
        <div className="app-tour-nav">
          <button type="button" className="btn btn-secondary" disabled={stepIndex === 0} onClick={() => setStepIndex(stepIndex - 1)}>
            <ArrowLeft size={16} aria-hidden="true" /> Atrás
          </button>
          <button type="button" className="btn btn-primary" onClick={() => isLast ? onClose() : setStepIndex(stepIndex + 1)}>
            {isLast ? 'Terminar guía' : 'Siguiente'}
            {!isLast && <ArrowRight size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}
