# HOREB 360 · Plan de trabajo

17 de noviembre de 2026 · Demostración para Carlos

## Entrega inicial

Web en español para tablet y escritorio con el nombre HOREB 360. Usar datos ficticios, MXN y las sucursales Lomas, Treviño y Sucursal 3. Un combo de lavado y secado cuesta $70. Mostrar «Modo demo» cerca del selector de sucursal. Todo funciona en una sola sesión de navegador con persistencia al recargar. La validación multiusuario queda para el piloto.

- **Mostrador.** Elegir autoservicio o encargo. Registrar un combo y un folio de prueba. En autoservicio, capturar efectivo, tarjeta simulada o transferencia simulada. Permitir importes combinados que sumen exactamente $70. El efectivo confirmado cuenta en caja en el momento. Confirmar lados externos mediante una acción simulada explícita. Para encargo, guardar un alias ficticio, avanzar recibido → lavado → secado → listo y cobrar desde la misma orden. Habilitar entrega tras confirmar todo el pago y emitir ticket.
- **Ticket.** Usar una vista de comprobante en pantalla, identificada como simulada. Guardar folio y pago aunque falle la emisión. Permitir reintentar el mismo ticket sin duplicar la venta ni el cobro.
- **Caja.** Abrir un turno de prueba por sucursal, mostrar efectivo esperado, tarjeta confirmada, transferencia confirmada y saldo pendiente. Cerrar con efectivo contado y guardar un resumen. Una confirmación posterior al corte conserva el folio original y registra su ingreso en un turno abierto. Mostrar qué sucursal y turno se están consultando. Una vista de administración resume las tres sucursales.

El demo de Carlos sirve de referencia de operación. El nombre de la tercera sucursal sigue provisional. Usar diseño táctil sencillo, etiquetas claras, botones fáciles de pulsar, contraste y foco visibles. Mantener importes en centavos enteros y separar el estado del pago, la orden, el ticket y el turno. El panel administra el conjunto de datos ficticios de un navegador. El piloto añadirá backend, identidad, base central y permisos reales. Hardware, cobros externos, conciliación bancaria automática, WhatsApp, lealtad y APK se estiman tras el piloto. La demo usa el equipo existente y se ejecuta localmente.

## Cómo aprovechar código existente

| Proyecto | Qué revisar primero | Límite |
| --- | --- | --- |
| Custom-POS, MIT | Plantilla de tintorería, flujo por estaciones y pruebas de reportes por sucursal. Puede ahorrar la configuración de un primer flujo si permite el caso de aceptación con poca adaptación. | El hub es de referencia para red local, sin autenticación. Evitar integrarlo en la app de demo. |
| Olgax POS, MIT | Componente de pago dividido y estructura visual del ticket. Priorizar piezas que puedan usarse con el modelo de HOREB sin importar todo Next.js, el inventario ni sus dependencias. | Su ruta de venta no aplica la regla de importe exacto y su modelo no implementa el corte por turno y sucursal de HOREB. |
| Posnic, AGPL-3.0-only | Referencia para turnos, corte y roles. | Para mantener abierta la decisión de licencia de HOREB, usar la referencia funcional. |
| PocketPOS, MIT | Si se confirma APK, revisar sus pantallas de recibo y persistencia nativa con SQLite. | El backend central y el panel web requieren diseño propio. |

En la primera vuelta, invertir solo un intento breve en configurar o portar una pieza MIT. Si necesita cambiar el motor de caja o agregar dependencias pesadas, construir el flujo chico en React + TypeScript + Vite. Capturar en el README el resultado del intento. Para cualquier fragmento copiado, conservar el aviso completo de la licencia, el autor y el enlace al archivo y commit. Las ideas, los patrones de UI y los casos de prueba redactados de nuevo se pueden atribuir como referencias. Mantener los datos de los clientes y las credenciales fuera de este proyecto de demo.

- [Custom-POS y licencia](https://github.com/TiredofSleep/Custom-POS) · [Prueba consolidada por tienda](https://github.com/TiredofSleep/Custom-POS/blob/11d627fc85ca47d25ac5f387965585f889a99faf/tests/multistore-report.js)
- [Olgax POS y licencia](https://github.com/OLGAX-com/olgax-pos) · [Panel de pago](https://github.com/OLGAX-com/olgax-pos/blob/42bc199438741b56631ec95e150d0600beceec17/src/components/pos/payment-panel.tsx)
- [Posnic y licencia](https://github.com/Posnic/POS) · [PocketPOS y licencia](https://github.com/harshithasompura/pocket-pos)

## Orden de trabajo

1. Antigravity revisa el reuso por pieza, elige la ruta más corta y arma la demo funcional en esta carpeta. Favorecer una implementación local pequeña con React, TypeScript y Vite si no resulta viable configurar la plantilla. Incluir README con arranque, supuestos y procedencia. Mantener cualquier manipulación de archivos de proyecto dentro de esta carpeta.
2. Codex revisa el resultado y vuelve a correr los casos siguientes. Comprueba la vista de escritorio y el tamaño de tablet si se puede simular, corrige los fallos que encuentre y deja evidencia de lo comprobado.
3. Mostrarle a Carlos un turno de mostrador y un encargo. Si quiere usarlo en operación, confirmar la red, la impresora y los formatos de pago de una sucursal y contratar ese piloto como una entrega nueva. La base central, roles, auditoría, respaldo/restauración, instalación y capacitación pertenecen a esa propuesta. Probar primero con una sucursal y expandir después del corte validado.

## Casos para demostrar

- Treviño. Guardar el folio con $30 efectivo confirmado y $40 transferencia pendiente. El corte muestra $30 en efectivo y $40 de saldo. Cerrar y abrir un turno nuevo. La confirmación de los $40 cae en el turno nuevo y el corte anterior se conserva. Emitir el ticket y entregar al estar lista la orden.
- Capturar un reparto de $69 para una venta de $70 y verificar el rechazo. Guardar una vez el reparto correcto y refrescar. El folio se conserva.
- Simular falla del ticket después de pagar. Reemitir bajo el mismo folio, con el mismo total y sin duplicar ingresos.
- Usar los cinco casos del plan de Carlos como prueba de dominio. Lomas $70 efectivo y $70 tarjeta. Treviño $30 efectivo + $40 transferencia. Sucursal 3 $20 efectivo + $30 tarjeta + $20 transferencia y otra venta de $70 transferencia. Tras confirmar todos los componentes, el total es $350, compuesto por $120 efectivo, $100 tarjeta y $130 transferencia. Totales por sucursal $140, $70 y $140.

Entregar una demo que arranque con un comando, tenga una forma documentada de reiniciar datos de prueba y pase compilación y al menos una prueba de reglas de dinero. No publicar, instalar servicios globales ni usar datos o credenciales reales.
