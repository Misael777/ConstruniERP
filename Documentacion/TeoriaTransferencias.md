Actúa como un Arquitecto de Software Senior, Ingeniero de Software Financiero,
especialista en sistemas transaccionales, bases de datos ACID y modelamiento
matemático de sistemas financieros.

Tu objetivo es integrar de manera segura y profesional el modelo matemático de
saldos, centros de costos, cuentas bancarias y transferencias dentro del ERP
existente.

IMPORTANTE:

NO debes comenzar modificando código inmediatamente.

Primero debes:

1. Analizar completamente la arquitectura actual del ERP en la parte de Finanzas y logica de transacciones tanto internas como externas.
2. Identificar el backend, frontend, ORM, base de datos y estructura existente.
3. Revisar los modelos relacionados con:
   - centros de costos
   - cuentas bancarias
   - saldos
   - movimientos
   - transacciones
   - usuarios/permisos
   - auditoría
   - dashboards
4. Entender cómo funciona actualmente el módulo financiero.
5. Identificar qué componentes existentes pueden reutilizarse.
6. Detectar inconsistencias entre el modelo matemático propuesto y la
   implementación actual.
7. Proponer la arquitectura de integración antes de modificar archivos.

NO reemplaces funcionalidades existentes sin justificarlo.

NO dupliques entidades si ya existe una estructura equivalente.

NO inventes reglas de negocio que no estén respaldadas por el sistema o por
esta especificación.

============================================================
1. MODELO CONCEPTUAL
============================================================

El sistema financiero debe modelar dos conjuntos principales de estados:

B = vector de saldos de cuentas bancarias.

C = vector de saldos operativos de centros de costos.

Formalmente:

B ∈ R^N

C ∈ R^M

donde:

N = número de cuentas bancarias.

M = número de centros de costos.

El estado financiero del sistema se representa mediante:

S = (B, C)

El estado inicial será:

S_0 = (B_0, C_0)

y después de una operación:

S_f = (B_f, C_f)


============================================================
2. MATRIZ DE RELACIÓN CUENTA ↔ CENTRO DE COSTO
============================================================

Un centro de costo NO necesariamente pertenece a una única cuenta bancaria.

Un centro de costo puede estar sustentado por múltiples cuentas bancarias.

Asimismo, una cuenta bancaria puede respaldar múltiples centros de costos.

Por lo tanto, la relación es potencialmente MANY-TO-MANY.

Debe implementarse una matriz de distribución:

W ∈ R^(N×M)

donde:

w_(r,k) ∈ [0,1]

representa el peso/proporción mediante el cual la cuenta bancaria r
respalda al centro de costo k.

Para cada centro de costo k:

Σ(r=1..N) w_(r,k) = 1

Esta condición significa que el centro de costo tiene el 100% de su
respaldo financiero distribuido entre las cuentas bancarias asociadas.


============================================================
3. IMPORTANTE: AUDITAR EL SIGNIFICADO DE W
============================================================

Antes de implementar W, determina exactamente qué representa en el ERP:

A) distribución de saldo;

B) distribución de disponibilidad;

C) distribución contable;

D) relación de respaldo financiero;

E) distribución de flujos;

o una combinación de las anteriores.

NO asumas automáticamente que:

C = WᵀB

ni que:

B = WC

sin verificar que esta relación sea compatible con el modelo de negocio
actual.

Debes determinar si los saldos B y C representan:

- el mismo dinero visto desde dos perspectivas,
- dinero operativo asignado,
- dinero físicamente depositado,
- presupuesto/disponibilidad,
- o conceptos contables diferentes.

Si existe riesgo de doble contabilización, debes detectarlo y reportarlo
ANTES de implementar.

============================================================
4. EVENTO A — TRANSFERENCIA ENTRE CENTROS DE COSTOS
============================================================

Una operación:

C_i → C_j

por un monto T

representa una transferencia operativa.

Si:

i ≠ j

entonces:

C_if = C_i0 - T

C_jf = C_j0 + T

Todos los demás centros permanecen iguales.

Formalmente:

C_kf =
C_k0 - Tδ_ki + Tδ_kj

para k = 1,...,M

donde δ representa la delta de Kronecker.


============================================================
5. IMPACTO DE LA TRANSFERENCIA OPERATIVA SOBRE B
============================================================

La transferencia entre centros de costos debe generar el impacto
correspondiente sobre las cuentas bancarias de acuerdo con W.

Para una cuenta bancaria r:

B_rf = B_r0 - T·w_(r,i) + T·w_(r,j)

cuando i ≠ j.

Equivalentemente:

ΔC = C_f - C_0

ΔB = W·ΔC

y:

B_f = B_0 + W·ΔC

La implementación debe calcular el impacto neto por cuenta bancaria.

Si:

w_(r,i) = w_(r,j)

entonces:

ΔB_r = 0

y no debe generarse un movimiento bancario innecesario.


============================================================
6. EVENTO B — TRANSFERENCIA DIRECTA ENTRE CUENTAS BANCARIAS
============================================================

Debe existir otro tipo de operación:

B_m → B_n

por un monto T.

Si:

m ≠ n

entonces:

B_mf = B_m0 - T

B_nf = B_n0 + T

y:

C_kf = C_k0

para todos los centros de costos.

Es decir:

una transferencia bancaria directa NO debe modificar automáticamente
los saldos operativos de los centros de costos, salvo que el análisis
del modelo existente determine que existe una regla de negocio que
obligue a hacerlo.

============================================================
7. CASOS DE IDENTIDAD
============================================================

Implementar explícitamente los casos:

i = j

y:

m = n

Para:

i = j:

C_f = C_0

Para:

m = n:

B_f = B_0

Estos casos deben estar cubiertos mediante pruebas automatizadas.


============================================================
8. VALIDACIÓN DE SALDOS
============================================================

Antes de ejecutar una transferencia:

EVENTO A:

debe cumplirse:

T > 0

T ≤ C_i0

Además, debe verificarse que el impacto bancario no produzca saldos
inválidos.

Para cada cuenta bancaria involucrada:

T·w_(r,i) ≤ B_r0

si la regla de negocio del ERP establece que el respaldo debe existir
físicamente en esas cuentas.

EVENTO B:

T > 0

T ≤ B_m0


============================================================
9. NO NEGATIVIDAD
============================================================

Después de cualquier operación válida:

C_kf ≥ 0

para todos los k.

Y:

B_rf ≥ 0

para todos los r.

Ninguna operación debe poder generar saldos negativos salvo que el
ERP tenga explícitamente configurado un mecanismo de sobregiro/crédito.

Si existe dicho mecanismo, NO lo inventes.

Identifica primero cómo está modelado actualmente.


============================================================
10. CONSISTENCIA Y CONSERVACIÓN
============================================================

Implementa pruebas que comprueben las invariantes matemáticas.

Para una transferencia interna C_i → C_j:

Σ C_f = Σ C_0

Para una transferencia interna B_m → B_n:

Σ B_f = Σ B_0

Sin embargo, NO asumas que:

ΣB = ΣC

representa automáticamente una conservación financiera válida.

Primero determina si B y C representan dos vistas del mismo dinero o
dos conceptos financieros distintos.

Si son el mismo dinero, debes evitar doble contabilización.

Si son conceptos distintos, documenta claramente la diferencia.


============================================================
11. CONCURRENCIA Y ATOMICIDAD
============================================================

Este punto es CRÍTICO.

Dos operadores pueden intentar modificar simultáneamente:

- el mismo centro de costo;
- la misma cuenta bancaria;
- diferentes centros sustentados por las mismas cuentas;
- o diferentes transferencias simultáneas.

Por ello:

TODAS las operaciones financieras deben ejecutarse dentro de una
transacción de base de datos ACID.

La operación debe tener comportamiento:

BEGIN TRANSACTION

1. Validar entidades.
2. Bloquear/aislar los registros necesarios.
3. Obtener saldos actuales.
4. Obtener relaciones W.
5. Validar monto.
6. Calcular estado futuro.
7. Validar no negatividad.
8. Validar consistencia.
9. Persistir movimientos.
10. Actualizar saldos.
11. Registrar auditoría.

COMMIT

Si cualquier validación falla:

ROLLBACK

Nunca debe existir un estado en el que se actualice C pero no B,
o B pero no el movimiento correspondiente.


============================================================
12. REGISTRO HISTÓRICO DE MOVIMIENTOS
============================================================

NO debes limitarte a modificar el saldo actual.

Cada operación financiera debe dejar trazabilidad.

Diseña o adapta una estructura de movimientos que permita conocer:

- ID de operación
- tipo de operación
- fecha/hora
- usuario
- centro origen
- centro destino
- cuenta origen
- cuenta destino
- monto
- estado anterior
- estado posterior
- impacto en cada cuenta bancaria
- impacto en cada centro de costo
- W utilizada durante la operación
- motivo/descripción
- referencia
- timestamps
- resultado
- error/rechazo, si corresponde

La información histórica debe permitir reconstruir cómo se llegó al
saldo actual.


============================================================
13. NO MODIFICAR HISTÓRICOS DE FORMA DESTRUCTIVA
============================================================

Una vez registrada una transacción financiera:

NO modificar silenciosamente el movimiento original.

Si se necesita corregir una operación:

utilizar reversión, anulación o transacción compensatoria según las
reglas del ERP.

Debe existir trazabilidad completa.


============================================================
14. MATRIZ W COMO ENTIDAD DEL ERP
============================================================

Implementa la relación mediante una entidad/tablas equivalente a:

cuenta_bancaria
centro_costo
cuenta_centro_costo

La relación debe almacenar como mínimo:

- cuenta_bancaria_id
- centro_costo_id
- peso
- estado
- fecha_inicio
- fecha_fin, si aplica
- usuario_creacion
- timestamp

Restricciones:

0 ≤ peso ≤ 1

y para cada centro de costo activo:

Σ peso = 1

La validación debe realizarse tanto en backend como en las operaciones
administrativas correspondientes.


============================================================
15. CAMBIOS EN W
============================================================

Determina si W debe ser:

- fija;
- configurable;
- histórica;
- efectiva por periodo;
- o dinámica.

NO sobrescribas una distribución histórica si una transacción anterior
utilizó otra configuración.

Si W cambia con el tiempo, debe poder reconstruirse qué distribución
estaba vigente cuando ocurrió cada transacción.


============================================================
16. CONSISTENCIA DE SALDOS
============================================================

Implementa mecanismos de conciliación.

El sistema debe poder detectar:

- saldo bancario inconsistente;
- saldo operativo inconsistente;
- pesos W que no suman 100%;
- movimientos sin contraparte;
- saldos negativos;
- transacciones incompletas;
- diferencias entre movimientos y saldos;
- discrepancias entre el modelo financiero y la base de datos.

Crear una función de:

RECONCILIAR SISTEMA FINANCIERO

que produzca:

OK

o

INCONSISTENTE

y detalle exactamente dónde está la diferencia.


============================================================
17. PRUEBAS AUTOMATIZADAS
============================================================

Crear pruebas unitarias, de integración y de concurrencia.

Como mínimo:

TEST 1:
Transferencia C1 → C2.

TEST 2:
Transferencia C1 → C1.

TEST 3:
Transferencia B1 → B2.

TEST 4:
Transferencia B1 → B1.

TEST 5:
Centro de costo respaldado por una sola cuenta.

TEST 6:
Centro de costo respaldado por múltiples cuentas.

TEST 7:
Dos centros de costo respaldidos por la misma cuenta.

TEST 8:
Transferencia donde origen y destino comparten parcialmente
las mismas cuentas bancarias.

TEST 9:
w_origen = w_destino.

TEST 10:
W cuya suma no sea 1.

TEST 11:
Monto superior al saldo operativo.

TEST 12:
Monto que genere saldo bancario negativo.

TEST 13:
Monto cero.

TEST 14:
Monto negativo.

TEST 15:
Cuenta o centro inexistente.

TEST 16:
Rollback provocado por error.

TEST 17:
Dos transferencias simultáneas sobre el mismo saldo.

TEST 18:
Dos operadores intentando consumir simultáneamente el mismo saldo.

TEST 19:
Reversión de una transacción.

TEST 20:
Conciliación completa de todos los saldos.


============================================================
18. PRUEBAS DE NEGOCIO
============================================================

No te limites a pruebas técnicas.

Debes probar el ERP como si fueras un operador financiero real.

Simula:

1. Crear cuentas bancarias.
2. Crear centros de costos.
3. Asignar relaciones W.
4. Cargar saldos iniciales.
5. Realizar transferencias.
6. Consultar saldos.
7. Revisar movimientos.
8. Realizar transferencias parciales.
9. Intentar operaciones inválidas.
10. Revertir operaciones.
11. Ejecutar operaciones simultáneas.
12. Conciliar saldos.
13. Revisar dashboards.
14. Verificar que todos los números coincidan.

El objetivo es verificar que el sistema funcione correctamente desde
la perspectiva del usuario final y desde la perspectiva contable.


============================================================
19. SEGURIDAD
============================================================

Analiza vulnerabilidades relacionadas con:

- autorización;
- permisos;
- manipulación de IDs;
- modificación de montos;
- modificación de saldos;
- modificación de W;
- acceso a movimientos de otros usuarios;
- llamadas directas a APIs;
- race conditions;
- duplicación de transacciones;
- replay de solicitudes;
- modificación de registros históricos;
- bypass de validaciones frontend.

NUNCA confíes en validaciones realizadas únicamente en frontend.

Toda regla financiera crítica debe validarse en backend y, cuando
corresponda, reforzarse mediante restricciones de base de datos.


============================================================
20. API
============================================================

Si el ERP todavía no tiene una API adecuada para estas operaciones,
diseña una capa de servicios/API.

Como mínimo deben existir operaciones equivalentes a:

POST /financial/transfers/cost-centers

POST /financial/transfers/bank-accounts

GET /financial/accounts/{id}/balance

GET /financial/cost-centers/{id}/balance

GET /financial/transactions

POST /financial/transactions/{id}/reverse

GET /financial/reconciliation

Los nombres definitivos deben adaptarse a la arquitectura existente.

No crear endpoints duplicados si ya existe una estructura equivalente.


============================================================
21. FRONTEND
============================================================

Integra la funcionalidad con la interfaz existente.

El usuario debe poder:

- consultar cuentas;
- consultar centros de costo;
- visualizar saldos;
- realizar transferencias;
- visualizar el impacto antes de confirmar;
- consultar historial;
- visualizar distribución W;
- detectar errores;
- realizar conciliaciones.

Antes de confirmar una operación, mostrar un resumen:

ORIGEN
DESTINO
MONTO
SALDO ANTES
SALDO DESPUÉS
IMPACTO BANCARIO
IMPACTO OPERATIVO

La operación debe requerir confirmación explícita.


============================================================
22. DASHBOARD FINANCIERO
============================================================

Integrar la información con los dashboards existentes.

Como mínimo permitir visualizar:

- saldo total bancario;
- saldo operativo total;
- saldo por cuenta;
- saldo por centro de costo;
- movimientos;
- transferencias;
- inconsistencias;
- conciliaciones;
- distribución de fondos;
- alertas.


============================================================
23. AUDITORÍA DEL CÓDIGO EXISTENTE
============================================================

Antes de implementar:

- analiza todos los modelos existentes;
- analiza migraciones;
- analiza servicios;
- analiza endpoints;
- analiza consultas SQL;
- analiza lógica de actualización de saldos;
- analiza frontend;
- analiza permisos;
- analiza tests.

Identifica cualquier código que pueda producir:

- pérdida de dinero;
- doble contabilización;
- saldos incorrectos;
- race conditions;
- inconsistencias;
- operaciones no atómicas.


============================================================
24. PLAN DE IMPLEMENTACIÓN
============================================================

NO realices cambios masivos directamente.

Primero entrega:

FASE 1 — DIAGNÓSTICO

Describe cómo funciona actualmente el módulo financiero.

FASE 2 — GAP ANALYSIS

Compara:

ERP ACTUAL

vs.

MODELO MATEMÁTICO

FASE 3 — ARQUITECTURA PROPUESTA

Explica qué componentes nuevos serán necesarios.

FASE 4 — MODELO DE DATOS

Propón tablas, relaciones, índices y restricciones.

FASE 5 — SERVICIOS

Define los servicios transaccionales.

FASE 6 — API

Define endpoints y contratos.

FASE 7 — FRONTEND

Define cambios necesarios.

FASE 8 — MIGRACIÓN

Define cómo migrar datos existentes sin perder información.

FASE 9 — TESTING

Ejecuta pruebas unitarias, integración, concurrencia y negocio.

FASE 10 — CONCILIACIÓN

Verifica matemáticamente todos los saldos.

FASE 11 — SEGURIDAD

Ejecuta pruebas de autorización y manipulación.

FASE 12 — PRODUCCIÓN

Solo después de superar todas las validaciones,
preparar la implementación final.


============================================================
25. REGLA FUNDAMENTAL DEL AGENTE
============================================================

NO implementes ciegamente la teoría.

La teoría es la especificación conceptual.

Tu responsabilidad como arquitecto es determinar cómo debe mapearse
correctamente al ERP real.

Si detectas una contradicción matemática, contable o de negocio:

1. DETÉN esa parte de la implementación.
2. Explica la contradicción.
3. Presenta el problema matemáticamente.
4. Explica sus consecuencias en el ERP.
5. Propón alternativas.
6. Elige la alternativa más consistente solamente si está respaldada
   por el modelo de negocio existente.

Especialmente debes auditar cuidadosamente la relación entre:

B

C

W

porque B y C podrían representar dos perspectivas del mismo dinero y
una implementación incorrecta podría provocar doble contabilización.


============================================================
26. CRITERIO DE ACEPTACIÓN FINAL
============================================================

La implementación será considerada correcta únicamente si:

✓ Las transferencias son atómicas.

✓ No existen saldos negativos no permitidos.

✓ Las transferencias C → C actualizan correctamente B según W.

✓ Las transferencias B → B no alteran C salvo regla explícita.

✓ W siempre cumple sus restricciones.

✓ Los movimientos quedan auditados.

✓ Los saldos pueden conciliarse.

✓ Las operaciones concurrentes son seguras.

✓ Las transacciones pueden revertirse sin destruir el historial.

✓ Las APIs no permiten bypass de reglas financieras.

✓ Los dashboards muestran información consistente.

✓ Las pruebas unitarias pasan.

✓ Las pruebas de integración pasan.

✓ Las pruebas de concurrencia pasan.

✓ Las pruebas de negocio pasan.

✓ El sistema puede detectar inconsistencias.

✓ No se pierde información existente.

✓ No se rompe ninguna funcionalidad actual del ERP.


COMIENZA AHORA.

PRIMER PASO:

NO MODIFIQUES CÓDIGO.

Inspecciona el ERP completo y genera un diagnóstico técnico de cómo
implementar este modelo dentro de la arquitectura existente.

Después presenta:

1. Arquitectura actual detectada.
2. Modelo financiero actual.
3. Diferencias con el modelo matemático.
4. Riesgos encontrados.
5. Modelo de datos propuesto.
6. Flujo transaccional propuesto.
7. Plan de implementación por etapas.

Espera la validación de la arquitectura propuesta antes de realizar
cambios estructurales importantes.