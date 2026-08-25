-- ============================================================
-- MIGRACIÓN: Centro de Costo "Socio o Banca"
-- A pedido explícito del usuario: en Nueva/Editar Transacción, cuando el tipo es Ingreso, el campo
-- Cliente (Centro de Costo Origen) debe ofrecer también "Socio o Banca" (para ingresos que no vienen de
-- un cliente real, sino de un aporte de socio o un préstamo bancario) — y al elegirlo, el campo Proyecto
-- (Centro de Costo Destino) debe mostrar "CORPORATIVO" (el Centro de Costo ya existente, código BG-001).
-- Mismo patrón que "CORPORATIVO": un Centro de Costo real y manual (tipo 'otro', sin proyecto/cliente/
-- proveedor/empleado vinculado), no un valor inventado — así el campo sigue guardando un
-- id_centro_costo real y válido.
-- Idempotente: no crea un segundo registro si ya existe uno con este nombre.
-- ============================================================

INSERT INTO centro_costo (codigo, nombre, tipo, monto_actual, estado)
SELECT
    'OTRO-' || LPAD((COALESCE((SELECT COUNT(*) FROM centro_costo WHERE tipo = 'otro'), 0) + 1)::text, 3, '0'),
    'Socio o Banca',
    'otro',
    0,
    'activo'
WHERE NOT EXISTS (
    SELECT 1 FROM centro_costo WHERE nombre = 'Socio o Banca' AND tipo = 'otro'
);

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
