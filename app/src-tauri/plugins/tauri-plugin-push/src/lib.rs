//! Ticket #113: notificaciones push (Firebase Cloud Messaging) en Android. El lado nativo (PushPlugin.kt y
//! PushMessagingService.kt) recibe los avisos aunque la app esté cerrada y los muestra agrupados por categoría; este
//! plugin solo expone el token del celular para que el frontend lo registre en Supabase (dispositivo_push).
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
use desktop::Push;
#[cfg(mobile)]
use mobile::Push;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPush {
    pub token: Option<String>,
}

pub trait PushExt<R: Runtime> {
    fn push(&self) -> &Push<R>;
}

impl<R: Runtime, T: Manager<R>> PushExt<R> for T {
    fn push(&self) -> &Push<R> {
        self.state::<Push<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("push")
        .invoke_handler(tauri::generate_handler![commands::obtener_token])
        .setup(|app, api| {
            #[cfg(mobile)]
            let push = mobile::init(app, api)?;
            #[cfg(desktop)]
            let push = desktop::init(app, api)?;
            app.manage(push);
            Ok(())
        })
        .build()
}
