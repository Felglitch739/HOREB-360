import { createExampleState } from './examples';
import {
  DEFAULT_SUPPLY_ITEMS,
  assignOrderMachines,
  buildDemoShowcaseMachines,
  captureEncargoPayment,
  confirmPaymentLine,
  createOrder,
  getBranchMachines,
  getOrderPendingCents,
  seedSampleCustomersForTesting,
  upsertCustomer,
  upsertExpense,
  upsertMachine,
  upsertSupplyItem,
} from './rules';
import type { BranchId, DemoState } from './types';

export type TourTabId =
  | 'inicio'
  | 'mostrador'
  | 'ordenes'
  | 'equipos'
  | 'clientes'
  | 'caja'
  | 'admin'
  | 'ajustes';

export type AdminTourTabId = 'resumen' | 'equipos' | 'finanzas' | 'gastos' | 'clientes' | 'ajustes';

export type GuidedAction =
  | { type: 'click'; selector: string; caption: string; onlyIfMissingSelector?: string; delayMs?: number }
  | { type: 'type'; selector: string; text: string; caption: string; charDelayMs?: number }
  | { type: 'check'; selector: string; checked: boolean; caption: string; delayMs?: number }
  | { type: 'pause'; ms: number; caption?: string };

export interface WalkthroughStep {
  tab: TourTabId;
  adminTab?: AdminTourTabId;
  selector: string;
  adminSelector?: string;
  title: string;
  description: string;
  tip?: string;
  simLabel?: string;
  demoActions?: GuidedAction[];
  simulate?: (state: DemoState, branchId: BranchId) => DemoState;
}

export interface WalkthroughFlow {
  id: string;
  scope: 'admin' | 'pos' | 'both';
  featured?: boolean;
  title: string;
  subtitle: string;
  badge: string;
  durationLabel: string;
  steps: WalkthroughStep[];
}

/**
 * Crea un estado de práctica aislado en memoria con órdenes activas,
 * saldos por cobrar, clientes de lealtad 10+1 y 44 máquinas de demostración.
 * Nunca se persiste ni se envía a Supabase.
 */
export function createTrainingSandboxState(base = new Date()): DemoState {
  let state = createExampleState(base);
  const nowIso = base.toISOString();

  // Sembrar clientes de lealtad y boleto de rifa en Lomas y Treviño
  const custRes = seedSampleCustomersForTesting(state, 'lomas', 'Modo Práctica', nowIso);
  if (custRes.ok) {
    state = custRes.state;
  }
  const extraCustomers = [
    { branchId: 'trevino' as const, name: 'Mateo Castillo [Demo]', phone: '8682113344', contactConsent: true },
    { branchId: 'trevino' as const, name: 'Valeria Ortiz [Demo]', phone: '8682557788', contactConsent: false },
  ];
  for (const extra of extraCustomers) {
    const res = upsertCustomer(state, extra.branchId, extra, 'Modo Práctica', nowIso);
    if (res.ok) state = res.state;
  }

  // Sembrar 44 máquinas de demostración (11+11 Lomas y 11+11 Treviño) con estados variados
  state = {
    ...state,
    machines: [
      ...buildDemoShowcaseMachines('lomas', base),
      ...buildDemoShowcaseMachines('trevino', base),
    ],
  };

  // Vincular órdenes en etapa 'lavado' o 'secado' con equipos disponibles en su sucursal
  for (const branchId of ['lomas', 'trevino'] as const) {
    for (const order of state.orders.filter((o) => o.branchId === branchId)) {
      if (order.encargoStage === 'lavado') {
        const freeWasher = getBranchMachines(state, branchId).find(
          (m) => m.kind === 'lavadora' && m.status === 'disponible',
        );
        if (freeWasher) {
          const assigned = assignOrderMachines(state, order.id, [freeWasher.id], 'Modo Práctica', nowIso);
          if (assigned.ok) state = assigned.state;
        }
      } else if (order.encargoStage === 'secado') {
        const freeDryer = getBranchMachines(state, branchId).find(
          (m) => m.kind === 'secadora' && m.status === 'disponible',
        );
        if (freeDryer) {
          const assigned = assignOrderMachines(state, order.id, [freeDryer.id], 'Modo Práctica', nowIso);
          if (assigned.ok) state = assigned.state;
        }
      }
    }
  }

  // Vincular órdenes de Treviño con sus clientes locales
  const trevCust = (state.customers ?? []).find((c) => c.createdBranchId === 'trevino');
  state = {
    ...state,
    orders: state.orders.map((o) => {
      if (o.branchId === 'trevino' && !o.customerId && trevCust) {
        return { ...o, customerId: trevCust.id, customerPhone: trevCust.phone };
      }
      return o;
    }),
  };

  // Crear un encargo explícito "Cobrar al recoger" sin pagos registrados ($140.00 pendientes)
  const unpaidOrder = createOrder(state, {
    branchId: 'lomas',
    now: nowIso,
    serviceType: 'encargo',
    customerAlias: 'Roberto Garza (Demo)',
    comboCount: 2,
    weightKg: 8.5,
    notes: 'Separar ropa blanca (Demo)',
    paymentLines: [],
    actorLabel: 'Modo Práctica',
  });
  if (unpaidOrder.ok) {
    state = unpaidOrder.state;
  }

  // Crear un encargo con anticipo parcial ($50.00 de $140.00 -> $90.00 pendientes)
  const partialOrder = createOrder(state, {
    branchId: 'lomas',
    now: nowIso,
    serviceType: 'encargo',
    customerAlias: 'Patricia Vega (Anticipo Demo)',
    comboCount: 2,
    allowPartialPayment: true,
    paymentLines: [{ method: 'efectivo', amountCents: 5000, cashReceivedCents: 5000 }],
    actorLabel: 'Modo Práctica',
  });
  if (partialOrder.ok) {
    state = partialOrder.state;
  }

  // Sembrar catálogo de insumos y gastos demo en Lomas y Treviño
  for (const branchId of ['lomas', 'trevino'] as const) {
    for (const sup of DEFAULT_SUPPLY_ITEMS) {
      const supRes = upsertSupplyItem(state, branchId, sup, 'Modo Práctica', nowIso);
      if (supRes.ok) state = supRes.state;
    }
  }

  const matamorosDay = (daysAgo: number) => {
    const d = new Date(base.getTime() - daysAgo * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Matamoros',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  };

  const sampleExpenses = [
    {
      branchId: 'lomas' as const,
      date: matamorosDay(0),
      category: 'insumos' as const,
      concept: 'Jabón líquido',
      unitLabel: 'garrafa',
      quantity: 4,
      unitCostCents: 18000,
      notes: 'Compra semanal de detergente líquido',
    },
    {
      branchId: 'lomas' as const,
      date: matamorosDay(1),
      category: 'insumos' as const,
      concept: 'Jabón para lavadora',
      unitLabel: 'unidad',
      quantity: 6,
      unitCostCents: 7000,
      notes: 'Reposición de mostrador',
    },
    {
      branchId: 'lomas' as const,
      date: matamorosDay(2),
      category: 'luz' as const,
      concept: 'Recibo CFE bimestral (parcial semana)',
      unitLabel: 'recibo',
      quantity: 1,
      unitCostCents: 145000,
    },
    {
      branchId: 'trevino' as const,
      date: matamorosDay(1),
      category: 'insumos' as const,
      concept: 'Suavizante concentrado',
      unitLabel: 'garrafa',
      quantity: 3,
      unitCostCents: 12500,
    },
    {
      branchId: 'trevino' as const,
      date: matamorosDay(3),
      category: 'gas' as const,
      concept: 'Recarga de gas para secadoras',
      unitLabel: 'carga',
      quantity: 1,
      unitCostCents: 98000,
    },
    {
      branchId: 'trevino' as const,
      date: matamorosDay(2),
      category: 'mantenimiento' as const,
      concept: 'Limpieza de trampas y revisión de válvulas',
      unitLabel: 'servicio',
      quantity: 1,
      unitCostCents: 65000,
    },
  ];
  for (const exp of sampleExpenses) {
    const expRes = upsertExpense(state, exp.branchId, exp, 'Modo Práctica', nowIso);
    if (expRes.ok) state = expRes.state;
  }

  return state;
}

export const WALKTHROUGH_FLOWS: readonly WalkthroughFlow[] = [
  {
    id: 'recorrido-general-admin',
    scope: 'admin',
    featured: true,
    title: 'Recorrido general · Portal de Dirección',
    subtitle: 'Paseo rápido de 6 pasos por todas las pestañas de administrador: KPIs, 44 máquinas, cortes, gastos y clientes.',
    badge: 'Vista general',
    durationLabel: '6 pasos · ~90 seg',
    steps: [
      {
        tab: 'inicio',
        adminTab: 'resumen',
        selector: '[data-tour-id="admin-kpis"]',
        title: '1. Centro de Control',
        description:
          'Resumen ejecutivo de Lomas y Treviño: ingresos en $ MXN, órdenes en proceso, saldo por cobrar, mezcla de cobro y tendencia semanal.',
      },
      {
        tab: 'equipos',
        adminTab: 'equipos',
        selector: '[data-tour-id="floor-summary"]',
        title: '2. Mapa Visual de Equipos (44 máquinas)',
        description:
          'Supervisa en planta las 22 máquinas de Lomas y 22 de Treviño (11 lavadoras + 11 secadoras cada una), filtrando disponibles, en uso o fuera de servicio.',
      },
      {
        tab: 'caja',
        adminTab: 'finanzas',
        selector: '[data-tour-page="finanzas"]',
        title: '3. Finanzas, Turnos y Cortes',
        description:
          'Consulta cortes abiertos o cerrados por sucursal, valida transferencias bancarias y descarga reportes consolidados a Excel.',
      },
      {
        tab: 'admin',
        adminTab: 'gastos',
        selector: '[data-tour-id="gastos-kpis"]',
        title: '4. Gastos, Insumos y Ganancia Neta',
        description:
          'Registra compras de jabón o gastos operativos (renta, luz, gas, sueldos) y calcula la ganancia neta real por semana, mes o fecha.',
      },
      {
        tab: 'clientes',
        adminTab: 'clientes',
        selector: '[data-tour-page="clientes"]',
        title: '5. Clientes, Lealtad 10+1 y Rifa Anual',
        description:
          'Consulta clientes por sucursal, revisa su progreso hacia su combo gratis y gestiona boletos y sorteos anuales.',
      },
      {
        tab: 'ajustes',
        adminTab: 'ajustes',
        selector: '[data-tour-page="ajustes"]',
        title: '6. Ajustes y cambio a Mostrador',
        description:
          'Edita precios del catálogo, agrega servicios nuevos, cambia contraseñas o entra a la vista operativa de Mostrador cuando lo necesites.',
      },
    ],
  },
  {
    id: 'recorrido-general-pos',
    scope: 'pos',
    featured: true,
    title: 'Recorrido general · Mostrador y Operación',
    subtitle: 'Paseo rápido de 7 pasos por cada pestaña que usa el personal en tienda: cobrar, entregar y cerrar turno.',
    badge: 'Vista general',
    durationLabel: '7 pasos · ~2 min',
    steps: [
      {
        tab: 'inicio',
        adminTab: 'resumen',
        selector: '[data-tour="overview-stats"]',
        title: '1. Inicio de turno',
        description:
          'Muestra ventas del turno actual, saldo pendiente por cobrar y accesos rápidos para abrir Mostrador o atender órdenes pendientes.',
      },
      {
        tab: 'mostrador',
        adminTab: 'resumen',
        selector: '#checkout-form',
        title: '2. Mostrador (POS)',
        description:
          'Crea ventas de Autoservicio o Encargo en segundos, da de alta clientes frecuentes, elige pago completo/anticipo/al recoger y cobra.',
      },
      {
        tab: 'ordenes',
        adminTab: 'resumen',
        selector: '[data-tour="orders-panel"]',
        title: '3. Órdenes y tablero Kanban',
        description:
          'Rastrea cada folio (Recibido → Lavado → Secado → Listo → Entregado), cobra saldos pendientes y envía avisos por WhatsApp.',
      },
      {
        tab: 'equipos',
        adminTab: 'equipos',
        selector: '[data-tour-page="equipos"]',
        title: '4. Equipos de sucursal',
        description:
          'Verifica qué lavadoras y secadoras están libres, en uso o en mantenimiento preventivo antes de asignar una orden.',
      },
      {
        tab: 'clientes',
        adminTab: 'clientes',
        selector: '[data-tour-page="clientes"]',
        title: '5. Clientes y programa 10+1',
        description:
          'Busca clientes por nombre o teléfono, crea fichas nuevas y revisa sus combos gratis y boletos acumulados.',
      },
      {
        tab: 'caja',
        adminTab: 'finanzas',
        selector: '[data-tour="caja-panel"]',
        title: '6. Caja y arqueo',
        description:
          'Cuenta billetes y monedas, registra retiros o entradas de efectivo, confirma transferencias y cierra el turno al final del día.',
      },
      {
        tab: 'ajustes',
        adminTab: 'ajustes',
        selector: '[data-tour-page="ajustes"]',
        title: '7. Ajustes de mostrador',
        description:
          'Configura impresora térmica (80 mm / 58 mm), revisa el manual o regresa al Portal de Dirección si tienes permiso de administrador.',
      },
    ],
  },
  {
    id: 'orden-completa',
    scope: 'pos',
    title: '1. Orden completa: cliente nuevo a cobro',
    subtitle: 'Observa en vivo cómo se registra un cliente letra por letra, se arma el carrito, se calcula cambio y se guarda la orden.',
    badge: 'Mostrador POS',
    durationLabel: '4 pasos · Animado',
    steps: [
      {
        tab: 'mostrador',
        adminTab: 'resumen',
        selector: '[data-tour-id="pos-service-toggle"]',
        title: 'Elige Autoservicio o Encargo',
        description:
          'Indica si el cliente lava en el momento (Autoservicio) o si deja su ropa para seguimiento por etapas (Encargo).',
        simLabel: 'Ver cambio a "Encargo"',
        demoActions: [
          {
            type: 'click',
            selector: '[data-tour-id="pos-service-encargo"]',
            caption: 'Seleccionando servicio "Encargo"...',
          },
        ],
      },
      {
        tab: 'mostrador',
        adminTab: 'clientes',
        selector: '[data-tour-id="pos-new-customer-btn"]',
        title: 'Registra un cliente nuevo en vivo',
        description:
          'Haz clic en "Nuevo cliente", captura nombre completo, teléfono de 10 dígitos, autoriza WhatsApp y guarda la ficha sin salir del mostrador.',
        tip: 'Mira cómo el tutorial abre el panel, teclea los datos ficticios y selecciona a la clienta automáticamente.',
        simLabel: 'Animar alta de "Ana Sofía Garza (Demo)"',
        demoActions: [
          {
            type: 'click',
            selector: '[data-tour-id="pos-new-customer-btn"]',
            onlyIfMissingSelector: '[data-tour-id="pos-new-customer-name"]',
            caption: 'Abriendo formulario de nuevo cliente...',
          },
          {
            type: 'type',
            selector: '[data-tour-id="pos-new-customer-name"]',
            text: 'Ana Sofía Garza (Demo)',
            caption: 'Escribiendo nombre: Ana Sofía Garza (Demo)',
          },
          {
            type: 'type',
            selector: '[data-tour-id="pos-new-customer-phone"]',
            text: '8685550192',
            caption: 'Escribiendo teléfono: 8685550192',
          },
          {
            type: 'check',
            selector: '[data-tour-id="pos-new-customer-consent"]',
            checked: true,
            caption: 'Marcando autorización de WhatsApp...',
          },
          {
            type: 'pause',
            ms: 450,
            caption: 'Confirmando ficha del cliente...',
          },
          {
            type: 'click',
            selector: '[data-tour-id="pos-new-customer-save"]',
            caption: 'Guardando ficha y seleccionando cliente...',
          },
        ],
        simulate: (state, branchId) => {
          const uniquePhone = `868${String(Math.floor(1000000 + Math.random() * 8999999))}`;
          const res = upsertCustomer(
            state,
            branchId,
            {
              name: 'Ana Sofía Garza (Demo)',
              phone: uniquePhone,
              contactConsent: true,
            },
            'Modo Práctica',
          );
          return res.ok ? res.state : state;
        },
      },
      {
        tab: 'mostrador',
        adminTab: 'equipos',
        selector: '.pos-catalog-grid',
        title: 'Agrega servicios al carrito',
        description:
          'Toca el botón + de cualquier servicio para armar la orden. Si es encargo, también puedes elegir Pago completo, Anticipo parcial o Al recoger.',
        simLabel: 'Animar suma de 2 combos ($140.00)',
        demoActions: [
          {
            type: 'click',
            selector: '[data-tour-id="pos-catalog-add-combo"]',
            caption: 'Agregando 1° Combo Lavado + Secado ($70)...',
          },
          {
            type: 'pause',
            ms: 350,
          },
          {
            type: 'click',
            selector: '[data-tour-id="pos-catalog-add-combo"]',
            caption: 'Agregando 2° Combo Lavado + Secado ($140 total)...',
          },
        ],
      },
      {
        tab: 'mostrador',
        adminTab: 'finanzas',
        selector: '.pos-payment-col',
        title: 'Cobra y emite la orden',
        description:
          'Captura el efectivo recibido (o elige Tarjeta, Transferencia o Mixto), verifica el cambio calculado al instante y guarda la orden.',
        simLabel: 'Animar cobro con billete de $200 y guardar',
        demoActions: [
          {
            type: 'type',
            selector: '#cash-received-input',
            text: '200',
            caption: 'Capturando $200.00 en efectivo (calcula $60 de cambio)...',
          },
          {
            type: 'pause',
            ms: 550,
            caption: 'Listo para guardar orden y generar folio...',
          },
          {
            type: 'click',
            selector: '[data-tour-id="pos-submit-order"]',
            caption: 'Guardando orden pagada en el sistema...',
          },
        ],
        simulate: (state, branchId) => {
          const customer = (state.customers ?? [])[0];
          const res = createOrder(state, {
            branchId,
            serviceType: 'encargo',
            customerAlias: customer ? customer.name : 'Ana Sofía Garza (Demo)',
            customerId: customer?.id,
            comboCount: 2,
            paymentLines: [{ method: 'efectivo', amountCents: 14000, cashReceivedCents: 20000 }],
            actorLabel: 'Modo Práctica',
          });
          return res.ok ? res.state : state;
        },
      },
    ],
  },
  {
    id: 'equipos-monitoreo',
    scope: 'admin',
    title: '2. Mapa visual de 44 máquinas y filtros',
    subtitle: 'Supervisa en tiempo real disponibilidad, ciclos en uso y mantenimiento en Lomas y Treviño.',
    badge: 'Dirección · Equipos',
    durationLabel: '3 pasos · Animado',
    steps: [
      {
        tab: 'equipos',
        adminTab: 'equipos',
        selector: '[data-tour-id="floor-summary"]',
        title: 'Prueba los filtros por estado',
        description:
          'Alterna entre Disponibles, En uso y Fuera de servicio para ubicar al instante las lavadoras y secadoras que requieren atención.',
        simLabel: 'Animar recorrido por los filtros',
        demoActions: [
          {
            type: 'click',
            selector: '[data-tour-id="floor-filter-en_uso"]',
            caption: 'Filtrando máquinas En uso...',
          },
          {
            type: 'pause',
            ms: 950,
          },
          {
            type: 'click',
            selector: '[data-tour-id="floor-filter-fuera_de_servicio"]',
            caption: 'Filtrando máquinas Fuera de servicio...',
          },
          {
            type: 'pause',
            ms: 950,
          },
          {
            type: 'click',
            selector: '[data-tour-id="floor-filter-todos"]',
            caption: 'Mostrando las 44 máquinas nuevamente...',
          },
        ],
      },
      {
        tab: 'equipos',
        adminTab: 'equipos',
        selector: '.floor-tile-grid, .machine-grid',
        title: 'Inspecciona ciclos activos y folios',
        description:
          'Cada equipo en uso muestra su tambor animado, el folio asignado y el tiempo estimado restante para responder rápido a clientes.',
      },
      {
        tab: 'equipos',
        adminTab: 'equipos',
        selector: '[data-tour-id="floor-add-machine-btn"], .equipos-toolbar',
        title: 'Agrega una lavadora o secadora',
        description:
          'Desde "Agregar equipo" puedes registrar nuevas máquinas con código, modelo LG y capacidad en kg.',
        simLabel: 'Simular alta de lavadora demo',
        simulate: (state, branchId) => {
          const codeNum = getBranchMachines(state, branchId).length + 1;
          const res = upsertMachine(
            state,
            branchId,
            {
              code: `LD${codeNum}`,
              name: `Lavadora Demo #${codeNum}`,
              kind: 'lavadora',
            },
            'Modo Práctica',
          );
          return res.ok ? res.state : state;
        },
      },
    ],
  },
  {
    id: 'gastos-ganancia',
    scope: 'admin',
    title: '3. Gastos, catálogo de insumos y ganancia neta',
    subtitle: 'Observa cómo capturar una compra de jabón con cálculo automático y ver la ganancia neta en vivo.',
    badge: 'Dirección · Finanzas',
    durationLabel: '3 pasos · Animado',
    steps: [
      {
        tab: 'admin',
        adminTab: 'gastos',
        selector: '[data-tour-id="gastos-kpis"]',
        title: 'Ingresos, Gastos y Ganancia Neta',
        description:
          'Los 4 indicadores superiores restan automáticamente tus gastos del periodo a los ingresos confirmados, mostrando el margen real.',
      },
      {
        tab: 'admin',
        adminTab: 'gastos',
        selector: '[data-tour-id="gastos-form"]',
        title: 'Registra una compra de insumos en vivo',
        description:
          'Captura concepto, unidad, cantidad y costo unitario; puedes elegir un insumo del catálogo o escribirlo directo.',
        simLabel: 'Animar compra de 4 garrafas de jabón ($720)',
        demoActions: [
          {
            type: 'type',
            selector: '#exp-concept',
            text: 'Jabón líquido',
            caption: 'Escribiendo insumo: Jabón líquido...',
          },
          {
            type: 'type',
            selector: '#exp-unit',
            text: 'garrafa',
            caption: 'Unidad: garrafa',
          },
          {
            type: 'type',
            selector: '#exp-qty',
            text: '4',
            caption: 'Cantidad: 4 garrafas...',
          },
          {
            type: 'type',
            selector: '#exp-cost',
            text: '180',
            caption: 'Costo unitario $180.00 = $720.00 MXN total...',
          },
          {
            type: 'pause',
            ms: 550,
            caption: 'Guardando gasto y actualizando ganancia neta...',
          },
          {
            type: 'click',
            selector: '[data-tour-id="gastos-submit-btn"]',
            caption: 'Registrando gasto...',
          },
        ],
      },
      {
        tab: 'admin',
        adminTab: 'gastos',
        selector: '[data-tour-id="gastos-categories"]',
        title: 'Filtra por categoría y exporta a Excel',
        description:
          'Toca cualquier barra (Insumos, Luz, Gas, Renta, Sueldos, Mantenimiento) para filtrar el historial y descarga el libro Excel de 4 hojas.',
      },
    ],
  },
  {
    id: 'clientes-lealtad',
    scope: 'both',
    title: '4. Alta de clientes, Lealtad 10+1 y Rifa',
    subtitle: 'Mira cómo registrar una ficha paso a paso, ver su progreso hacia combo gratis y controlar boletos.',
    badge: 'Fidelización',
    durationLabel: '3 pasos · Animado',
    steps: [
      {
        tab: 'clientes',
        adminTab: 'clientes',
        selector: '[data-tour-id="clientes-new-btn"]',
        title: 'Abre y llena el alta de cliente en vivo',
        description:
          'Presiona "Nuevo cliente", captura nombre y teléfono de 10 dígitos, autoriza avisos de WhatsApp y guarda su ficha.',
        simLabel: 'Animar registro de "Valentina Ruiz (Demo)"',
        demoActions: [
          {
            type: 'click',
            selector: '[data-tour-id="clientes-new-btn"]',
            onlyIfMissingSelector: '[data-tour-id="clientes-name-input"]',
            caption: 'Abriendo cajón de registro de cliente...',
          },
          {
            type: 'type',
            selector: '[data-tour-id="clientes-name-input"]',
            text: 'Valentina Ruiz (Demo)',
            caption: 'Escribiendo nombre completo...',
          },
          {
            type: 'type',
            selector: '[data-tour-id="clientes-phone-input"]',
            text: '8684129901',
            caption: 'Escribiendo teléfono WhatsApp...',
          },
          {
            type: 'check',
            selector: '[data-tour-id="clientes-consent-checkbox"]',
            checked: true,
            caption: 'Autorizando avisos por WhatsApp...',
          },
          {
            type: 'pause',
            ms: 450,
            caption: 'Guardando ficha de lealtad...',
          },
          {
            type: 'click',
            selector: '[data-tour-id="clientes-save-btn"]',
            caption: 'Guardando cliente...',
          },
        ],
        simulate: (state, branchId) => {
          const randomDigits = String(Math.floor(1000000 + Math.random() * 8999999));
          const res = upsertCustomer(
            state,
            branchId,
            {
              name: 'Valentina Ruiz (Demo)',
              phone: `868${randomDigits}`,
              contactConsent: true,
            },
            'Modo Práctica',
          );
          return res.ok ? res.state : state;
        },
      },
      {
        tab: 'clientes',
        adminTab: 'clientes',
        selector: '.clientes-master-detail',
        title: 'Consulta avance 10+1 e historial',
        description:
          'A la izquierda filtras clientes por nombre o teléfono; a la derecha ves sus combos acumulados, combos gratis y órdenes previas.',
      },
      {
        tab: 'admin',
        adminTab: 'clientes',
        selector: '[data-tour="admin-panel"]',
        title: 'Boletos digitales y Rifa Anual',
        description:
          'Al canjear un combo gratis y cerrar la orden, se genera un boleto digital único para el sorteo del 23 de diciembre.',
      },
    ],
  },
  {
    id: 'saldos-pendientes',
    scope: 'pos',
    title: '5. Saldos pendientes, sucursal y cobranza',
    subtitle: 'Identifica qué falta por cobrar, de qué sucursal es cada folio, su hora y liquida o confirma transferencias.',
    badge: 'Mostrador POS · Cobranza',
    durationLabel: '4 pasos · ~90 seg',
    steps: [
      {
        tab: 'inicio',
        adminTab: 'resumen',
        selector: '[data-tour="overview-stats"]',
        title: 'Detecta saldos por cobrar al instante',
        description:
          'El indicador "Por cobrar" se resalta en ámbar cuando existen encargos pendientes de liquidar o transferencias sin verificar.',
      },
      {
        tab: 'ordenes',
        adminTab: 'resumen',
        selector: '[data-tour="orders-panel"] .order-toolbar',
        title: 'Filtra por "Por cobrar" y fecha',
        description:
          'Elige el filtro "Por cobrar" y la fecha para localizar órdenes de días anteriores o del turno actual.',
      },
      {
        tab: 'ordenes',
        adminTab: 'resumen',
        selector: '.order-list',
        title: 'Lee sucursal, hora y estado de un vistazo',
        description:
          'El prefijo indica sucursal (LOM- Lomas, TRE- Treviño), la insignia muestra su etapa y la etiqueta ámbar detalla el saldo restante.',
      },
      {
        tab: 'ordenes',
        adminTab: 'finanzas',
        selector: '.order-list',
        title: 'Liquida saldo o confirma transferencia',
        description:
          'Usa "Cobrar saldo" en encargos pendientes o confirma transferencias SPEI desde la tarjeta.',
        simLabel: 'Simular cobro de un saldo pendiente',
        simulate: (state, branchId) => {
          const unpaid = state.orders.find(
            (o) =>
              o.branchId === branchId &&
              state.paymentLines.filter((l) => l.orderId === o.id).length === 0 &&
              getOrderPendingCents(state, o.id) > 0,
          );
          if (unpaid) {
            const res = captureEncargoPayment(
              state,
              unpaid.id,
              [{ method: 'efectivo', amountCents: unpaid.totalCents, cashReceivedCents: unpaid.totalCents }],
              undefined,
              'Modo Práctica',
            );
            return res.ok ? res.state : state;
          }
          const pendingLine = state.paymentLines.find((l) => l.status === 'pendiente');
          if (pendingLine) {
            const res = confirmPaymentLine(state, pendingLine.id, undefined, {
              reference: 'SPEI-DEMO-901',
              actorLabel: 'Modo Práctica',
            });
            return res.ok ? res.state : state;
          }
          return state;
        },
      },
    ],
  },
  {
    id: 'caja-corte',
    scope: 'both',
    title: '6. Arqueo de efectivo, conciliación y cortes',
    subtitle: 'Cuenta billetes y monedas, confirma pagos en lote, realiza el corte del día y exporta turnos a Excel.',
    badge: 'Caja y Finanzas',
    durationLabel: '3 pasos · ~90 seg',
    steps: [
      {
        tab: 'caja',
        adminTab: 'finanzas',
        selector: '[data-tour="caja-panel"]',
        adminSelector: '[data-tour-page="finanzas"]',
        title: 'Contador de billetes y monedas',
        description:
          'Ingresa piezas de $1,000 a $0.50 MXN para calcular el efectivo contado y comparar al centavo contra lo esperado.',
      },
      {
        tab: 'caja',
        adminTab: 'finanzas',
        selector: '.transfer-inbox, [data-tour="caja-panel"]',
        adminSelector: '[data-tour-page="finanzas"]',
        title: 'Conciliación bancaria y movimientos',
        description:
          'Registra entradas/retiros con motivo obligatorio y confirma pagos con tarjeta o transferencias SPEI pendientes.',
      },
      {
        tab: 'caja',
        adminTab: 'finanzas',
        selector: '.night-closing-card, [data-tour="caja-panel"]',
        adminSelector: '[data-tour-page="finanzas"]',
        title: 'Reportes de cierre y Excel (.xlsx)',
        description:
          'Revisa el historial de turnos y cierres por sucursal y descarga el reporte completo en Excel.',
      },
    ],
  },
];
