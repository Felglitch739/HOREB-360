import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Compass, X } from 'lucide-react';
import './AppTour.css';
import { useModalFocus } from './useModalFocus';

export type TourTabId = 'inicio' | 'mostrador' | 'ordenes' | 'caja' | 'admin' | 'ajustes';

interface TourStep {
  title: string;
  description: string;
  selector: string;
  tab: TourTabId;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: 'Sucursal, turno y rol',
    description:
      'Cambia entre Lomas, Treviño y Sucursal 3 desde la barra superior y revisa si el turno está abierto. Supervisión gestiona turnos y cortes; Caja opera su sucursal.',
    selector: '[data-tour="branch-bar"]',
    tab: 'inicio',
  },
  {
    title: 'Resumen operativo',
    description:
      'Consulta de un vistazo los cobros confirmados, el saldo pendiente por cobrar, los encargos por etapa y la gráfica semanal de ingresos.',
    selector: '[data-tour="overview-stats"]',
    tab: 'inicio',
  },
  {
    title: 'Recepción en Mostrador',
    description:
      'Registra Autoservicio o Encargo, mezcla productos del catálogo (Combo, Edredón, Detergente, Bolsa), vincula cliente frecuente para lealtad 10+1 o realiza cobro rápido, asigna lavadoras disponibles y registra pagos mixtos.',
    selector: '#checkout-form',
    tab: 'mostrador',
  },
  {
    title: 'Flujo manual de etapas y pagos pendientes',
    description:
      'Busca órdenes por folio o cliente, avanza manualmente cada etapa (Iniciar lavado → Pasar a secado → Marcar listo → Entregar orden, preparado a futuro para enlazar equipos LG) y confirma transferencias o tarjetas pendientes.',
    selector: '[data-tour="orders-panel"]',
    tab: 'ordenes',
  },
  {
    title: 'Ticket térmico personalizado',
    description:
      'Desde cada orden emite el comprobante en formato térmico (80 mm o 58 mm), agrega notas de cuidado de prendas y mensaje al pie. Si falla la impresora, el folio y el cobro quedan resguardados para reintentar.',
    selector: '[data-tour="orders-panel"]',
    tab: 'ordenes',
  },
  {
    title: 'Control de Caja y Cortes',
    description:
      'Supervisión abre turnos con fondo inicial, registra entradas o retiros con motivo y realiza el corte con efectivo contado. Los pagos pendientes confirmados después del corte caen en el turno nuevo sin alterar el corte anterior.',
    selector: '[data-tour="caja-panel"]',
    tab: 'caja',
  },
  {
    title: 'Reportes multi-sucursal y CSV',
    description:
      'Consolida en vivo el efectivo, tarjeta, transferencia y saldo pendiente de todas tus sucursales habilitadas, y descarga el reporte en CSV para Excel.',
    selector: '[data-tour="admin-panel"]',
    tab: 'admin',
  },
  {
    title: 'Ajustes para Supervisión y Sesión',
    description:
      'En Ajustes los dueños o supervisores pueden modificar el precio del combo, personalizar el teléfono, horario y pie del ticket térmico, cambiar el color de marca (Verde/Azul), actualizar datos o cerrar sesión.',
    selector: '[data-tour="settings-panel"]',
    tab: 'ajustes',
  },
];

interface AppTourProps {
  open: boolean;
  onNavigate: (tab: TourTabId) => void;
  onClose: () => void;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function AppTour({ open, onNavigate, onClose }: AppTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const dialogRef = useModalFocus(open, onClose);

  const step = TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0];

  useEffect(() => {
    if (!open) {
      setStepIndex(0);
      setRect(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    onNavigate(step.tab);

    let cancelled = false;
    function measure() {
      if (cancelled) return;
      const target = document.querySelector(step.selector);
      if (!target) {
        setRect(null);
        return;
      }
      const box = target.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) {
        setRect(null);
        return;
      }
      const pad = 6;
      setRect({
        top: Math.max(8, box.top - pad),
        left: Math.max(8, box.left - pad),
        width: Math.min(window.innerWidth - 16, box.width + pad * 2),
        height: Math.min(window.innerHeight - 16, box.height + pad * 2),
      });
    }

    const timer = window.setTimeout(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.querySelector(step.selector)?.scrollIntoView({
        block: 'nearest',
        behavior: reduceMotion ? 'instant' : 'smooth',
      });
      measure();
    }, 80);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, stepIndex, step.selector, step.tab]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') {
        if (stepIndex < TOUR_STEPS.length - 1) setStepIndex((i) => i + 1);
      } else if (event.key === 'ArrowLeft') {
        if (stepIndex > 0) setStepIndex((i) => i - 1);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, stepIndex]);

  if (!open) return null;

  const isLast = stepIndex === TOUR_STEPS.length - 1;
  const cardWidth = Math.min(390, window.innerWidth - 24);
  const estimatedHeight = 235;

  let cardStyle: React.CSSProperties;
  if (!rect || window.innerWidth <= 560) {
    cardStyle = {
      left: '50%',
      bottom: 16,
      transform: 'translateX(-50%)',
    };
  } else {
    const fitsBelow = rect.top + rect.height + 14 + estimatedHeight <= window.innerHeight;
    const fitsAbove = rect.top - 14 - estimatedHeight >= 12;
    const top = fitsBelow
      ? rect.top + rect.height + 14
      : fitsAbove
        ? rect.top - estimatedHeight - 14
        : Math.max(16, window.innerHeight - estimatedHeight - 16);
    const left = Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - cardWidth - 12),
    );
    cardStyle = { top, left };
  }

  return (
    <div ref={dialogRef} className="app-tour-overlay" role="dialog" tabIndex={-1} aria-modal="true" aria-label="Guía interactiva">
      {!rect && <div className="app-tour-backdrop" onClick={onClose} />}
      {rect && (
        <>
          <div className="app-tour-backdrop" style={{ background: 'transparent' }} onClick={onClose} />
          <div
            className="app-tour-spotlight"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            }}
          />
        </>
      )}

      <div className="app-tour-card" style={cardStyle}>
        <div className="app-tour-head">
          <span className="app-tour-step">
            <Compass size={14} aria-hidden="true" />
            Paso {stepIndex + 1} de {TOUR_STEPS.length}
          </span>
          <button
            type="button"
            className="app-tour-close"
            onClick={onClose}
            aria-label="Cerrar guía"
          >
            <X size={16} />
          </button>
        </div>

        <h3>{step.title}</h3>
        <p>{step.description}</p>

        <div className="app-tour-footer">
          <div className="app-tour-dots" aria-hidden="true">
            {TOUR_STEPS.map((item, idx) => (
              <span
                key={item.title}
                className={`app-tour-dot ${idx === stepIndex ? 'active' : ''}`}
              />
            ))}
          </div>

          <div className="app-tour-nav">
            {stepIndex > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              >
                <ArrowLeft size={14} />
                Anterior
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                if (isLast) onClose();
                else setStepIndex((i) => Math.min(TOUR_STEPS.length - 1, i + 1));
              }}
            >
              {isLast ? 'Finalizar' : 'Siguiente'}
              {!isLast && <ArrowRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
