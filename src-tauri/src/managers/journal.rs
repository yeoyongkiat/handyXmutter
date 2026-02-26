use anyhow::Result;
use chrono::Utc;
use log::{debug, error, info, warn};
use rusqlite::{params, Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

static MIGRATIONS: &[M] = &[
    M::up(
        "CREATE TABLE IF NOT EXISTS journal_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            title TEXT NOT NULL,
            transcription_text TEXT NOT NULL,
            post_processed_text TEXT,
            post_process_prompt_id TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            linked_entry_ids TEXT NOT NULL DEFAULT '[]'
        );",
    ),
    M::up(
        "CREATE TABLE IF NOT EXISTS journal_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        ALTER TABLE journal_entries ADD COLUMN folder_id INTEGER REFERENCES journal_folders(id) ON DELETE SET NULL;",
    ),
    M::up(
        "ALTER TABLE journal_entries ADD COLUMN transcript_snapshots TEXT NOT NULL DEFAULT '[]';",
    ),
    M::up(
        "CREATE TABLE IF NOT EXISTS journal_chat_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
            mode TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS journal_chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES journal_chat_sessions(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );",
    ),
    M::up(
        "ALTER TABLE journal_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'voice';
        ALTER TABLE journal_entries ADD COLUMN source_url TEXT;
        ALTER TABLE journal_folders ADD COLUMN source TEXT NOT NULL DEFAULT 'voice';",
    ),
    M::up(
        "CREATE TABLE IF NOT EXISTS meeting_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
            speaker INTEGER,
            start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL,
            text TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_meeting_segments_entry ON meeting_segments(entry_id);
        ALTER TABLE journal_entries ADD COLUMN speaker_names TEXT NOT NULL DEFAULT '{}';",
    ),
    M::up(
        "ALTER TABLE journal_entries ADD COLUMN user_source TEXT NOT NULL DEFAULT '';",
    ),
];

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct JournalEntry {
    pub id: i64,
    pub file_name: String,
    pub timestamp: i64,
    pub title: String,
    pub transcription_text: String,
    pub post_processed_text: Option<String>,
    pub post_process_prompt_id: Option<String>,
    pub tags: Vec<String>,
    pub linked_entry_ids: Vec<i64>,
    pub folder_id: Option<i64>,
    pub transcript_snapshots: Vec<String>,
    pub source: String,
    pub source_url: Option<String>,
    pub speaker_names: String,
    pub user_source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct JournalFolder {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct JournalRecordingResult {
    pub file_name: String,
    pub transcription_text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChatSession {
    pub id: i64,
    pub entry_id: i64,
    pub mode: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChatMessage {
    pub id: i64,
    pub session_id: i64,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

// --- Filename helpers ---

/// Sanitize a string for use as a filename (replace unsafe chars, trim, limit length).
fn sanitize_filename(s: &str) -> String {
    let sanitized: String = s
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    let trimmed = sanitized.trim().to_string();
    if trimmed.is_empty() {
        "untitled".to_string()
    } else if trimmed.len() > 100 {
        trimmed[..100].trim_end().to_string()
    } else {
        trimmed
    }
}

/// Return a unique filename in `dir`. If `base.ext` exists, try `base (2).ext`, etc.
fn unique_path(dir: &Path, base: &str, ext: &str) -> PathBuf {
    let candidate = dir.join(format!("{}{}", base, ext));
    if !candidate.exists() {
        return candidate;
    }
    for i in 2..1000 {
        let candidate = dir.join(format!("{} ({}){}", base, i, ext));
        if !candidate.exists() {
            return candidate;
        }
    }
    // Fallback with timestamp
    let ts = Utc::now().timestamp();
    dir.join(format!("{} ({}){}", base, ts, ext))
}

/// Extract base name from a file_name (strip the extension).
fn entry_base_name(file_name: &str) -> &str {
    file_name.strip_suffix(".wav").unwrap_or(file_name)
}

/// Capitalize first letter of a string.
fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().to_string() + chars.as_str(),
    }
}

pub struct JournalManager {
    app_handle: AppHandle,
    recordings_dir: PathBuf,
    db_path: PathBuf,
}

impl JournalManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        let app_data_dir = app_handle.path().app_data_dir()?;
        let recordings_dir = app_data_dir.join("journal_recordings");
        let db_path = app_data_dir.join("journal.db");

        if !recordings_dir.exists() {
            fs::create_dir_all(&recordings_dir)?;
            debug!("Created journal recordings directory: {:?}", recordings_dir);
        }

        let manager = Self {
            app_handle: app_handle.clone(),
            recordings_dir,
            db_path,
        };

        manager.init_database()?;

        Ok(manager)
    }

    fn init_database(&self) -> Result<()> {
        info!("Initializing journal database at {:?}", self.db_path);

        let mut conn = Connection::open(&self.db_path)?;
        let migrations = Migrations::new(MIGRATIONS.to_vec());

        #[cfg(debug_assertions)]
        migrations.validate().expect("Invalid journal migrations");

        let version_before: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        debug!(
            "Journal database version before migration: {}",
            version_before
        );

        migrations.to_latest(&mut conn)?;

        let version_after: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if version_after > version_before {
            info!(
                "Journal database migrated from version {} to {}",
                version_before, version_after
            );
        } else {
            debug!(
                "Journal database already at latest version {}",
                version_after
            );
        }

        Ok(())
    }

    fn get_connection(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    pub fn recordings_dir(&self) -> &PathBuf {
        &self.recordings_dir
    }

    /// Get the effective recordings directory (from settings or default).
    pub fn effective_recordings_dir(&self) -> PathBuf {
        let settings = crate::settings::get_settings(&self.app_handle);
        if let Some(ref path) = settings.journal_storage_path {
            if !path.is_empty() {
                let p = PathBuf::from(path);
                if p.exists() || fs::create_dir_all(&p).is_ok() {
                    return p;
                }
                warn!(
                    "Configured journal storage path {:?} is invalid, using default",
                    path
                );
            }
        }
        self.recordings_dir.clone()
    }

    /// Resolve the directory for a given folder_id (or root if None).
    fn resolve_entry_dir(&self, folder_id: Option<i64>) -> Result<PathBuf> {
        let root = self.effective_recordings_dir();
        match folder_id {
            Some(fid) => {
                let name = self.get_folder_name(fid)?;
                let dir = root.join(&name);
                if !dir.exists() {
                    fs::create_dir_all(&dir)?;
                }
                Ok(dir)
            }
            None => Ok(root),
        }
    }

    // --- Markdown file helpers ---

    /// Write the transcript markdown file for an entry.
    fn write_transcript_md(&self, entry: &JournalEntry) {
        if let Err(e) = self._write_transcript_md(entry) {
            error!(
                "Failed to write transcript .md for entry {}: {}",
                entry.id, e
            );
        }
    }

    fn _write_transcript_md(&self, entry: &JournalEntry) -> Result<()> {
        let dir = self.resolve_entry_dir(entry.folder_id)?;
        let base = entry_base_name(&entry.file_name);
        let md_path = dir.join(format!("{}.md", base));
        let content = &entry.transcription_text;
        fs::write(&md_path, content)?;
        debug!("Wrote transcript markdown: {:?}", md_path);
        Ok(())
    }

    /// Write a chat session's messages to a markdown file.
    pub fn write_chat_md(
        &self,
        entry: &JournalEntry,
        session: &ChatSession,
        messages: &[ChatMessage],
    ) {
        if let Err(e) = self._write_chat_md(entry, session, messages) {
            error!("Failed to write chat .md for session {}: {}", session.id, e);
        }
    }

    fn _write_chat_md(
        &self,
        entry: &JournalEntry,
        session: &ChatSession,
        messages: &[ChatMessage],
    ) -> Result<()> {
        let dir = self.resolve_entry_dir(entry.folder_id)?;
        let base = entry_base_name(&entry.file_name);
        let session_title = if session.title.is_empty() {
            format!("Session {}", session.id)
        } else {
            sanitize_filename(&session.title)
        };

        let (prefix, is_jot) = if session.mode == "jotter" {
            ("Jot", true)
        } else {
            ("Chat", false)
        };

        let filename = if is_jot {
            format!("{} - {} - {}.md", base, prefix, session_title)
        } else {
            let mode_cap = capitalize_first(&session.mode);
            format!(
                "{} - {} - {} - {}.md",
                base, prefix, mode_cap, session_title
            )
        };
        let md_path = dir.join(&filename);

        let mut content = String::new();
        if is_jot {
            // Jot: just write the last user message content (the jot body)
            if let Some(msg) = messages.last() {
                content = msg.content.clone();
            }
        } else {
            // Chat: format as conversation
            for msg in messages {
                let role_label = if msg.role == "user" { "You" } else { "mutter" };
                content.push_str(&format!("**{}**: {}\n\n", role_label, msg.content));
            }
        }

        fs::write(&md_path, content.trim_end())?;
        debug!("Wrote {} markdown: {:?}", prefix.to_lowercase(), md_path);
        Ok(())
    }

    /// Delete the chat/jot markdown file for a session.
    fn delete_chat_md(&self, entry: &JournalEntry, session: &ChatSession) {
        if let Err(e) = self._delete_chat_md(entry, session) {
            error!(
                "Failed to delete chat .md for session {}: {}",
                session.id, e
            );
        }
    }

    fn _delete_chat_md(&self, entry: &JournalEntry, session: &ChatSession) -> Result<()> {
        let dir = self.resolve_entry_dir(entry.folder_id)?;
        let base = entry_base_name(&entry.file_name);
        let session_title = if session.title.is_empty() {
            format!("Session {}", session.id)
        } else {
            sanitize_filename(&session.title)
        };

        let filename = if session.mode == "jotter" {
            format!("{} - Jot - {}.md", base, session_title)
        } else {
            let mode_cap = capitalize_first(&session.mode);
            format!("{} - Chat - {} - {}.md", base, mode_cap, session_title)
        };

        let md_path = dir.join(&filename);
        if md_path.exists() {
            fs::remove_file(&md_path)?;
            debug!("Deleted chat/jot markdown: {:?}", md_path);
        }
        Ok(())
    }

    /// Rename all files for an entry when its title changes.
    /// Returns the new file_name (for the audio file).
    fn rename_entry_files(&self, entry: &JournalEntry, new_title: &str) -> Result<String> {
        let dir = self.resolve_entry_dir(entry.folder_id)?;
        let old_base = entry_base_name(&entry.file_name);
        let new_base = sanitize_filename(new_title);

        if old_base == new_base {
            return Ok(entry.file_name.clone());
        }

        // Rename audio file
        let new_wav_path = unique_path(&dir, &new_base, ".wav");
        let new_wav_name = new_wav_path
            .file_name()
            .ok_or_else(|| anyhow::anyhow!("Path has no filename: {:?}", new_wav_path))?
            .to_string_lossy()
            .to_string();
        let old_wav_path = dir.join(&entry.file_name);
        if old_wav_path.exists() {
            fs::rename(&old_wav_path, &new_wav_path)?;
            debug!("Renamed audio: {:?} -> {:?}", old_wav_path, new_wav_path);
        }

        // Rename transcript .md
        let old_md = dir.join(format!("{}.md", old_base));
        let actual_new_base = entry_base_name(&new_wav_name);
        let new_md = dir.join(format!("{}.md", actual_new_base));
        if old_md.exists() {
            fs::rename(&old_md, &new_md)?;
            debug!("Renamed transcript: {:?} -> {:?}", old_md, new_md);
        }

        // Rename chat/jot .md files (find by prefix)
        if let Ok(read_dir) = fs::read_dir(&dir) {
            let old_prefix = format!("{} - ", old_base);
            let new_prefix = format!("{} - ", actual_new_base);
            for dir_entry in read_dir.flatten() {
                let name = dir_entry.file_name().to_string_lossy().to_string();
                if name.starts_with(&old_prefix) && name.ends_with(".md") {
                    let suffix = &name[old_prefix.len()..];
                    let new_name = format!("{}{}", new_prefix, suffix);
                    let old_path = dir_entry.path();
                    let new_path = dir.join(&new_name);
                    if let Err(e) = fs::rename(&old_path, &new_path) {
                        error!("Failed to rename {:?}: {}", old_path, e);
                    } else {
                        debug!("Renamed: {:?} -> {:?}", old_path, new_path);
                    }
                }
            }
        }

        Ok(new_wav_name)
    }

    /// Move all files for an entry between folders (audio, transcript md, chat/jot mds).
    fn move_all_entry_files(
        &self,
        entry: &JournalEntry,
        old_folder_id: Option<i64>,
        new_folder_id: Option<i64>,
    ) -> Result<()> {
        let src_dir = self.resolve_entry_dir(old_folder_id)?;
        let dest_dir = self.resolve_entry_dir(new_folder_id)?;

        if src_dir == dest_dir {
            return Ok(());
        }

        let base = entry_base_name(&entry.file_name);

        // Move audio file
        let src_wav = src_dir.join(&entry.file_name);
        let dest_wav = dest_dir.join(&entry.file_name);
        if src_wav.exists() {
            fs::rename(&src_wav, &dest_wav)?;
            debug!("Moved audio: {:?} -> {:?}", src_wav, dest_wav);
        }

        // Move transcript .md
        let src_md = src_dir.join(format!("{}.md", base));
        let dest_md = dest_dir.join(format!("{}.md", base));
        if src_md.exists() {
            fs::rename(&src_md, &dest_md)?;
        }

        // Move chat/jot .md files (find by prefix)
        let prefix = format!("{} - ", base);
        if let Ok(read_dir) = fs::read_dir(&src_dir) {
            for dir_entry in read_dir.flatten() {
                let name = dir_entry.file_name().to_string_lossy().to_string();
                if name.starts_with(&prefix) && name.ends_with(".md") {
                    let src = dir_entry.path();
                    let dest = dest_dir.join(&name);
                    if let Err(e) = fs::rename(&src, &dest) {
                        error!("Failed to move {:?}: {}", src, e);
                    }
                }
            }
        }

        Ok(())
    }

    /// Delete all associated files for an entry (audio, transcript md, chat/jot mds).
    fn delete_all_entry_files(&self, entry: &JournalEntry) {
        let dir = match self.resolve_entry_dir(entry.folder_id) {
            Ok(d) => d,
            Err(e) => {
                error!("Failed to resolve entry dir for deletion: {}", e);
                return;
            }
        };

        let base = entry_base_name(&entry.file_name);

        // Delete audio
        let wav_path = dir.join(&entry.file_name);
        if wav_path.exists() {
            if let Err(e) = fs::remove_file(&wav_path) {
                error!("Failed to delete audio {:?}: {}", wav_path, e);
            }
        }

        // Delete transcript .md
        let md_path = dir.join(format!("{}.md", base));
        if md_path.exists() {
            if let Err(e) = fs::remove_file(&md_path) {
                error!("Failed to delete transcript md {:?}: {}", md_path, e);
            }
        }

        // Delete chat/jot .md files
        let prefix = format!("{} - ", base);
        if let Ok(read_dir) = fs::read_dir(&dir) {
            for dir_entry in read_dir.flatten() {
                let name = dir_entry.file_name().to_string_lossy().to_string();
                if name.starts_with(&prefix) && name.ends_with(".md") {
                    if let Err(e) = fs::remove_file(dir_entry.path()) {
                        error!("Failed to delete {:?}: {}", dir_entry.path(), e);
                    }
                }
            }
        }
    }

    /// Migrate all files from the default recordings_dir to a new storage path.
    pub fn migrate_storage(&self, new_path: &str) -> Result<()> {
        let new_dir = PathBuf::from(new_path);
        if !new_dir.exists() {
            fs::create_dir_all(&new_dir)?;
        }

        // Only migrate if the new path differs from the current effective path
        let old_dir = self.effective_recordings_dir();
        if old_dir == new_dir {
            return Ok(());
        }

        // Recursively copy contents from old to new
        Self::copy_dir_recursive(&old_dir, &new_dir)?;
        info!(
            "Migrated journal storage from {:?} to {:?}",
            old_dir, new_dir
        );
        Ok(())
    }

    fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<()> {
        if !dest.exists() {
            fs::create_dir_all(dest)?;
        }
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            let src_path = entry.path();
            let dest_path = dest.join(entry.file_name());
            if file_type.is_dir() {
                Self::copy_dir_recursive(&src_path, &dest_path)?;
            } else if !dest_path.exists() {
                fs::copy(&src_path, &dest_path)?;
            }
        }
        Ok(())
    }

    /// Get the audio file path accounting for folder location.
    /// Checks folder path first, then falls back to root recordings dir.
    pub fn get_audio_file_path_in_folder(
        &self,
        file_name: &str,
        folder_id: Option<i64>,
    ) -> Result<PathBuf> {
        let root = self.effective_recordings_dir();
        if let Some(fid) = folder_id {
            let conn = self.get_connection()?;
            let folder_name: Option<String> = conn
                .query_row(
                    "SELECT name FROM journal_folders WHERE id = ?1",
                    [fid],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(name) = folder_name {
                let folder_path = root.join(&name).join(file_name);
                if folder_path.exists() {
                    return Ok(folder_path);
                }
            }
        }
        // Fallback to root
        Ok(root.join(file_name))
    }

    pub async fn save_entry(
        &self,
        file_name: String,
        title: String,
        transcription_text: String,
        post_processed_text: Option<String>,
        post_process_prompt_id: Option<String>,
        tags: Vec<String>,
        linked_entry_ids: Vec<i64>,
        folder_id: Option<i64>,
    ) -> Result<JournalEntry> {
        self.save_entry_with_source(
            file_name,
            title,
            transcription_text,
            post_processed_text,
            post_process_prompt_id,
            tags,
            linked_entry_ids,
            folder_id,
            "voice".to_string(),
            None,
        )
        .await
    }

    pub async fn save_entry_with_source(
        &self,
        file_name: String,
        title: String,
        transcription_text: String,
        post_processed_text: Option<String>,
        post_process_prompt_id: Option<String>,
        tags: Vec<String>,
        linked_entry_ids: Vec<i64>,
        folder_id: Option<i64>,
        source: String,
        source_url: Option<String>,
    ) -> Result<JournalEntry> {
        let timestamp = Utc::now().timestamp();
        let tags_json = serde_json::to_string(&tags)?;
        let linked_json = serde_json::to_string(&linked_entry_ids)?;

        // Rename audio file from timestamp-based to title-based
        let root = self.effective_recordings_dir();
        let src_path = root.join(&file_name);
        let sanitized = sanitize_filename(&title);
        let dest_dir = match folder_id {
            Some(fid) => {
                let name = self.get_folder_name(fid)?;
                let dir = root.join(&name);
                if !dir.exists() {
                    fs::create_dir_all(&dir)?;
                }
                dir
            }
            None => root,
        };

        let new_file_name = if !file_name.is_empty() && src_path.is_file() {
            let new_wav_path = unique_path(&dest_dir, &sanitized, ".wav");
            let name = new_wav_path
                .file_name()
                .ok_or_else(|| anyhow::anyhow!("Path has no filename: {:?}", new_wav_path))?
                .to_string_lossy()
                .to_string();
            fs::rename(&src_path, &new_wav_path)?;
            debug!(
                "Renamed audio to title-based: {:?} -> {:?}",
                src_path, new_wav_path
            );
            name
        } else {
            // No audio file (e.g. pending entry or YouTube transcript) — use sanitized title as file_name
            format!("{}.md", sanitized)
        };

        let conn = self.get_connection()?;
        conn.execute(
            "INSERT INTO journal_entries (file_name, timestamp, title, transcription_text, post_processed_text, post_process_prompt_id, tags, linked_entry_ids, folder_id, source, source_url) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![new_file_name, timestamp, title, transcription_text, post_processed_text, post_process_prompt_id, tags_json, linked_json, folder_id, source, source_url],
        )?;

        let id = conn.last_insert_rowid();
        debug!("Saved journal entry {} (source={}) to database", id, source);

        let entry = JournalEntry {
            id,
            file_name: new_file_name,
            timestamp,
            title,
            transcription_text,
            post_processed_text,
            post_process_prompt_id,
            tags,
            linked_entry_ids,
            folder_id,
            transcript_snapshots: vec![],
            source,
            source_url,
            speaker_names: "{}".to_string(),
            user_source: String::new(),
        };

        // Write transcript markdown file
        self.write_transcript_md(&entry);

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(entry)
    }

    fn parse_entry_row(row: &rusqlite::Row) -> rusqlite::Result<JournalEntry> {
        let tags_json: String = row.get("tags")?;
        let linked_json: String = row.get("linked_entry_ids")?;
        let snapshots_json: String = row.get("transcript_snapshots")?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        let linked_entry_ids: Vec<i64> = serde_json::from_str(&linked_json).unwrap_or_default();
        let transcript_snapshots: Vec<String> =
            serde_json::from_str(&snapshots_json).unwrap_or_default();
        Ok(JournalEntry {
            id: row.get("id")?,
            file_name: row.get("file_name")?,
            timestamp: row.get("timestamp")?,
            title: row.get("title")?,
            transcription_text: row.get("transcription_text")?,
            post_processed_text: row.get("post_processed_text")?,
            post_process_prompt_id: row.get("post_process_prompt_id")?,
            tags,
            linked_entry_ids,
            folder_id: row.get("folder_id")?,
            transcript_snapshots,
            source: row.get("source")?,
            source_url: row.get("source_url")?,
            speaker_names: row.get("speaker_names")?,
            user_source: row.get("user_source")?,
        })
    }

    #[allow(dead_code)]
    pub async fn get_entries(&self) -> Result<Vec<JournalEntry>> {
        self.get_entries_by_source(None).await
    }

    pub async fn get_entries_by_sources(&self, sources: &[&str]) -> Result<Vec<JournalEntry>> {
        let conn = self.get_connection()?;
        let mut entries = Vec::new();

        let placeholders: Vec<String> = (1..=sources.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT id, file_name, timestamp, title, transcription_text, post_processed_text, post_process_prompt_id, tags, linked_entry_ids, folder_id, transcript_snapshots, source, source_url, speaker_names, user_source FROM journal_entries WHERE source IN ({}) ORDER BY timestamp DESC",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> = sources
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = stmt.query_map(params.as_slice(), |row| Self::parse_entry_row(row))?;
        for row in rows {
            entries.push(row?);
        }

        Ok(entries)
    }

    pub async fn get_entries_by_source(
        &self,
        source_filter: Option<&str>,
    ) -> Result<Vec<JournalEntry>> {
        let conn = self.get_connection()?;
        let mut entries = Vec::new();

        match source_filter {
            Some(source) => {
                let mut stmt = conn.prepare(
                    "SELECT id, file_name, timestamp, title, transcription_text, post_processed_text, post_process_prompt_id, tags, linked_entry_ids, folder_id, transcript_snapshots, source, source_url, speaker_names, user_source FROM journal_entries WHERE source = ?1 ORDER BY timestamp DESC",
                )?;
                let rows = stmt.query_map([source], |row| Self::parse_entry_row(row))?;
                for row in rows {
                    entries.push(row?);
                }
            }
            None => {
                let mut stmt = conn.prepare(
                    "SELECT id, file_name, timestamp, title, transcription_text, post_processed_text, post_process_prompt_id, tags, linked_entry_ids, folder_id, transcript_snapshots, source, source_url, speaker_names, user_source FROM journal_entries ORDER BY timestamp DESC",
                )?;
                let rows = stmt.query_map([], |row| Self::parse_entry_row(row))?;
                for row in rows {
                    entries.push(row?);
                }
            }
        }

        Ok(entries)
    }

    pub async fn get_entry_by_id(&self, id: i64) -> Result<Option<JournalEntry>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, file_name, timestamp, title, transcription_text, post_processed_text, post_process_prompt_id, tags, linked_entry_ids, folder_id, transcript_snapshots, source, source_url, speaker_names, user_source FROM journal_entries WHERE id = ?1",
        )?;

        let entry = stmt
            .query_row([id], |row| Self::parse_entry_row(row))
            .optional()?;

        Ok(entry)
    }

    pub async fn update_entry(
        &self,
        id: i64,
        title: String,
        tags: Vec<String>,
        linked_entry_ids: Vec<i64>,
        folder_id: Option<i64>,
        user_source: String,
    ) -> Result<()> {
        let mut file_name_update: Option<String> = None;

        if let Some(entry) = self.get_entry_by_id(id).await? {
            // If folder is changing, move all associated files
            if entry.folder_id != folder_id {
                self.move_all_entry_files(&entry, entry.folder_id, folder_id)?;
            }

            // If title is changing, rename all associated files
            if entry.title != title {
                match self.rename_entry_files(&entry, &title) {
                    Ok(new_file_name) => {
                        file_name_update = Some(new_file_name);
                    }
                    Err(e) => {
                        error!("Failed to rename entry files: {}", e);
                    }
                }
            }
        }

        let conn = self.get_connection()?;
        let tags_json = serde_json::to_string(&tags)?;
        let linked_json = serde_json::to_string(&linked_entry_ids)?;

        if let Some(ref new_fn) = file_name_update {
            conn.execute(
                "UPDATE journal_entries SET title = ?1, tags = ?2, linked_entry_ids = ?3, folder_id = ?4, file_name = ?5, user_source = ?6 WHERE id = ?7",
                params![title, tags_json, linked_json, folder_id, new_fn, user_source, id],
            )?;
        } else {
            conn.execute(
                "UPDATE journal_entries SET title = ?1, tags = ?2, linked_entry_ids = ?3, folder_id = ?4, user_source = ?5 WHERE id = ?6",
                params![title, tags_json, linked_json, folder_id, user_source, id],
            )?;
        }

        debug!("Updated journal entry {}", id);

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(())
    }

    /// Update an entry after async processing completes (YouTube download, video import).
    /// Sets file_name, title, and transcription_text in one go.
    pub async fn update_entry_after_processing(
        &self,
        id: i64,
        file_name: String,
        title: String,
        transcription_text: String,
    ) -> Result<()> {
        let conn = self.get_connection()?;

        conn.execute(
            "UPDATE journal_entries SET file_name = ?1, title = ?2, transcription_text = ?3 WHERE id = ?4",
            params![file_name, title, transcription_text, id],
        )?;

        // Write the transcript .md file
        if let Some(entry) = self.get_entry_by_id(id).await? {
            self.write_transcript_md(&entry);
        }

        debug!("Updated entry {} after processing", id);

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(())
    }

    pub async fn update_post_processed_text(
        &self,
        id: i64,
        text: String,
        prompt_id: String,
    ) -> Result<()> {
        let conn = self.get_connection()?;

        conn.execute(
            "UPDATE journal_entries SET post_processed_text = ?1, post_process_prompt_id = ?2 WHERE id = ?3",
            params![text, prompt_id, id],
        )?;

        debug!("Updated post-processed text for journal entry {}", id);

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(())
    }

    pub async fn update_transcription_text(
        &self,
        id: i64,
        text: String,
        prompt_id: Option<String>,
    ) -> Result<()> {
        let conn = self.get_connection()?;

        conn.execute(
            "UPDATE journal_entries SET transcription_text = ?1, post_process_prompt_id = ?2 WHERE id = ?3",
            params![text, prompt_id, id],
        )?;

        debug!("Updated transcription text for journal entry {}", id);

        // Update the transcript .md file
        if let Ok(Some(entry)) = self.get_entry_by_id(id).await {
            self.write_transcript_md(&entry);
        }

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(())
    }

    /// Push a snapshot of the current text before applying a prompt, then update text + prompt_id.
    pub async fn apply_prompt_with_snapshot(
        &self,
        id: i64,
        new_text: String,
        prompt_id: String,
    ) -> Result<()> {
        let entry = self
            .get_entry_by_id(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Entry not found"))?;

        let mut snapshots = entry.transcript_snapshots;
        snapshots.push(entry.transcription_text);
        let snapshots_json = serde_json::to_string(&snapshots)?;

        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE journal_entries SET transcription_text = ?1, post_process_prompt_id = ?2, transcript_snapshots = ?3 WHERE id = ?4",
            params![new_text, prompt_id, snapshots_json, id],
        )?;

        debug!(
            "Applied prompt {} to journal entry {} (snapshot saved)",
            prompt_id, id
        );

        // Update the transcript .md file
        if let Ok(Some(updated)) = self.get_entry_by_id(id).await {
            self.write_transcript_md(&updated);
        }

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(())
    }

    /// Undo the last prompt: pop the last snapshot, restore text, and set prompt_id to the previous level.
    pub async fn undo_last_prompt(
        &self,
        id: i64,
        previous_prompt_id: Option<String>,
    ) -> Result<String> {
        let entry = self
            .get_entry_by_id(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Entry not found"))?;

        let mut snapshots = entry.transcript_snapshots;
        let restored_text = snapshots
            .pop()
            .ok_or_else(|| anyhow::anyhow!("No snapshots to undo"))?;
        let snapshots_json = serde_json::to_string(&snapshots)?;

        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE journal_entries SET transcription_text = ?1, post_process_prompt_id = ?2, transcript_snapshots = ?3 WHERE id = ?4",
            params![restored_text, previous_prompt_id, snapshots_json, id],
        )?;

        debug!("Undid prompt for journal entry {} (restored snapshot)", id);

        // Update the transcript .md file
        if let Ok(Some(updated)) = self.get_entry_by_id(id).await {
            self.write_transcript_md(&updated);
        }

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(restored_text)
    }

    /// Clear all snapshots (used when re-transcribing).
    pub async fn clear_snapshots(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE journal_entries SET transcript_snapshots = '[]' WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub async fn delete_entry(&self, id: i64) -> Result<()> {
        if let Some(entry) = self.get_entry_by_id(id).await? {
            // Delete all associated files (audio, transcript md, chat/jot mds)
            self.delete_all_entry_files(&entry);
        }

        let conn = self.get_connection()?;
        conn.execute("DELETE FROM journal_entries WHERE id = ?1", params![id])?;

        debug!("Deleted journal entry with id: {}", id);

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(())
    }

    pub fn delete_recording_file(&self, file_name: &str) -> Result<()> {
        let root = self.effective_recordings_dir();
        let file_path = root.join(file_name);
        if file_path.exists() {
            fs::remove_file(&file_path)?;
            debug!("Deleted journal recording file: {}", file_name);
        }
        Ok(())
    }

    // --- Folder operations ---

    fn get_folder_name(&self, folder_id: i64) -> Result<String> {
        let conn = self.get_connection()?;
        let name: String = conn.query_row(
            "SELECT name FROM journal_folders WHERE id = ?1",
            [folder_id],
            |row| row.get(0),
        )?;
        Ok(name)
    }

    // Note: move_file_to_folder removed — save_entry now handles file placement directly,
    // and move_all_entry_files handles folder moves.

    pub async fn create_folder(&self, name: String) -> Result<JournalFolder> {
        self.create_folder_with_source(name, "voice".to_string())
            .await
    }

    pub async fn create_folder_with_source(
        &self,
        name: String,
        source: String,
    ) -> Result<JournalFolder> {
        let created_at = Utc::now().timestamp();

        // Create actual directory
        let root = self.effective_recordings_dir();
        let folder_path = root.join(&name);
        if !folder_path.exists() {
            fs::create_dir_all(&folder_path)?;
            debug!("Created journal folder directory: {:?}", folder_path);
        }

        let conn = self.get_connection()?;
        conn.execute(
            "INSERT INTO journal_folders (name, created_at, source) VALUES (?1, ?2, ?3)",
            params![name, created_at, source],
        )?;
        let id = conn.last_insert_rowid();
        debug!(
            "Created journal folder {} ('{}', source={})",
            id, name, source
        );

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(JournalFolder {
            id,
            name,
            created_at,
            source,
        })
    }

    pub async fn rename_folder(&self, id: i64, new_name: String) -> Result<()> {
        let root = self.effective_recordings_dir();
        let old_name = self.get_folder_name(id)?;
        let old_path = root.join(&old_name);
        let new_path = root.join(&new_name);

        if old_path.exists() && old_path != new_path {
            fs::rename(&old_path, &new_path)?;
            debug!("Renamed folder directory '{}' -> '{}'", old_name, new_name);
        }

        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE journal_folders SET name = ?1 WHERE id = ?2",
            params![new_name, id],
        )?;
        debug!("Renamed journal folder {} to '{}'", id, new_name);

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(())
    }

    pub async fn delete_folder(&self, id: i64) -> Result<()> {
        // Prevent deletion of folders that contain entries
        let conn = self.get_connection()?;
        let entry_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM journal_entries WHERE folder_id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if entry_count > 0 {
            anyhow::bail!(
                "Cannot delete folder: it contains {} entr{}. Delete or move entries first.",
                entry_count,
                if entry_count == 1 { "y" } else { "ies" }
            );
        }

        let root = self.effective_recordings_dir();
        let folder_name = self.get_folder_name(id)?;
        let folder_path = root.join(&folder_name);

        if folder_path.exists() {
            fs::remove_dir_all(&folder_path)?;
            debug!("Removed journal folder directory: {:?}", folder_path);
        }

        conn.execute("DELETE FROM journal_folders WHERE id = ?1", params![id])?;
        debug!("Deleted journal folder {}", id);

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(())
    }

    #[allow(dead_code)]
    pub async fn get_folders(&self) -> Result<Vec<JournalFolder>> {
        self.get_folders_by_source(None).await
    }

    pub async fn get_folders_by_source(
        &self,
        source_filter: Option<&str>,
    ) -> Result<Vec<JournalFolder>> {
        let conn = self.get_connection()?;
        let mut folders = Vec::new();

        match source_filter {
            Some(source) => {
                let mut stmt = conn.prepare(
                    "SELECT id, name, created_at, source FROM journal_folders WHERE source = ?1 ORDER BY name ASC",
                )?;
                let rows = stmt.query_map([source], |row| {
                    Ok(JournalFolder {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        created_at: row.get(2)?,
                        source: row.get(3)?,
                    })
                })?;
                for row in rows {
                    folders.push(row?);
                }
            }
            None => {
                let mut stmt = conn.prepare(
                    "SELECT id, name, created_at, source FROM journal_folders ORDER BY name ASC",
                )?;
                let rows = stmt.query_map([], |row| {
                    Ok(JournalFolder {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        created_at: row.get(2)?,
                        source: row.get(3)?,
                    })
                })?;
                for row in rows {
                    folders.push(row?);
                }
            }
        }

        Ok(folders)
    }

    pub async fn move_entry_to_folder(&self, entry_id: i64, folder_id: Option<i64>) -> Result<()> {
        let entry = self
            .get_entry_by_id(entry_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Entry not found"))?;

        if entry.folder_id == folder_id {
            return Ok(()); // No change needed
        }

        // Move all associated files (audio, transcript md, chat/jot mds)
        self.move_all_entry_files(&entry, entry.folder_id, folder_id)?;

        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE journal_entries SET folder_id = ?1 WHERE id = ?2",
            params![folder_id, entry_id],
        )?;

        debug!("Moved journal entry {} to folder {:?}", entry_id, folder_id);

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(())
    }

    // --- Chat session operations ---

    pub async fn create_chat_session(&self, entry_id: i64, mode: String) -> Result<ChatSession> {
        let now = Utc::now().timestamp();
        let conn = self.get_connection()?;
        conn.execute(
            "INSERT INTO journal_chat_sessions (entry_id, mode, title, created_at, updated_at) VALUES (?1, ?2, '', ?3, ?4)",
            params![entry_id, mode, now, now],
        )?;
        let id = conn.last_insert_rowid();
        debug!("Created chat session {} for entry {}", id, entry_id);

        Ok(ChatSession {
            id,
            entry_id,
            mode,
            title: String::new(),
            created_at: now,
            updated_at: now,
        })
    }

    pub async fn get_chat_sessions_for_entry(&self, entry_id: i64) -> Result<Vec<ChatSession>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, entry_id, mode, title, created_at, updated_at FROM journal_chat_sessions WHERE entry_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([entry_id], |row| {
            Ok(ChatSession {
                id: row.get(0)?,
                entry_id: row.get(1)?,
                mode: row.get(2)?,
                title: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        Ok(sessions)
    }

    pub async fn save_chat_message(
        &self,
        session_id: i64,
        role: String,
        content: String,
    ) -> Result<ChatMessage> {
        let now = Utc::now().timestamp();
        let conn = self.get_connection()?;
        conn.execute(
            "INSERT INTO journal_chat_messages (session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![session_id, role, content, now],
        )?;
        let id = conn.last_insert_rowid();

        // Update the session's updated_at and auto-generate title from first user message
        conn.execute(
            "UPDATE journal_chat_sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )?;

        // If title is empty and this is a user message, set it from first ~50 chars
        if role == "user" {
            let current_title: String = conn.query_row(
                "SELECT title FROM journal_chat_sessions WHERE id = ?1",
                [session_id],
                |row| row.get(0),
            )?;
            if current_title.is_empty() {
                let title: String = if content.len() > 50 {
                    format!("{}...", &content[..50])
                } else {
                    content.clone()
                };
                conn.execute(
                    "UPDATE journal_chat_sessions SET title = ?1 WHERE id = ?2",
                    params![title, session_id],
                )?;
            }
        }

        debug!("Saved chat message {} to session {}", id, session_id);

        let message = ChatMessage {
            id,
            session_id,
            role,
            content,
            created_at: now,
        };

        // Write chat/jot .md file
        self.write_chat_md_for_session(session_id).await;

        Ok(message)
    }

    /// Write chat/jot .md after looking up session, entry, and messages.
    async fn write_chat_md_for_session(&self, session_id: i64) {
        // Look up the session to get entry_id and mode
        let conn = match self.get_connection() {
            Ok(c) => c,
            Err(_) => return,
        };
        let session_row: Option<(i64, String, String)> = conn
            .query_row(
                "SELECT entry_id, mode, title FROM journal_chat_sessions WHERE id = ?1",
                [session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .ok()
            .flatten();
        drop(conn);

        if let Some((entry_id, mode, title)) = session_row {
            if let Ok(Some(entry)) = self.get_entry_by_id(entry_id).await {
                if let Ok(messages) = self.get_chat_messages(session_id).await {
                    let session = ChatSession {
                        id: session_id,
                        entry_id,
                        mode,
                        title,
                        created_at: 0,
                        updated_at: 0,
                    };
                    self.write_chat_md(&entry, &session, &messages);
                }
            }
        }
    }

    pub async fn get_chat_messages(&self, session_id: i64) -> Result<Vec<ChatMessage>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, created_at FROM journal_chat_messages WHERE session_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([session_id], |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        let mut messages = Vec::new();
        for row in rows {
            messages.push(row?);
        }
        Ok(messages)
    }

    pub async fn update_chat_session_title(&self, session_id: i64, title: String) -> Result<()> {
        // Get old session info for renaming the .md file
        let conn = self.get_connection()?;
        let old_info: Option<(i64, String, String)> = conn
            .query_row(
                "SELECT entry_id, mode, title FROM journal_chat_sessions WHERE id = ?1",
                [session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;

        conn.execute(
            "UPDATE journal_chat_sessions SET title = ?1 WHERE id = ?2",
            params![title, session_id],
        )?;
        debug!("Updated chat session {} title", session_id);

        // Rename the .md file if title changed
        if let Some((entry_id, mode, old_title)) = old_info {
            if old_title != title {
                if let Ok(Some(entry)) = self.get_entry_by_id(entry_id).await {
                    let old_session = ChatSession {
                        id: session_id,
                        entry_id,
                        mode: mode.clone(),
                        title: old_title,
                        created_at: 0,
                        updated_at: 0,
                    };
                    self.delete_chat_md(&entry, &old_session);
                    // Rewrite with new title
                    self.write_chat_md_for_session(session_id).await;
                }
            }
        }

        Ok(())
    }

    pub async fn delete_chat_session(&self, session_id: i64) -> Result<()> {
        // Get session info to delete the .md file
        let conn = self.get_connection()?;
        let session_info: Option<(i64, String, String)> = conn
            .query_row(
                "SELECT entry_id, mode, title FROM journal_chat_sessions WHERE id = ?1",
                [session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;

        // Messages are cascade-deleted via FK
        conn.execute(
            "DELETE FROM journal_chat_sessions WHERE id = ?1",
            params![session_id],
        )?;
        debug!("Deleted chat session {}", session_id);

        // Delete the .md file
        if let Some((entry_id, mode, title)) = session_info {
            if let Ok(Some(entry)) = self.get_entry_by_id(entry_id).await {
                let session = ChatSession {
                    id: session_id,
                    entry_id,
                    mode,
                    title,
                    created_at: 0,
                    updated_at: 0,
                };
                self.delete_chat_md(&entry, &session);
            }
        }

        Ok(())
    }

    // --- Meeting segment operations ---

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub async fn save_meeting_segments(
        &self,
        entry_id: i64,
        segments: &[crate::diarize::DiarizedSegment],
    ) -> Result<()> {
        let conn = self.get_connection()?;

        // Clear existing segments for this entry
        conn.execute(
            "DELETE FROM meeting_segments WHERE entry_id = ?1",
            params![entry_id],
        )?;

        for seg in segments {
            conn.execute(
                "INSERT INTO meeting_segments (entry_id, speaker, start_ms, end_ms, text) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![entry_id, seg.speaker, seg.start_ms, seg.end_ms, seg.text],
            )?;
        }

        debug!(
            "Saved {} meeting segments for entry {}",
            segments.len(),
            entry_id
        );
        Ok(())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub async fn get_meeting_segments(
        &self,
        entry_id: i64,
    ) -> Result<Vec<crate::diarize::DiarizedSegment>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, speaker, start_ms, end_ms, text FROM meeting_segments WHERE entry_id = ?1 ORDER BY start_ms ASC",
        )?;
        let rows = stmt.query_map([entry_id], |row| {
            Ok(crate::diarize::DiarizedSegment {
                id: Some(row.get(0)?),
                speaker: row.get(1)?,
                start_ms: row.get(2)?,
                end_ms: row.get(3)?,
                text: row.get(4)?,
            })
        })?;
        let mut segments = Vec::new();
        for row in rows {
            segments.push(row?);
        }
        Ok(segments)
    }

    pub async fn update_segment_text(&self, segment_id: i64, text: String) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE meeting_segments SET text = ?1 WHERE id = ?2",
            params![text, segment_id],
        )?;
        debug!("Updated text for segment {}", segment_id);
        Ok(())
    }

    pub async fn update_segment_speaker(
        &self,
        segment_id: i64,
        speaker: Option<i32>,
    ) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE meeting_segments SET speaker = ?1 WHERE id = ?2",
            params![speaker, segment_id],
        )?;
        debug!(
            "Updated speaker for segment {} to {:?}",
            segment_id, speaker
        );
        Ok(())
    }

    pub async fn update_speaker_name(
        &self,
        entry_id: i64,
        speaker_id: i32,
        name: String,
    ) -> Result<()> {
        let conn = self.get_connection()?;
        let current: String = conn.query_row(
            "SELECT speaker_names FROM journal_entries WHERE id = ?1",
            [entry_id],
            |row| row.get(0),
        )?;

        let mut names: std::collections::HashMap<String, String> =
            serde_json::from_str(&current).unwrap_or_default();
        names.insert(speaker_id.to_string(), name);
        let updated = serde_json::to_string(&names)?;

        conn.execute(
            "UPDATE journal_entries SET speaker_names = ?1 WHERE id = ?2",
            params![updated, entry_id],
        )?;

        debug!(
            "Updated speaker name for entry {} speaker {}",
            entry_id, speaker_id
        );

        if let Err(e) = self.app_handle.emit("journal-updated", ()) {
            error!("Failed to emit journal-updated event: {}", e);
        }

        Ok(())
    }

    pub async fn get_speaker_names(
        &self,
        entry_id: i64,
    ) -> Result<std::collections::HashMap<String, String>> {
        let conn = self.get_connection()?;
        let json: String = conn.query_row(
            "SELECT speaker_names FROM journal_entries WHERE id = ?1",
            [entry_id],
            |row| row.get(0),
        )?;
        let names: std::collections::HashMap<String, String> =
            serde_json::from_str(&json).unwrap_or_default();
        Ok(names)
    }
}
