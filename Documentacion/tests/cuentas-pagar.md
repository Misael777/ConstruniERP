# Tests de negocio — Cuentas por Pagar

Servicio: `app/src/lib/modules/cuentas-pagar/services/cuentasPagar.service.ts`. RPCs: `fn_confirmar_pago`,
`fn_recalcular_cuenta_pagar`, `fn_crear_transaccion`. Ejecutado en Dev el 2026-09-24
(`npm run test:negocio`). Contexto de negocio: [FlujoDeNegocio.md §5](../FlujoDeNegocio.md).

**Modelo:** una Cuenta por Pagar es una obligación; el dinero real es una Transacción de egreso enlazada
por una fila de `pagos`. `monto_pagado`, `saldo_pendiente` y `estado` se **derivan de `pagos`**
(`fn_recalcular_cuenta_pagar`), nunca se escriben a mano.

## Casos

| ID | Dado / Cuando / Entonces | Resultado |
|---|---|---|
| P-01 | Dada una cuenta nueva de 1000, entonces saldo = 1000, pagado = 0, estado `pendiente` | PASS |
| P-02 | `monto_imponible + monto_igv` = `monto_comprometido` (1000 → 847.46 + 152.54) | PASS |
| P-03 | Cuando se paga 400 de 1000, entonces pagado 400, saldo 600, estado `pendiente` | PASS |
| P-04 | La transacción del pago conserva `categoria` y es de tipo `egreso` (regresión del bug de `fn_crear_transaccion`) | PASS |
| P-05 | Sentido del dinero: origen = centro que paga, destino = centro del proveedor | PASS |
| P-06 | Un pago de 700 con saldo 600 se rechaza y no altera la cuenta | PASS |
| P-07 | Pagar el saldo restante deja saldo 0 y estado `pagado` | PASS |
| P-08 | La auditoría no encuentra inconsistencias tras pagos completos | PASS |
| P-09 | No se puede registrar un pago sobre una cuenta ya saldada | PASS |
| P-10 | Fraccionada en 3 cuotas de 2000: 3 pagos `programado`, saldo sigue en 6000 | PASS |
| P-11 | Con cuotas cubriendo el 100%, un pago suelto extra se rechaza | PASS |
| P-12 | Fraccionar 6000 en 2000 + 2000 (suma 4000) se rechaza (H1) | PASS |
| P-13 | Serie mensual: una cuenta por mes, cada una por el monto **íntegro** (no reparte) | PASS |
| P-14 | Serie mensual desde 31-oct recorta a fin de mes: 31-oct, 30-nov, 31-dic, 31-ene | PASS |
| P-15 | Las cuentas de una serie quedan encadenadas por `id_cuenta_pagar_padre` | PASS en Dev (H2 aplicada); falla en Producción hasta aplicar la migración |
| P-16 | Serie periódica sin `fin_periodo_pago` se rechaza | PASS |
| P-17 / P-18 | `monto_comprometido` 0 y −50 se rechazan | PASS |
| P-19 | `fecha_vencimiento` anterior a `fecha_emision` **debería** rechazarse | **FAIL** → H3 (abierto) |
| P-20 | Proveedor inexistente se rechaza con mensaje claro | PASS |
| P-21 | `frecuencia_pago = 'contado'` se rechaza (no es un valor real de la BD) | PASS |
| P-22 | Un pago de US$100 (TC 3.75) descuenta 375 soles, no 100 (H4) | PASS |
| P-23 | Auditoría de las cuentas creadas en la corrida: sin inconsistencias | PASS |
| P-24 | Cuenta en USD (1000 × 3.75): `monto_comprometido` 3750 soles y saldo 3750 | PASS |
| P-25 | Pagar US$400 a TC 3.75 en esa cuenta descuenta 1500 (saldo 2250) y la auditoría cuadra | PASS |
| P-26 | Una transacción en dólares sin tipo de cambio se rechaza | PASS |
| P-27 | Una cuenta en USD sin `monto_dolares`/`tipo_cambio` se rechaza | PASS |

## Hallazgos

Corregidos en Dev (código + migración `20260925000000`), **pendientes en Producción**:

- **H1** — el servidor ahora exige que las cuotas sumen exactamente `monto_comprometido − monto_pagado`
  (`validarSumaFracciones` en `createCuentaPagar`, `updateCuentaPagar` y `sincronizarCuotasProgramadas`; al editar,
  un calendario idéntico al guardado no se revalida para no bloquear cuentas viejas descuadradas).
- **H4** — las cuentas por pagar pueden estar en dólares: columnas `moneda`, `monto_dolares`, `tipo_cambio`
  (mismo esquema que Cobrar). `monto_comprometido` es siempre soles. Los pagos descuentan el equivalente en soles
  de su transacción (`fn_monto_soles_transaccion`), y `fn_crear_transaccion` exige tipo de cambio si la
  transacción es en dólares. Un pago a otro tipo de cambio que el de la cuenta descuenta según el suyo.
- **H7** — pagar una cuota programada con una transacción menor la parte (lo abonado queda `pagado`, el resto
  sigue `programado` en la misma fecha); mayor que la cuota se rechaza (`MONTO_EXCEDE_CUOTA`). Los pagos parciales
  se manejan, por tanto, como fraccionamiento.

Abiertos:

- **H2** — migración `20260924170000` (columna `id_cuenta_pagar_padre`) aplicada en Dev; falta Producción.
- **H3** — vencimiento anterior a la emisión (P-19).

## Campos sospechosos / redundantes

| Campo | Observación |
|---|---|
| `monto_pagado`, `saldo_pendiente`, `estado` | Derivados de `pagos` y guardados. Cuadran (P-08), pero cualquier escritura directa los desincroniza. Candidatos a vista/columna calculada |
| `monto_imponible`, `monto_igv` | Derivados de `monto_comprometido` (÷ 1.18). Se guardan; si cambia la tasa de IGV los históricos quedan con la vieja |
| `fotma_pago` | Typo en el nombre real de la columna (falta la "r"). Funciona, pero confunde |
| `condicion_pago` | Texto que se reutiliza como "Número de Cuotas"; el calendario real está en `pagos`. Dos fuentes de verdad |
| `fecha_pago_programada` vs `pagos.fecha_pago` (estado `programado`) | Dos lugares para la misma fecha futura |
| `id_presupuesto`, `id_partida` | Se digitan como número, sin selector; sin uso visible en el flujo probado |
| `categoria_gasto` (cuenta) vs `transaccion.categoria` | Dos catálogos distintos para lo mismo (PCGE vs categorías del ERP) |
| `medio_pago`, `referencia`, `tipo_documento`, `num_documento` | Se repiten en `pagos` y en `transaccion` |
| `id_cuenta_pagar_padre` | Ver H2 |
