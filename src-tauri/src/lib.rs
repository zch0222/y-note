mod dialogs;
mod document;
mod external;
mod git;
mod scope;
mod watch;
mod workspace;

use tauri::Manager;

use dialogs::{authorize_test_root, pick_document, pick_workspace};
use document::{
    delete_draft, hash_file, read_document, read_draft, write_document_atomic, write_draft,
};
use external::open_external;
use git::{read_git_diff, read_git_versions};
use scope::PathScope;
use watch::{unwatch_document, watch_document, WatchState};
use workspace::list_workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WatchState::default())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(PathScope::load(&data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_document,
            pick_workspace,
            authorize_test_root,
            open_external,
            read_document,
            hash_file,
            write_document_atomic,
            list_workspace,
            write_draft,
            read_draft,
            delete_draft,
            watch_document,
            unwatch_document,
            read_git_diff,
            read_git_versions
        ])
        .run(tauri::generate_context!())
        .expect("error while running Y Note");
}
