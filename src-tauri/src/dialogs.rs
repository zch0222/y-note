use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::document::ApiError;
use crate::scope::PathScope;

#[tauri::command]
pub async fn pick_document(
    app: AppHandle,
    scope: State<'_, PathScope>,
) -> Result<Option<String>, ApiError> {
    let selected = app
        .dialog()
        .file()
        .set_title("打开 Markdown")
        .add_filter("Markdown", &["md", "markdown", "mdown", "mkd", "txt"])
        .blocking_pick_file();
    let Some(file) = selected else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|error| ApiError::new("invalid-path", error.to_string()))?;
    scope.authorize_file(&path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn pick_workspace(
    app: AppHandle,
    scope: State<'_, PathScope>,
) -> Result<Option<String>, ApiError> {
    let selected = app
        .dialog()
        .file()
        .set_title("打开文件夹")
        .blocking_pick_folder();
    let Some(folder) = selected else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|error| ApiError::new("invalid-path", error.to_string()))?;
    scope.authorize_root(&path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Native acceptance runs against a dev build and needs to open fixture paths
/// without walking the file dialog for each file. Release builds always reject.
#[tauri::command]
pub fn authorize_test_root(scope: State<'_, PathScope>, path: String) -> Result<(), ApiError> {
    if !cfg!(debug_assertions) {
        return Err(ApiError::new(
            "not-authorized",
            "Test scopes are only available in debug builds",
        ));
    }
    scope.authorize_root(std::path::Path::new(&path))?;
    Ok(())
}
