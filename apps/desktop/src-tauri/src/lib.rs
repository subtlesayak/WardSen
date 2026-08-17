use std::{
    env, fs, io,
    io::Read,
    io::Write,
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{path::BaseDirectory, Manager};

struct ServerProcess {
    child: Mutex<Option<Child>>,
    last_error: Mutex<Option<String>>,
    last_exit: Mutex<Option<String>>,
    last_output: Mutex<Option<String>>,
}
struct ApiToken(String);
#[derive(Clone)]
struct ServerLaunchConfig {
    node_path: PathBuf,
    server_path: PathBuf,
    data_dir: PathBuf,
    log_path: PathBuf,
    port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalServiceStatus {
    running: bool,
    port: u16,
    port_open: bool,
    node_runtime_found: bool,
    server_bundle_found: bool,
    last_error: Option<String>,
    last_exit: Option<String>,
    last_output: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalServiceProxyRequest {
    path: String,
    method: String,
    body: Option<String>,
    employee_session: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalServiceProxyResponse {
    status_code: u16,
    body: String,
    content_type: String,
}

#[tauri::command]
fn proxy_local_service_request(
    request: LocalServiceProxyRequest,
    config: tauri::State<ServerLaunchConfig>,
    token: tauri::State<ApiToken>,
) -> Result<LocalServiceProxyResponse, String> {
    proxy_local_service_request_inner(&config, &token.0, &request).map_err(|_| {
        "WardSen could not complete the local service request. Restart the service and retry."
            .to_string()
    })
}

#[tauri::command]
fn restart_local_service(
    process: tauri::State<ServerProcess>,
    config: tauri::State<ServerLaunchConfig>,
    token: tauri::State<ApiToken>,
) -> Result<(), String> {
    restart_server_process(&process, &config, &token.0).map_err(|error| error.to_string())
}

#[tauri::command]
fn local_service_status(
    process: tauri::State<ServerProcess>,
    config: tauri::State<ServerLaunchConfig>,
) -> Result<LocalServiceStatus, String> {
    service_status(&process, &config).map_err(|error| error.to_string())
}

#[tauri::command]
async fn open_terminal_session(
    account_id: String,
    launch_id: String,
    config: tauri::State<'_, ServerLaunchConfig>,
    token: tauri::State<'_, ApiToken>,
) -> Result<(), String> {
    validate_terminal_launch_id(&account_id)?;
    validate_terminal_launch_id(&launch_id)?;
    let config = config.inner().clone();
    let token = token.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let command = fetch_terminal_handoff_command(&config, &token, &account_id, &launch_id)
            .map_err(|_| "WardSen could not retrieve the one-time terminal login command. Start Terminal login / unlock again.".to_string())?;
        validate_terminal_handoff_command(&command)?;
        launch_terminal_session(&command).map_err(|error| {
            format!(
                "WardSen could not open a terminal for Bitwarden login: {error}. Copy the terminal command and run it manually."
            )
        })
    })
    .await
    .map_err(|error| format!("WardSen terminal launch task failed: {error}."))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            proxy_local_service_request,
            restart_local_service,
            local_service_status,
            open_terminal_session
        ])
        .setup(|app| {
            let server_path = resolve_server_bundle(app);
            let bundled_node_path = resolve_bundled_node(app);
            let api_token = generate_api_token()?;
            let node_path = resolve_node_executable(bundled_node_path)?;
            let data_dir = resolve_data_dir(app)?;
            let log_path = data_dir.join("wardsen-service.log");
            let port = select_available_local_port()?;
            let config = ServerLaunchConfig {
                node_path,
                server_path,
                data_dir,
                log_path,
                port,
            };
            let process = ServerProcess {
                child: Mutex::new(None),
                last_error: Mutex::new(None),
                last_exit: Mutex::new(None),
                last_output: Mutex::new(None),
            };
            match spawn_server_process(&config, &api_token) {
                Ok(child) => {
                    set_mutex_value(&process.child, Some(child))?;
                }
                Err(error) => {
                    set_mutex_value(&process.last_error, Some(error.to_string()))?;
                    let _ = append_launch_log(&config, &format!("spawn failed: {error}"));
                }
            }
            app.manage(ApiToken(api_token));
            app.manage(config);
            app.manage(process);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::Destroyed = event {
                let process = window.state::<ServerProcess>();
                if let Ok(mut child) = process.child.lock() {
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

fn restart_server_process(
    process: &ServerProcess,
    config: &ServerLaunchConfig,
    api_token: &str,
) -> io::Result<()> {
    let mut child_guard = process.child.lock().map_err(|_| {
        io::Error::new(
            io::ErrorKind::Other,
            "WardSen local service process lock was poisoned",
        )
    })?;
    if let Some(mut child) = child_guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let child = match spawn_server_process(config, api_token) {
        Ok(child) => {
            set_mutex_value(&process.last_error, None)?;
            set_mutex_value(&process.last_exit, None)?;
            set_mutex_value(&process.last_output, None)?;
            child
        }
        Err(error) => {
            set_mutex_value(&process.last_error, Some(error.to_string()))?;
            return Err(error);
        }
    };
    *child_guard = Some(child);
    Ok(())
}

fn spawn_server_process(config: &ServerLaunchConfig, api_token: &str) -> io::Result<Child> {
    let node_path = normalize_child_path(&config.node_path);
    let server_path = normalize_child_path(&config.server_path);
    let data_dir = normalize_child_path(&config.data_dir);
    append_launch_log(
        config,
        &format!(
            "spawning node={} server={} data={} port={}",
            node_path.display(),
            server_path.display(),
            data_dir.display(),
            config.port
        ),
    )?;
    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&config.log_path)?;
    Command::new(&node_path)
        .arg(&server_path)
        .current_dir(&data_dir)
        .env("WARDSEN_PORT", config.port.to_string())
        .env("WARDSEN_API_TOKEN", api_token)
        .env("WARDSEN_DATA_DIR", &data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file.try_clone()?))
        .stderr(Stdio::from(log_file))
        .spawn()
}

fn service_status(
    process: &ServerProcess,
    config: &ServerLaunchConfig,
) -> io::Result<LocalServiceStatus> {
    let mut running = false;
    {
        let mut child_guard = process.child.lock().map_err(|_| {
            io::Error::new(
                io::ErrorKind::Other,
                "WardSen local service process lock was poisoned",
            )
        })?;
        if let Some(child) = child_guard.as_mut() {
            match child.try_wait()? {
                Some(status) => {
                    let output = collect_child_output(child);
                    set_mutex_value(&process.last_exit, Some(format_exit_status(status)))?;
                    let output = output.or_else(|| read_log_tail(&config.log_path, 1200));
                    if let Some(output) = output {
                        set_mutex_value(&process.last_output, Some(output))?;
                    }
                    *child_guard = None;
                }
                None => {
                    running = true;
                }
            }
        }
    }

    Ok(LocalServiceStatus {
        running,
        port: config.port,
        port_open: is_port_open(config.port),
        node_runtime_found: config.node_path.is_file(),
        server_bundle_found: config.server_path.is_file(),
        last_error: clone_mutex_value(&process.last_error)?,
        last_exit: clone_mutex_value(&process.last_exit)?,
        last_output: clone_mutex_value(&process.last_output)?
            .or_else(|| read_log_tail(&config.log_path, 1200)),
    })
}

fn is_port_open(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn proxy_local_service_request_inner(
    config: &ServerLaunchConfig,
    api_token: &str,
    request: &LocalServiceProxyRequest,
) -> io::Result<LocalServiceProxyResponse> {
    validate_local_service_proxy_request(request)
        .map_err(|message| io::Error::new(io::ErrorKind::InvalidInput, message))?;
    let address = SocketAddr::from(([127, 0, 0, 1], config.port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))?;
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    stream.set_write_timeout(Some(Duration::from_secs(30)))?;

    let body = request.body.as_deref().unwrap_or("");
    let content_headers = if request.body.is_some() {
        format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            body.len()
        )
    } else {
        String::new()
    };
    let employee_session_header = request
        .employee_session
        .as_deref()
        .map(|session| format!("X-WardSen-Employee-Session: {session}\r\n"))
        .unwrap_or_default();
    let raw_request = format!(
        "{} {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-WardSen-API-Token: {}\r\n{}Connection: close\r\n{}\r\n{}",
        request.method, request.path, config.port, api_token, employee_session_header, content_headers, body
    );
    stream.write_all(raw_request.as_bytes())?;

    let mut raw_response = Vec::new();
    stream.read_to_end(&mut raw_response)?;
    let header_end = raw_response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "local service response was malformed",
            )
        })?;
    let headers = std::str::from_utf8(&raw_response[..header_end]).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "local service response headers were invalid",
        )
    })?;
    let status_code = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "local service response status was invalid",
            )
        })?;
    let content_type = headers
        .lines()
        .find_map(|line| http_header_value(line, "content-type"))
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let body_bytes = decode_http_response_body(headers, &raw_response[(header_end + 4)..])?;
    let body = String::from_utf8(body_bytes).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "local service response body was invalid",
        )
    })?;

    Ok(LocalServiceProxyResponse {
        status_code,
        body,
        content_type,
    })
}

fn http_header_value(line: &str, expected_name: &str) -> Option<String> {
    line.split_once(':').and_then(|(name, value)| {
        name.eq_ignore_ascii_case(expected_name)
            .then(|| value.trim().to_string())
    })
}

fn header_value(headers: &str, expected_name: &str) -> Option<String> {
    headers
        .lines()
        .find_map(|line| http_header_value(line, expected_name))
}

fn decode_http_response_body(headers: &str, body: &[u8]) -> io::Result<Vec<u8>> {
    if header_value(headers, "transfer-encoding")
        .is_some_and(|value| value.to_ascii_lowercase().contains("chunked"))
    {
        return decode_chunked_body(body);
    }
    if let Some(length) = header_value(headers, "content-length") {
        let length = length.parse::<usize>().map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "local service response content length was invalid",
            )
        })?;
        if body.len() < length {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "local service response body was truncated",
            ));
        }
        return Ok(body[..length].to_vec());
    }
    Ok(body.to_vec())
}

fn decode_chunked_body(body: &[u8]) -> io::Result<Vec<u8>> {
    let mut decoded = Vec::new();
    let mut cursor = 0;
    loop {
        if cursor >= body.len() {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "local service chunked response ended early",
            ));
        }
        let line_end = body[cursor..]
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    "local service chunk size was malformed",
                )
            })?;
        let size_line = std::str::from_utf8(&body[cursor..(cursor + line_end)]).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "local service chunk size was invalid",
            )
        })?;
        let size_hex = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "local service chunk size was invalid",
            )
        })?;
        cursor += line_end + 2;
        if size == 0 {
            break;
        }
        if body.len() < cursor + size + 2 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "local service chunked response was truncated",
            ));
        }
        decoded.extend_from_slice(&body[cursor..(cursor + size)]);
        cursor += size;
        if body.get(cursor..(cursor + 2)) != Some(b"\r\n") {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "local service chunk terminator was malformed",
            ));
        }
        cursor += 2;
    }
    Ok(decoded)
}

fn validate_local_service_proxy_request(request: &LocalServiceProxyRequest) -> Result<(), String> {
    const MAX_PATH_LENGTH: usize = 4_096;
    const MAX_BODY_LENGTH: usize = 128 * 1024;
    if !matches!(
        request.method.as_str(),
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
    ) {
        return Err("WardSen rejected an unsupported local service method.".to_string());
    }
    if !request.path.starts_with("/api/")
        || request.path.len() > MAX_PATH_LENGTH
        || !request.path.bytes().all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(
                    character,
                    b'/' | b'?'
                        | b'&'
                        | b'='
                        | b'.'
                        | b'_'
                        | b'~'
                        | b'%'
                        | b'-'
                        | b':'
                        | b'+'
                        | b','
                        | b'@'
                )
        })
    {
        return Err("WardSen rejected an invalid local service path.".to_string());
    }
    if request
        .body
        .as_ref()
        .is_some_and(|body| body.len() > MAX_BODY_LENGTH || body.contains('\0'))
    {
        return Err(
            "WardSen rejected an oversized or invalid local service request body.".to_string(),
        );
    }
    if request.employee_session.as_ref().is_some_and(|session| {
        session.is_empty()
            || session.len() > 4_096
            || session.contains('\r')
            || session.contains('\n')
            || session.contains('\0')
    }) {
        return Err("WardSen rejected an invalid employee session header.".to_string());
    }
    Ok(())
}

fn validate_terminal_launch_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value.bytes().all(|character| {
            character.is_ascii_alphanumeric() || character == b'_' || character == b'-'
        })
    {
        return Err("WardSen rejected an invalid terminal launch request.".to_string());
    }
    Ok(())
}

fn fetch_terminal_handoff_command(
    config: &ServerLaunchConfig,
    api_token: &str,
    account_id: &str,
    launch_id: &str,
) -> io::Result<String> {
    let address = SocketAddr::from(([127, 0, 0, 1], config.port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let path = format!("/api/accounts/{account_id}/terminal-handoff/{launch_id}/command");
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-WardSen-API-Token: {api_token}\r\nConnection: close\r\n\r\n",
        config.port
    );
    stream.write_all(request.as_bytes())?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "local service response was malformed",
            )
        })?;
    let headers = std::str::from_utf8(&response[..header_end]).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "local service response headers were invalid",
        )
    })?;
    if !headers.starts_with("HTTP/1.1 200 ") {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "local service did not authorize the terminal launch",
        ));
    }
    let command = String::from_utf8(response[(header_end + 4)..].to_vec()).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "local service terminal command was invalid",
        )
    })?;
    if command.len() > 16_384 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "local service terminal command was too large",
        ));
    }
    Ok(command)
}

fn validate_terminal_handoff_command(command: &str) -> Result<(), String> {
    let value = command.trim();
    if value.is_empty() || value.len() > 16_384 || value.contains('\0') {
        return Err("WardSen rejected an invalid terminal login command.".to_string());
    }
    let expected_prefix = value.starts_with("$env:BITWARDENCLI_APPDATA_DIR=")
        || value.starts_with("export BITWARDENCLI_APPDATA_DIR=");
    let expected_handoff = value.contains("X-WardSen-Terminal-Handoff")
        && value.contains("/terminal-handoff/claim")
        && value.contains("bwCommand")
        && value.contains("WardSen received the Bitwarden session");
    if !expected_prefix || !expected_handoff {
        return Err(
            "WardSen only opens its own short-lived Bitwarden terminal handoff commands."
                .to_string(),
        );
    }
    Ok(())
}

fn launch_terminal_session(command: &str) -> io::Result<()> {
    #[cfg(windows)]
    {
        return launch_windows_powershell(command);
    }

    #[cfg(target_os = "macos")]
    {
        return launch_macos_terminal(command);
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = command;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "automatic terminal launch is currently available on Windows and macOS only",
        ))
    }
}

#[cfg(windows)]
fn launch_windows_powershell(command: &str) -> io::Result<()> {
    let visible_command = windows_terminal_command(command);
    let encoded_command = encode_powershell_command(&visible_command);

    match launch_windows_powershell_console(&encoded_command) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            launch_windows_terminal_tab(&encoded_command)
        }
        Err(error) => Err(error),
    }
}

#[cfg(windows)]
fn launch_windows_terminal_tab(encoded_command: &str) -> io::Result<()> {
    match Command::new("wt.exe")
        .args(windows_terminal_args(&encoded_command))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            launch_windows_powershell_console(&encoded_command)
        }
        Err(error) => Err(error),
    }
}

#[cfg(windows)]
fn launch_windows_powershell_console(encoded_command: &str) -> io::Result<()> {
    use std::os::windows::process::CommandExt;

    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    Command::new("powershell.exe")
        .args(windows_powershell_args(encoded_command))
        .creation_flags(CREATE_NEW_CONSOLE)
        // A new console needs its own standard handles for the Bitwarden prompt and errors.
        .spawn()
        .map(|_| ())
}

#[cfg(any(windows, test))]
fn windows_terminal_args(encoded_command: &str) -> Vec<String> {
    let mut args = vec![
        "-w".to_string(),
        "new".to_string(),
        "new-tab".to_string(),
        "--title".to_string(),
        "WardSen Bitwarden".to_string(),
        "powershell.exe".to_string(),
    ];
    args.extend(windows_powershell_args(encoded_command));
    args
}

#[cfg(any(windows, test))]
fn windows_powershell_args(encoded_command: &str) -> Vec<String> {
    vec![
        "-NoLogo".to_string(),
        "-NoProfile".to_string(),
        "-NoExit".to_string(),
        "-ExecutionPolicy".to_string(),
        "Bypass".to_string(),
        "-EncodedCommand".to_string(),
        encoded_command.to_string(),
    ]
}

#[cfg(any(windows, test))]
fn windows_terminal_command(command: &str) -> String {
    format!(
        "Write-Host ''; Write-Host 'WardSen is starting Bitwarden login. Enter your password only if Bitwarden prompts.'; Write-Host ''; try {{ & {{ {command} }} }} catch {{ Write-Host ''; Write-Host 'WardSen terminal handoff stopped. Review the Bitwarden or setup message above, then retry from WardSen.' -ForegroundColor Yellow }} finally {{ Write-Host ''; Write-Host 'This PowerShell window stays open so you can read the Bitwarden or setup result above.' }}"
    )
}

#[cfg(target_os = "macos")]
fn launch_macos_terminal(command: &str) -> io::Result<()> {
    let script = r#"on run argv
    set handoffCommand to item 1 of argv
    tell application "Terminal"
        activate
        do script handoffCommand
    end tell
end run"#;
    let visible_command = macos_terminal_command(command);
    Command::new("osascript")
        .arg("-e")
        .arg(script)
        .arg(visible_command)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
}

#[cfg(any(target_os = "macos", test))]
fn macos_terminal_command(command: &str) -> String {
    format!(
        "printf '\\nWardSen is starting Bitwarden login. Enter your password only if Bitwarden prompts.\\n\\n'; {command}; printf '\\nThis terminal stays open so you can read the Bitwarden or setup result above.\\n'; exec /bin/zsh -l"
    )
}

#[cfg(windows)]
fn encode_powershell_command(command: &str) -> String {
    let mut utf16_le = Vec::with_capacity(command.len() * 2);
    for unit in command.encode_utf16() {
        utf16_le.extend_from_slice(&unit.to_le_bytes());
    }
    base64_encode(&utf16_le)
}

#[cfg(windows)]
fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        encoded.push(ALPHABET[(first >> 2) as usize] as char);
        encoded.push(ALPHABET[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            ALPHABET[(((second & 0x0f) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            ALPHABET[(third & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::{
        decode_http_response_body, macos_terminal_command, validate_local_service_proxy_request,
        windows_terminal_args, windows_terminal_command, LocalServiceProxyRequest,
    };

    #[test]
    fn macos_terminal_handoff_keeps_the_window_open_after_running() {
        let command = macos_terminal_command(
            "export BITWARDENCLI_APPDATA_DIR='/tmp/wardsen'; bw unlock --raw",
        );

        assert!(command.contains("WardSen is starting Bitwarden login"));
        assert!(command.contains("bw unlock --raw"));
        assert!(command.contains("exec /bin/zsh -l"));
    }

    #[test]
    fn windows_terminal_handoff_keeps_the_window_open_after_running() {
        let command = windows_terminal_command(
            "$env:BITWARDENCLI_APPDATA_DIR='C:\\WardSen'; bw unlock --raw",
        );

        assert!(command.contains("WardSen is starting Bitwarden login"));
        assert!(command.contains("bw unlock --raw"));
        assert!(command.contains("This PowerShell window stays open"));
    }

    #[test]
    fn windows_terminal_handoff_opens_one_named_tab() {
        let args = windows_terminal_args("encoded-command");

        assert_eq!(
            args,
            vec![
                "-w",
                "new",
                "new-tab",
                "--title",
                "WardSen Bitwarden",
                "powershell.exe",
                "-NoLogo",
                "-NoProfile",
                "-NoExit",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                "encoded-command",
            ]
        );
    }

    #[test]
    fn local_service_proxy_only_accepts_bounded_local_api_requests() {
        let accepted = LocalServiceProxyRequest {
            method: "GET".to_string(),
            path: "/api/providers?filter=ready".to_string(),
            body: None,
            employee_session: None,
        };
        assert!(validate_local_service_proxy_request(&accepted).is_ok());

        let external_path = LocalServiceProxyRequest {
            method: "GET".to_string(),
            path: "https://127.0.0.1:4777/api/providers".to_string(),
            body: None,
            employee_session: None,
        };
        assert!(validate_local_service_proxy_request(&external_path).is_err());

        let injected_path = LocalServiceProxyRequest {
            method: "GET".to_string(),
            path: "/api/providers\r\nX-Injected: true".to_string(),
            body: None,
            employee_session: None,
        };
        assert!(validate_local_service_proxy_request(&injected_path).is_err());
    }

    #[test]
    fn local_service_proxy_decodes_framed_http_response_bodies() {
        let sized = decode_http_response_body(
            "HTTP/1.1 200 OK\r\nContent-Length: 11\r\nContent-Type: application/json",
            br#"{"ok":true}ignored"#,
        )
        .expect("content length body");
        assert_eq!(sized, br#"{"ok":true}"#);

        let chunked = decode_http_response_body(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json",
            b"6\r\n{\"ok\":\r\n5\r\ntrue}\r\n0\r\n\r\n",
        )
        .expect("chunked body");
        assert_eq!(chunked, br#"{"ok":true}"#);
    }
}

fn select_available_local_port() -> io::Result<u16> {
    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))?;
    listener.local_addr().map(|address| address.port())
}

fn collect_child_output(child: &mut Child) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(stdout) = child.stdout.as_mut() {
        let mut text = String::new();
        if stdout.read_to_string(&mut text).is_ok() && !text.trim().is_empty() {
            parts.push(format!("stdout: {}", text.trim()));
        }
    }
    if let Some(stderr) = child.stderr.as_mut() {
        let mut text = String::new();
        if stderr.read_to_string(&mut text).is_ok() && !text.trim().is_empty() {
            parts.push(format!("stderr: {}", text.trim()));
        }
    }
    let output = parts.join("\n");
    if output.is_empty() {
        None
    } else {
        Some(truncate_for_ui(&output, 1200))
    }
}

fn format_exit_status(status: std::process::ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("exited with code {code}"),
        None => "exited without a status code".to_string(),
    }
}

fn set_mutex_value<T>(mutex: &Mutex<Option<T>>, value: Option<T>) -> io::Result<()> {
    let mut guard = mutex.lock().map_err(|_| {
        io::Error::new(
            io::ErrorKind::Other,
            "WardSen service status lock was poisoned",
        )
    })?;
    *guard = value;
    Ok(())
}

fn clone_mutex_value<T: Clone>(mutex: &Mutex<Option<T>>) -> io::Result<Option<T>> {
    let guard = mutex.lock().map_err(|_| {
        io::Error::new(
            io::ErrorKind::Other,
            "WardSen service status lock was poisoned",
        )
    })?;
    Ok(guard.clone())
}

fn truncate_for_ui(value: &str, limit: usize) -> String {
    let mut truncated = value.chars().take(limit).collect::<String>();
    if value.chars().count() > limit {
        truncated.push_str("...");
    }
    truncated
}

fn append_launch_log(config: &ServerLaunchConfig, message: &str) -> io::Result<()> {
    fs::create_dir_all(&config.data_dir)?;
    let mut log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&config.log_path)?;
    writeln!(log_file, "{message}")?;
    Ok(())
}

fn read_log_tail(path: &PathBuf, limit: usize) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            let count = value.chars().count();
            if count <= limit {
                value.trim().to_string()
            } else {
                value.chars().skip(count - limit).collect::<String>()
            }
        })
}

fn generate_api_token() -> io::Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| {
        io::Error::new(
            io::ErrorKind::Other,
            format!("failed to generate WardSen API token: {error:?}"),
        )
    })?;
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

fn resolve_node_executable(bundled_node_path: Option<PathBuf>) -> io::Result<PathBuf> {
    let candidates = node_candidates(bundled_node_path);
    candidates.into_iter().find(|candidate| candidate.is_file()).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "WardSen could not find a trusted Node.js runtime. Reinstall WardSen, install Node.js from nodejs.org, or set WARDSEN_NODE_PATH to an absolute node executable path."
        )
    })
}

fn node_candidates(bundled_node_path: Option<PathBuf>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = bundled_node_path {
        candidates.push(path);
    }
    if let Some(explicit) = env::var_os("WARDSEN_NODE_PATH").map(PathBuf::from) {
        if explicit.is_absolute() {
            candidates.push(explicit);
        }
    }

    #[cfg(windows)]
    {
        for root in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(path) = env::var_os(root).map(PathBuf::from) {
                candidates.push(path.join("nodejs").join("node.exe"));
            }
        }
    }

    #[cfg(not(windows))]
    {
        candidates.push(PathBuf::from("/usr/local/bin/node"));
        candidates.push(PathBuf::from("/opt/homebrew/bin/node"));
        candidates.push(PathBuf::from("/usr/bin/node"));
    }

    candidates
}

fn resolve_server_bundle(app: &tauri::App) -> PathBuf {
    let candidates = path_candidates(app, "server/index.cjs");
    let fallback = candidates
        .first()
        .cloned()
        .unwrap_or_else(|| PathBuf::from("server/index.cjs"));
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .unwrap_or(fallback)
}

fn resolve_bundled_node(app: &tauri::App) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        find_first_existing_path(path_candidates(app, "runtime/node.exe"))
    }

    #[cfg(not(windows))]
    {
        find_first_existing_path(path_candidates(app, "runtime/node"))
    }
}

fn resolve_data_dir(app: &tauri::App) -> io::Result<PathBuf> {
    let candidates = data_dir_candidates(app);
    let mut existing_data_dir: Option<(PathBuf, u64)> = None;
    for candidate in &candidates {
        if let Some(size) = data_root_database_size(candidate) {
            if existing_data_dir
                .as_ref()
                .map(|(_, best_size)| size > *best_size)
                .unwrap_or(true)
            {
                existing_data_dir = Some((candidate.clone(), size));
            }
        }
    }

    if let Some((existing, _)) = existing_data_dir {
        if ensure_writable_dir(&existing).is_ok() {
            return Ok(existing);
        }
    }

    let mut failures = Vec::new();
    for candidate in candidates {
        match ensure_writable_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) => failures.push(format!("{}: {error}", candidate.display())),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::PermissionDenied,
        format!(
            "WardSen could not prepare a writable local data directory. Checked: {}",
            failures.join("; ")
        ),
    ))
}

fn data_dir_candidates(app: &tauri::App) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(windows)]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            push_data_dir_candidate(&mut candidates, local_app_data.join("WardSen").join("data"));
            push_data_dir_candidate(
                &mut candidates,
                local_app_data
                    .join("dev.wardsen.desktop")
                    .join("wardsen-data"),
            );
        }
        if let Some(app_data) = env::var_os("APPDATA").map(PathBuf::from) {
            push_data_dir_candidate(&mut candidates, app_data.join("WardSen").join("data"));
            push_data_dir_candidate(
                &mut candidates,
                app_data.join("dev.wardsen.desktop").join("wardsen-data"),
            );
        }
    }

    if let Ok(path) = app.path().app_data_dir() {
        push_data_dir_candidate(&mut candidates, path.join("wardsen-data"));
    }
    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            push_data_dir_candidate(&mut candidates, exe_dir.join(".wardsen-data"));
        }
    }

    candidates
}

fn push_data_dir_candidate(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if candidates
        .iter()
        .any(|existing| same_filesystem_path(existing, &candidate))
    {
        return;
    }
    candidates.push(candidate);
}

fn data_root_database_size(path: &Path) -> Option<u64> {
    fs::metadata(path.join("wardsen.sqlite"))
        .ok()
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
}

fn ensure_writable_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    let probe_path = path.join(".wardsen-write-test");
    fs::write(&probe_path, b"ok")?;
    let _ = fs::remove_file(probe_path);
    Ok(())
}

fn same_filesystem_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        return left.display().to_string().to_lowercase()
            == right.display().to_string().to_lowercase();
    }

    #[cfg(not(windows))]
    {
        left == right
    }
}

fn find_first_existing_path(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn path_candidates(app: &tauri::App, relative_path: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = app.path().resolve(relative_path, BaseDirectory::Resource) {
        candidates.push(path);
    }
    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join(relative_path));
            candidates.push(exe_dir.join("resources").join(relative_path));
        }
    }
    candidates
}

fn normalize_child_path(path: &PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.display().to_string();
        if let Some(stripped) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }

    path.clone()
}
