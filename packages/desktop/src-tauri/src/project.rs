use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::diagrams::DIAGRAM_DIR;
use crate::watcher::Watcher;

/// The project the window is currently pointed at, and the ones before it.
///
/// A "project" is just a folder that owns a `.diagrams/` directory. There is
/// deliberately no import step and no library: diagrams live in the repository
/// they describe, so opening a project is opening a folder.

const RECENT_LIMIT: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    #[serde(rename = "openedAt")]
    pub opened_at: String,
    /// Recomputed on every read — a folder can be moved or deleted between runs.
    #[serde(default)]
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectState {
    pub root: Option<String>,
    pub dir: Option<String>,
    pub sep: String,
    pub recent: Vec<RecentProject>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Settings {
    #[serde(default)]
    last: Option<String>,
    #[serde(default)]
    recent: Vec<RecentProject>,
}

pub struct Project {
    root: Mutex<Option<PathBuf>>,
    recent: Mutex<Vec<RecentProject>>,
    settings_file: PathBuf,
}

fn separator() -> String {
    std::path::MAIN_SEPARATOR.to_string()
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

impl Project {
    pub fn load(app: &AppHandle) -> Self {
        let settings_file = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("settings.json");

        let settings: Settings = fs::read_to_string(&settings_file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();

        // Only reopen the last project if it is still there; a stale path
        // should land the user on the welcome screen, not an error.
        let root = settings
            .last
            .map(PathBuf::from)
            .filter(|path| path.is_dir());

        Self {
            root: Mutex::new(root),
            recent: Mutex::new(settings.recent),
            settings_file,
        }
    }

    pub fn root(&self) -> Option<PathBuf> {
        self.root.lock().unwrap().clone()
    }

    /// The `.diagrams` directory of the open project.
    pub fn dir(&self) -> Option<PathBuf> {
        self.root().map(|root| root.join(DIAGRAM_DIR))
    }

    pub fn state(&self) -> ProjectState {
        let root = self.root();
        let mut recent = self.recent.lock().unwrap().clone();
        for entry in &mut recent {
            entry.exists = Path::new(&entry.path).is_dir();
        }
        ProjectState {
            dir: root
                .as_ref()
                .map(|r| r.join(DIAGRAM_DIR).to_string_lossy().to_string()),
            root: root.map(|r| r.to_string_lossy().to_string()),
            sep: separator(),
            recent,
        }
    }

    fn persist(&self) {
        let settings = Settings {
            last: self.root().map(|r| r.to_string_lossy().to_string()),
            recent: self.recent.lock().unwrap().clone(),
        };
        if let Some(parent) = self.settings_file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(&settings) {
            let _ = fs::write(&self.settings_file, text);
        }
    }

    fn remember(&self, path: &Path) {
        let mut recent = self.recent.lock().unwrap();
        let key = path.to_string_lossy().to_string();
        recent.retain(|entry| entry.path != key);
        recent.insert(
            0,
            RecentProject {
                name: folder_name(path),
                path: key,
                opened_at: now_iso(),
                exists: true,
            },
        );
        recent.truncate(RECENT_LIMIT);
    }

    fn set_root(&self, path: PathBuf) {
        *self.root.lock().unwrap() = Some(path.clone());
        self.remember(&path);
        self.persist();
    }
}

/// Point the app at `path`, rewire the watcher and tell the window.
pub fn open(app: &AppHandle, path: PathBuf) -> Result<ProjectState, String> {
    if !path.is_dir() {
        return Err(format!("{} is not a folder.", path.display()));
    }
    let canonical = dunce_canonicalize(&path);

    let project = app.state::<Project>();
    project.set_root(canonical.clone());

    // Create `.diagrams/` up front so the watcher has something to watch and
    // the user can drop a file in by hand straight away.
    let dir = canonical.join(DIAGRAM_DIR);
    fs::create_dir_all(&dir).map_err(|err| format!("Could not create {}: {err}", dir.display()))?;

    app.state::<Watcher>().watch(&dir)?;

    let state = project.state();
    let _ = app.emit("project-changed", &state);
    Ok(state)
}

/// `canonicalize` on Windows returns a `\\?\` path, which is correct but ugly
/// in a title bar and unusable in a config file a person may read. Strip the
/// prefix when it is safe to; otherwise use the path as given.
fn dunce_canonicalize(path: &Path) -> PathBuf {
    let Ok(canonical) = path.canonicalize() else {
        return path.to_path_buf();
    };
    let text = canonical.to_string_lossy().to_string();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => canonical,
    }
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

#[tauri::command]
pub fn project_state(project: State<Project>) -> ProjectState {
    project.state()
}

#[tauri::command]
pub async fn project_pick(app: AppHandle) -> Result<ProjectState, String> {
    use tauri_plugin_dialog::DialogExt;

    let start = app
        .state::<Project>()
        .root()
        .or_else(|| dirs::home_dir());

    let (tx, rx) = std::sync::mpsc::channel();
    let mut dialog = app.dialog().file().set_title("Choose a project folder");
    if let Some(start) = start {
        dialog = dialog.set_directory(start);
    }
    dialog.pick_folder(move |picked| {
        let _ = tx.send(picked);
    });

    let picked = rx.recv().map_err(|_| "The folder picker closed unexpectedly.".to_string())?;

    match picked {
        // Cancelling is not an error — hand back the state as it stands.
        None => Ok(app.state::<Project>().state()),
        Some(path) => {
            let path = path
                .into_path()
                .map_err(|err| format!("That folder cannot be opened: {err}"))?;
            open(&app, path)
        }
    }
}

#[tauri::command]
pub fn project_open(app: AppHandle, path: String) -> Result<ProjectState, String> {
    open(&app, PathBuf::from(path))
}

#[tauri::command]
pub fn project_forget(app: AppHandle, path: String) -> ProjectState {
    let project = app.state::<Project>();
    project.recent.lock().unwrap().retain(|entry| entry.path != path);
    project.persist();
    project.state()
}

/// Reveal a path in Explorer / Finder / the desktop's file manager.
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|err| err.to_string())
}
