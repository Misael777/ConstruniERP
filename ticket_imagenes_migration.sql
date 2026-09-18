-- ============================================================
-- MIGRACIÓN: adjuntar imágenes a tickets y comentarios
--
-- A pedido explícito del usuario: tanto al reportar un ticket como al responder en su hilo de
-- comentarios, se puede adjuntar una imagen (captura de pantalla, foto del error, etc.) — sube a
-- Google Drive (carpeta dedicada "ConstruniERP - Tickets (adjuntos)", ver
-- GOOGLE_DRIVE_FOLDER_ID_TICKETS en app/.env), mismo mecanismo ya usado para comprobantes/documentos.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE ticket ADD COLUMN IF NOT EXISTS imagen_url TEXT;
ALTER TABLE ticket_comentario ADD COLUMN IF NOT EXISTS imagen_url TEXT;

NOTIFY pgrst, 'reload schema';
