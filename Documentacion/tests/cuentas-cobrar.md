# Tests de negocio — Cuentas por Cobrar

Servicio: `app/src/lib/modules/cuentas-cobrar/services/cuentasCobrar.service.ts`. RPCs: `fn_confirmar_cobro`,
`fn_recalcular_cuenta_cobrar`, `fn_crear_transaccion`. Ejecutado en Dev el 2026-09-25
(`cd app && npm run test:negocio`). Contexto de negocio: [FlujoDeNegocio.md §5](../FlujoDeNegocio.md).

**Modelo actual (decisión del cliente, H6):** igual que Cuentas por Pagar. `monto_cobrado` y `saldo_pendiente`
salen de **los cobros `cobrado` de la propia cuenta** (`fn_recalcular_cuenta_cobrar`), no de todos los ingresos
hacia el centro de costo. `id_centro_costo` sigue siendo el centro que recibe el ingreso (destino del cobro).
El monto de la cuenta está siempre en soles; con `moneda = USD`, `monto = monto_dolares × tipo_cambio`.

> Antes de H6 el saldo salía de todos los ingresos al centro. Así funcionaba en Producción: las 6 cuentas reales
> tienen 0 cobros propios y su saldo venía solo de transacciones sueltas. Por eso H6 va acompañado de un backfill
> (`20260925000100_backfill_cobros_desde_ingresos_al_centro.sql`) que convierte esos ingresos en cobros.

## Casos

| ID | Dado / Cuando / Entonces | Resultado |
|---|---|---|
| C-01 | Una cuenta nueva sobre un centro que ya recibió ingresos nace sin cobrado (los ingresos ajenos no cuentan) | PASS |
| C-03 | Un cobro parcial de 1000 deja cobrado 1000 y saldo 19 000 (solo cuenta ese cobro) | PASS |
| C-04 | La transacción del cobro conserva `categoria` y es de tipo `ingreso` | PASS |
| C-05 | Un cobro que excede lo que falta por cubrir se rechaza | PASS |
| C-06 | Dos cuentas sobre el mismo centro son independientes (el cobro de A no cambia a B) | PASS |
| C-07 | Un ingreso suelto al mismo centro no altera la cuenta; la auditoría sigue limpia | PASS |
| C-08 | Fraccionar 3000 en 1000 + 1000 (suma 2000) se rechaza (H1) | PASS |
| C-09 | `monto = 0` se rechaza | PASS |
| C-10 | Sin `id_centro_costo` se rechaza (obligatorio) | PASS |
| C-11 | `fecha_vencimiento` anterior a `fecha_emision` debería rechazarse | **FAIL** → H3 (abierto) |
| C-12 | Cuenta en USD: `monto = 1000 × 3.75 = 3750` y saldo 3750 | PASS |
| C-13 | Auditoría de las cuentas creadas en la corrida: sin inconsistencias | PASS |
| C-14 | Cobrar US$400 a TC 3.75 en esa cuenta descuenta 1500 soles (saldo 2250) (H4) | PASS |

Además, en [fraccionamiento.md](fraccionamiento.md): cobro parcial de una cuota la parte (F-21) y cambio de
periodicidad a mitad de plan (F-17 a F-20).

## Hallazgos

Corregidos en Dev (código + migraciones), **pendientes de aplicar en Producción**: H1 (suma de cuotas validada
en el servidor), H4 (dólares: el cobro descuenta el equivalente en soles y la transacción en dólares exige tipo de
cambio), H5 y H6 (ahora el saldo solo cambia cuando cambian los cobros de la cuenta, así que ya no se desactualiza
por ingresos ajenos), H7 (cobro parcial de una cuota la parte).

**H3 — vencimiento anterior a la emisión (C-11).** Sigue abierto: se acepta y la cuenta nace "vencida".

**Consecuencia a vigilar de H6.** Un ingreso registrado como transacción suelta, o el adelanto que se crea al
cerrar una venta, **ya no reduce el saldo de la cuenta por cobrar** a menos que se vincule a ella (registrar
cobro, o "Vincular con Cuenta por Cobrar" al crear la transacción). Conviene decidir si el adelanto de cierre de
venta debe crear también un cobro sobre la cuenta.

## Campos sospechosos / redundantes

| Campo | Observación |
|---|---|
| `monto_cobrado`, `saldo_pendiente`, `estado` | Derivados de `cobros` y guardados; cuadran (C-13) |
| `id_proyecto` (cuenta) vs proyecto del `id_centro_costo` | Dos formas de apuntar al proyecto; en las pruebas quedó `null` aunque el centro es de un proyecto |
| `"condición_pago"` | Columna con tilde literal; smallint sin catálogo definido |
| `monto`, `monto_dolares`, `tipo_cambio`, `moneda` | `monto` se recalcula solo en USD; en PEN los otros dos quedan vacíos |
| `numero_opracion` (`cobros`) vs `num_operacion` | Dos columnas casi idénticas en la misma tabla (una con typo) |
| `cobros.cuenta_banco` | Texto libre; no se enlaza a `cuenta_banco` |
