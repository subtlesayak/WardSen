use std::{
    io,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use tauri::{path::BaseDirectory, Manager};

struct ServerProcess(Mutex<Option<Child>>);
struct ApiToken(String);

#[tauri::command]
fn get_api_token(token: tauri::State<ApiToken>) -> String {
    token.0.clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_api_token])
        .setup(|app| {
            let server_path = app.path().resolve("server/index.cjs", BaseDirectory::Resource)?;
            let api_token = generate_api_token()?;
            let child = Command::new("node")
                .arg(server_path)
                .env("WARDSEN_PORT", "4777")
                .env("WARDSEN_API_TOKEN", &api_token)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()?;
            app.manage(ApiToken(api_token));
            app.manage(ServerProcess(Mutex::new(Some(child))));
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::Destroyed = event {
                let process = window.state::<ServerProcess>();
                if let Ok(mut child) = process.0.lock() {
                    if let Some(mut child) = child.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running WardSen desktop application");
}

fn generate_api_token() -> io::Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| io::Error::new(io::ErrorKind::Other, format!("failed to generate WardSen API token: {error:?}")))?;
    Ok(hex_encode(&bytes))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}
