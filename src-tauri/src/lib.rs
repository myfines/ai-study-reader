mod ai;
mod storage;
use rusqlite::{params, OptionalExtension};
use storage::{Book, Store};
use tauri::{Manager, State};
type Result<T> = std::result::Result<T, String>;
#[tauri::command]
fn list_books(s: State<Store>) -> Result<Vec<Book>> {
    let c = s.inner().0.lock().map_err(|e| e.to_string())?;
    let mut q = c
        .prepare("SELECT metadata FROM books")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.map(|r| serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string()))
        .collect()
}
#[tauri::command]
fn import_document(path: String, s: State<Store>) -> Result<Book> {
    let p = std::path::Path::new(&path);
    let name = p.file_name().and_then(|n| n.to_str()).ok_or("无效文件名")?;
    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > 200 * 1024 * 1024 {
        return Err("文件超过 200 MB 或不是常规文件".into());
    }
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    storage::import(
        &*s.inner().0.lock().map_err(|e| e.to_string())?,
        name,
        &bytes,
    )
}
#[tauri::command]
fn read_document(id: String, s: State<Store>) -> Result<tauri::ipc::Response> {
    let data: Vec<u8> = s
        .inner()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .query_row("SELECT data FROM books WHERE id=?1", [id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(data))
}
#[tauri::command]
fn save_progress(book: Book, s: State<Store>) -> Result<()> {
    storage::save_progress(&*s.inner().0.lock().map_err(|e| e.to_string())?, book)
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            let dir = std::env::var_os("AI_STUDY_READER_TEST_DATA")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            #[cfg(not(debug_assertions))]
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let c = rusqlite::Connection::open(dir.join("reader.sqlite"))?;
            storage::init(&c)?;
            app.manage(Store(std::sync::Mutex::new(c)));
            app.manage(ai::Jobs::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_books,
            import_document,
            read_document,
            save_progress,
            load_annotations,
            save_annotations,
            ai::get_settings,
            ai::save_settings,
            ai::delete_key,
            ai::list_chats,
            ai::save_chat,
            ai::ai_chat,
            ai::cancel_chat
        ])
        .run(tauri::generate_context!())
        .expect("运行阅读器失败");
}
#[tauri::command]
fn load_annotations(book_id: String, page: u32, s: State<Store>) -> Result<serde_json::Value> {
    let raw = s
        .inner()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .query_row(
            "SELECT data FROM annotations WHERE book_id=?1 AND page=?2",
            params![book_id, page],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or("[]".into());
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}
#[tauri::command]
fn save_annotations(book_id: String, page: u32, data: String, s: State<Store>) -> Result<()> {
    storage::save_annotations(
        &*s.inner().0.lock().map_err(|e| e.to_string())?,
        &book_id,
        page,
        &data,
    )
}
