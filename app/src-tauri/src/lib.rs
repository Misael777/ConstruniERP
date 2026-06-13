use serde::{Deserialize, Serialize};
use std::env;
use chrono::Utc;

#[derive(Deserialize)]
struct FirstAdminPayload {
  nombre: String,
  email: String,
  password: String,
}

#[derive(Serialize)]
struct FirstAdminResponse {
  success: bool,
  message: String,
}

fn env_var(name: &str) -> Result<String, String> {
  env::var(name).map_err(|_| format!("Environment variable '{}' not set", name))
}

fn supabase_url() -> Result<String, String> {
  env_var("PUBLIC_SUPABASE_URL").or_else(|_| env_var("SUPABASE_URL"))
}

fn supabase_key() -> Result<String, String> {
  env_var("SUPABASE_SERVICE_ROLE_KEY")
}

#[tauri::command]
fn check_first_admin_available() -> Result<bool, String> {
  let url = supabase_url()?;
  let key = supabase_key()?;
  let client = reqwest::blocking::Client::new();
  let response = client
    .get(format!("{}/rest/v1/empleados?select=id&limit=1", url))
    .header("apikey", &key)
    .header("Authorization", format!("Bearer {}", key))
    .header("Accept", "application/json")
    .send()
    .map_err(|err| format!("Supabase request failed: {}", err))?;

  if !response.status().is_success() {
    return Err(format!("Supabase responded {}", response.status()));
  }

  let rows: Vec<serde_json::Value> = response
    .json()
    .map_err(|err| format!("Failed to parse Supabase response: {}", err))?;

  Ok(rows.is_empty())
}

#[tauri::command]
fn create_first_admin(payload: FirstAdminPayload) -> Result<FirstAdminResponse, String> {
  let url = supabase_url()?;
  let key = supabase_key()?;
  let client = reqwest::blocking::Client::new();

  let response = client
    .get(format!("{}/rest/v1/empleados?select=id&limit=1", url))
    .header("apikey", &key)
    .header("Authorization", format!("Bearer {}", key))
    .header("Accept", "application/json")
    .send()
    .map_err(|err| format!("Supabase request failed: {}", err))?;

  if !response.status().is_success() {
    return Err(format!("Supabase responded {} when checking empleados", response.status()));
  }

  let rows: Vec<serde_json::Value> = response
    .json()
    .map_err(|err| format!("Failed to parse Supabase empleados response: {}", err))?;

  if !rows.is_empty() {
    return Err("Ya existe al menos un empleado registrado. El primer administrador no se puede crear ahora.".into());
  }

  let role_response = client
    .get(format!("{}/rest/v1/roles?select=id&nombre=eq.administrador", url))
    .header("apikey", &key)
    .header("Authorization", format!("Bearer {}", key))
    .header("Accept", "application/json")
    .send()
    .map_err(|err| format!("Supabase role lookup failed: {}", err))?;

  if !role_response.status().is_success() {
    return Err(format!("Supabase responded {} when looking up role", role_response.status()));
  }

  let role_rows: Vec<serde_json::Value> = role_response
    .json()
    .map_err(|err| format!("Failed to parse role lookup response: {}", err))?;

  let role_id = if let Some(role) = role_rows.into_iter().next() {
    role["id"].as_i64().ok_or("Role id missing or invalid")?
  } else {
    let create_role_response = client
      .post(format!("{}/rest/v1/roles", url))
      .header("apikey", &key)
      .header("Authorization", format!("Bearer {}", key))
      .header("Content-Type", "application/json")
      .header("Accept", "application/json")
      .body(serde_json::json!({ "nombre": "administrador" }).to_string())
      .send()
      .map_err(|err| format!("Supabase role create failed: {}", err))?;

    if !create_role_response.status().is_success() {
      return Err(format!("Supabase responded {} when creating role", create_role_response.status()));
    }

    let created_role: Vec<serde_json::Value> = create_role_response
      .json()
      .map_err(|err| format!("Failed to parse created role response: {}", err))?;

    created_role
      .into_iter()
      .next()
      .ok_or("Rol administrador no fue creado correctamente")?["id"]
      .as_i64()
      .ok_or("Role id missing after role creation")?
  };

  let user_response = client
    .post(format!("{}/auth/v1/admin/users", url))
    .header("apikey", &key)
    .header("Authorization", format!("Bearer {}", key))
    .header("Content-Type", "application/json")
    .header("Accept", "application/json")
    .body(
      serde_json::json!({
        "email": payload.email,
        "password": payload.password,
        "email_confirm": true,
        "user_metadata": { "nombre": payload.nombre }
      })
      .to_string(),
    )
    .send()
    .map_err(|err| format!("Supabase auth create user failed: {}", err))?;

  let user_status = user_response.status();
  if !user_status.is_success() {
    let body = user_response.text().unwrap_or_default();
    return Err(format!("Supabase auth user creation failed {}: {}", user_status, body));
  }

  let user_data: serde_json::Value = user_response
    .json()
    .map_err(|err| format!("Failed to parse auth user response: {}", err))?;

  let auth_user_id = user_data["id"]
    .as_str()
    .ok_or("Auth user id missing in response")?;

  let empleado_response = client
    .post(format!("{}/rest/v1/empleados", url))
    .header("apikey", &key)
    .header("Authorization", format!("Bearer {}", key))
    .header("Content-Type", "application/json")
    .header("Prefer", "return=representation")
    .header("Accept", "application/json")
    .body(
      {
        // set fecha_ingreso to current date (YYYY-MM-DD)
        let fecha_ingreso = Utc::now().format("%Y-%m-%d").to_string();
        serde_json::json!([{ 
          "nombre": payload.nombre,
          "correo": payload.email,
          "rol_id": role_id,
          "auth_user_id": auth_user_id,
          "fecha_ingreso": fecha_ingreso
        }])
        .to_string()
      }
    )
    .send()
    .map_err(|err| format!("Supabase create empleado failed: {}", err))?;

  let empleado_status = empleado_response.status();
  if !empleado_status.is_success() {
    let body = empleado_response.text().unwrap_or_default();
    return Err(format!("Supabase empleado insert failed {}: {}", empleado_status, body));
  }

  Ok(FirstAdminResponse {
    success: true,
    message: "Primer administrador creado con éxito.".into(),
  })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![check_first_admin_available, create_first_admin])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
