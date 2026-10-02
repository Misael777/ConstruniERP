//! Auditoría (Control de Accesos → Auditoría): parte nativa del auditor silencioso.
//!
//! - Diario local `app_data_dir/auditoria/pendientes.jsonl`: una línea JSON por evento que todavía no llegó
//!   al servidor. Sobrevive a un cierre brusco; el frontend lo vacía y lo sube en el siguiente inicio de
//!   sesión (`auditoria_diario_tomar`, ver app/src/lib/shared/auditoria.ts).
//! - Cierre de la ventana / salida de la app: anota `app_cerrada` con la hora exacta en el diario y hace un
//!   intento corto de avisarle al servidor en el momento.
//! - Panic de Rust: anota el error + `cierre_inesperado` en el diario antes de que el proceso muera.
//!
//! Lo que ningún hook alcanza a ver (matar el proceso, corte de luz, Android matando la app en segundo
//! plano) lo resuelve el latido del lado del servidor: ver auditoria_cerrar_huerfanas() en la migración.

use serde_json::json;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Clone)]
struct SesionActual {
    sesion_id: String,
    token: String,
    url: String,
    anon_key: String,
}

static DIARIO: OnceLock<PathBuf> = OnceLock::new();
static SESION: Mutex<Option<SesionActual>> = Mutex::new(None);
static CIERRE_REGISTRADO: AtomicBool = AtomicBool::new(false);

/// Se llama una vez desde `setup`: prepara la carpeta del diario e instala el hook de panic.
pub fn inicializar(dir_datos: PathBuf) {
    let dir = dir_datos.join("auditoria");
    let _ = fs::create_dir_all(&dir);
    let _ = DIARIO.set(dir.join("pendientes.jsonl"));

    let anterior = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let mensaje = info.to_string();
        let momento = ahora_iso();
        // try_lock: si el panic ocurrió con el mutex tomado, no hay que bloquearse acá.
        let sesion = SESION.try_lock().ok().and_then(|g| g.clone());
        let (sesion_id, token) = match &sesion {
            Some(s) => (json!(s.sesion_id), json!(s.token)),
            None => (json!(null), json!(null)),
        };
        agregar_linea(
            &json!({
                "kind": "error", "sesion": sesion_id, "token": token, "origen": "rust_panic",
                "mensaje": recortar(&mensaje, 1000), "stack": null, "plataforma": std::env::consts::OS, "momento": momento
            })
            .to_string(),
        );
        if sesion.is_some() {
            agregar_linea(
                &json!({
                    "kind": "cierre", "sesion": sesion_id, "token": token, "motivo": "cierre_inesperado",
                    "momento": momento, "detalle": format!("Falla interna de la app: {}", recortar(&mensaje, 400))
                })
                .to_string(),
            );
        }
        anterior(info);
    }));
}

/// Cierre de la ventana principal o salida de la app. Solo cuenta la primera vez por sesión
/// (al cerrar la ventana llegan tanto CloseRequested como Exit).
pub fn registrar_cierre_app(detalle: &str) {
    let Some(s) = SESION.lock().ok().and_then(|g| g.clone()) else {
        return;
    };
    if CIERRE_REGISTRADO.swap(true, Ordering::SeqCst) {
        return;
    }
    let momento = ahora_iso();
    agregar_linea(
        &json!({
            "kind": "cierre", "sesion": s.sesion_id, "token": s.token, "motivo": "app_cerrada",
            "momento": momento, "detalle": detalle
        })
        .to_string(),
    );

    // Aviso inmediato al servidor, en un hilo propio (reqwest::blocking no debe correr dentro del runtime
    // async de Tauri) y con un tope corto para no demorar el cierre. Si falla, queda el diario.
    let detalle = detalle.to_string();
    let hilo = std::thread::spawn(move || {
        if let Ok(cliente) = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(1500))
            .build()
        {
            let _ = cliente
                .post(format!("{}/rest/v1/rpc/auditoria_cerrar_sesion", s.url))
                .header("apikey", &s.anon_key)
                .header("Authorization", format!("Bearer {}", s.anon_key))
                .header("Content-Type", "application/json")
                .body(
                    json!({
                        "p_sesion": s.sesion_id, "p_token": s.token, "p_motivo": "app_cerrada",
                        "p_momento": momento, "p_detalle": detalle
                    })
                    .to_string(),
                )
                .send();
        }
    });
    let _ = hilo.join();
}

/// El frontend avisa cuál es la sesión de auditoría activa (o `None` al cerrar sesión), para que los
/// hooks de cierre/panic sepan a qué sesión anotar el evento.
#[tauri::command]
pub fn auditoria_sesion_actual(
    sesion_id: Option<String>,
    token: Option<String>,
    url: Option<String>,
    anon_key: Option<String>,
) {
    let nueva = match (sesion_id, token, url, anon_key) {
        (Some(sesion_id), Some(token), Some(url), Some(anon_key)) => Some(SesionActual { sesion_id, token, url, anon_key }),
        _ => None,
    };
    if nueva.is_some() {
        CIERRE_REGISTRADO.store(false, Ordering::SeqCst);
    }
    if let Ok(mut g) = SESION.lock() {
        *g = nueva;
    }
}

#[tauri::command]
pub fn auditoria_diario_agregar(linea: String) {
    agregar_linea(&linea);
}

/// Devuelve los eventos pendientes y vacía el diario. Quien los recibe se encarga de re-agregar los que
/// no pudo subir.
#[tauri::command]
pub fn auditoria_diario_tomar() -> Vec<String> {
    let Some(ruta) = DIARIO.get() else {
        return Vec::new();
    };
    let contenido = fs::read_to_string(ruta).unwrap_or_default();
    let _ = fs::remove_file(ruta);
    contenido
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

fn agregar_linea(linea: &str) {
    let Some(ruta) = DIARIO.get() else {
        return;
    };
    if let Ok(mut archivo) = OpenOptions::new().create(true).append(true).open(ruta) {
        let _ = writeln!(archivo, "{}", linea.replace('\n', " "));
    }
}

fn recortar(texto: &str, max: usize) -> String {
    texto.chars().take(max).collect()
}

/// Hora actual UTC en formato ISO 8601 (sin depender de chrono).
fn ahora_iso() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs() as i64;
    let dias = secs.div_euclid(86_400);
    let resto = secs.rem_euclid(86_400);
    // civil_from_days (Howard Hinnant)
    let z = dias + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let dia = doy - (153 * mp + 2) / 5 + 1;
    let mes = if mp < 10 { mp + 3 } else { mp - 9 };
    let anio = yoe + era * 400 + if mes <= 2 { 1 } else { 0 };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        anio,
        mes,
        dia,
        resto / 3600,
        (resto % 3600) / 60,
        resto % 60,
        d.subsec_millis()
    )
}
