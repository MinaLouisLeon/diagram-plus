use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager, State};

use crate::project::Project;

/// Registering the MCP server with the AI tools on this machine.
///
/// This is the desktop counterpart of `npm run install-mcp`, and writes the
/// same entries in the same formats — the difference is only that it is driven
/// by a settings screen instead of a terminal list. Existing servers in those
/// files are left alone, and anything that gets changed is backed up first.

const SERVER_NAME: &str = "diagram-plus";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Local,
    Global,
}

/// How a client's config file is shaped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    /// `{ "mcpServers": { "diagram-plus": {...} } }` — the common shape.
    McpServers,
    /// `{ "servers": { "diagram-plus": { "type": "stdio", ... } } }` — VS Code.
    VscodeServers,
    /// `[mcp_servers.diagram-plus]` in `config.toml` — Codex.
    Toml,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Terminal,
    Desktop,
}

struct ClientSpec {
    id: &'static str,
    label: &'static str,
    kind: Kind,
    /// Desktop apps have no working directory, so they need the project path
    /// baked in. Terminal tools are better off without it: one global install
    /// then works in every project.
    pins_root: bool,
    after: &'static str,
}

const CLIENTS: &[ClientSpec] = &[
    ClientSpec {
        id: "claude-code",
        label: "Claude Code",
        kind: Kind::Terminal,
        pins_root: false,
        after: "Restart Claude Code, then check with /mcp.",
    },
    ClientSpec {
        id: "claude-desktop",
        label: "Claude Desktop",
        kind: Kind::Desktop,
        pins_root: true,
        after: "Quit Claude Desktop completely and reopen it.",
    },
    ClientSpec {
        id: "codex",
        label: "Codex CLI",
        kind: Kind::Terminal,
        pins_root: false,
        after: "Start a new codex session.",
    },
    ClientSpec {
        id: "cursor",
        label: "Cursor",
        kind: Kind::Desktop,
        pins_root: true,
        after: "Reload Cursor, then enable the server under Settings > MCP.",
    },
    ClientSpec {
        id: "windsurf",
        label: "Windsurf",
        kind: Kind::Desktop,
        pins_root: true,
        after: "Reload Windsurf, then refresh the MCP server list.",
    },
    ClientSpec {
        id: "vscode",
        label: "VS Code (Copilot)",
        kind: Kind::Desktop,
        pins_root: true,
        after: "Reload the window, then pick the server from the Copilot Chat tool list.",
    },
    ClientSpec {
        id: "gemini-cli",
        label: "Gemini CLI",
        kind: Kind::Terminal,
        pins_root: false,
        after: "Start a new gemini session, then check with /mcp.",
    },
];

/* ------------------------------------------------------------------ *
 * Where things live
 * ------------------------------------------------------------------ */

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// `%APPDATA%` on Windows, the platform config directory elsewhere.
fn app_data() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData").join("Roaming"))
    }
    #[cfg(target_os = "macos")]
    {
        home().join("Library").join("Application Support")
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        dirs::config_dir().unwrap_or_else(|| home().join(".config"))
    }
}

fn claude_desktop_config() -> PathBuf {
    app_data().join("Claude").join("claude_desktop_config.json")
}

/// VS Code's user-level MCP file.
///
/// Deliberately `User/mcp.json` rather than `User/settings.json`: settings.json
/// is JSONC and rewriting it would strip the user's comments. `mcp.json` is
/// plain JSON, is where `code --add-mcp` puts servers, and is read by every VS
/// Code recent enough to speak MCP.
fn vscode_user_mcp() -> PathBuf {
    app_data().join("Code").join("User").join("mcp.json")
}

fn on_path(command: &str) -> bool {
    which::which(command).is_ok()
}

/// The config file a client uses for this scope, and how it is shaped.
fn target_for(id: &str, scope: Scope, project: Option<&Path>) -> Option<(PathBuf, Format)> {
    let home = home();
    match (id, scope) {
        ("claude-code", Scope::Local) => {
            Some((project?.join(".mcp.json"), Format::McpServers))
        }
        ("claude-code", Scope::Global) => Some((home.join(".claude.json"), Format::McpServers)),

        // Claude Desktop has no project-level config.
        ("claude-desktop", Scope::Local) => None,
        ("claude-desktop", Scope::Global) => Some((claude_desktop_config(), Format::McpServers)),

        // Codex reads one global config.toml.
        ("codex", Scope::Local) => None,
        ("codex", Scope::Global) => {
            Some((home.join(".codex").join("config.toml"), Format::Toml))
        }

        ("cursor", Scope::Local) => {
            Some((project?.join(".cursor").join("mcp.json"), Format::McpServers))
        }
        ("cursor", Scope::Global) => {
            Some((home.join(".cursor").join("mcp.json"), Format::McpServers))
        }

        ("windsurf", Scope::Local) => None,
        ("windsurf", Scope::Global) => Some((
            home.join(".codeium").join("windsurf").join("mcp_config.json"),
            Format::McpServers,
        )),

        ("vscode", Scope::Local) => Some((
            project?.join(".vscode").join("mcp.json"),
            Format::VscodeServers,
        )),
        ("vscode", Scope::Global) => Some((vscode_user_mcp(), Format::VscodeServers)),

        ("gemini-cli", Scope::Local) => Some((
            project?.join(".gemini").join("settings.json"),
            Format::McpServers,
        )),
        ("gemini-cli", Scope::Global) => {
            Some((home.join(".gemini").join("settings.json"), Format::McpServers))
        }

        _ => None,
    }
}

fn detect(id: &str) -> bool {
    let home = home();
    match id {
        "claude-code" => {
            on_path("claude") || home.join(".claude").is_dir() || home.join(".claude.json").is_file()
        }
        "claude-desktop" => claude_desktop_config()
            .parent()
            .map(Path::is_dir)
            .unwrap_or(false),
        "codex" => on_path("codex") || home.join(".codex").is_dir(),
        "cursor" => home.join(".cursor").is_dir() || on_path("cursor"),
        "windsurf" => home.join(".codeium").join("windsurf").is_dir(),
        "vscode" => {
            on_path("code")
                || vscode_user_mcp()
                    .parent()
                    .map(Path::is_dir)
                    .unwrap_or(false)
        }
        "gemini-cli" => on_path("gemini") || home.join(".gemini").is_dir(),
        _ => false,
    }
}

/* ------------------------------------------------------------------ *
 * The server definition
 * ------------------------------------------------------------------ */

/// Absolute path of the MCP server bundled with the app.
pub fn server_entry(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("mcp-server.mjs", tauri::path::BaseDirectory::Resource)
        .map_err(|err| format!("The bundled MCP server is missing: {err}"))
}

/// The `node` the registered command will run under.
///
/// An absolute path rather than bare `node`, because a desktop client launches
/// the server with its own environment and may not have the user's PATH.
fn node_binary() -> Option<PathBuf> {
    which::which("node").ok()
}

fn node_version(node: &Path) -> Option<String> {
    let output = std::process::Command::new(node).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn definition(node: &str, entry: &Path, root: Option<&Path>, vscode: bool) -> Value {
    let mut map = Map::new();
    if vscode {
        map.insert("type".into(), json!("stdio"));
    }
    map.insert("command".into(), json!(node));
    map.insert("args".into(), json!([entry.to_string_lossy()]));
    if let Some(root) = root {
        map.insert(
            "env".into(),
            json!({ "DIAGRAM_PLUS_ROOT": root.to_string_lossy() }),
        );
    }
    Value::Object(map)
}

/* ------------------------------------------------------------------ *
 * Reading and writing config files
 * ------------------------------------------------------------------ */

fn read_json(file: &Path) -> Result<Value, String> {
    if !file.is_file() {
        return Ok(Value::Object(Map::new()));
    }
    let text = fs::read_to_string(file)
        .map_err(|err| format!("Could not read {}: {err}", file.display()))?;
    if text.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(&text).map_err(|err| {
        format!(
            "{} is not valid JSON ({err}). Fix or move it, then try again.",
            file.display()
        )
    })
}

/// Keep a timestamped copy the first time a run touches an existing file.
fn backup(file: &Path, done: &mut BTreeSet<PathBuf>, backups: &mut Vec<String>) {
    if !file.is_file() || done.contains(file) {
        return;
    }
    let stamp = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S");
    let copy = file.with_extension(format!(
        "{}.backup-{stamp}",
        file.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default()
    ));
    if fs::copy(file, &copy).is_ok() {
        backups.push(copy.to_string_lossy().to_string());
    }
    done.insert(file.to_path_buf());
}

fn write_text(file: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create {}: {err}", parent.display()))?;
    }
    fs::write(file, contents).map_err(|err| format!("Could not write {}: {err}", file.display()))
}

fn write_json(file: &Path, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|err| format!("Could not serialise {}: {err}", file.display()))?;
    write_text(file, &format!("{text}\n"))
}

/// Add, update or remove the entry under one JSON key (`mcpServers`/`servers`).
fn apply_json(
    file: &Path,
    key: &str,
    entry: Value,
    remove: bool,
    done: &mut BTreeSet<PathBuf>,
    backups: &mut Vec<String>,
) -> Result<Action, String> {
    let mut data = read_json(file)?;
    if !data.is_object() {
        data = Value::Object(Map::new());
    }
    let root = data.as_object_mut().expect("object");
    let servers = root
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !servers.is_object() {
        *servers = Value::Object(Map::new());
    }
    let servers = servers.as_object_mut().expect("object");

    if remove {
        if servers.remove(SERVER_NAME).is_none() {
            return Ok(Action::Absent);
        }
        backup(file, done, backups);
        write_json(file, &data)?;
        return Ok(Action::Removed);
    }

    let existed = servers.get(SERVER_NAME);
    if existed == Some(&entry) {
        return Ok(Action::Unchanged);
    }
    let action = if existed.is_some() {
        Action::Updated
    } else {
        Action::Added
    };
    servers.insert(SERVER_NAME.to_string(), entry);
    backup(file, done, backups);
    write_json(file, &data)?;
    Ok(action)
}

/// Codex's `config.toml`, edited in place so the user's other settings and
/// comments survive.
fn apply_toml(
    file: &Path,
    node: &str,
    entry_path: &Path,
    root: Option<&Path>,
    remove: bool,
    done: &mut BTreeSet<PathBuf>,
    backups: &mut Vec<String>,
) -> Result<Action, String> {
    use toml_edit::{value, Array, DocumentMut, Item, Table};

    let text = if file.is_file() {
        fs::read_to_string(file)
            .map_err(|err| format!("Could not read {}: {err}", file.display()))?
    } else {
        String::new()
    };
    let mut doc: DocumentMut = text.parse().map_err(|err| {
        format!(
            "{} is not valid TOML ({err}). Fix or move it, then try again.",
            file.display()
        )
    })?;

    let servers = doc
        .entry("mcp_servers")
        .or_insert(Item::Table({
            let mut table = Table::new();
            table.set_implicit(true);
            table
        }));
    let Some(servers) = servers.as_table_mut() else {
        return Err(format!(
            "{} has an mcp_servers entry that is not a table.",
            file.display()
        ));
    };
    servers.set_implicit(true);

    if remove {
        if servers.remove(SERVER_NAME).is_none() {
            return Ok(Action::Absent);
        }
        backup(file, done, backups);
        write_text(file, &doc.to_string())?;
        return Ok(Action::Removed);
    }

    let before = servers.get(SERVER_NAME).map(|item| item.to_string());

    let mut table = Table::new();
    table["command"] = value(node);
    let mut args = Array::new();
    args.push(entry_path.to_string_lossy().as_ref());
    table["args"] = value(args);
    if let Some(root) = root {
        let mut env = Table::new();
        env["DIAGRAM_PLUS_ROOT"] = value(root.to_string_lossy().as_ref());
        env.set_implicit(false);
        table["env"] = Item::Table(env);
    }
    servers[SERVER_NAME] = Item::Table(table);

    if before.as_deref() == Some(&servers[SERVER_NAME].to_string()) {
        return Ok(Action::Unchanged);
    }
    let action = if before.is_some() {
        Action::Updated
    } else {
        Action::Added
    };
    backup(file, done, backups);
    write_text(file, &doc.to_string())?;
    Ok(action)
}

/// Is diagram-plus already registered in this file?
fn installed_in(file: &Path, format: Format) -> bool {
    match format {
        Format::McpServers => read_json(file)
            .ok()
            .and_then(|data| data.get("mcpServers")?.get(SERVER_NAME).cloned())
            .is_some(),
        Format::VscodeServers => read_json(file)
            .ok()
            .and_then(|data| data.get("servers")?.get(SERVER_NAME).cloned())
            .is_some(),
        Format::Toml => fs::read_to_string(file)
            .ok()
            .and_then(|text| text.parse::<toml_edit::DocumentMut>().ok())
            .map(|doc| doc.get("mcp_servers").and_then(|s| s.get(SERVER_NAME)).is_some())
            .unwrap_or(false),
    }
}

/* ------------------------------------------------------------------ *
 * The commands
 * ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Added,
    Updated,
    Unchanged,
    Removed,
    Absent,
    Skipped,
    Failed,
}

#[derive(Debug, Serialize)]
pub struct ClientStatus {
    id: String,
    label: String,
    kind: Kind,
    detected: bool,
    target: Option<String>,
    installed: bool,
    after: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    server_entry: String,
    node_path: Option<String>,
    node_version: Option<String>,
    clients: Vec<ClientStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpResult {
    client_id: String,
    label: String,
    file: String,
    action: Action,
    detail: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct McpReport {
    results: Vec<McpResult>,
    backups: Vec<String>,
}

#[tauri::command]
pub fn mcp_status(
    app: AppHandle,
    project: State<Project>,
    scope: Scope,
) -> Result<McpStatus, String> {
    let entry = server_entry(&app)?;
    let root = project.root();
    let node = node_binary();

    let clients = CLIENTS
        .iter()
        .map(|spec| {
            let target = target_for(spec.id, scope, root.as_deref());
            ClientStatus {
                id: spec.id.to_string(),
                label: spec.label.to_string(),
                kind: spec.kind,
                detected: detect(spec.id),
                installed: target
                    .as_ref()
                    .map(|(file, format)| installed_in(file, *format))
                    .unwrap_or(false),
                target: target.map(|(file, _)| file.to_string_lossy().to_string()),
                after: spec.after.to_string(),
            }
        })
        .collect();

    Ok(McpStatus {
        server_entry: entry.to_string_lossy().to_string(),
        node_version: node.as_deref().and_then(node_version),
        node_path: node.map(|p| p.to_string_lossy().to_string()),
        clients,
    })
}

#[tauri::command]
pub fn mcp_apply(
    app: AppHandle,
    project: State<Project>,
    scope: Scope,
    client_ids: Vec<String>,
    remove: bool,
) -> Result<McpReport, String> {
    let entry = server_entry(&app)?;
    let root = project.root();

    if scope == Scope::Local && root.is_none() {
        return Err("Open a project folder first — a local install writes into it.".into());
    }

    let node = node_binary()
        .map(|p| p.to_string_lossy().to_string())
        // Without node on PATH the entry is still worth writing: the user may
        // install it later, and a bare `node` is what most configs carry.
        .unwrap_or_else(|| "node".to_string());

    let mut results = Vec::new();
    let mut backups = Vec::new();
    let mut backed_up = BTreeSet::new();

    for id in &client_ids {
        let Some(spec) = CLIENTS.iter().find(|c| c.id == *id) else {
            continue;
        };
        let Some((file, format)) = target_for(spec.id, scope, root.as_deref()) else {
            results.push(McpResult {
                client_id: spec.id.to_string(),
                label: spec.label.to_string(),
                file: String::new(),
                action: Action::Skipped,
                detail: Some(match scope {
                    Scope::Local => format!("{} has no project-level config.", spec.label),
                    Scope::Global => format!("{} has no global config.", spec.label),
                }),
            });
            continue;
        };

        // A pinned root is only meaningful when we have one to pin.
        let pinned = if spec.pins_root { root.as_deref() } else { None };

        let outcome = match format {
            Format::McpServers => apply_json(
                &file,
                "mcpServers",
                definition(&node, &entry, pinned, false),
                remove,
                &mut backed_up,
                &mut backups,
            ),
            Format::VscodeServers => apply_json(
                &file,
                "servers",
                definition(&node, &entry, pinned, true),
                remove,
                &mut backed_up,
                &mut backups,
            ),
            Format::Toml => apply_toml(
                &file,
                &node,
                &entry,
                pinned,
                remove,
                &mut backed_up,
                &mut backups,
            ),
        };

        results.push(match outcome {
            Ok(action) => McpResult {
                client_id: spec.id.to_string(),
                label: spec.label.to_string(),
                file: file.to_string_lossy().to_string(),
                action,
                detail: matches!(action, Action::Added | Action::Updated)
                    .then(|| spec.after.to_string()),
            },
            Err(message) => McpResult {
                client_id: spec.id.to_string(),
                label: spec.label.to_string(),
                file: file.to_string_lossy().to_string(),
                action: Action::Failed,
                detail: Some(message),
            },
        });
    }

    Ok(McpReport { results, backups })
}
