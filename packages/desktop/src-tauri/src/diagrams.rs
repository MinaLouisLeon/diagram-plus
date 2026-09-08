use std::fs;
use std::path::PathBuf;

use tauri::State;

use crate::project::Project;

/// The filesystem half of the diagram store.
///
/// The rules about diagrams — revisions, slugs, write ordering — live in
/// TypeScript in `@diagram-plus/core`, shared with the MCP server. This file is
/// only the bytes: read, write, list, delete, inside one directory.

pub const DIAGRAM_DIR: &str = ".diagrams";
pub const DIAGRAM_EXT: &str = ".diagram.json";
pub const DESIGN_EXT: &str = ".design.json";

/// The two documents a slug can name: the graph, and the screen designs drawn
/// from it. They share a directory and a slug, so every command here takes the
/// kind alongside it and the TypeScript side says which one it wants.
pub const DOCUMENT_EXTS: [&str; 2] = [DIAGRAM_EXT, DESIGN_EXT];

/// Resolve a kind to its extension, rejecting anything not on the list.
///
/// The kind arrives from the webview exactly as the slug does, so it is
/// matched against a fixed set rather than interpolated into a filename —
/// there is no way through here to a path outside the two documents we own.
fn extension(kind: Option<&str>) -> Result<&'static str, String> {
    match kind.unwrap_or("diagram") {
        "diagram" => Ok(DIAGRAM_EXT),
        "design" => Ok(DESIGN_EXT),
        other => Err(format!("\"{other}\" is not a kind of document.")),
    }
}

fn dir(project: &Project) -> Result<PathBuf, String> {
    project
        .dir()
        .ok_or_else(|| "No project folder is open.".to_string())
}

/// Reject anything that is not a bare slug before it reaches the filesystem.
///
/// The slug arrives from the webview, so this is the boundary that keeps a
/// crafted name from escaping `.diagrams/` — no separators, no `..`, no drive
/// letters, and nothing but the characters `slugify` can actually produce.
fn diagram_file(project: &Project, slug: &str, kind: Option<&str>) -> Result<PathBuf, String> {
    if slug.is_empty() || slug.len() > 96 {
        return Err(format!("\"{slug}\" is not a valid diagram name."));
    }
    if !slug
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!("\"{slug}\" is not a valid diagram name."));
    }
    let ext = extension(kind)?;
    Ok(dir(project)?.join(format!("{slug}{ext}")))
}

#[tauri::command]
pub fn diagrams_ensure_dir(project: State<Project>) -> Result<(), String> {
    let dir = dir(&project)?;
    fs::create_dir_all(&dir).map_err(|err| format!("Could not create {}: {err}", dir.display()))
}

#[tauri::command]
pub fn diagrams_list_slugs(
    project: State<Project>,
    kind: Option<String>,
) -> Result<Vec<String>, String> {
    let ext = extension(kind.as_deref())?;
    let dir = dir(&project)?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        // A project that has never had a diagram is not an error.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(format!("Could not read {}: {err}", dir.display())),
    };

    let mut slugs = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(slug) = name.strip_suffix(ext) {
            // A slug ending in one of the other kinds' extensions would match
            // both, so the longest matching suffix decides what the file is.
            let longest = DOCUMENT_EXTS
                .iter()
                .filter(|candidate| name.ends_with(*candidate))
                .max_by_key(|candidate| candidate.len());
            if !slug.is_empty() && longest == Some(&ext) {
                slugs.push(slug.to_string());
            }
        }
    }
    slugs.sort();
    Ok(slugs)
}

#[tauri::command]
pub fn diagrams_read(
    project: State<Project>,
    slug: String,
    kind: Option<String>,
) -> Result<Option<String>, String> {
    let file = diagram_file(&project, &slug, kind.as_deref())?;
    match fs::read_to_string(&file) {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("Could not read {}: {err}", file.display())),
    }
}

/// Write through a temporary file and rename over the target, so a reader --
/// the MCP server, or a `git status` -- never sees a half-written diagram.
#[tauri::command]
pub fn diagrams_write(
    project: State<Project>,
    slug: String,
    contents: String,
    kind: Option<String>,
) -> Result<(), String> {
    let file = diagram_file(&project, &slug, kind.as_deref())?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create {}: {err}", parent.display()))?;
    }

    let temp = file.with_extension(format!("tmp{}", std::process::id()));
    fs::write(&temp, contents.as_bytes())
        .map_err(|err| format!("Could not write {}: {err}", temp.display()))?;
    fs::rename(&temp, &file).map_err(|err| {
        let _ = fs::remove_file(&temp);
        format!("Could not save {}: {err}", file.display())
    })
}

#[tauri::command]
pub fn diagrams_remove(
    project: State<Project>,
    slug: String,
    kind: Option<String>,
) -> Result<(), String> {
    let file = diagram_file(&project, &slug, kind.as_deref())?;
    match fs::remove_file(&file) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("Could not delete {}: {err}", file.display())),
    }
}
