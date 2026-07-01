-- ============================================================
-- Migration: documento_proyecto table + Supabase Storage setup
-- Run this in Supabase SQL Editor (Project > SQL Editor)
-- ============================================================

-- 1. Documents metadata table
CREATE TABLE IF NOT EXISTS documento_proyecto (
    id_documento    BIGSERIAL       PRIMARY KEY,
    id_proyecto     BIGINT          NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    nombre          VARCHAR(200)    NOT NULL,
    tipo_documento  VARCHAR(80)     NOT NULL DEFAULT 'Otro',
    descripcion     TEXT,
    version         VARCHAR(20)     NOT NULL DEFAULT 'V1.0',
    estado          VARCHAR(30)     NOT NULL DEFAULT 'borrador'
                        CHECK (estado IN ('borrador', 'revision', 'aprobado', 'rechazado')),
    storage_path    TEXT,
    storage_url     TEXT,
    file_size       BIGINT,
    file_type       VARCHAR(100),
    creado_por      VARCHAR(100),
    responsable     VARCHAR(100),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- 2. Index for project lookups
CREATE INDEX IF NOT EXISTS idx_documento_proyecto_proyecto
    ON documento_proyecto(id_proyecto);

-- 3. Auto-update updated_at
CREATE OR REPLACE FUNCTION trg_set_updated_at_documento()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documento_proyecto_updated_at ON documento_proyecto;
CREATE TRIGGER trg_documento_proyecto_updated_at
    BEFORE UPDATE ON documento_proyecto
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_documento();

-- 4. Row-Level Security
ALTER TABLE documento_proyecto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_full_access_documento" ON documento_proyecto;
CREATE POLICY "authenticated_full_access_documento"
    ON documento_proyecto FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

-- ============================================================
-- Storage bucket setup (run these in Supabase Dashboard >
-- Storage > New bucket, or via the SQL below)
-- ============================================================

-- Create the bucket (idempotent via INSERT ... ON CONFLICT)
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-documents', 'project-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload
DROP POLICY IF EXISTS "auth_upload_project_docs" ON storage.objects;
CREATE POLICY "auth_upload_project_docs"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'project-documents');

-- Allow public read (for download/preview)
DROP POLICY IF EXISTS "public_read_project_docs" ON storage.objects;
CREATE POLICY "public_read_project_docs"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'project-documents');

-- Allow authenticated users to delete their uploads
DROP POLICY IF EXISTS "auth_delete_project_docs" ON storage.objects;
CREATE POLICY "auth_delete_project_docs"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'project-documents');
