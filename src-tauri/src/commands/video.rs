use crate::managers::journal::{JournalEntry, JournalFolder, JournalManager, JournalRecordingResult};
use crate::managers::transcription::TranscriptionManager;
use log::{debug, info};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// Transcribe audio in chunks to avoid ORT errors with long audio.
/// Splits into 30-second segments at 16kHz (480,000 samples).
fn transcribe_chunked(
    transcription_manager: &TranscriptionManager,
    samples: Vec<f32>,
) -> Result<String, String> {
    const CHUNK_SIZE: usize = 16000 * 30; // 30 seconds at 16kHz

    if samples.len() <= CHUNK_SIZE {
        return transcription_manager
            .transcribe(samples)
            .map_err(|e| format!("Transcription failed: {}", e));
    }

    let total_chunks = (samples.len() + CHUNK_SIZE - 1) / CHUNK_SIZE;
    info!(
        "Transcribing {} samples in {} chunks of ~30s each",
        samples.len(),
        total_chunks
    );

    let mut parts: Vec<String> = Vec::new();
    for (i, chunk) in samples.chunks(CHUNK_SIZE).enumerate() {
        debug!("Transcribing chunk {}/{}", i + 1, total_chunks);
        let text = transcription_manager
            .transcribe(chunk.to_vec())
            .map_err(|e| format!("Transcription failed on chunk {}: {}", i + 1, e))?;
        let trimmed = text.trim().to_string();
        if !trimmed.is_empty() {
            parts.push(trimmed);
        }
    }

    Ok(parts.join(" "))
}

// --- yt-dlp management commands ---

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct YouTubeDownloadResult {
    pub title: String,
    pub transcription: String,
    pub file_name: String,
}

#[tauri::command]
#[specta::specta]
pub async fn check_ytdlp_installed(app: AppHandle) -> Result<bool, String> {
    crate::ytdlp::ytdlp_exists(&app)
}

#[tauri::command]
#[specta::specta]
pub async fn install_ytdlp(app: AppHandle) -> Result<(), String> {
    let version = crate::ytdlp::get_latest_version().await?;
    info!("Installing yt-dlp version {}", version);
    crate::ytdlp::download_ytdlp_binary(&app, &version).await
}

#[tauri::command]
#[specta::specta]
pub async fn download_youtube_audio(
    app: AppHandle,
    url: String,
    journal_manager: State<'_, Arc<JournalManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<YouTubeDownloadResult, String> {
    info!("[yt-dl] Step 1: Starting YouTube audio download for: {}", url);

    // Get video title
    let _ = app.emit("ytdlp-status", "fetching-title");
    let title = crate::ytdlp::get_video_title(&app, &url)
        .await
        .unwrap_or_else(|e| {
            log::warn!("[yt-dl] get_video_title failed (non-fatal): {}", e);
            "YouTube Video".to_string()
        });
    info!("[yt-dl] Step 2: Got title = '{}'", title);

    // Download audio to a temp file
    let _ = app.emit("ytdlp-status", "downloading");
    let temp_dir = std::env::temp_dir();
    let timestamp = chrono::Utc::now().timestamp();
    let temp_base = temp_dir.join(format!("mutter-yt-{}", timestamp));
    let temp_path_with_ext = temp_base.with_extension("m4a");
    info!(
        "[yt-dl] Step 3: Downloading audio to {}",
        temp_path_with_ext.display()
    );

    crate::ytdlp::download_audio(&app, &url, &temp_path_with_ext).await?;
    info!("[yt-dl] Step 4: yt-dlp download finished");

    // yt-dlp may produce a file with a slightly different name; find it
    let downloaded_file = if temp_path_with_ext.exists() {
        temp_path_with_ext.clone()
    } else {
        let parent = temp_base.parent().unwrap_or(&temp_dir);
        let base_stem = temp_base
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("mutter-yt");
        let mut found = None;
        if let Ok(entries) = std::fs::read_dir(parent) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with(base_stem) {
                    found = Some(entry.path());
                    break;
                }
            }
        }
        found.ok_or_else(|| "Downloaded audio file not found".to_string())?
    };
    info!(
        "[yt-dl] Step 5: Downloaded file = {}",
        downloaded_file.display()
    );

    // Extract audio from downloaded file using symphonia
    let _ = app.emit("ytdlp-status", "extracting");
    let file_path_str = downloaded_file.to_string_lossy().to_string();
    info!("[yt-dl] Step 6: Extracting audio from {}", file_path_str);
    let (samples, sample_rate) = extract_audio_from_video(&file_path_str)?;
    info!(
        "[yt-dl] Step 7: Extracted {} samples at {}Hz",
        samples.len(),
        sample_rate
    );

    // Resample to 16kHz mono if needed
    let target_rate = 16000u32;
    let resampled = if sample_rate != target_rate {
        let ratio = sample_rate as f64 / target_rate as f64;
        let new_len = (samples.len() as f64 / ratio) as usize;
        (0..new_len)
            .map(|i| {
                let src_idx = i as f64 * ratio;
                let idx = src_idx as usize;
                let frac = src_idx - idx as f64;
                let a = samples.get(idx).copied().unwrap_or(0.0);
                let b = samples.get(idx + 1).copied().unwrap_or(a);
                a + (b - a) * frac as f32
            })
            .collect::<Vec<f32>>()
    } else {
        samples
    };

    let samples_for_wav = resampled.clone();

    // Transcribe
    let _ = app.emit("ytdlp-status", "transcribing");
    transcription_manager.initiate_model_load();
    info!("[yt-dl] Step 8: Transcribing {} samples", resampled.len());

    let transcription = transcribe_chunked(&transcription_manager, resampled)?;
    info!(
        "[yt-dl] Step 9: Transcription complete ({} chars)",
        transcription.len()
    );

    // Save as 16kHz mono WAV in journal recordings dir
    let file_name = format!("mutter-yt-{}.wav", timestamp);
    let dest_path = journal_manager.effective_recordings_dir().join(&file_name);
    info!("[yt-dl] Step 10: Saving WAV to {}", dest_path.display());

    crate::audio_toolkit::save_wav_file(dest_path, &samples_for_wav)
        .await
        .map_err(|e| format!("Failed to save audio: {}", e))?;

    // Clean up temp file
    let _ = std::fs::remove_file(&downloaded_file);

    let _ = app.emit("ytdlp-status", "done");
    info!(
        "[yt-dl] DONE: '{}' ({} chars transcript)",
        title,
        transcription.len()
    );

    Ok(YouTubeDownloadResult {
        title,
        transcription,
        file_name,
    })
}

// --- Video file import (extract audio, transcribe) ---

fn extract_audio_from_video(file_path: &str) -> Result<(Vec<f32>, u32), String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(file_path)
        .map_err(|e| format!("Failed to open video file: {}", e))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
    {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Unsupported video format: {}. Supported formats: MP4, MKV, WebM, MP3.", e))?;

    let mut format = probed.format;

    // Find the first audio track
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or_else(|| "No audio track found in video file".to_string())?
        .clone();

    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| "Unknown sample rate in audio track".to_string())?;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Failed to create audio decoder: {}", e))?;

    let mut all_samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break; // EOF
            }
            Err(symphonia::core::errors::Error::ResetRequired) => {
                break;
            }
            Err(_) => break,
        };

        if packet.track_id() != track.id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        let num_channels = spec.channels.count();
        let mut sample_buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);

        let samples = sample_buf.samples();

        // Mix to mono if multichannel
        if num_channels > 1 {
            for frame in samples.chunks(num_channels) {
                let mono: f32 = frame.iter().sum::<f32>() / num_channels as f32;
                all_samples.push(mono);
            }
        } else {
            all_samples.extend_from_slice(samples);
        }
    }

    if all_samples.is_empty() {
        return Err("No audio data could be extracted from the video file".to_string());
    }

    info!(
        "Extracted {} audio samples at {}Hz from video",
        all_samples.len(),
        sample_rate
    );

    Ok((all_samples, sample_rate))
}

#[tauri::command]
#[specta::specta]
pub async fn import_video_for_journal(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    file_path: String,
) -> Result<JournalRecordingResult, String> {
    info!("Importing video file: {}", file_path);

    let src = std::path::Path::new(&file_path);
    if !src.exists() {
        return Err("Video file not found".to_string());
    }

    // Extract audio from video
    let (samples, sample_rate) = extract_audio_from_video(&file_path)?;

    // Resample to 16kHz mono if needed
    let target_rate = 16000u32;
    let resampled = if sample_rate != target_rate {
        let ratio = sample_rate as f64 / target_rate as f64;
        let new_len = (samples.len() as f64 / ratio) as usize;
        (0..new_len)
            .map(|i| {
                let src_idx = i as f64 * ratio;
                let idx = src_idx as usize;
                let frac = src_idx - idx as f64;
                let a = samples.get(idx).copied().unwrap_or(0.0);
                let b = samples.get(idx + 1).copied().unwrap_or(a);
                a + (b - a) * frac as f32
            })
            .collect::<Vec<f32>>()
    } else {
        samples
    };

    // Clone for WAV saving
    let samples_for_wav = resampled.clone();

    // Ensure model is loaded
    transcription_manager.initiate_model_load();

    // Transcribe
    let transcription = transcribe_chunked(&transcription_manager, resampled)?;

    // Save as 16kHz mono WAV in journal recordings dir
    let timestamp = chrono::Utc::now().timestamp();
    let file_name = format!("mutter-video-{}.wav", timestamp);
    let dest_path = journal_manager
        .effective_recordings_dir()
        .join(&file_name);

    crate::audio_toolkit::save_wav_file(dest_path, &samples_for_wav)
        .await
        .map_err(|e| format!("Failed to save extracted audio: {}", e))?;

    info!("Video import complete: {}", file_name);

    Ok(JournalRecordingResult {
        file_name,
        transcription_text: transcription,
    })
}

// --- Source-filtered queries ---

#[tauri::command]
#[specta::specta]
pub async fn get_video_entries(
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<Vec<JournalEntry>, String> {
    journal_manager
        .get_entries_by_source(Some("video"))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_video_folders(
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<Vec<JournalFolder>, String> {
    journal_manager
        .get_folders_by_source(Some("video"))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn create_video_folder(
    name: String,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<JournalFolder, String> {
    journal_manager
        .create_folder_with_source(name, "video".to_string())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn save_video_entry(
    app: AppHandle,
    file_name: String,
    title: String,
    transcription_text: String,
    source: String,
    source_url: Option<String>,
    folder_id: Option<i64>,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<JournalEntry, String> {
    let _ = &app; // used for state access
    journal_manager
        .save_entry_with_source(
            file_name,
            title,
            transcription_text,
            None,
            None,
            vec![],
            vec![],
            folder_id,
            source,
            source_url,
        )
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_audio_nonexistent_file() {
        let result = extract_audio_from_video("/nonexistent/file.mp4");
        assert!(result.is_err());
    }
}
