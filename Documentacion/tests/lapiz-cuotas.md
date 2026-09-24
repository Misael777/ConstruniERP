# Tests de negocio — El "lápiz" de las cuotas y los montos desiguales

Ticket #30 pedía revisar "el lápiz para editar montos desiguales dentro de frecuencia de pagos". El lápiz de una
cuota es `updatePago` / `updateCobro` (editar monto, fecha, medio o referencia de UNA fila de `pagos`/`cobros`).
Ejecutado en Dev el 2026-09-25: `cd app && npm run test:negocio:lapiz` (12 casos, 12 PASS tras las correcciones).
Recorre la capa de servicio, no la pantalla en un navegador.

**Regla de negocio:** el total de una cuenta siempre debe seguir cuadrando. Al cambiar el monto de una cuota
pendiente, el sistema reajusta la **última** cuota pendiente por la diferencia (`rebalancearUltimaCuota`).

## Casos

| ID | Caso | Resultado |
|---|---|---|
| L-01 | Subir la cuota 2 de 1000 a 1500: la última baja a 500 y el total sigue en 5000 | PASS |
| L-02 | Bajar la cuota 1 a 600: la última sube a 900 | PASS |
| L-03 | Editar la propia última cuota: la diferencia se reparte en otra y el total cuadra | PASS |
| L-04 | Mover solo la fecha de una cuota no toca ningún monto | PASS |
| L-05 | Subir una cuota a 9000 en una cuenta de 5000 se rechaza con el máximo permitido | PASS (corregido, H8) |
| L-06 | Cambiar el monto de la única cuota pendiente se rechaza (debe valer lo que falta) | PASS (corregido, H9) |
| L-07 | Cambiar el monto de una cuota ya pagada se rechaza | PASS (corregido, H10) |
| L-08 | Anular una cuota sin reajustar antes las demás se bloquea con mensaje claro | PASS |
| L-09 | Serie por Frecuencia de Pago: cambiar el monto de UNA cuenta (500 → 800) solo afecta a esa | PASS |
| L-10 | En esa cuenta se recalculan saldo, IGV e imponible | PASS |
| L-11 | Cobrar: el lápiz sube la cuota 2 a 1500 y la última se reajusta | PASS |
| L-12 | Cobrar: subir una cuota a 9000 se rechaza | PASS (corregido, H8) |

## Hallazgos (corregidos en Dev, código de la app: sin migración SQL)

- **H8 — cuotas negativas.** Subir una cuota por encima de lo que falta dejaba la última en **−7000** y el total
  seguía "cuadrando" con un monto imposible. Ahora se rechaza con un mensaje que indica el máximo permitido.
- **H9 — única cuota pendiente.** Editar su monto dejaba la cuenta descuadrada (pagado + pendiente ≠ monto), sin
  ninguna otra cuota que absorbiera la diferencia. Ahora se exige que valga lo que falta; para repartir distinto se
  usa "Configurar Cuotas".
- **H10 — cuota ya pagada.** Se podía cambiar su monto aunque la transacción de respaldo quedara con otro valor.
  Ahora se rechaza.

## Montos desiguales: cómo se hacen

| Necesidad | Mecanismo |
|---|---|
| Cuotas distintas dentro de UNA cuenta | "Configurar Cuotas" con montos libres (deben sumar lo que falta) o el lápiz sobre una cuota |
| Una cuenta distinta dentro de una serie por Frecuencia | Editar esa cuenta: solo cambia ella; las demás de la serie no se tocan ni se reajustan |

Dentro de una serie por Frecuencia de Pago **no hay reajuste automático** entre cuentas: cada una es
independiente (cada una por su propio monto).
