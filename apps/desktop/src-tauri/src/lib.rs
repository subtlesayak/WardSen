use std::{
    env, fs, io,
    io::Read,
    io::Write,
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalServiceStatus {
    running: bool,
    port_open: bool,
    node_runtime_found: bool,
    server_bundle_found: bool,
    last_error: Option<String>,
    last_exit: Option<String>,
    last_output: Option<String>,
}

#[tauri::command]
fn get_api_token(token: tauri::State<ApiToken>) -> String {
    token.0.clone()
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_api_token,
            restart_local_service,
            local_service_status
        ])
        .setup(|app| {
            let server_path = resolve_server_bundle(app);
            let bundled_node_path = resolve_bundled_node(app);
            let api_token = generate_api_token()?;
            let node_path = resolve_node_executable(bundled_node_path)?;
            let data_dir = resolve_data_dir(app)?;
            let log_path = data_dir.join("wardsen-service.log");
            let config = ServerLaunchConfig {
                node_path,
                server_path,
                data_dir,
                log_path,
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
            "spawning node={} server={} data={}",
            node_path.display(),
            server_path.display(),
            data_dir.display()
        ),
    )?;
    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&config.log_path)?;
    Command::new(&node_path)
        .arg(&server_path)
        .current_dir(&data_dir)
        .env("WARDSEN_PORT", "4777")
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
        port_open: is_port_open(),
        node_runtime_found: config.node_path.is_file(),
        server_bundle_found: config.server_path.is_file(),
        last_error: clone_mutex_value(&process.last_error)?,
        last_exit: clone_mutex_value(&process.last_exit)?,
        last_output: clone_mutex_value(&process.last_output)?
            .or_else(|| read_log_tail(&config.log_path, 1200)),
    })
}

fn is_port_open() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 4777));
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
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
    let mut candidates = Vec::new();

    #[cfg(windows)]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            candidates.push(local_app_data.join("WardSen").join("data"));
        }
    }

    if let Ok(path) = app.path().app_data_dir() {
        candidates.push(path.join("wardsen-data"));
    }
    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join(".wardsen-data"));
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

fn ensure_writable_dir(path: &PathBuf) -> io::Result<()> {
    fs::create_dir_all(path)?;
    let probe_path = path.join(".wardsen-write-test");
    fs::write(&probe_path, b"ok")?;
    let _ = fs::remove_file(probe_path);
    Ok(())
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
