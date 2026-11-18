# HOREB 360 · Demo Operativa

Demostración web en español (tablet y escritorio) para **HOREB 360**, con datos 100% ficticios, montos en **MXN** almacenados en **centavos enteros** y persistencia local en un perfil de navegador (`localStorage`).

## Arranque rápido

Usa Node.js 22.12 o una versión LTS posterior.

```powershell
npm.cmd ci
npm.cmd run dev
```

Abrir la URL local que muestre Vite (por ejemplo `http://localhost:5173`).

### Compilación y pruebas

```powershell
npm.cmd test
npm.cmd run build
```

## Recorrido de la demo

- **Inicio** muestra los cobros confirmados de los últimos siete días, el saldo por cobrar, las etapas y los folios recientes de la sucursal seleccionada.
- **Cargar ejemplos** llena una demo vacía con 15 órdenes ficticias de las tres sucursales. La opción se oculta en cuanto hay órdenes, movimientos o cortes guardados. El botón **Reiniciar datos** pide confirmación y devuelve el turno inicial sin órdenes.
- **Mostrador** permite autoservicio o encargos. **Órdenes** permite buscar por folio o alias y filtrar por etapa, saldo o autoservicio. El buscador muestra la sucursal seleccionada.
- **Caja** permite abrir un turno con fondo inicial y anotar entradas y retiros con motivo. Esos movimientos modifican el efectivo esperado y permanecen en el historial. Los reportes de ventas cuentan pagos confirmados.
- **Reportes** consolida las tres sucursales y exporta los importes a CSV.

## Demo compartida con Supabase

La demo local conserva los datos del navegador. La demo compartida usa Supabase Auth, Postgres y una Edge Function que valida los cobros, el cierre y el estado del turno aplicando las mismas reglas TypeScript que la demo local.

1. Completa `.env.local` a partir de `.env.example` con la URL y la clave publicable del proyecto.
2. Enlaza y aplica la migración con `supabase link --project-ref TU_PROJECT_REF` y `supabase db push`. Despliega con `supabase functions deploy horeb-operation --project-ref TU_PROJECT_REF --use-api --no-verify-jwt`. La función valida el token con Supabase Auth antes de realizar operaciones.
3. Crea usuarios desde Auth y registra su asignación en `public.horeb_memberships`. Agrega una fila por usuario y sucursal. `operator` opera pedidos y cobros de la sucursal asignada. `supervisor` también abre y cierra turnos y registra movimientos de efectivo. Usa cuentas de prueba con contraseñas individuales.
4. Arranca con `npm.cmd run dev` y abre **Abrir demo compartida** en el menú. El panel actualiza las sucursales habilitadas cada ocho segundos y también permite actualizar manualmente.

Cada sucursal guarda una versión de órdenes, pagos, tickets y turnos en `horeb_branch_state`. La Edge Function es el único punto de escritura para caja y pedidos desde la app. Postgres registra la operación y su versión en la misma transacción. Un guardado basado en una versión anterior debe revisarse después de recargar, y el reintento del mismo identificador conserva un solo folio. Los datos de la demo local y la compartida usan almacenamiento independiente.

La beta compartida usa datos ficticios y confirmaciones simuladas. El almacenamiento por sucursal en JSONB se eligió para conservar el flujo actual del prototipo. Antes de operar con clientes reales, se requiere modelar los registros operativos para auditoría y reportes, validar recuperación y periféricos y acordar accesos de cada empleado. Configura las variables con un proyecto propio al publicar la app. Nunca incluyas claves administrativas ni contraseñas en el frontend o en el repositorio.

## Cómo reiniciar datos de prueba

1. En la barra superior derecha, pulsar **Reiniciar datos** y luego **Confirmar reinicio**.
2. Esto restablece la clave `horeb360_demo_state_v1` en `localStorage`, dejando abiertos los turnos `#1` de **Lomas**, **Treviño** y **Sucursal 3** sin órdenes previas.

## Alcance y supuestos de la demo

- **Sucursales:** `Lomas`, `Treviño` y `Sucursal 3` (nombre provisional), con el indicador **Modo demo** junto al selector de sucursal.
- **Combo base:** Lavado + Secado = `$70.00` MXN (`7000` centavos).
- **Mostrador:** Permite registrar **Autoservicio** o **Encargo** (con alias ficticio y avance `Recibido → Lavado → Secado → Listo → Entregado`). Un encargo se puede recibir sin pago y cobrarse después desde su folio. Captura el efectivo recibido y los importes de tarjeta o transferencia. Puedes dejar los métodos que no usas vacíos. El mostrador calcula el cambio y aplica solo el importe de la venta. La tarjeta y la transferencia siguen simuladas.
- **Pagos externos y cortes de caja:** El efectivo se confirma al instante; tarjeta y transferencia pueden quedar pendientes y confirmarse después mediante acción explícita. Al confirmar un pago pendiente después de cerrar un turno, se conserva el folio original y el corte del turno anterior, y el ingreso se registra en el turno abierto actual.
- **Ticket simulado:** Vista en pantalla marcada como comprobante simulado sin validez fiscal. Permite simular falla de emisión después de pagar y reintentar el mismo ticket bajo el mismo folio sin duplicar venta ni cobro. La entrega de un encargo solo se habilita cuando está en etapa **Listo**, tiene todo el pago confirmado y el ticket emitido.
- **Fuera de alcance en esta demo:** Multiusuario real, base de datos central, hardware/impresora física, cobros bancarios reales, WhatsApp, lealtad y APK.

## Revisión de reuso MIT y atribución

Se inspeccionaron los archivos de referencia indicados en `PLAN-PROTOTIPO.md` antes de elegir la arquitectura:

- **Custom-POS (MIT)** — [`TiredofSleep/Custom-POS`](https://github.com/TiredofSleep/Custom-POS), archivo [`tests/multistore-report.js`](https://github.com/TiredofSleep/Custom-POS/blob/11d627fc85ca47d25ac5f387965585f889a99faf/tests/multistore-report.js) (commit `11d627fc85ca47d25ac5f387965585f889a99faf`).
  - *Resultado:* La prueba citada usa un escenario en efectivo para comprobar totales por tienda. Codex ejecutó en Chrome esa prueba y la de asignación de órdenes por tienda del mismo commit. El flujo de pago, corte y ticket de HOREB requiere reglas propias. Se tomó el reporte por sucursal como referencia.
- **Olgax POS (MIT)** — [`OLGAX-com/olgax-pos`](https://github.com/OLGAX-com/olgax-pos), archivo [`src/components/pos/payment-panel.tsx`](https://github.com/OLGAX-com/olgax-pos/blob/42bc199438741b56631ec95e150d0600beceec17/src/components/pos/payment-panel.tsx) (commit `42bc199438741b56631ec95e150d0600beceec17`).
  - *Resultado:* Acoplado a Next.js, `next-intl` y stores propios de carrito con impuestos/propinas, con una ruta de venta que no exige suma exacta en el servidor. Se tomó como referencia conceptual para las líneas de pago dividido.
- **Decisión:** Conforme al plan, Antigravity armó la aplicación en **React + TypeScript + Vite**. Se usaron las reglas de caja y reportes de los repos como referencias, sin incorporar su código.

## Evidencia de verificación

- `npm.cmd test` (`vitest run --config vite.config.mjs`): **10 pruebas aprobadas**. Las cinco pruebas originales están en [src/domain/rules.test.ts](src/domain/rules.test.ts):
  1. Manejo de centavos enteros MXN sin flotantes.
  2. Rechazo de reparto de `$69.00` para venta de `$70.00` y aceptación de reparto exacto.
  3. Caso **Treviño** (recepción sin cobro, bloqueo de ticket con saldo, `$30` efectivo + `$40` transferencia pendiente, corte, apertura de turno nuevo, confirmación posterior en el turno nuevo conservando folio y corte anterior, ticket y entrega).
  4. Simulación de falla de ticket después de pagar y reemisión sin duplicar venta ni ingresos.
  5. Cinco casos del plan de Carlos (`$350.00` total: `$120.00` efectivo, `$100.00` tarjeta, `$130.00` transferencia; totales por sucursal `$140.00`, `$70.00` y `$140.00`).
- `npm.cmd run build` (`tsc --noEmit && vite build --config vite.config.mjs`): **compilación exitosa** sin errores de TypeScript (`dist/` generado).

- Codex verificó en Chrome a 800 px el encargo desde recepción hasta entrega, el rechazo de $69, el corte con $40 pendientes, la confirmación en el turno siguiente, el reintento del ticket y la persistencia tras recargar. La interfaz cargó sin desbordamiento horizontal a 1366, 800 y 390 px. Las resoluciones se simularon en Chrome en esta computadora.
