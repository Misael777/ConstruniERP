# Migraciones de esquema (ConstruniERP)

Ver `Documentacion/FlujoDeNegocio.md` y el plan de Desarrollo/Testing (`floating-snuggling-corbato.md`)
para el contexto completo. Resumen operativo:

## Qué es esto

- `20260924144941_baseline.sql` — dump de esquema (solo estructura, `--schema public`, cero datos) de
  **Producción** (`CONSTRUNISYS`, ref `nqffgnbcwsixlaodhaku`) tomado el 2026-09-24. Representa el punto
  de partida: todo lo que ya existía en Prod antes de que este pipeline existiera.
- A partir de ahora, **cualquier cambio de esquema nuevo se escribe como un archivo nuevo acá**, con el
  mismo estilo idempotente que ya usa el equipo (`IF NOT EXISTS`, `NOTIFY pgrst, 'reload schema'` al
  final) — no cambia CÓMO se escribe SQL, solo dónde vive y que quede versionado en git.
- Los 89 archivos sueltos `*_migration.sql` en la raíz del repo (anteriores a este pipeline) **se
  quedan donde están** como registro histórico — no se migran retroactivamente acá.

## Cómo generar un archivo de migración nuevo

Nombre: `YYYYMMDDHHMMSS_descripcion_corta.sql` (UTC). Podés generar el timestamp con:

```bash
date -u +%Y%m%d%H%M%S
```

## Flujo seguro de despliegue (SIEMPRE Dev primero)

Dos archivos de credenciales, **misma variable `SUPABASE_DB_URL`, distinto archivo cargado** (a
propósito — nunca una variable de "modo" que se pueda leer mal):

- `app/.env` → Producción (`nqffgnbcwsixlaodhaku`, pooler `aws-1-us-west-1`).
- `app/.env.dev` → Desarrollo (`hlfaxszecrxgkbjafepv`, pooler `aws-0-us-east-1`).

Ninguno de los dos se commitea (`app/.gitignore`: `.env` y `.env.*`).

1. **Probar en Dev primero, siempre:**
   ```bash
   cd app && DB_URL=$(grep '^SUPABASE_DB_URL=' .env.dev | cut -d'=' -f2-) && cd ..
   supabase db push --db-url "$DB_URL" --yes
   ```
2. Verificar en Dev que el cambio funciona como se espera (consultas, o desde la app apuntando a Dev).
3. **Recién después, aplicar a Producción:**
   ```bash
   cd app && DB_URL=$(grep '^SUPABASE_DB_URL=' .env | cut -d'=' -f2-) && cd ..
   supabase db push --db-url "$DB_URL" --yes
   ```

## Reglas

- Nunca `DROP TABLE`/`DROP COLUMN` sin confirmarlo explícitamente con el usuario primero — Producción
  tiene datos reales de clientes.
- Nunca usar `db reset` contra Prod ni contra Dev con datos que importen — reescribe todo desde cero.
- `supabase db dump --db-url <URL> --schema public -f archivo.sql` sirve para verificar en cualquier
  momento que Dev y Prod tienen el mismo esquema (comparar `wc -l` y cantidad de `CREATE TABLE`).
