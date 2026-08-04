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

#[derive(Serialize, Deserialize, Debug)]
pub struct PartidaNode {
    id_partida: i64,
    codigo: String,
    descripcion: String,
    nivel: i32,
    id_partida_padre: Option<i64>,
    unidad: Option<String>,
    precio_unitario: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Plantilla {
    id_plantilla: i64,
    nombre: String,
    descripcion: Option<String>,
    tipo: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PlantillaDetalleReq {
    id_plantilla_detalle: i64,
    id_partida: i64,
    cantidad_sugerida: Option<f64>,
    orden: Option<i32>,
    partida: Option<PartidaItem>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PartidaItem {
    descripcion: String,
}

#[derive(Serialize, Debug)]
pub struct PlantillaDetalle {
    id_plantilla_detalle: i64,
    id_partida: i64,
    cantidad_sugerida: Option<f64>,
    orden: Option<i32>,
    nombre_partida: String,
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


#[tauri::command]
fn get_partidas_tree() -> Result<Vec<PartidaNode>, String> {
    let url = supabase_url()?;
    let key = supabase_key()?;
    let client = reqwest::blocking::Client::new();
    
    let res = client.get(format!("{}/rest/v1/partida?select=id_partida,codigo,descripcion,nivel,id_partida_padre,unidad,precio_unitario&order=codigo.asc", url))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key))
        .send()
        .map_err(|e| e.to_string())?;
        
    if !res.status().is_success() {
        return Err(format!("Supabase error: {}", res.text().unwrap_or_default()));
    }
    
    let partidas = res.json::<Vec<PartidaNode>>().map_err(|e| e.to_string())?;
    Ok(partidas)
}

#[tauri::command]
fn get_plantillas() -> Result<Vec<Plantilla>, String> {
    let url = supabase_url()?;
    let key = supabase_key()?;
    let client = reqwest::blocking::Client::new();
    
    let res = client.get(format!("{}/rest/v1/plantilla_presupuesto?select=id_plantilla,nombre,descripcion,tipo&order=nombre.asc", url))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key))
        .send()
        .map_err(|e| e.to_string())?;
        
    if !res.status().is_success() {
        return Err(format!("Supabase error: {}", res.text().unwrap_or_default()));
    }
    
    let plantillas = res.json::<Vec<Plantilla>>().map_err(|e| e.to_string())?;
    Ok(plantillas)
}

#[tauri::command]
fn get_plantilla_detalle(id_plantilla: i64) -> Result<Vec<PlantillaDetalle>, String> {
    let url = supabase_url()?;
    let key = supabase_key()?;
    let client = reqwest::blocking::Client::new();
    
    // We use embedding to get the partida's name in one go
    let res = client.get(format!("{}/rest/v1/plantilla_detalle?select=id_plantilla_detalle,id_partida,cantidad_sugerida,orden,partida(descripcion)&id_plantilla=eq.{}&order=orden.asc", url, id_plantilla))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key))
        .send()
        .map_err(|e| e.to_string())?;
        
    if !res.status().is_success() {
        return Err(format!("Supabase error: {}", res.text().unwrap_or_default()));
    }
    
    let raw = res.json::<Vec<PlantillaDetalleReq>>().map_err(|e| e.to_string())?;
    let mapped = raw.into_iter().map(|r| PlantillaDetalle {
        id_plantilla_detalle: r.id_plantilla_detalle,
        id_partida: r.id_partida,
        cantidad_sugerida: r.cantidad_sugerida,
        orden: r.orden,
        nombre_partida: r.partida.map(|p| p.descripcion).unwrap_or_default(),
    }).collect();
    
    Ok(mapped)
}

#[derive(Deserialize)]
struct PresupuestoIdResult {
    id_presupuesto: i64,
}

#[tauri::command]
fn instanciar_plantilla(
    id_plantilla: i64,
    id_proyecto: i64,
    usar_cantidades: bool,
    _crear_metrados: bool,
    auth_user_id: String,
) -> Result<String, String> {
    let url = supabase_url()?;
    let key = supabase_key()?;
    let client = reqwest::blocking::Client::new();
    
    // 1. Check if presupuesto exists
    let res = client.get(format!("{}/rest/v1/presupuesto?select=id_presupuesto&id_proyecto=eq.{}&limit=1", url, id_proyecto))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key))
        .send()
        .map_err(|e| e.to_string())?;
        
    let presupuestos = res.json::<Vec<PresupuestoIdResult>>().map_err(|e| e.to_string())?;
    
    let presupuesto_id = if let Some(p) = presupuestos.first() {
        p.id_presupuesto
    } else {
        // Create presupuesto
        let create_res = client.post(format!("{}/rest/v1/presupuesto", url))
            .header("apikey", &key)
            .header("Authorization", format!("Bearer {}", key))
            .header("Prefer", "return=representation")
            .header("Content-Type", "application/json")
            .body(serde_json::json!({
                "id_proyecto": id_proyecto,
                "nombre": "Presupuesto Base",
                "usuario_registro": auth_user_id
            }).to_string())
            .send()
            .map_err(|e| e.to_string())?;
            
        let new_p = create_res.json::<Vec<PresupuestoIdResult>>().map_err(|e| e.to_string())?;
        new_p.first().ok_or("No se pudo crear el presupuesto")?.id_presupuesto
    };
    
    // 2. Get template details
    let det_res = client.get(format!("{}/rest/v1/plantilla_detalle?select=id_partida,cantidad_sugerida&id_plantilla=eq.{}", url, id_plantilla))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key))
        .send()
        .map_err(|e| e.to_string())?;
        
    let detalles = det_res.json::<Vec<PlantillaDetalleReq>>().map_err(|e| e.to_string())?;
    
    // 3. Insert into presupuesto_detalle
    let mut payload = Vec::new();
    for d in detalles {
        payload.push(serde_json::json!({
            "id_presupuesto": presupuesto_id,
            "id_partida": d.id_partida,
            "cantidad": if usar_cantidades { d.cantidad_sugerida.unwrap_or(0.0) } else { 0.0 },
            "usuario_registro": auth_user_id
        }));
    }
    
    if !payload.is_empty() {
        client.post(format!("{}/rest/v1/presupuesto_detalle", url))
            .header("apikey", &key)
            .header("Authorization", format!("Bearer {}", key))
            .header("Content-Type", "application/json")
            .body(serde_json::to_string(&payload).map_err(|e| e.to_string())?)
            .send()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(format!("Se insertaron {} partidas en el presupuesto", payload.len()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
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
        .invoke_handler(tauri::generate_handler![
            check_first_admin_available,
            create_first_admin,
            get_partidas_tree,
            get_plantillas,
            get_plantilla_detalle,
            instanciar_plantilla
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
