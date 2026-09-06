use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::project::Project;

/// Carrying a diagram in and out of the project folder.
///
/// Everything else on this side is confined to `.diagrams/`, deliberately: the
/// webview names a slug and never a path. Import and export are the one case
/// that has to reach outside it, because the whole point is a file that arrived
/// from someone else's machine — so the reaching out is done here, where the
/// path comes from a native dialog the user just clicked through rather than
/// from anything the webview said.
///
/// The webview cannot name a path in either direction. It can read only files
/// the user picked in an open dialog, and write only to a file the user named
/// in a save dialog.

/// Roughly a diagram with a few thousand blocks. Large enough that no real
/// design hits it, small enough that a mis-picked video does not load.
const MAX_IMPORT_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct PickedFile {
    /// File name alone, for messages. The full path never reaches the webview.
    pub name: String,
    pub text: String,
}

fn start_dir(app: &AppHandle) -> Option<PathBuf> {
    app.state::<Project>()
        .root()
        .or_else(dirs::download_dir)
        .or_else(dirs::home_dir)
}

/// Native open dialog, then read what was chosen.
///
/// Cancelling gives an empty list rather than an error — the user changing
/// their mind is a normal outcome, not a failure.
#[tauri::command]
pub async fn transfer_pick_files(app: AppHandle) -> Result<Vec<PickedFile>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose diagram files to import")
        .add_filter("diagram-plus", &["json"]);
    if let Some(start) = start_dir(&app) {
        dialog = dialog.set_directory(start);
    }
    dialog.pick_files(move |picked| {
        let _ = tx.send(picked);
    });

    let picked = rx
        .recv()
        .map_err(|_| "The file picker closed unexpectedly.".to_string())?;

    let mut out = Vec::new();
    for entry in picked.unwrap_or_default() {
        let path = entry
            .into_path()
            .map_err(|err| format!("That file cannot be opened: {err}"))?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.display().to_string());

        match fs::metadata(&path) {
            Ok(meta) if meta.len() > MAX_IMPORT_BYTES => {
                return Err(format!("{name} is too large to be a diagram."));
            }
            Ok(_) => {}
            Err(err) => return Err(format!("Could not open {name}: {err}")),
        }

        let text = fs::read_to_string(&path)
            .map_err(|err| format!("Could not read {name}: {err}"))?;
        out.push(PickedFile { name, text });
    }
    Ok(out)
}

/// Native save dialog, then write to wherever the user pointed it.
///
/// Returns the path so the editor can say where the file went, or `None` when
/// the dialog was cancelled.
#[tauri::command]
pub async fn transfer_save_file(
    app: AppHandle,
    suggested_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Export diagram")
        .set_file_name(&suggested_name)
        .add_filter("diagram-plus", &["json"]);
    if let Some(start) = dirs::download_dir().or_else(dirs::home_dir) {
        dialog = dialog.set_directory(start);
    }
    dialog.save_file(move |picked| {
        let _ = tx.send(picked);
    });

    let picked = rx
        .recv()
        .map_err(|_| "The save dialog closed unexpectedly.".to_string())?;

    let Some(entry) = picked else {
        return Ok(None);
    };
    let path = entry
        .into_path()
        .map_err(|err| format!("That location cannot be written to: {err}"))?;

    fs::write(&path, contents.as_bytes())
        .map_err(|err| format!("Could not write {}: {err}", path.display()))?;
    Ok(Some(path.display().to_string()))
}
