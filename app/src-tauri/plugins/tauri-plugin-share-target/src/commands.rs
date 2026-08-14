use tauri::{command, AppHandle, Runtime};

use crate::{PendingShare, ShareTargetExt};

/// Se llama al abrir/reanudar la app en Android — si hay una imagen recién compartida (ver
/// SharePlugin.kt), la devuelve UNA sola vez (queda consumida del lado Kotlin) para que el frontend
/// abra "Nueva Transacción" con ella ya adjunta. `None` en cualquier otro caso, incluido siempre en
/// escritorio (ver desktop.rs).
#[command]
pub(crate) async fn get_pending_share<R: Runtime>(app: AppHandle<R>) -> Result<Option<PendingShare>, String> {
    app.share_target().get_pending_share().map_err(|e| e.to_string())
}
