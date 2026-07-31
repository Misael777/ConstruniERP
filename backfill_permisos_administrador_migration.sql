-- ============================================================
-- Migration: backfill de roles_permisos para el rol 'administrador'
-- Run this in Supabase SQL Editor (Project > SQL Editor)
--
-- El seed original (DER2.sql) le dio a 'administrador' TODOS los permisos
-- que existían en ese momento, pero fue un INSERT puntual (no un trigger):
-- cualquier fila agregada a `permisos` DESPUÉS de ese seed (ej.
-- 'ver_finanzas_cuentas_bancarias') nunca quedó vinculada a 'administrador'
-- en `roles_permisos`, aunque la UI de Roles y Permisos la muestre.
-- Este backfill es idempotente (ON CONFLICT DO NOTHING) y cubre cualquier
-- permiso faltante, no solo el de Cuentas Bancarias.
-- ============================================================

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.nombre = 'administrador'
ON CONFLICT DO NOTHING;
