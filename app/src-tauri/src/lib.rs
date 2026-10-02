use serde::{Deserialize, Serialize};
use std::env;
use tauri::Manager;

mod auditoria;

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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_share_target::init())
        // Módulo de Tickets/Releases (ver Documentacion/MecanismoCICD.md) — tauri-plugin-os es
        // cross-platform, lo usa BotonActualizar.svelte para saber si mostrar el flujo de Windows
        // (auto-update) o el de Android (descarga de Drive + instalación manual). tauri-plugin-opener
        // (también cross-platform) es lo que en Android invoca el instalador nativo sobre el APK ya
        // descargado.
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init());

    // El plugin de auto-update (tauri-plugin-updater) y el de relanzar la app tras instalar
    // (tauri-plugin-process) son SOLO de escritorio — no compilan para Android/iOS, coincide con el
    // diseño: Android nunca los necesita, usa el flujo de Drive en su lugar.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Auditoría: diario local de eventos pendientes + hook de panic (ver auditoria.rs).
            if let Ok(dir) = app.path().app_data_dir() {
                auditoria::inicializar(dir);
            }
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                auditoria::registrar_cierre_app("Se cerró la ventana de la app");
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_partidas_tree,
            get_plantillas,
            get_plantilla_detalle,
            instanciar_plantilla,
            auditoria::auditoria_sesion_actual,
            auditoria::auditoria_diario_agregar,
            auditoria::auditoria_diario_tomar
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                auditoria::registrar_cierre_app("La app terminó");
            }
        });
}
