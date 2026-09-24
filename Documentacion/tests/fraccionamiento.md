# Tests de negocio — Cambiar la periodicidad a mitad de un plan de pagos/cobros

**Pregunta del cliente:** empezar con una cuenta a 10 meses con amortización mensual y, después del mes 4,
cambiar el monto restante a periodicidad semanal. ¿Se puede?

**Respuesta corta: sí, con "Fraccionar este pago" (una sola cuenta con cuotas). No, con "Frecuencia de Pago".**
Ejecutado en Dev el 2026-09-24: `cd app && npm run test:negocio:fraccionamiento` (22 casos: 21 PASS, 1 INFO, tras corregir H1 y H7). Ojo: los tests recorren la **capa de servicio** (las mismas funciones que llama la pantalla), no la
interfaz gráfica; la pantalla no se probó en un navegador.

## Por qué hay "doble registro" de periodicidad

Son dos mecanismos distintos que el formulario deja convivir con nombres parecidos:

| | **Frecuencia de Pago** | **Fraccionar este pago** ("Configurar Cuotas") |
|---|---|---|
| Qué crea | **Varias cuentas** independientes, cada una por el monto **íntegro** | **Una cuenta** con varias cuotas (filas en `pagos`/`cobros`, estado `programado`) |
| Reparte el monto | No | Sí (las cuotas deben sumar lo que falta pagar) |
| Se puede usar a la vez | No: en el alta, si hay serie periódica no se usan cuotas (`CuentaPagarModal.svelte`) | — |
| Existe en Cobrar | No (solo Pagar) | Sí (Pagar y Cobrar) |
| Cambiar la periodicidad después | **No regenera nada** (ver F-14) | **Sí**, reemplaza las cuotas pendientes (F-03…F-09) |

Para el caso del cliente (préstamo/compra a 10 meses que después cambia de ritmo) el mecanismo correcto es
**Fraccionar**: en Editar → "Configurar Cuotas", el sistema solo reparte lo que falta
(`monto_comprometido − monto_pagado`), no toca las cuotas ya pagadas, y permite elegir otra periodicidad.

## Casos

### A. Cuenta por Pagar fraccionada: 10 meses → semanal tras el mes 4

| ID | Caso | Resultado |
|---|---|---|
| F-01 | Cuenta de 10 000 con 10 cuotas mensuales de 1000 | PASS |
| F-02 | Tras pagar 4 cuotas (`confirmar_pago_cuota`): pagado 4000, saldo 6000, 4 pagadas + 6 programadas | PASS |
| F-03 | Cambiar el saldo restante a 12 cuotas semanales de 500 se acepta | PASS |
| F-04 | Las 4 cuotas ya pagadas y sus transacciones quedan intactas (mismos ids) | PASS |
| F-05 | Las 6 mensuales pendientes se reemplazan por 12 semanales de 500 | PASS |
| F-06 | Las nuevas cuotas quedan a 7 días exactos y después de la última cuota pagada | PASS |
| F-07 | Totales: pagado + programado = 10 000, saldo 6000, auditoría limpia | PASS |
| F-08 | Se puede pagar la primera cuota semanal (pagado 4500, saldo 5500) | PASS |
| F-09 | Segundo cambio (semanal → mensual, 5 × 1100) conserva las 5 pagadas y cuadra | PASS |
| F-10 | Re-fraccionar con más que el saldo restante (10 000 en vez de 5500) se rechaza | PASS (corregido, H1) |
| F-11 | Juntar el saldo en una sola cuota y pagarla deja la cuenta pagada, auditoría limpia | PASS |
| F-12 | Pagar una cuota de 1000 con una transacción de 600: la cuota se parte (600 pagado + 400 programado) y todo cuadra | PASS (corregido, H7) |
| F-12b | Pagar una cuota de 1000 con una transacción de 1500 se rechaza y no cambia nada | PASS |

### B. Con "Frecuencia de Pago" (serie de cuentas)

| ID | Caso | Resultado |
|---|---|---|
| F-13 | Frecuencia mensual a 10 meses genera 10 cuentas de 1000, todas de golpe | PASS |
| F-14 | Cambiar `frecuencia_pago` a "semanal" en una cuenta de la serie **no** reprograma las 6 restantes (sigue habiendo 10 cuentas) | INFO |
| F-15 | Alternativa manual: dar de baja las 6 restantes y crear una serie semanal por el saldo (12 × 500 = 6000) | PASS |
| F-16 | Las series no dejan inconsistencias en la auditoría global | PASS |

La vía B **se puede lograr, pero a mano** (dar de baja seis cuentas y crear otra serie), perdiendo el vínculo
entre ambas partes del plan. No la recomendamos para este caso.

### C. Cuenta por Cobrar fraccionada (mismo cambio)

| ID | Caso | Resultado |
|---|---|---|
| F-17 | Plan de 10 cuotas mensuales | PASS |
| F-18 | Tras cobrar 4 cuotas: 4 cobradas + 6 programadas | PASS |
| F-19 | Cambio a semanal del saldo restante: conserva las 4 cobradas y deja 12 cuotas a 7 días | PASS |
| F-20 | La auditoría no encuentra inconsistencias | PASS |
| F-21 | Cobrar 600 de una cuota de 1000: 600 cobrado + 400 programado, saldo 2400, auditoría limpia | PASS |

## Hallazgos (corregidos en Dev, pendientes en Producción)

**H7 — pago parcial de una cuota.** Antes, pagar 600 de una cuota de 1000 dejaba la cuota "pagada por 1000".
Ahora se parte: 600 `pagado` + 400 `programado` en la misma fecha; una transacción mayor que la cuota se rechaza.
Resuelve la duda "¿los pagos parciales se manejan como fraccionamiento?": sí.

**H1 — validación en el servidor.** Un re-fraccionamiento debe sumar exactamente lo que falta por pagar/cobrar
(F-10).

## Recomendación para el cliente

1. Crear la cuenta con Forma de Pago = Crédito y "Configurar Cuotas" en 10 cuotas mensuales.
2. Registrar cada pago confirmando su cuota (no como pago nuevo suelto).
3. Al cambiar el ritmo: Editar la cuenta → Configurar Cuotas → elegir Periodicidad semanal; el monto a repartir
   ya es solo el saldo restante.
4. Pagos parciales de una cuota: se registran normalmente; el resto queda como una cuota pendiente.
5. Requiere aplicar en Producción las migraciones y la nueva versión de la app (ver README de esta carpeta).
