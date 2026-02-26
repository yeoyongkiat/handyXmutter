//! Share intent handling for Android.
//!
//! On Android, when content is shared to the app via ACTION_SEND,
//! the Kotlin MainActivity writes a `pending_share.json` file.
//! These commands let the frontend poll for and consume that data.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ShareData {
    #[serde(rename = "type")]
    pub share_type: String,
    pub text: Option<String>,
    pub subject: Option<String>,
    pub file_path: Option<String>,
}

fn find_share_file(app: &AppHandle) -> Option<PathBuf> {
    let data_dir = app.path().app_data_dir().ok()?;

    // Check multiple locations where Android's filesDir might resolve
    let candidates = [
        data_dir.join("pending_share.json"),
        data_dir
            .parent()
            .map(|p| p.join("pending_share.json"))
            .unwrap_or_default(),
    ];

    candidates.into_iter().find(|p| p.exists())
}

/// Check if there's pending share data from an Android share intent.
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
#[specta::specta]
pub async fn get_pending_share(app: AppHandle) -> Result<Option<ShareData>, String> {
    let Some(path) = find_share_file(&app) else {
        return Ok(None);
    };

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read share data: {}", e))?;
    let data: ShareData =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse share data: {}", e))?;
    Ok(Some(data))
}

/// Clear pending share data after the frontend has processed it.
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
#[specta::specta]
pub async fn clear_pending_share(app: AppHandle) -> Result<(), String> {
    if let Some(path) = find_share_file(&app) {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}
