use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::document::ApiError;

pub const DOCUMENT_CHANGED_EVENT: &str = "ynote://document-changed";

#[derive(Default)]
pub struct WatchState {
    session: Mutex<Option<WatchSession>>,
}

struct WatchSession {
    _watcher: RecommendedWatcher,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentEvent {
    pub path: String,
}

fn normalize_target(path: &Path) -> Option<(PathBuf, PathBuf)> {
    let file_name = path.file_name()?.to_os_string();
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let parent = parent.canonicalize().ok()?;
    Some((parent.join(file_name), parent))
}

fn same_file(candidate: &Path, target: &Path) -> bool {
    if candidate == target {
        return true;
    }
    if candidate.file_name() != target.file_name() {
        return false;
    }
    match (candidate.parent(), target.parent()) {
        (Some(left), Some(right)) => match (left.canonicalize(), right.canonicalize()) {
            (Ok(left), Ok(right)) => left == right,
            _ => false,
        },
        _ => false,
    }
}

fn is_relevant(event: &Event, target: &Path) -> bool {
    // Atomic saves also touch temp files and read access events are noise.
    if matches!(event.kind, EventKind::Access(_) | EventKind::Other) {
        return false;
    }
    event.paths.iter().any(|path| same_file(path, target))
}

fn create_watcher<F>(
    target: PathBuf,
    parent: PathBuf,
    mut on_change: F,
) -> notify::Result<RecommendedWatcher>
where
    F: FnMut() + Send + 'static,
{
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        if let Ok(event) = result {
            if is_relevant(&event, &target) {
                on_change();
            }
        }
    })?;
    watcher.watch(&parent, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}

#[tauri::command]
pub fn watch_document(
    app: AppHandle,
    state: State<'_, WatchState>,
    path: String,
) -> Result<(), ApiError> {
    let (target, parent) = normalize_target(Path::new(&path)).ok_or_else(|| {
        ApiError::new(
            "watch-failed",
            format!("Cannot resolve the directory for {path:?}"),
        )
    })?;
    let app_handle = app.clone();
    let emit_path = path.clone();
    let watcher = create_watcher(target, parent, move || {
        let _ = app_handle.emit(
            DOCUMENT_CHANGED_EVENT,
            DocumentEvent {
                path: emit_path.clone(),
            },
        );
    })
    .map_err(|error| {
        ApiError::new(
            "watch-failed",
            format!("Could not watch the document directory: {error}"),
        )
    })?;

    let mut session = state
        .session
        .lock()
        .map_err(|_| ApiError::new("watch-failed", "Watcher state is poisoned"))?;
    *session = Some(WatchSession { _watcher: watcher });
    Ok(())
}

#[tauri::command]
pub fn unwatch_document(state: State<'_, WatchState>) -> Result<(), ApiError> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| ApiError::new("watch-failed", "Watcher state is poisoned"))?;
    *session = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("y-note-watch-{}-{suffix}", std::process::id()))
    }

    #[test]
    fn ignores_events_for_other_files() {
        let target = Path::new("/notes/current.md");
        assert!(same_file(Path::new("/notes/current.md"), target));
        assert!(!same_file(Path::new("/notes/other.md"), target));
    }

    #[test]
    fn notifies_when_the_watched_file_changes() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("note.md");
        fs::write(&target, b"one").unwrap();

        let (target, parent) = normalize_target(&target).unwrap();
        let (sender, receiver) = mpsc::channel();
        let _watcher = create_watcher(target, parent, move || {
            let _ = sender.send(());
        })
        .unwrap();

        fs::write(dir.join("note.md"), b"two").unwrap();
        assert!(receiver.recv_timeout(Duration::from_secs(5)).is_ok());
        fs::remove_dir_all(dir).unwrap();
    }
}
