use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use tauri::{AppHandle, Emitter};

use crate::diagrams::{DESIGN_EXT, DIAGRAM_EXT};

/// Watches `.diagrams/` so a change made outside the window — by the MCP
/// server, by git, or by editing the JSON directly — reaches the canvas.
///
/// Both documents in the directory are watched: the diagram and the screen
/// designs beside it. Claude drawing a screen between two messages has to land
/// on the canvas the same way an edited block does.
///
/// Events are coalesced over a short window before they are emitted. A single
/// save produces several filesystem notifications (the temp file, the rename,
/// a metadata touch), and the editor only needs to hear about it once.

const SETTLE: Duration = Duration::from_millis(140);

pub struct Watcher {
    /// Kept alive to keep watching; dropping it stops the notify thread.
    inner: Mutex<Option<RecommendedWatcher>>,
    watching: Mutex<Option<PathBuf>>,
    /// Handed to each new watcher's callback, drained by the debounce thread.
    events: Sender<Event>,
}

/// Which document a path names, as a (slug, is-design) pair.
///
/// The design extension is tried first: a slug that itself ended in
/// `.diagram` would otherwise be mistaken for the other kind.
fn document_of(path: &Path) -> Option<(String, bool)> {
    let name = path.file_name()?.to_string_lossy().to_string();
    if let Some(slug) = name.strip_suffix(DESIGN_EXT) {
        if !slug.is_empty() {
            return Some((slug.to_string(), true));
        }
    }
    name.strip_suffix(DIAGRAM_EXT)
        .filter(|slug| !slug.is_empty())
        .map(|slug| (slug.to_string(), false))
}

impl Watcher {
    /// Build the watcher and start the single thread that drains its events.
    pub fn start(app: AppHandle) -> Self {
        let (events, rx) = channel();
        thread::spawn(move || debounce_loop(app, rx));
        Self {
            inner: Mutex::new(None),
            watching: Mutex::new(None),
            events,
        }
    }

    /// Start watching `dir`, replacing whatever was being watched before.
    pub fn watch(&self, dir: &Path) -> Result<(), String> {
        let mut watching = self.watching.lock().unwrap();
        if watching.as_deref() == Some(dir) {
            return Ok(());
        }

        let mut inner = self.inner.lock().unwrap();
        // Drop the old watcher first so its thread stops before the new one
        // starts; the shared event channel outlives both.
        *inner = None;
        *watching = None;

        let events = self.events.clone();
        let mut watcher = RecommendedWatcher::new(
            move |result: notify::Result<Event>| {
                if let Ok(event) = result {
                    let _ = events.send(event);
                }
            },
            Config::default(),
        )
        .map_err(|err| format!("Could not start watching for changes: {err}"))?;

        watcher
            .watch(dir, RecursiveMode::NonRecursive)
            .map_err(|err| format!("Could not watch {}: {err}", dir.display()))?;

        *inner = Some(watcher);
        *watching = Some(dir.to_path_buf());
        Ok(())
    }
}

fn debounce_loop(app: AppHandle, rx: Receiver<Event>) {
    // (slug, is-design) -> (was it a deletion, when was it last seen)
    let mut pending: HashMap<(String, bool), (bool, Instant)> = HashMap::new();

    loop {
        // Nothing pending means nothing to flush, so wait indefinitely rather
        // than spinning on a timeout.
        let outcome = if pending.is_empty() {
            rx.recv().map_err(|_| RecvTimeoutError::Disconnected)
        } else {
            rx.recv_timeout(SETTLE)
        };

        match outcome {
            Ok(event) => {
                let removed = matches!(event.kind, EventKind::Remove(_));
                for path in &event.paths {
                    if let Some(key) = document_of(path) {
                        // A rename lands as a remove followed by a create, so
                        // the latest event is the file's real fate.
                        pending.insert(key, (removed, Instant::now()));
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            // The sender is gone: the app is shutting down.
            Err(RecvTimeoutError::Disconnected) => return,
        }

        let now = Instant::now();
        let ready: Vec<(String, bool)> = pending
            .iter()
            .filter(|(_, (_, at))| now.duration_since(*at) >= SETTLE)
            .map(|(key, _)| key.clone())
            .collect();

        for key in ready {
            let Some((removed, _)) = pending.remove(&key) else {
                continue;
            };
            let (slug, design) = key;
            let event = match (design, removed) {
                (false, false) => "diagram-changed",
                (false, true) => "diagram-removed",
                (true, false) => "design-changed",
                (true, true) => "design-removed",
            };
            let _ = app.emit(event, slug);
        }
    }
}
