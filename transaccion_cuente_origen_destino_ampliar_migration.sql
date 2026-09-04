-- ============================================================
-- MIGRACIÓN: Ampliar transaccion.cuente_origen/cuente_destino a VARCHAR(30)
-- Bug real reportado por el usuario: al elegir una Cuenta Bancaria como origen/destino (selector que
-- guarda cuenta_banco.numero_cuenta, ver getCuentaBancoOptions en cuentaBanco.service.ts), el guardado
-- fallaba con "Cuenta destino no puede superar 20 caracteres" para cuentas con numero_cuenta largo (ej.
-- "EFECTIVO_GUILLERMO...", una cuenta de efectivo con nombre de persona). Causa: cuenta_banco.numero_cuenta
-- es VARCHAR(30) (ver cuentaBanco.config.ts), pero transaccion.cuente_origen/cuente_destino, que guarda
-- ese mismo valor, se quedó en VARCHAR(20) — nunca se amplió cuando numero_cuenta se amplió. Se iguala a
-- VARCHAR(30) para que cualquier numero_cuenta válido siempre quepa acá también.
-- Idempotente: ALTER COLUMN TYPE no falla si ya tiene ese tamaño o uno mayor (solo trunca si fuera menor,
-- que no es el caso acá).
-- ============================================================

ALTER TABLE transaccion
	ALTER COLUMN cuente_origen TYPE VARCHAR(100),
	ALTER COLUMN cuente_destino TYPE VARCHAR(100);

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
