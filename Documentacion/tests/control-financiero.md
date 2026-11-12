# Control Financiero — prueba de punta a punta

`npm run test:negocio:control-financiero` (desde `app/`), **solo contra Dev**. Última corrida: 12/11/2026 — **1211 PASS · 0 FAIL · 6 INFO**.

## Qué hace

1. Anula lo que haya quedado de corridas anteriores y registra un **punto de corte** de ayer que deja Dev cuadrado
   (Σ cuentas = Σ centros). Al final anula todo lo suyo y elimina ese corte: Dev queda como estaba.
2. Crea sus propias cuentas bancarias (corriente, 2 cajas de efectivo, una en 0, una en dólares) y 3 proyectos con
   venta cerrada (2 obras, 1 consultoría), todo marcado `E2E-CF-…`.
3. Recorre ~20 pasos: cuentas por cobrar (fraccionada y al contado) y sus cobros, cuenta por pagar y su pago,
   transferencia interna, egreso corporativo, financiamiento, edición de monto y de cuenta, duplicado, anular y
   reactivar cobros y pagos, centro de costo en negativo, cuenta bancaria en negativo, dólares, puntos de corte
   (mismo día y descuadrado), conciliación interna y bancaria manual, incidencias.
4. Después de **cada** paso lee TODAS las pestañas con las herramientas `cf_*` del MCP (que llaman a las mismas
   funciones que la pantalla) y compara contra el valor esperado calculado a mano:
   - por cada centro y cuenta de la suite: saldo en Conciliación = flujo neto en Rendimiento = nodo del grafo =
     saldo final de la trayectoria = saldo de la cuenta en Cuentas Bancarias;
   - cuadre Σ centros − Σ bancos, y que el Dashboard muestre la misma diferencia;
   - estado de cada chequeo de Consistencia; estado general del Dashboard tras "Ejecutar revisión";
   - IGV (base de compras, crédito fiscal, IGV estimado), totales de Rendimiento, resumen general, flujo de caja
     del mes, proyección, gastos corporativos, concentración por categoría, incidencias y su severidad.

## Herramientas MCP (agent-tools/tools/control-financiero.ts)

| Herramienta | Pestaña / acción | Entorno |
|---|---|---|
| `cf_dashboard` | Dashboard completo (salud, resumen, rendimiento + totales, grafo, flujo mensual, proyección, trayectorias) | Prod y Dev |
| `cf_consistencia_evaluar` / `cf_consistencia_ultima` | Chequeos en vivo sin guardar / última revisión guardada | Prod y Dev |
| `cf_conciliacion` | Cruce interno, saldo por centro y cuenta, historial, aperturas y puntos de corte | Prod y Dev |
| `cf_igv` | Resumen del mes, objetivo y semáforo, evolución, comprobantes, Control Mensual | Prod y Dev |
| `cf_incidencias` | Lista, abiertas, por estado/severidad | Prod y Dev |
| `cf_ejecutar_revision`, `cf_registrar_conciliacion_*`, `cf_crear_corte`, `cf_eliminar_corte`, `cf_resolver_y_cerrar_incidencia` | Botones de las pestañas | Solo Dev |
| `editar_transaccion`, `anular_transaccion`, `reactivar_transaccion`, `eliminar_transaccion`, `crear_proyecto_prueba`, `crear_cuenta_bancaria_prueba` | Para armar escenarios | Solo Dev |

El semáforo general y los totales de Rendimiento ahora son funciones compartidas (`calcularEstadoGeneral`,
`calcularTotalesRendimiento`, `calcularConcentracionGlobal`): la pantalla y el MCP no pueden dar números distintos.

## Hallazgos

| # | Hallazgo | Estado |
|---|---|---|
| CF1 | No había alerta de saldos negativos | **Corregido**: chequeo "Saldos negativos" (centro < 0 = error, cuenta bancaria < 0 = alerta) |
| CF2 | Rendimiento ignoraba transferencias y financiamientos (CORPORATIVO salía −500 tras recibir 500 y pagar 500) | **Corregido** |
| CF3 | Gastos corporativos sumaba centros de proyectos de consultoría, empleados, subcontratistas y centros de baja | **Corregido** |
| CF4 | Grafo de flujo con una regla de saldo distinta | **Corregido** |
| CF5 | Conciliación bancaria con el monto vacío se registraba como "Banco 0.00" e incidencia crítica | **Corregido** |
| CF6 | `cobros.cuenta_banco` (y n° de operación en cobros/pagos) de 20 caracteres: no se podía cobrar a "EFECTIVO - CAJA FUERTE S/" | **Corregido** (`20261112120000`, Dev y Producción) |
| CF7 | Reactivar un cobro/pago anulado contaba el dinero dos veces (la cuenta seguía debiéndolo) y nada lo detectaba | **Corregido** (`20261112130000` + chequeo de integridad, Dev y Producción) |
| CF8 | `anon` (sin iniciar sesión) podía crear/anular transacciones y confirmar cobros/pagos | **Corregido** (`20261112140000`, Dev y Producción) |
| CF9 | Tras un punto de corte, Control Financiero suma lo declarado pero el formulario de transacciones y el bloqueo por saldo no: no se puede gastar lo declarado | **Corregido en Dev** (`20261112150000`: el corte vale en todo el sistema, decisión del cliente); pendiente en Producción |
| CF10 | Dólares: un ingreso de $100 suma 100 (no S/ 375) al centro de costo, y Σ bancos suma dólares como soles | **Corregido en Dev** (`20261112150000`: centros en soles, cada cuenta en su moneda, tipo de cambio obligatorio entre monedas — decisión del cliente); pendiente en Producción |
| CF11 | La trayectoria de cuentas bancarias ignoraba el punto de corte | **Corregido** (solo app) |
| CF12 | Borrar una transacción con comprobante podía tumbar el proceso si no cargaba el cliente de Drive (promesa sin atrapar) | **Corregido** (solo app) |
| INFO | Un movimiento con la misma fecha del corte no cuenta (regla "solo después del corte"; la pantalla avisa) | Diseño |
| INFO | Se puede eliminar un ingreso ya gastado (el centro queda negativo) — ahora lo marca CF1 | Diseño |
| INFO | "Ingresos totales" del resumen general no incluye financiamientos ni transferencias | Diseño |
