use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::PendingShare;

// Identificador del plugin Kotlin — debe calzar con el `package` declarado en SharePlugin.kt y con
// `register_android_plugin(identifier, className)` abajo. Solo Android está implementado (no hay
// ios_path en build.rs ni carpeta ios/), así que esto nunca se ejercita en iOS aunque `cfg(mobile)`
// también sea `true` ahí.
const PLUGIN_IDENTIFIER: &str = "com.construnierp.app.sharetarget";

pub fn init<R: Runtime, C: DeserializeOwned>(_app: &AppHandle<R>, api: PluginApi<R, C>) -> tauri::Result<ShareTarget<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "SharePlugin")?;
    Ok(ShareTarget(handle))
}

pub struct ShareTarget<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ShareTarget<R> {
    /// Llama al método `getPendingShare` del lado Kotlin (ver SharePlugin.kt) — sin argumentos, así
    /// que se manda `()` como payload.
    pub fn get_pending_share(&self) -> tauri::Result<Option<PendingShare>> {
        Ok(self.0.run_mobile_plugin("getPendingShare", ())?)
    }
}
