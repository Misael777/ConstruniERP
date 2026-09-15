-- ----------------------------------------------------------------------------
-- Ensancha cuentas_cobrar.responsable de VARCHAR(20) a VARCHAR(100).
--
-- El código (cuentaCobrar.config.ts) ya documentaba esta ampliación como si
-- estuviera hecha ("Ensanchada de VARCHAR(20) a VARCHAR(100) vía migración, ver
-- responsable_varchar_migration.sql") pero ese archivo nunca existió y la
-- columna real en Supabase seguía en VARCHAR(20) — confirmado consultando el
-- esquema real vía la API de Supabase (OpenAPI, con la service role key).
--
-- Por eso el guardado de una Cuenta por Cobrar fallaba con "value too long for
-- type character varying(20)" apenas el nombre del responsable (autocompletado
-- con el usuario que inició sesión) pasaba de 20 caracteres — con el dropdown
-- de "Responsable" ya no hay forma de escribir una versión abreviada a mano
-- para evitarlo.
--
-- cuentas_pagar.responsable ya está en VARCHAR(100) (verificado, no necesita
-- este mismo cambio).
-- ----------------------------------------------------------------------------

ALTER TABLE cuentas_cobrar ALTER COLUMN responsable TYPE VARCHAR(100);
