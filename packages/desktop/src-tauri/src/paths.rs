use std::path::{Path, PathBuf};

/// Windows paths, in the form other programs can actually open.
///
/// `std::fs::canonicalize` and Tauri's resource resolver both hand back
/// verbatim paths on Windows — `\\?\C:\Users\…`. Those are real paths and Win32
/// takes them, but very little else does: `node` reads the prefix as part of
/// the filename and refuses to load the file at all. An MCP entry pointing at
/// one is written without complaint, reads correctly in the settings screen,
/// and then every client that starts it reports the server as failed. So a
/// path that leaves this app — for a config file, a title bar, another
/// process — comes through here first.
///
/// The prefix is dropped only where the short form names the same file, so the
/// rare path that genuinely needs it (longer than 260 characters, or with a
/// component Win32 would normalise away) is left as it is. Off Windows both of
/// these are the plain path and `canonicalize`.

/// Strip the verbatim prefix from a path where that names the same file.
pub fn plain(path: &Path) -> PathBuf {
    dunce::simplified(path).to_path_buf()
}

/// `canonicalize`, without the verbatim prefix.
///
/// Falls back to the path as given when it cannot be resolved — a folder
/// deleted between being picked and being opened, say.
pub fn canonical(path: &Path) -> PathBuf {
    dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn drops_the_verbatim_prefix_from_a_drive_path() {
        let entry = plain(Path::new(
            r"\\?\C:\Users\a\AppData\Local\diagram-plus\mcp-server.mjs",
        ));
        assert_eq!(
            entry,
            PathBuf::from(r"C:\Users\a\AppData\Local\diagram-plus\mcp-server.mjs")
        );
    }

    #[test]
    fn leaves_an_ordinary_path_alone() {
        let path = Path::new(r"C:\Program Files\diagram-plus\mcp-server.mjs");
        assert_eq!(plain(path), path);
    }
}
