-- ----------------------------------------------------------------------------
-- Vincula una Cuenta por Pagar/Cobrar con la transacción de "Préstamo" que la
-- originó — a pedido explícito del usuario: al EDITAR una transacción con
-- Categoría="Préstamo" (Ingreso) o "Préstamo Otorgado" (Egreso) y actualizarla,
-- el sistema necesita encontrar la Cuenta por Pagar/Cobrar correspondiente para
-- abrirla también en edición con los nuevos valores.
--
-- Antes de esto NO existía ningún vínculo guardado entre ambas filas — se
-- creaban juntas (ver guardarCuentaPagarConTransaccionPrestamo/
-- guardarCuentaCobrarConTransaccionPrestamo) pero sin ninguna columna que las
-- conectara después. Por eso el vínculo solo existe para préstamos creados
-- DESDE que esta migración + el código que la usa estén desplegados — los
-- préstamos ya existentes quedan con id_transaccion NULL (ver el aviso que
-- muestra TransaccionModal.svelte cuando no encuentra el vínculo).
--
-- ON DELETE SET NULL (no CASCADE): si la transacción se elimina, la Cuenta por
-- Pagar/Cobrar debe seguir existiendo (es un registro contable propio, no un
-- detalle de la transacción) — solo pierde la referencia.
-- ----------------------------------------------------------------------------

ALTER TABLE cuentas_pagar
    ADD COLUMN IF NOT EXISTS id_transaccion BIGINT REFERENCES transaccion(id_transaccion) ON DELETE SET NULL;

ALTER TABLE cuentas_cobrar
    ADD COLUMN IF NOT EXISTS id_transaccion BIGINT REFERENCES transaccion(id_transaccion) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_id_transaccion ON cuentas_pagar(id_transaccion);
CREATE INDEX IF NOT EXISTS idx_cuentas_cobrar_id_transaccion ON cuentas_cobrar(id_transaccion);
