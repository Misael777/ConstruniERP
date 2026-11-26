use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::TokenPush;

pub fn init<R: Runtime, C: DeserializeOwned>(app: &AppHandle<R>, _api: PluginApi<R, C>) -> tauri::Result<Push<R>> {
    Ok(Push(app.clone()))
}

/// En escritorio no hay push de Firebase: los avisos llegan por la campana (Realtime) mientras el ERP está abierto.
pub struct Push<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> Push<R> {
    pub fn obtener_token(&self) -> Result<TokenPush, String> {
        Ok(TokenPush { token: None })
    }
}
