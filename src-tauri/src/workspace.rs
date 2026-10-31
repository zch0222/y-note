use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::document::ApiError;
use crate::scope::PathScope;

const MAX_DEPTH: usize = 12;
const MAX_ENTRIES: usize = 5000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<WorkspaceNode>,
}

const SKIPPED_DIRECTORIES: [&str; 8] = [
    "node_modules",
    "target",
    "dist",
    "coverage",
    ".git",
    ".idea",
    ".vscode",
    ".y-note",
];

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd"
            )
        })
        .unwrap_or(false)
}

fn read_children(
    directory: &Path,
    depth: usize,
    budget: &mut usize,
) -> Result<Vec<WorkspaceNode>, ApiError> {
    if depth > MAX_DEPTH || *budget == 0 {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(directory)
        .map_err(|error| ApiError::new("list-failed", format!("{directory:?}: {error}")))?;
    let mut nodes = Vec::new();

    for entry in entries.flatten() {
        if *budget == 0 {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            if SKIPPED_DIRECTORIES.contains(&name.as_str()) {
                continue;
            }
            *budget -= 1;
            let children = read_children(&path, depth + 1, budget)?;
            if !children.is_empty() {
                nodes.push(WorkspaceNode {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    is_dir: true,
                    children,
                });
            }
        } else if file_type.is_file() && is_markdown(&path) {
            *budget -= 1;
            nodes.push(WorkspaceNode {
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir: false,
                children: Vec::new(),
            });
        }
    }

    nodes.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(nodes)
}

#[tauri::command]
pub fn list_workspace(root: String, scope: State<'_, PathScope>) -> Result<WorkspaceNode, ApiError> {
    scope.require(Path::new(&root))?;
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err(ApiError::new("not-a-directory", "Workspace is not a directory"));
    }

    let mut budget = MAX_ENTRIES;
    let children = read_children(&path, 0, &mut budget)?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.clone());

    Ok(WorkspaceNode {
        name,
        path: root,
        is_dir: true,
        children,
    })
}
