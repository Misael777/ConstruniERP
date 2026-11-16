# Tests de negocio — ConstruniERP

Casos de prueba que verifican que el **flujo de datos** de cada módulo tiene sentido de negocio (no solo que
el código compile): que los saldos cuadren, que las reglas se hagan cumplir en el servidor, y que no haya
campos redundantes o mal alimentados. Punto de partida: [FlujoDeNegocio.md](../FlujoDeNegocio.md).

## Cómo se ejecutan

Contra la base de **Desarrollo** (nunca Producción), usando el servidor MCP `construnierp-dev`, que llama a
las mismas funciones de servicio que la UI (`*.service.ts`), no a INSERTs crudos:

```bash
cd app
npm run seed:dev        # datos base sintéticos (idempotente)
npm run test:negocio    # ejecuta los casos y muestra PASS / FAIL / INFO
```

`scripts/tests-negocio-cuentas.mjs` deja filas marcadas `TEST-D` en Dev; para volver a empezar de cero:
`TRUNCATE ... RESTART IDENTITY CASCADE` en el SQL Editor de Dev (ver `supabase/migrations/README.md`) y
`npm run seed:dev`.

## Formato de cada caso

| ID | Caso | Resultado |
|---|---|---|

- **PASS** — el sistema se comporta como el negocio espera.
- **FAIL** — el sistema acepta/hace algo que el negocio no debería permitir, o deja datos inconsistentes.
  Cada FAIL está explicado en la sección "Hallazgos" del documento del módulo, con su impacto.
- **INFO** — comportamiento que no es un error pero hay que conocer (regla de diseño no obvia). Se
  documenta qué hace realmente el sistema.

Las herramientas `auditar_cuentas_pagar` / `auditar_cuentas_cobrar` (agent-tools) recalculan los saldos desde
la fuente y reportan inconsistencias; se pueden llamar en cualquier momento, también contra Producción
(solo lectura).

## Módulos

| Módulo | Documento | Estado |
|---|---|---|
| Cuentas por Pagar | [cuentas-pagar.md](cuentas-pagar.md) | 27 casos ejecutados (2026-09-25) |
| Cuentas por Cobrar | [cuentas-cobrar.md](cuentas-cobrar.md) | 13 casos ejecutados (2026-09-25) |
| Cambio de periodicidad a mitad de plan (Pagar y Cobrar) | [fraccionamiento.md](fraccionamiento.md) | 22 casos ejecutados (2026-09-25) — `npm run test:negocio:fraccionamiento` |
| El lápiz de las cuotas y montos desiguales | [lapiz-cuotas.md](lapiz-cuotas.md) | 12 casos ejecutados (2026-09-25) — `npm run test:negocio:lapiz` |
| Control Financiero (de punta a punta, todas las pestañas) | [control-financiero.md](control-financiero.md) | 1211 casos (2026-11-12) — `npm run test:negocio:control-financiero` |
| Transacciones, Centro de Costos, Cuentas Bancarias, Ventas, Facturación | — | pendientes |

## Hallazgos (resumen)

Verificados en Dev. Detalle e impacto en cada documento.

| # | Hallazgo | Estado |
|---|---|---|
| H1 | El servidor aceptaba un fraccionamiento cuyas cuotas no suman lo que falta por pagar/cobrar | Corregido en Dev (`validarSumaFracciones`) |
| H2 | La columna `id_cuenta_pagar_padre` no existía en Producción (las series se creaban sin encadenar) | Migración `20260924170000` aplicada en Dev; **pendiente en Producción** |
| H3 | Se acepta `fecha_vencimiento` anterior a `fecha_emision`; la cuenta nace "vencida" | **Abierto** (baja gravedad, sin arreglo pedido) |
| H4 | Un pago/cobro en dólares descontaba el número tal cual, sin convertir. Las cuentas por pagar ahora pueden estar en dólares | Corregido en Dev; **pendiente en Producción** |
| H5 | El saldo guardado de una cuenta por cobrar se desactualizaba cuando entraba un ingreso ajeno | Resuelto por H6 |
| H6 | El saldo de Cobrar salía de todos los ingresos al centro (doble conteo). Decisión del cliente: que salga de los cobros propios, como Pagar | Corregido en Dev con backfill; **pendiente en Producción** |
| H7 | Pagar una cuota de 1000 con una transacción de 600 dejaba la cuota en 1000. Ahora la parte (600 pagado + 400 programado); una transacción mayor se rechaza | Corregido en Dev; **pendiente en Producción** |
| H8-H10 | Lápiz de cuotas: una cuota podía quedar en negativo, la única cuota pendiente descuadraba la cuenta y se podía cambiar el monto de una cuota ya pagada | Corregido en Dev (solo código de la app); **pendiente en Producción** |

**Pendiente en Producción, en este orden:** migraciones `20260924170000`, `20260925000000` y
`20260925000100`, y publicar la versión de la app que trae el código (los cambios de servicios y modales van
acoplados a las funciones SQL). El backfill conserva los saldos actuales de las 6 cuentas por cobrar reales.

Corregido antes: `fn_crear_transaccion` descartaba `categoria`, `tipo_moneda`, `tipo_cambio`, `monto_convertido` y los
campos de documento pendiente (migración `20260924160000`, ya en Producción).

## Hallazgos de datos y de tickets de cliente (2026-09-25)

- **Dos cuentas bancarias activas con el mismo `numero_cuenta` en Producción** (cajas `EFECTIVO` de GUILLERMO y de
  WILLY): comparten transacciones y saldo (ambas muestran 25 000 por la transacción #259) y rompían el desplegable
  de Cuenta destino (`each_key_duplicate`). El código ya rechaza duplicados, el desplegable los tolera y una Cuenta Efectivo sin número recibe uno
  generado (`EFECTIVO-<n>`). La migración `20260925130000` renombra la duplicada (`EFECTIVO-16`), recalcula saldos y crea
  el índice único; la transacción #259 queda con la cuenta más antigua (GUILLERMO) — si era de WILLY, basta corregir
  su `cuente_destino`.
- **Sesión perdida sin aviso:** cuando el refresco del token falla, las consultas salen como `anon`; las tablas sin
  RLS siguen funcionando pero `empleados`, `documento_proyecto`, etc. devuelven vacío o `42501`. Ahora la app avisa
  y redirige al login (`onAuthStateChange` en el layout) y `describeError` traduce esos errores.
- **Guardado de venta no atómico:** el proyecto se inserta antes que sus documentos; ahora se deshace si falla lo
  demás y el doble clic se bloquea de forma síncrona.
