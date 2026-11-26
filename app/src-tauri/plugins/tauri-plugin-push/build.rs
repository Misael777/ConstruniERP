const COMMANDS: &[&str] = &["obtener_token"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
