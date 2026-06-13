# Supabase Edge Functions for User Management

Esta carpeta contiene la función de Supabase para CRUD completo de usuarios en el esquema nativo de Auth y la tabla `public.empleados`.

## Archivos
- `package.json` - dependencias necesarias para la función.
- `user-admin/index.ts` - función HTTP que soporta list, get, create, update, delete y reset-password.

## Despliegue
1. Instala Supabase CLI si no lo tienes.
2. Desde la raíz del proyecto, ejecuta:
   ```bash
   cd supabase/functions
   npm install
   supabase functions deploy user-admin
   ```
3. Configura el secreto del service role key:
   ```bash
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY="tu_service_role_key"
   ```

## Uso
### Listar usuarios
- `GET https://<project>.supabase.co/functions/v1/user-admin`

### Obtener usuario
- `GET https://<project>.supabase.co/functions/v1/user-admin?id=<auth_user_id>`

### Crear usuario
- `POST https://<project>.supabase.co/functions/v1/user-admin`
- Body JSON:
  ```json
  {
    "email": "user@example.com",
    "password": "secret123",
    "nombre": "Nombre",
    "telefono": "123456789",
    "rol_id": 1,
    "area_id": 2
  }
  ```

### Actualizar usuario
- `PUT https://<project>.supabase.co/functions/v1/user-admin`
- Body JSON:
  ```json
  {
    "auth_user_id": "...",
    "email": "new@example.com",
    "nombre": "Nombre Actualizado",
    "telefono": "987654321"
  }
  ```

### Eliminar usuario
- `DELETE https://<project>.supabase.co/functions/v1/user-admin`
- Body JSON:
  ```json
  {
    "auth_user_id": "..."
  }
  ```

### Resetear contraseña
- `POST https://<project>.supabase.co/functions/v1/user-admin?action=reset-password`
- Body JSON:
  ```json
  {
    "auth_user_id": "...",
    "password": "NuevaContrasena123"
  }
  ```
