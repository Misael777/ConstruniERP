-- Ticket #63: diferenciar los tickets de la app del celular de los de la web/escritorio. 'app' = app del
-- celular (Android), 'web' = navegador o app de escritorio (Windows). Los tickets anteriores quedan en NULL
-- (sin especificar). Idempotente; no modifica filas.
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS plataforma VARCHAR(10);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_plataforma_check') THEN
        ALTER TABLE ticket ADD CONSTRAINT ticket_plataforma_check CHECK (plataforma IS NULL OR plataforma IN ('web', 'app'));
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
