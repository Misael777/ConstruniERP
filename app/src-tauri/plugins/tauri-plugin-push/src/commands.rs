use tauri::{command, AppHandle, Runtime};

use crate::{PushExt, TokenPush};

/// Token de Firebase del celular (None en escritorio o si la app se compiló sin google-services.json).
#[command]
pub(crate) async fn obtener_token<R: Runtime>(app: AppHandle<R>) -> Result<TokenPush, String> {
    app.push().obtener_token()
}
