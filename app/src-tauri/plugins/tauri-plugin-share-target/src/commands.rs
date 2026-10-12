use tauri::{command, AppHandle, Runtime};

use crate::{CompartirPayload, PendingShare, ShareTargetExt};

/// Se llama al abrir/reanudar la app en Android — si hay una imagen recién compartida (ver
/// SharePlugin.kt), la devuelve UNA sola vez (queda consumida del lado Kotlin) para que el frontend
/// abra "Nueva Transacción" con ella ya adjunta. `None` en cualquier otro caso, incluido siempre en
/// escritorio (ver desktop.rs).
#[command]
pub(crate) async fn get_pending_share<R: Runtime>(app: AppHandle<R>) -> Result<Option<PendingShare>, String> {
    app.share_target().get_pending_share().map_err(|e| e.to_string())
}

/// Ticket #83: abre el Share Sheet de Android con el comprobante y el mensaje de una transacción. En
/// escritorio devuelve error (el frontend usa ahí navigator.share / portapapeles, ver compartir.ts).
#[command]
pub(crate) async fn compartir<R: Runtime>(app: AppHandle<R>, payload: CompartirPayload) -> Result<(), String> {
    app.share_target().compartir(payload)
}
