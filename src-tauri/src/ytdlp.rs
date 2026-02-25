use futures_util::StreamExt;
use log::{info, warn};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn get_binary_name() -> &'static str {
    if cfg!(windows) {
        if cfg!(target_arch = "aarch64") {
            "yt-dlp_arm64.exe"
        } else {
            "yt-dlp.exe"
        }
    } else if cfg!(target_os = "linux") {
        if cfg!(target_arch = "aarch64") {
            "yt-dlp_linux_aarch64"
        } else {
            "yt-dlp_linux"
        }
    } else {
        "yt-dlp_macos"
    }
}

pub fn get_ytdlp_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join(get_binary_name()))
}

pub fn ytdlp_exists(app: &AppHandle) -> Result<bool, String> {
    let path = get_ytdlp_path(app)?;
    info!("yt-dlp path: {}, exists: {}", path.display(), path.exists());
    Ok(path.exists())
}

pub async fn get_latest_version() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("handyxmutter")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch yt-dlp releases: {}", e))?
        .error_for_status()
        .map_err(|e| format!("GitHub API error: {}", e))?;

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse release JSON: {}", e))?;

    json["tag_name"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Missing tag_name in release response".to_string())
}

pub async fn download_ytdlp_binary(app: &AppHandle, version: &str) -> Result<(), String> {
    let binary_name = get_binary_name();
    let download_url = format!(
        "https://github.com/yt-dlp/yt-dlp/releases/download/{}/{}",
        version, binary_name
    );

    info!("Downloading yt-dlp {} from {}", version, download_url);
    app.emit("ytdlp-download-progress", "downloading")
        .map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("handyxmutter")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download yt-dlp: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Download failed: {}", e))?;

    let total_size = response.content_length().unwrap_or(0);
    let dest_path = get_ytdlp_path(app)?;

    // Ensure parent directory exists
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut file_bytes: Vec<u8> = Vec::with_capacity(total_size as usize);

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
        file_bytes.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let progress = (downloaded as f64 / total_size as f64 * 100.0) as u32;
            let _ = app.emit("ytdlp-download-progress", format!("{}%", progress));
        }
    }

    std::fs::write(&dest_path, &file_bytes)
        .map_err(|e| format!("Failed to write yt-dlp binary: {}", e))?;

    // Set executable permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&dest_path)
            .map_err(|e| format!("Failed to read file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dest_path, perms)
            .map_err(|e| format!("Failed to set executable permission: {}", e))?;
    }

    // Remove macOS quarantine/provenance attributes and ad-hoc sign the binary
    #[cfg(target_os = "macos")]
    {
        let path_str = dest_path.to_string_lossy().to_string();
        let _ = std::process::Command::new("xattr")
            .args(["-cr", &path_str])
            .output();
        // Ad-hoc code sign so macOS allows execution from within the app
        let sign_result = std::process::Command::new("codesign")
            .args(["--force", "--sign", "-", &path_str])
            .output();
        match sign_result {
            Ok(o) if o.status.success() => info!("Ad-hoc signed yt-dlp binary"),
            Ok(o) => warn!(
                "codesign returned {}: {}",
                o.status,
                String::from_utf8_lossy(&o.stderr)
            ),
            Err(e) => warn!("codesign failed: {}", e),
        }
    }

    info!("yt-dlp downloaded to {}", dest_path.display());
    let _ = app.emit("ytdlp-download-progress", "done");

    Ok(())
}

/// Download audio from a YouTube URL using yt-dlp.
/// Uses `-f bestaudio[ext=m4a]` so we get native m4a without needing ffmpeg.
pub async fn download_audio(
    app: &AppHandle,
    url: &str,
    out_path: &std::path::Path,
) -> Result<(), String> {
    let ytdlp_path = get_ytdlp_path(app)?;
    if !ytdlp_path.exists() {
        return Err("yt-dlp is not installed".to_string());
    }

    info!(
        "download_audio: binary={}, url={}, out={}",
        ytdlp_path.display(),
        url,
        out_path.display()
    );
    let _ = app.emit("ytdlp-status", "downloading");

    // Ensure the binary is properly signed and quarantine-free
    #[cfg(target_os = "macos")]
    {
        let path_str = ytdlp_path.to_string_lossy().to_string();
        let _ = std::process::Command::new("xattr")
            .args(["-cr", &path_str])
            .output();
        let _ = std::process::Command::new("codesign")
            .args(["--force", "--sign", "-", &path_str])
            .output();
    }

    let mut cmd = Command::new(&ytdlp_path);
    cmd.args([
        "--progress-template",
        r#"{"progress": "%(progress.percent)s", "progress_str": "%(progress._percent_str)s"}"#,
        "--no-playlist",
        "-f",
        "bestaudio[ext=m4a]/bestaudio",
        url,
        "-o",
    ])
    .arg(out_path.as_os_str())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let cancel_flag = Arc::new(AtomicBool::new(false));
    let cancel_flag_clone = cancel_flag.clone();
    app.once("ytdlp-cancel", move |_| {
        cancel_flag_clone.store(true, Ordering::Relaxed);
    });

    info!("Spawning yt-dlp process...");
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn yt-dlp: {} (kind={:?})", e, e.kind()))?;
    info!("yt-dlp process spawned successfully");

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if cancel_flag.load(Ordering::Relaxed) {
                let _ = child.kill().await;
                return Err("Cancelled".to_string());
            }

            let line = line.replace('\r', "").trim().to_string();
            if line.starts_with("{\"progress") {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    let pct_str = value["progress_str"]
                        .as_str()
                        .unwrap_or_default()
                        .trim()
                        .replace('%', "");
                    if let Ok(pct) = pct_str.parse::<f32>() {
                        let _ = app.emit("ytdlp-audio-progress", pct);
                    }
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for yt-dlp: {}", e))?;

    if !status.success() && !cancel_flag.load(Ordering::Relaxed) {
        let mut stderr_output = String::new();
        if let Some(mut stderr) = child.stderr.take() {
            let mut buf = String::new();
            let _ = tokio::io::AsyncReadExt::read_to_string(&mut stderr, &mut buf).await;
            stderr_output = buf;
        }
        return Err(format!("yt-dlp failed: {}", stderr_output));
    }

    info!("yt-dlp download completed successfully");
    Ok(())
}

/// Get the title of a YouTube video via yt-dlp --get-title.
pub async fn get_video_title(app: &AppHandle, url: &str) -> Result<String, String> {
    let ytdlp_path = get_ytdlp_path(app)?;
    info!("get_video_title: binary={}, exists={}", ytdlp_path.display(), ytdlp_path.exists());

    if !ytdlp_path.exists() {
        return Err("yt-dlp is not installed".to_string());
    }

    // Ensure the binary is properly signed and quarantine-free
    #[cfg(target_os = "macos")]
    {
        let path_str = ytdlp_path.to_string_lossy().to_string();
        let _ = std::process::Command::new("xattr")
            .args(["-cr", &path_str])
            .output();
        let _ = std::process::Command::new("codesign")
            .args(["--force", "--sign", "-", &path_str])
            .output();
    }

    info!("Spawning yt-dlp --get-title for: {}", url);
    let output = Command::new(&ytdlp_path)
        .args(["--get-title", "--no-playlist", url])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await
        .map_err(|e| {
            format!(
                "Failed to run yt-dlp (path={}): {} (kind={:?})",
                ytdlp_path.display(),
                e,
                e.kind()
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to get video title: {}", stderr));
    }

    let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if title.is_empty() {
        warn!("yt-dlp returned empty title for {}", url);
        Ok("YouTube Video".to_string())
    } else {
        info!("Got video title: {}", title);
        Ok(title)
    }
}
