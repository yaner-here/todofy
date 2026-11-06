use std::io;
use std::path::{Path, PathBuf};

pub struct PortablePaths {
    pub database: PathBuf,
    pub webview_data: PathBuf,
}

impl PortablePaths {
    pub fn current() -> io::Result<Self> {
        Self::for_executable(&std::env::current_exe()?)
    }

    fn for_executable(executable: &Path) -> io::Result<Self> {
        let directory = executable
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "executable has no parent directory")
            })?;

        Ok(Self {
            database: directory.join("todofy.db"),
            webview_data: directory.join("todofy-webview"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn separate_executable_directories_keep_separate_persistent_databases() {
        let root =
            std::env::temp_dir().join(format!("todofy-portable-test-{}", uuid::Uuid::new_v4()));
        let first = root.join("first");
        let second = root.join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();

        let first_paths = PortablePaths::for_executable(&first.join("todofy.exe")).unwrap();
        let second_paths = PortablePaths::for_executable(&second.join("todofy.exe")).unwrap();
        assert_eq!(first_paths.database, first.join("todofy.db"));
        assert_eq!(first_paths.webview_data, first.join("todofy-webview"));
        assert_eq!(second_paths.database, second.join("todofy.db"));
        assert_eq!(second_paths.webview_data, second.join("todofy-webview"));

        let db = Connection::open(&first_paths.database).unwrap();
        db.execute("CREATE TABLE portable_check (value TEXT)", [])
            .unwrap();
        db.execute("INSERT INTO portable_check VALUES ('kept')", [])
            .unwrap();
        drop(db);
        let reopened = Connection::open(&first_paths.database).unwrap();
        let value: String = reopened
            .query_row("SELECT value FROM portable_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "kept");
        assert!(!second_paths.database.exists());
        drop(reopened);

        std::fs::remove_dir_all(root).unwrap();
    }
}
