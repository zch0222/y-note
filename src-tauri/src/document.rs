use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl ApiError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    fn io(context: &str, error: io::Error) -> Self {
        let code = match error.kind() {
            io::ErrorKind::NotFound => "not-found",
            io::ErrorKind::PermissionDenied => "permission-denied",
            _ => "io-error",
        };
        Self::new(code, format!("{context}: {error}"))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentBytes {
    pub path: String,
    pub bytes_base64: String,
    pub sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub path: String,
    pub sha256: String,
    pub bytes_written: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub path: String,
    pub source: String,
    pub baseline_sha256: String,
    pub updated_at: String,
}

pub fn digest_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, ApiError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ApiError::io("Could not read file", error)),
    }
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

#[tauri::command]
pub fn read_document(path: String) -> Result<DocumentBytes, ApiError> {
    let bytes = fs::read(&path).map_err(|error| ApiError::io("Could not read document", error))?;
    Ok(DocumentBytes {
        path,
        bytes_base64: STANDARD.encode(&bytes),
        sha256: digest_hex(&bytes),
    })
}

#[tauri::command]
pub fn hash_file(path: String) -> Result<Option<String>, ApiError> {
    Ok(read_optional(Path::new(&path))?.map(|bytes| digest_hex(&bytes)))
}

#[cfg(unix)]
fn sync_directory(directory: &Path) {
    if let Ok(handle) = fs::File::open(directory) {
        let _ = handle.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) {}

fn write_atomic(path: &Path, bytes: &[u8], expected_sha256: &str) -> Result<WriteOutcome, ApiError> {
    if path.as_os_str().is_empty() {
        return Err(ApiError::new("invalid-path", "Document path is empty"));
    }

    let existing = read_optional(path)?;
    let actual_sha256 = existing
        .as_ref()
        .map(|value| digest_hex(value))
        .unwrap_or_default();

    if actual_sha256 != expected_sha256 {
        return Err(ApiError::new(
            "disk-conflict",
            format!(
                "Refusing to overwrite {path:?}: disk content changed (expected {expected_sha256}, got {actual_sha256})"
            ),
        ));
    }

    let permissions = fs::metadata(path).ok().map(|meta| meta.permissions());
    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| ApiError::new("invalid-path", "Document path has no file name"))?;
    let temp_path = directory.join(format!(
        ".{file_name}.{}.{}.ynote.tmp",
        std::process::id(),
        unique_suffix()
    ));

    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut file = options
        .open(&temp_path)
        .map_err(|error| ApiError::io("Could not create temporary file", error))?;

    let result = (|| -> Result<(), ApiError> {
        file.write_all(bytes)
            .map_err(|error| ApiError::io("Could not write temporary file", error))?;
        file.sync_all()
            .map_err(|error| ApiError::io("Could not flush temporary file", error))?;
        drop(file);

        if let Some(permissions) = permissions {
            fs::set_permissions(&temp_path, permissions)
                .map_err(|error| ApiError::io("Could not preserve permissions", error))?;
        }

        fs::rename(&temp_path, path)
            .map_err(|error| ApiError::io("Could not replace document", error))?;
        sync_directory(directory);
        Ok(())
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    Ok(WriteOutcome {
        path: path.to_string_lossy().into_owned(),
        sha256: digest_hex(bytes),
        bytes_written: bytes.len(),
    })
}

#[tauri::command]
pub fn write_document_atomic(
    path: String,
    bytes_base64: String,
    expected_sha256: String,
) -> Result<WriteOutcome, ApiError> {
    let bytes = STANDARD
        .decode(&bytes_base64)
        .map_err(|error| ApiError::new("invalid-payload", error.to_string()))?;
    write_atomic(Path::new(&path), &bytes, &expected_sha256)
}

fn draft_file(app: &AppHandle, path: &str) -> Result<PathBuf, ApiError> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| ApiError::new("app-data-unavailable", error.to_string()))?
        .join("drafts");
    fs::create_dir_all(&directory)
        .map_err(|error| ApiError::io("Could not create draft directory", error))?;
    Ok(directory.join(format!("{}.json", digest_hex(path.as_bytes()))))
}

#[tauri::command]
pub fn write_draft(app: AppHandle, draft: Draft) -> Result<(), ApiError> {
    let path = draft_file(&app, &draft.path)?;
    let bytes = serde_json::to_vec(&draft)
        .map_err(|error| ApiError::new("draft-encode", error.to_string()))?;
    fs::write(path, bytes).map_err(|error| ApiError::io("Could not write draft", error))
}

#[tauri::command]
pub fn read_draft(app: AppHandle, path: String) -> Result<Option<Draft>, ApiError> {
    let file = draft_file(&app, &path)?;
    let bytes = match fs::read(file) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(ApiError::io("Could not read draft", error)),
    };
    let draft: Draft = serde_json::from_slice(&bytes)
        .map_err(|error| ApiError::new("draft-decode", error.to_string()))?;
    Ok(Some(draft))
}

#[tauri::command]
pub fn delete_draft(app: AppHandle, path: String) -> Result<(), ApiError> {
    let file = draft_file(&app, &path)?;
    match fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ApiError::io("Could not delete draft", error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("y-note-test-{}", unique_suffix()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_new_file_and_reports_digest() {
        let dir = temp_dir();
        let path = dir.join("note.md");
        let outcome = write_atomic(&path, b"hello\n", "").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"hello\n");
        assert_eq!(outcome.sha256, digest_hex(b"hello\n"));
        assert_eq!(outcome.bytes_written, 6);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replaces_only_when_baseline_matches() {
        let dir = temp_dir();
        let path = dir.join("note.md");
        fs::write(&path, b"old\n").unwrap();
        let baseline = digest_hex(b"old\n");

        let outcome = write_atomic(&path, b"new\n", &baseline).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new\n");
        assert_eq!(outcome.sha256, digest_hex(b"new\n"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_conflicting_write_and_leaves_file_intact() {
        let dir = temp_dir();
        let path = dir.join("note.md");
        fs::write(&path, b"external\n").unwrap();

        let error = write_atomic(&path, b"mine\n", &digest_hex(b"old\n")).unwrap_err();
        assert_eq!(error.code, "disk-conflict");
        assert_eq!(fs::read(&path).unwrap(), b"external\n");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_file_requires_empty_expected_digest() {
        let dir = temp_dir();
        let path = dir.join("note.md");

        let error = write_atomic(&path, b"data", &digest_hex(b"data")).unwrap_err();
        assert_eq!(error.code, "disk-conflict");

        write_atomic(&path, b"data", "").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"data");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn preserves_file_mode() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir();
        let path = dir.join("note.md");
        fs::write(&path, b"old\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();

        write_atomic(&path, b"new\n", &digest_hex(b"old\n")).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o640);
        fs::remove_dir_all(dir).unwrap();
    }
}
