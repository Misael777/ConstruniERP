use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::TokenPush;

// Debe calzar con el `package` de PushPlugin.kt. Solo Android (no hay carpeta ios/).
const PLUGIN_IDENTIFIER: &str = "com.construnierp.app.push";

pub fn init<R: Runtime, C: DeserializeOwned>(_app: &AppHandle<R>, api: PluginApi<R, C>) -> tauri::Result<Push<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "PushPlugin")?;
    Ok(Push(handle))
}

pub struct Push<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Push<R> {
    pub fn obtener_token(&self) -> Result<TokenPush, String> {
        self.0.run_mobile_plugin("obtenerToken", ()).map_err(|e| e.to_string())
    }
}
