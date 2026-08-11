-- ============================================================
-- MIGRACIÓN: nuevo esquema de código para ventas de Obra — a pedido del usuario, reemplaza por
-- completo el esquema anterior (tipo_intervencion / tipo_edificacion_obra / nro_pisos) por el nuevo
-- formato:
--
--   {TIPO_SERVICIO}-{PERMISO}{ALCANCE}{CONTRATACION}-{DISTRITO}{N_EN_DISTRITO}-{MES}{AÑO}-{CLIENTE}
--   ej: OBRA-LGC-ATE1-0525-EDIF. LOS ANDES SAC
--
-- tipo_obra (OBRA/SUP) y tipo_tramite (ahora L=Con permiso / S=Sin permiso) ya existían y se
-- reutilizan tal cual — solo se agregan las columnas que antes no existían:
--   - alcance_obra: R=Casco rojo, G=Casco gris, A=Acabados, L=Llave en mano
--   - tipo_contratacion: A=Administración, C=Contrata, S=Subcontrata, P=Por partidas
--   - correlativo_distrito: N° correlativo de la venta dentro de su distrito (se calcula solo, ver
--     NuevaVentaModal.svelte) — se guarda porque debe quedar FIJO una vez asignado, no puede
--     recalcularse cada vez que se edita la venta (otras ventas nuevas en el mismo distrito
--     correrían el número).
--
-- tipo_intervencion / tipo_edificacion_obra / nro_pisos NO se tocan ni se borran — quedan con los
-- valores históricos de ventas ya creadas, simplemente dejan de escribirse para ventas de Obra nuevas.
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE proyecto ADD COLUMN IF NOT EXISTS alcance_obra VARCHAR(2);
ALTER TABLE proyecto ADD COLUMN IF NOT EXISTS tipo_contratacion VARCHAR(2);
ALTER TABLE proyecto ADD COLUMN IF NOT EXISTS correlativo_distrito INTEGER;

NOTIFY pgrst, 'reload schema';
