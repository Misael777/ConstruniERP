use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;

#[cfg(desktop)]
use desktop::ShareTarget;
#[cfg(mobile)]
use mobile::ShareTarget;

/// Imagen (comprobante) que otra app acaba de compartir con Construni ERP vía el Share Sheet de
/// Android — `data` viene en base64 (ver SharePlugin.kt, que lee el `content://` original y lo
/// codifica directo en la respuesta del comando, para no depender del scope de fs del lado JS).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingShare {
    pub data: String,
    pub file_name: String,
    pub mime_type: String,
}

pub trait ShareTargetExt<R: Runtime> {
    fn share_target(&self) -> &ShareTarget<R>;
}

impl<R: Runtime, T: Manager<R>> ShareTargetExt<R> for T {
    fn share_target(&self) -> &ShareTarget<R> {
        self.state::<ShareTarget<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("share-target")
        .invoke_handler(tauri::generate_handler![commands::get_pending_share])
        .setup(|app, api| {
            #[cfg(mobile)]
            let share_target = mobile::init(app, api)?;
            #[cfg(desktop)]
            let share_target = desktop::init(app, api)?;
            app.manage(share_target);
            Ok(())
        })
        .build()
}
