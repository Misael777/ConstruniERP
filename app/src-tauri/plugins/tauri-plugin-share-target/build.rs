const COMMANDS: &[&str] = &["get_pending_share", "compartir"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
