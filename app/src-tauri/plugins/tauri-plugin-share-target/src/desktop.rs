use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::PendingShare;

pub fn init<R: Runtime, C: DeserializeOwned>(app: &AppHandle<R>, _api: PluginApi<R, C>) -> tauri::Result<ShareTarget<R>> {
    Ok(ShareTarget(app.clone()))
}

/// Windows no tiene un Share Sheet nativo equivalente al de Android — este stub existe solo para que
/// el resto del código (comandos, ShareTargetExt) compile igual en desktop; `get_pending_share`
/// siempre devuelve `None` acá. La implementación real vive en mobile.rs (Android).
pub struct ShareTarget<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> ShareTarget<R> {
    pub fn get_pending_share(&self) -> tauri::Result<Option<PendingShare>> {
        Ok(None)
    }
}
