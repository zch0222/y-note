use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::document::ApiError;

const MAX_FILES: usize = 100;
const MAX_ROOTS: usize = 16;

#[derive(Debug, Default, Serialize, Deserialize)]
struct ScopeData {
    files: Vec<PathBuf>,
    roots: Vec<PathBuf>,
}

/// Files and folders that the user explicitly chose through a native dialog.
/// Paths are canonicalized before comparison so symlinks cannot escape a root.
pub struct PathScope {
    state: Mutex<ScopeData>,
    store: Option<PathBuf>,
}

impl PathScope {
    pub fn load(data_dir: &Path) -> Self {
        let store = data_dir.join("scope.json");
        let mut state = fs::read(&store)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ScopeData>(&bytes).ok())
            .unwrap_or_default();
        trim(&mut state);
        Self {
            state: Mutex::new(state),
            store: Some(store),
        }
    }

    #[cfg(test)]
    fn in_memory() -> Self {
        Self {
            state: Mutex::new(ScopeData::default()),
            store: None,
        }
    }

    pub fn authorize_file(&self, path: &Path) -> Result<PathBuf, ApiError> {
        let normalized = normalize(path).ok_or_else(|| {
            ApiError::new("invalid-path", format!("Cannot resolve file path {path:?}"))
        })?;
        if !normalized.is_file() {
            return Err(ApiError::new(
                "not-a-file",
                format!("{path:?} is not an existing file"),
            ));
        }
        let mut state = self.lock()?;
        state.files.retain(|entry| entry != &normalized);
        state.files.push(normalized.clone());
        trim(&mut state);
        self.persist(&state);
        Ok(normalized)
    }

    pub fn authorize_root(&self, path: &Path) -> Result<PathBuf, ApiError> {
        let normalized = normalize(path).ok_or_else(|| {
            ApiError::new("invalid-path", format!("Cannot resolve folder path {path:?}"))
        })?;
        if !normalized.is_dir() {
            return Err(ApiError::new(
                "not-a-directory",
                format!("{path:?} is not an existing folder"),
            ));
        }
        let mut state = self.lock()?;
        state.roots.retain(|entry| entry != &normalized);
        state.roots.push(normalized.clone());
        trim(&mut state);
        self.persist(&state);
        Ok(normalized)
    }

    pub fn allows(&self, path: &Path) -> bool {
        let Some(normalized) = normalize(path) else {
            return false;
        };
        let Ok(state) = self.state.lock() else {
            return false;
        };
        state.files.iter().any(|entry| entry == &normalized)
            || state
                .roots
                .iter()
                .any(|root| normalized.starts_with(root))
    }

    pub fn require(&self, path: &Path) -> Result<(), ApiError> {
        if self.allows(path) {
            Ok(())
        } else {
            Err(ApiError::new(
                "not-authorized",
                format!(
                    "Path is outside the files and folders the user approved: {}",
                    path.display()
                ),
            ))
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, ScopeData>, ApiError> {
        self.state
            .lock()
            .map_err(|_| ApiError::new("scope-failed", "Path scope is poisoned"))
    }

    fn persist(&self, state: &ScopeData) {
        let Some(store) = &self.store else {
            return;
        };
        let Some(parent) = store.parent() else {
            return;
        };
        let _ = fs::create_dir_all(parent);
        let Ok(bytes) = serde_json::to_vec(state) else {
            return;
        };
        let temp = store.with_extension("json.tmp");
        if fs::write(&temp, bytes).is_ok() {
            let _ = fs::rename(&temp, store);
        }
    }
}

fn trim(state: &mut ScopeData) {
    if state.files.len() > MAX_FILES {
        state.files.drain(0..state.files.len() - MAX_FILES);
    }
    if state.roots.len() > MAX_ROOTS {
        state.roots.drain(0..state.roots.len() - MAX_ROOTS);
    }
}

fn normalize(path: &Path) -> Option<PathBuf> {
    if path.as_os_str().is_empty() {
        return None;
    }
    if let Ok(canonical) = fs::canonicalize(path) {
        return Some(canonical);
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = parent.canonicalize().ok()?;
    let name = path.file_name()?;
    Some(parent.join(name))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "y-note-scope-test-{}-{suffix}-{counter}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn accepts_an_explicitly_authorized_file() {
        let root = temp_dir();
        let file = root.join("note.md");
        fs::write(&file, b"hello").unwrap();
        let scope = PathScope::in_memory();
        assert!(!scope.allows(&file));
        scope.authorize_file(&file).unwrap();
        assert!(scope.allows(&file));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_paths_outside_the_approved_set() {
        let root = temp_dir();
        let approved = root.join("approved.md");
        let other = root.join("other.md");
        fs::write(&approved, b"a").unwrap();
        fs::write(&other, b"b").unwrap();
        let scope = PathScope::in_memory();
        scope.authorize_file(&approved).unwrap();
        assert_eq!(scope.require(&other).unwrap_err().code, "not-authorized");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_authorized_folder_covers_children_but_not_siblings() {
        let root = temp_dir();
        let inside = root.join("inside");
        let sibling = root.join("sibling");
        fs::create_dir_all(&inside).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        let child = inside.join("note.md");
        let outside = sibling.join("note.md");
        fs::write(&child, b"child").unwrap();
        fs::write(&outside, b"outside").unwrap();

        let scope = PathScope::in_memory();
        scope.authorize_root(&inside).unwrap();
        assert!(scope.allows(&child));
        assert!(scope.allows(&inside.join("not-created-yet.md")));
        assert!(!scope.allows(&outside));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn persists_authorized_paths_across_loads() {
        let root = temp_dir();
        let file = root.join("note.md");
        fs::write(&file, b"persisted").unwrap();
        let scope = PathScope::load(&root);
        scope.authorize_file(&file).unwrap();
        let reloaded = PathScope::load(&root);
        assert!(reloaded.allows(&file));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deleted_authorized_files_still_match_via_their_parent() {
        let root = temp_dir();
        let file = root.join("gone.md");
        fs::write(&file, b"gone").unwrap();
        let scope = PathScope::in_memory();
        scope.authorize_file(&file).unwrap();
        fs::remove_file(&file).unwrap();
        assert!(scope.allows(&file));
        fs::remove_dir_all(root).unwrap();
    }
}
