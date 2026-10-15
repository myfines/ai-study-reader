use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

pub struct Store(pub Mutex<Connection>);
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Book {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub page: u32,
    pub pages: u32,
    pub zoom: f64,
    pub added: u64,
    #[serde(default)]
    pub scroll: f64,
}
pub fn init(c: &Connection) -> Result<(), String> {
    c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY, metadata TEXT NOT NULL, data BLOB NOT NULL); CREATE TABLE IF NOT EXISTS annotations(book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, page INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(book_id,page)); CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, page INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY, data TEXT NOT NULL);").map_err(|e|e.to_string())
}
pub fn import(c: &Connection, name: &str, bytes: &[u8]) -> Result<Book, String> {
    let kind = name.rsplit('.').next().unwrap_or("").to_lowercase();
    if kind != "pdf" && kind != "txt" {
        return Err("仅支持 PDF / TXT".into());
    }
    if bytes.is_empty() || bytes.len() > 200 * 1024 * 1024 {
        return Err("文档为空或超过 200 MB".into());
    }
    if kind == "pdf" && !bytes.starts_with(b"%PDF-") {
        return Err("文件不是有效的 PDF".into());
    }
    let id = format!("{:x}", Sha256::digest(bytes));
    if let Some(json) = c
        .query_row("SELECT metadata FROM books WHERE id=?1", [&id], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .map_err(|e| e.to_string())?
    {
        return serde_json::from_str(&json).map_err(|e| e.to_string());
    }
    let book = Book {
        id,
        name: name.into(),
        kind,
        page: 1,
        pages: 1,
        zoom: 1.0,
        scroll: 0.0,
        added: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64,
    };
    c.execute(
        "INSERT INTO books VALUES(?1,?2,?3)",
        params![
            book.id,
            serde_json::to_string(&book).map_err(|e| e.to_string())?,
            bytes
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(book)
}
pub fn validate_annotations(raw: &str) -> Result<(), String> {
    if raw.len() > 10 * 1024 * 1024 {
        return Err("本页批注超过 10 MB".into());
    }
    let value: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let strokes = value.as_array().ok_or("批注必须为数组")?;
    for s in strokes {
        if !matches!(s["tool"].as_str(), Some("pen" | "highlight" | "rect"))
            || s["id"].as_str().is_none()
            || s["color"].as_str().is_none()
        {
            return Err("批注属性无效".into());
        }
        let width = s["width"].as_f64().ok_or("批注宽度无效")?;
        if !(0.1..=100.0).contains(&width) {
            return Err("批注宽度越界".into());
        }
        let points = s["points"].as_array().ok_or("批注点无效")?;
        if points.is_empty() {
            return Err("空笔迹".into());
        }
        for p in points {
            for axis in ["x", "y"] {
                let n = p[axis].as_f64().ok_or("坐标无效")?;
                if !n.is_finite() || n.abs() > 1e6 {
                    return Err("坐标越界".into());
                }
            }
        }
    }
    Ok(())
}
pub fn save_annotations(
    c: &Connection,
    book_id: &str,
    page: u32,
    data: &str,
) -> Result<(), String> {
    validate_annotations(data)?;
    if page == 0 {
        return Err("页码无效".into());
    }
    c.execute("INSERT INTO annotations VALUES(?1,?2,?3) ON CONFLICT(book_id,page) DO UPDATE SET data=excluded.data",params![book_id,page,data]).map_err(|e|e.to_string())?;
    Ok(())
}
pub fn save_progress(c: &Connection, book: Book) -> Result<(), String> {
    if book.page < 1
        || book.pages < 1
        || book.page > book.pages
        || !book.zoom.is_finite()
        || !(0.4..=3.0).contains(&book.zoom)
        || !book.scroll.is_finite()
        || !(0.0..=1.0).contains(&book.scroll)
    {
        return Err("阅读进度无效".into());
    }
    let raw: String = c
        .query_row("SELECT metadata FROM books WHERE id=?1", [&book.id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let mut old: Book = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    old.page = book.page;
    old.pages = book.pages;
    old.zoom = book.zoom;
    old.scroll = book.scroll;
    c.execute(
        "UPDATE books SET metadata=?2 WHERE id=?1",
        params![
            book.id,
            serde_json::to_string(&old).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod persistence_tests {
    use super::*;
    #[test]
    fn file_database_recovers_pdf_coordinates_and_progress() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("study-reader-test-{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("reader.sqlite");
        let id;
        let strokes = r##"[{"id":"circle","tool":"pen","color":"#456ad2","width":2,"points":[{"x":120,"y":220},{"x":210,"y":270}]}]"##;
        {
            let c = Connection::open(&db).unwrap();
            init(&c).unwrap();
            let mut book = import(&c, "formula.pdf", b"%PDF-1.7\nfixture").unwrap();
            id = book.id.clone();
            book.pages = 2;
            book.page = 2;
            book.zoom = 1.4;
            save_progress(&c, book).unwrap();
            save_annotations(&c, &id, 1, strokes).unwrap();
            assert!(save_annotations(&c, "missing", 1, strokes).is_err());
        }
        {
            let c = Connection::open(&db).unwrap();
            init(&c).unwrap();
            let raw: String = c
                .query_row("SELECT metadata FROM books WHERE id=?1", [&id], |r| {
                    r.get(0)
                })
                .unwrap();
            let b: Book = serde_json::from_str(&raw).unwrap();
            assert_eq!(b.page, 2);
            assert_eq!(b.zoom, 1.4);
            let restored: String = c
                .query_row(
                    "SELECT data FROM annotations WHERE book_id=?1 AND page=1",
                    [&id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(restored, strokes);
            let value: serde_json::Value = serde_json::from_str(&restored).unwrap();
            assert_eq!(value[0]["points"][0]["x"], 120);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_invalid_coordinates_and_keeps_existing_annotation() {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        let b = import(&c, "a.txt", b"text").unwrap();
        save_annotations(&c, &b.id, 1, "[]").unwrap();
        assert!(save_annotations(
            &c,
            &b.id,
            1,
            r#"[{"tool":"pen","points":[{"x":"invalid"}]}]"#
        )
        .is_err());
        let raw: String = c
            .query_row("SELECT data FROM annotations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(raw, "[]");
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn import_persist_and_deduplicate() {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        let b = import(&c, "notes.TXT", b"hello").unwrap();
        let again = import(&c, "copy.txt", b"hello").unwrap();
        assert_eq!(b.id, again.id);
        let data: Vec<u8> = c
            .query_row("SELECT data FROM books WHERE id=?1", [b.id], |r| r.get(0))
            .unwrap();
        assert_eq!(data, b"hello");
    }
    #[test]
    fn reject_fake_pdf() {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        assert!(import(&c, "bad.pdf", b"not pdf").is_err());
    }
}
