import { createExampleState } from './examples';
import {
  DEFAULT_SUPPLY_ITEMS,
  advanceEncargoStage,
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

export interface WalkthroughStep {
  tab: TourTabId;
  adminTab?: AdminTourTabId;
  selector: string;
  title: string;
  description: string;
  tip?: string;
  simLabel?: string;
  simulate?: (state: DemoState, branchId: BranchId) => DemoState;
}

export interface WalkthroughFlow {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  durationLabel: string;
  steps: WalkthroughStep[];
}

/**
 * Crea un estado de práctica aislado en memoria con órdenes activas,
 * saldos por cobrar, clientes de lealtad 10+1 y padrón de equipos en las 3 sucursales.
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
    id: 'orden-completa',
    title: '1. Orden completa: de cliente nuevo a cobro',
    subtitle: 'Cómo registrar un cliente nuevo, armar su carrito, asignar lavadora y cobrar con cambio.',
    badge: 'Mostrador POS',
    durationLabel: '4 pasos · ~2 min',
    steps: [
      {
        tab: 'mostrador',
        adminTab: 'resumen',
        selector: '#checkout-service-label',
        title: 'Elige Autoservicio o Encargo',
        description:
          'En Mostrador la pantalla prioriza la creación rápida: a la izquierda armas la orden y a la derecha ves el resumen y cobro. Elige Autoservicio (el cliente lava en el momento) o Encargo (deja su ropa y se marca etapa).',
        tip: 'Puedes ocultar el menú lateral con el botón superior izquierdo para trabajar a pantalla completa en tablets.',
      },
      {
        tab: 'mostrador',
        adminTab: 'clientes',
        selector: '#checkout-form .catalog-head-row',
        title: 'Registra o selecciona un cliente (Lealtad 10+1)',
        description:
          'Haz clic en "Nuevo cliente" para dar de alta nombre y teléfono de 10 dígitos sin salir de Mostrador, o elige uno del selector para que acumule combos hacia su combo gratis y boleto de rifa.',
        tip: 'Si el cliente solo viene de paso y no quiere ficha, déjalo en "Cobro rápido (sin ficha)".',
        simLabel: 'Simular alta de "Ana Sofía Garza (Demo)"',
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
        selector: '#checkout-catalog-label',
        title: 'Agrega servicios y asigna lavadora (opcional)',
        description:
          'Toca cualquier tarjeta del catálogo para sumar +1 rápidamente o usa los botones - y +. Si un servicio ocupa máquina, puedes desplegar "Asignar lavadora (opcional)" para apartar un equipo libre.',
        tip: 'Usa los filtros "Lavado / Secado" e "Insumos y extras" cuando el catálogo tenga muchos productos.',
      },
      {
        tab: 'mostrador',
        adminTab: 'finanzas',
        selector: '.pos-payment-col',
        title: 'Cobra y emite el comprobante',
        description:
          'Selecciona Efectivo (con chips rápidos como Exacto, $100, $200), Tarjeta, Transferencia o Mixto. Al guardar verás el cambio a entregar y el botón "Ver / emitir comprobante".',
        tip: 'Si es Encargo y pagará después, marca "Cobrar al recoger" para que quede con saldo pendiente.',
        simLabel: 'Simular orden pagada en efectivo ($140.00)',
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
    id: 'saldos-pendientes',
    title: '2. Saldos pendientes: sucursal, hora y si sigue activa',
    subtitle: 'Cómo detectar qué falta por cobrar, de qué sucursal es, a qué hora se creó y en qué etapa va.',
    badge: 'Cobranza y control',
    durationLabel: '4 pasos · ~2 min',
    steps: [
      {
        tab: 'inicio',
        adminTab: 'resumen',
        selector: '[data-tour="overview-stats"]',
        title: 'Detecta al instante si falta algo por cobrar',
        description:
          'En Inicio (o en el Centro de Control Admin) el cuadro "Por cobrar" se resalta en ámbar cuando hay dinero pendiente. Al tocarlo te lleva directo al listado filtrado con esas órdenes.',
        tip: 'En la barra superior siempre ves la sucursal activa y si su turno de Caja está abierto.',
      },
      {
        tab: 'ordenes',
        adminTab: 'resumen',
        selector: '[data-tour="orders-panel"] .order-toolbar',
        title: 'Filtra por "Por cobrar" y por fecha',
        description:
          'Usa el selector derecho para elegir "Por cobrar" y los botones de fecha (Hoy, Ayer, Últimos 7 días) para encontrar órdenes atrasadas o del turno anterior.',
        tip: 'En Mostrador puedes abrir el mismo listado sin salir de caja con el botón "Órdenes" en la esquina superior derecha.',
      },
      {
        tab: 'ordenes',
        adminTab: 'resumen',
        selector: '.order-list',
        title: 'Cómo leer sucursal, hora, folio y si sigue activa',
        description:
          'Cada tarjeta te da todo de un vistazo: el prefijo del folio indica la sucursal (LOM- Lomas, TRE- Treviño); junto al folio ves la etapa activa (Recibido, Lavado, Secado o Listo); abajo aparece el cliente y la hora exacta; y la etiqueta ámbar muestra el saldo "Pendiente $XX.XX".',
        tip: 'Las órdenes con etiqueta "Entregado" se atenúan para distinguirlas fácilmente de las que siguen activas.',
      },
      {
        tab: 'ordenes',
        adminTab: 'finanzas',
        selector: '.order-list',
        title: 'Cobra un encargo pendiente o confirma una transferencia',
        description:
          'Si el cliente dejó el encargo "Cobrar al recoger", presiona "Cobrar" para abrir el panel de pago. Si pagó por transferencia y falta validarla en banco, presiona "Confirmar" o abre la tarjeta para ingresar la referencia.',
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
    id: 'ciclo-encargo',
    title: '3. Ciclo de encargo, tablero Kanban y WhatsApp',
    subtitle: 'Sigue el progreso Recibido → Lavado → Secado → Listo y avisa al cliente cuando esté terminado.',
    badge: 'Operación diaria',
    durationLabel: '3 pasos · ~90 seg',
    steps: [
      {
        tab: 'ordenes',
        adminTab: 'resumen',
        selector: '.view-toggle-group',
        title: 'Alterna entre vista Lista y tablero Kanban',
        description:
          'En la pestaña Órdenes cambia al modo "Kanban" para ver 4 columnas visuales: Recibido, Lavado, Secado y Listo. Es ideal en tablets para controlar el taller de un vistazo.',
        tip: 'Cada columna te permite avanzar de etapa con un solo toque.',
      },
      {
        tab: 'ordenes',
        adminTab: 'resumen',
        selector: '.order-list',
        title: 'Avanza etapas y asigna equipo al pasar',
        description:
          'Al expandir un encargo ves la barra de progreso de 5 pasos y puedes asignar la lavadora o secadora correspondiente; al avanzar de etapa la máquina anterior se libera automáticamente.',
        simLabel: 'Simular avance de etapa en una orden activa',
        simulate: (state, branchId) => {
          const candidate =
            state.orders.find(
              (o) =>
                o.branchId === branchId &&
                o.serviceType === 'encargo' &&
                (o.encargoStage === 'recibido' || o.encargoStage === 'lavado' || o.encargoStage === 'secado'),
            ) ??
            state.orders.find(
              (o) =>
                o.serviceType === 'encargo' &&
                (o.encargoStage === 'recibido' || o.encargoStage === 'lavado' || o.encargoStage === 'secado'),
            );
          if (!candidate) return state;
          const res = advanceEncargoStage(state, candidate.id, { actorLabel: 'Modo Práctica' });
          return res.ok ? res.state : state;
        },
      },
      {
        tab: 'ordenes',
        adminTab: 'resumen',
        selector: '.order-list',
        title: 'Avisa por WhatsApp y registra la entrega',
        description:
          'Cuando un encargo llega a "Listo", aparece automáticamente el mensaje prellenado con folio, sucursal y saldo (si debe algo) para abrir WhatsApp en 1 clic. Al entregar al cliente, presiona "Entregar".',
        tip: 'No podrás entregar un encargo si aún tiene saldo pendiente por cobrar.',
      },
    ],
  },
  {
    id: 'clientes-lealtad',
    title: '4. Agregar cliente, Lealtad 10+1 y Rifa anual',
    subtitle: 'Cómo dar de alta clientes frecuentes, revisar su avance hacia el combo gratis y ver boletos de rifa.',
    badge: 'Fidelización',
    durationLabel: '3 pasos · ~90 seg',
    steps: [
      {
        tab: 'clientes',
        adminTab: 'clientes',
        selector: '[data-tour-page="clientes"]',
        title: 'Abre el alta desde "Nuevo cliente"',
        description:
          'En la pestaña Clientes presiona "Nuevo cliente" para abrir el panel lateral de registro. Captura nombre completo, teléfono a 10 dígitos y confirma si autoriza avisos por WhatsApp.',
        simLabel: 'Simular registro de cliente frecuente',
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
        title: 'Consulta el progreso 10+1 y el historial por folio',
        description:
          'A la izquierda buscas por nombre o teléfono; a la derecha ves su barra de progreso hacia 10 combos, sus combos gratis disponibles, boletos de rifa emitidos y todas sus órdenes.',
        tip: 'Los combos se acreditan automáticamente al completar órdenes pagadas a nombre del cliente.',
      },
      {
        tab: 'admin',
        adminTab: 'clientes',
        selector: '[data-tour="admin-panel"]',
        title: 'Controla los boletos y ejecuta la Rifa Anual',
        description:
          'Cuando un cliente canjea su combo gratis y termina la orden, recibe un boleto digital único para el sorteo anual que Supervisión puede ejecutar con historial auditable.',
      },
    ],
  },
  {
    id: 'equipos-monitoreo',
    title: '5. Agregar lavadora/secadora y ver tiempos de ciclo',
    subtitle: 'Alta de máquinas al padrón, seguimiento de ciclos en uso y reporte fuera de servicio.',
    badge: 'Taller y equipos',
    durationLabel: '3 pasos · ~90 seg',
    steps: [
      {
        tab: 'equipos',
        adminTab: 'equipos',
        selector: '[data-tour-page="equipos"]',
        title: 'Filtra por estado con las tarjetas superiores',
        description:
          'Toca Disponibles, En uso o Fuera de servicio para enfocar solo los equipos que te interesan. En el Portal Admin cuentas además con el Mapa Visual de planta por zonas.',
      },
      {
        tab: 'equipos',
        adminTab: 'equipos',
        selector: '.machine-grid',
        title: 'Revisa qué folio ocupa cada equipo y su tiempo estimado',
        description:
          'Las máquinas en uso muestran el folio asignado, una barra de progreso del ciclo y los minutos transcurridos/restantes estimados para responder rápido si un cliente pregunta por su ropa.',
        tip: 'Si una máquina falla, captura el motivo y presiona "Fuera de servicio" para bloquearla en Mostrador.',
      },
      {
        tab: 'equipos',
        adminTab: 'equipos',
        selector: '.equipos-toolbar',
        title: 'Agrega una nueva lavadora o secadora (Supervisión)',
        description:
          'Presiona "Agregar equipo", define un código corto (ej. L4, S3), su nombre o capacidad y el tipo (Lavadora o Secadora). Quedará disponible de inmediato para asignar en órdenes.',
        simLabel: 'Simular alta de lavadora "L-DEMO"',
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
    id: 'caja-corte',
    title: '6. Arqueo de efectivo, transferencias y corte 23:00',
    subtitle: 'Cuenta billetes y monedas, concilia pagos externos, cierra turno y exporta a Excel.',
    badge: 'Caja y finanzas',
    durationLabel: '3 pasos · ~2 min',
    steps: [
      {
        tab: 'caja',
        adminTab: 'finanzas',
        selector: '[data-tour="caja-panel"]',
        title: 'Usa el contador interactivo de billetes y monedas',
        description:
          'En Caja abre "Contar billetes y monedas" para ingresar la cantidad de piezas de cada denominación ($1,000 a $0.50). El total y la diferencia (Cuadrado, Sobrante o Faltante) se calculan al instante.',
      },
      {
        tab: 'caja',
        adminTab: 'finanzas',
        selector: '.transfer-inbox, [data-tour="caja-panel"]',
        title: 'Registra entradas/retiros y verifica transferencias',
        description:
          'Registra compras de insumos o retiros con su motivo y confirma en lote las transferencias SPEI o pagos con terminal que ya reflejen en tu cuenta bancaria.',
      },
      {
        tab: 'caja',
        adminTab: 'finanzas',
        selector: '.night-closing-card, [data-tour="caja-panel"]',
        title: 'Corte nocturno de las 23:00 y Excel (.xlsx)',
        description:
          'Consulta el historial de turnos y cierres nocturnos. Desde "Exportar Excel" descargas un libro .xlsx con hojas separadas para turnos y movimientos de caja.',
      },
    ],
  },
];
