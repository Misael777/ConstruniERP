# Traspaso: módulo Personal, Asistencia y Huelleros (al 2026-11-03)

Resumen de lo hecho en la sesión del 30/10 al 03/11/2026 para que otra terminal o desarrollador pueda revisarlo y continuar.
Reglas de base de datos: [GuiaDevYTests.md](GuiaDevYTests.md) y [GuiaAgente.md](GuiaAgente.md) §5. Producción solo se lee; los
cambios de esquema los aplica el usuario a mano en el SQL Editor.

## 1. Qué hace el módulo

Hay huelleros **ZKTeco SenseFace 2A** en las obras. Envían las marcas a internet (protocolo **ADMS/PUSH 3.1.2**, modo control
de acceso: `rtlog`, `tabledata`). Un **Cloudflare Worker** las recibe y las guarda en Supabase. El ERP muestra al personal, sus
marcas y la asistencia calculada, y desde el ERP se dan de alta o de baja trabajadores en cada huellero.

```
Huellero (WiFi) ──HTTP :80──► Worker construni-asistencia.construnisys.workers.dev ──RPC (token)──► Supabase PROD
                                       └── si asistencia_dispositivo.destino='desarrollo' ──► Supabase DEV (variables DEV_*)
```

## 2. Dónde está cada cosa

| Parte | Archivos |
|---|---|
| Receptor (Worker) | `servicios/huellero-adms/worker.js`. Se despliega **a mano**: Cloudflare → Workers → *construni-asistencia* → Edit code → pegar → Deploy. Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INGESTA_TOKEN` (Prod); `DEV_SUPABASE_URL`, `DEV_SUPABASE_ANON_KEY`, `DEV_INGESTA_TOKEN` son opcionales. |
| Personal | `app/src/routes/(app)/rrhh/personal/+page.svelte`, `app/src/lib/modules/personal/services/personal.service.ts`, `components/PersonalModal.svelte`, `components/PersonalResumen.svelte` |
| Asistencia | `app/src/routes/(app)/rrhh/asistencia/+page.svelte`, `app/src/lib/modules/asistencia/services/asistencia.service.ts` (+ `.test.ts`, 9 tests) |
| Huelleros | `app/src/routes/(app)/rrhh/huelleros/+page.svelte`, `app/src/lib/modules/asistencia/services/huelleros.service.ts` |
| Barra superior | `app/src/lib/shared/components/EntornoDeveloper.svelte` (etiqueta BASE PRD / BASE DEV), `EntornoHuelleros.svelte` (solo developer: envía cada huellero a PRD o DEV) |
| Menú | `app/src/lib/config/modules.ts` (permisos `ver_rrhh*`, otorgados a administrador y socio) |
| Componente | `app/src/lib/shared/components/SelectConSaldo.svelte` (nueva prop opcional `claseBoton`) |

## 3. Migraciones (todas en `supabase/migrations/`, todas idempotentes)

Estado detallado en la tabla de GuiaAgente.md. Al 03/11 todas están aplicadas en Dev y en Producción, **salvo `20261103150000_horario_libre`** (solo Dev).

| Migración | Qué hace |
|---|---|
| `20261030120000` … `20261102190000` | Tablas `asistencia_dispositivo`, `asistencia_marcacion`, `asistencia_comando`, `asistencia_trafico`, `asistencia_config`, `personal`, `horario`, `personal_huellero`, `personal_biometria` (plantillas cifradas, solo con consentimiento, Ley 29733) y las RPC que usa el Worker. |
| `20261102200000_personal_periodicidad_pago` | `periodicidad_pago` (diaria/semanal/quincenal/mensual) + `monto_pago`; elimina `jornal_diario` y `sueldo_mensual`. |
| `20261103120000_huellero_destino` | `asistencia_dispositivo.destino` + `fn_asistencia_destino` (lo consulta el Worker, con caché de 60 s) + trigger que solo deja cambiarlo al rol developer. |
| `20261103130000_huella_por_huellero` | `personal_huellero.huellas/rostros/dedos/biometria_at`: solo el **número** de huellas y rostros por huellero. Sincronizar también pide `DATA QUERY biodata`. Aviso rojo "Falta registrar huella" en Personal. |
| `20261103140000_huellero_grupo_acceso` | **Corrección del 03/11** (ver §5): `fn_asistencia_encolar_alta` envía `Group=1` en lugar de `Group=0`. |
| `20261103150000_horario_libre` | **Pendiente en Producción.** `horario.tipo` = `fijo` o `libre` y el horario "Horario libre". Libre: por horas, sin entrada ni salida; `calcularAsistencia` empareja las marcas del día (1ª–2ª, 3ª–4ª…) y suma los tramos; sin tardanza, faltas ni extra; una marca sin pareja = "Sin marca de salida" (o "En jornada" si es hoy). Pantallas: selector Fijo/Libre en Horarios; en Asistencia, días trabajados, horas, promedio por día y tramos. |

## 4. Cambios de interfaz recientes

- **Personal (tabla):** columnas Trabajador, *Número en huellero*, Puesto, Obra o área, **Huelleros** y *Avisos*.
  - *Huelleros*: por cada equipo, su nombre, su ID (número de serie), si está en línea, el estado del envío y las huellas o rostros.
  - *Avisos*: el primero es el rojo **"Falta registrar huella"**. Hay un contador "N sin huella" que sirve de filtro.
  - Filtros en una fila (pastillas de color): obra, huellero, cargo, régimen, categoría y fecha de ingreso.
  - Si la base no tiene aún las columnas de huella (error 42703), Personal carga igual, sin el aviso, y muestra un banner ámbar.
- **Ficha:**
  - Periodicidad y monto de pago.
  - "Huelleros donde marca", con un desplegable (SelectConSaldo) de todos los equipos.
  - Si nombres y apellidos están vacíos, se proponen desde el nombre que trajo el huellero.
- **Asistencia:**
  - Por trabajador (`?p=id`): estadísticas compactas y vista de calendario por mes, o vista de lista.
  - Cálculo en el cliente:
    - hora de Lima (UTC−5);
    - entrada = primera marca y salida = última;
    - se ignoran las marcas duplicadas a menos de 2 min;
    - tardanza según la tolerancia del horario y horas extra;
    - días fuera de contrato;
    - **se descartan los eventos ≥ 20** (rechazos del equipo).
- **Huelleros:**
  - Acciones con íconos: 🔄 Sincronizar, ✏️ editar, 🚫 baja.
  - "Asignar lugar" para los equipos pendientes y aviso "ENVÍA A DEV".

## 5. Incidente del 03/11: "Verificación Fallida" con huella correcta

- **Síntoma:** al poner el dedo, el equipo mostraba el ID del usuario pero decía "Verificación Fallida". En `asistencia_trafico` el `rtlog` llegaba con `pin=75517543 … event=48`. A Benjamín (pin 2) le pasaba igual.
- **Causa:** el equipo verifica por **grupo de acceso** y `fn_asistencia_encolar_alta` enviaba `DATA UPDATE user … Group=0`.
  - En el grupo 0 el usuario queda fuera de toda combinación y el equipo lo rechaza: evento 48, "multi-person verification failed".
  - Los usuarios creados en el equipo quedan en el grupo 1. En Dev, antes de que el ERP reenviara a los usuarios, el pin 2 marcaba con evento 3 (éxito).
- **Corrección:** migración `20261103140000`, que envía `Group=1`. Se aplicó en Dev (probada: la orden sale con `Group=1`) y en Producción (verificado leyendo `pg_proc`).
- **Falta:** pulsar **Huelleros → 🔄 Sincronizar** en "huellero principal" para reenviar a todos con el grupo 1. Al cierre de este documento aún no se había hecho.
  - Verificar en Producción, en solo lectura: `select pin, marcado_en, evento from asistencia_marcacion order by marcado_en desc limit 10;` → las marcas nuevas deben tener `evento` < 20 (normalmente 0 o 3).
- Las 8 marcas rechazadas (evento 48) quedan en `asistencia_marcacion` pero Asistencia no las cuenta.

## 6. Estado actual en Producción

- Equipo `NYU7261202822`, "huellero principal": obra id 139, activo, `destino='produccion'`, conectado.
- Personal en Prod: pines 1, 2, 3, 4 y 75517543 (Misael, consentimiento sí, 1 huella).
- Versión de la app: **0.2.51** publicada el 03/11 desde la máquina *linar* (`app_release`).
- El Worker apunta a Prod. No se sabe si en Cloudflare están cargadas las variables `DEV_*` ni la última versión de `worker.js`, que es la que permite el botón PRD/DEV.

## 7. Configuración de un huellero nuevo (una sola vez)

1. **COMM → Servidor en la nube:** ADMS, dominio sí, `construni-asistencia.construnisys.workers.dev`, puerto 80, sin proxy.
2. **COMM → Ethernet:** DHCP apagado, IP `10.10.10.201`, máscara `255.255.255.0`, puerta de enlace `0.0.0.0`. Evita el choque de subred con el WiFi.
3. **COMM → WiFi:** la red de la obra (sirve un módem 4G).
4. **Sistema:** fecha y hora de Perú. Conviene crear un administrador en el equipo.
5. **En el ERP:** Huelleros → aparece como pendiente → 📍 Asignar lugar (nombre + obra) → asignar trabajadores → que registren su huella → 🔄 Sincronizar.

No se instala nada en las PC ni por equipo en Cloudflare: el Worker identifica cada huellero por su número de serie.

## 8. Pendientes

- [ ] Sincronizar el huellero principal y confirmar que las marcas entran con evento < 20 (§5).
- [ ] Aplicar `20261103150000_horario_libre.sql` en Producción (SQL Editor) y registrarla en `schema_migrations`.
- [ ] Confirmar que en Asistencia aparecen la entrada y la salida del día por trabajador.
- [ ] Opcional: variables `DEV_*` en Cloudflare + desplegar el último `worker.js`, para que el botón PRD/DEV funcione.
- [ ] Opcional: quitar la imagen de WhatsApp que entró en el commit `7bbb180`.
- [ ] Ideas ofrecidas, aún no pedidas: tareo por obra, exportar a Excel, justificaciones y pago estimado.

## 9. Herramientas usadas

- Scripts de lectura y prueba con `pg`:
  - `node --env-file=app/.env.dev <script>` para Dev, siempre con un guard que exige que la URL contenga `hlfaxszecrxgkbjafepv`.
  - `node --env-file=app/.env <script>` para Producción, con `BEGIN TRANSACTION READ ONLY` y un guard que exige que **no** sea Dev.
- Para ver qué hace el equipo, la tabla `asistencia_trafico` guarda cada petición del huellero (sin las plantillas) y `asistencia_comando` las órdenes y su `Return`.
- Ejecutar la app: `npm run dev` (Prod) o `npx vite dev --mode dev` (Dev) dentro de `app/`; `npm run tauri dev` para escritorio.
