mod diagrams;
mod mcp;
mod project;
mod transfer;
mod watcher;

use tauri::Manager;

use project::Project;
use watcher::Watcher;

/// diagram-plus, as a desktop app.
///
/// The editor is the same React app the `dgp` server serves, and the diagram
/// rules are the same TypeScript the MCP server runs — this side supplies the
/// filesystem, the folder picker, the change watcher and the MCP registration,
/// and nothing else. Diagrams stay as JSON in the user's own project, so the
/// app is a window onto their repository rather than a place their work lives.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();

            app.manage(Watcher::start(handle.clone()));
            app.manage(Project::load(&handle));

            // Nothing is opened here on purpose. The app starts on the welcome
            // screen every time and works in the folder the user picks in this
            // session, so it never arrives pointed at someone's old diagrams.
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            project::project_state,
            project::project_pick,
            project::project_open,
            project::project_forget,
            project::open_path,
            diagrams::diagrams_ensure_dir,
            diagrams::diagrams_list_slugs,
            diagrams::diagrams_read,
            diagrams::diagrams_write,
            diagrams::diagrams_remove,
            transfer::transfer_pick_files,
            transfer::transfer_save_file,
            mcp::mcp_status,
            mcp::mcp_apply,
        ])
        .run(tauri::generate_context!())
        .expect("error while running diagram-plus");
}
