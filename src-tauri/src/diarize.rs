use futures_util::StreamExt;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

const SEGMENTATION_MODEL: &str = "segmentation-3.0.onnx";
const EMBEDDING_MODEL: &str = "wespeaker_en_voxceleb_CAM++.onnx";
const SEGMENTATION_URL: &str =
    "https://github.com/thewh1teagle/pyannote-rs/releases/download/v0.1.0/segmentation-3.0.onnx";
const EMBEDDING_URL: &str = "https://github.com/thewh1teagle/pyannote-rs/releases/download/v0.1.0/wespeaker_en_voxceleb_CAM%2B%2B.onnx";

/// A single diarized speech segment with speaker assignment and audio samples.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct DiarizedSegment {
    pub speaker: Option<i32>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

/// Result of diarization before transcription (internal use).
pub struct RawDiarizedSegment {
    pub speaker: Option<i32>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub samples: Vec<f32>,
}

fn get_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let models_dir = data_dir.join("diarize_models");
    Ok(models_dir)
}

fn segmentation_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_models_dir(app)?.join(SEGMENTATION_MODEL))
}

fn embedding_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_models_dir(app)?.join(EMBEDDING_MODEL))
}

pub fn models_installed(app: &AppHandle) -> Result<bool, String> {
    let seg = segmentation_model_path(app)?;
    let emb = embedding_model_path(app)?;
    Ok(seg.exists() && emb.exists())
}

async fn download_model(
    app: &AppHandle,
    url: &str,
    dest: &Path,
    label: &str,
) -> Result<(), String> {
    info!("Downloading diarize model '{}' from {}", label, url);

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create models directory: {}", e))?;
    }

    let client = reqwest::Client::builder()
        .user_agent("handyxmutter")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to download {}: {}", label, e))?
        .error_for_status()
        .map_err(|e| format!("Download failed for {}: {}", label, e))?;

    let total_size = response.content_length().unwrap_or(0);
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut file_bytes: Vec<u8> = Vec::with_capacity(total_size as usize);

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
        file_bytes.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let progress = (downloaded as f64 / total_size as f64 * 100.0) as u32;
            let _ = app.emit(
                "diarize-download-progress",
                serde_json::json!({
                    "label": label,
                    "progress": progress,
                }),
            );
        }
    }

    std::fs::write(dest, &file_bytes).map_err(|e| format!("Failed to write model file: {}", e))?;

    info!(
        "Downloaded diarize model '{}' ({} bytes)",
        label,
        file_bytes.len()
    );
    Ok(())
}

pub async fn install_models(app: &AppHandle) -> Result<(), String> {
    let seg_path = segmentation_model_path(app)?;
    let emb_path = embedding_model_path(app)?;

    if !seg_path.exists() {
        download_model(app, SEGMENTATION_URL, &seg_path, "segmentation").await?;
    }
    if !emb_path.exists() {
        download_model(app, EMBEDDING_URL, &emb_path, "embedding").await?;
    }

    let _ = app.emit(
        "diarize-download-progress",
        serde_json::json!({
            "label": "done",
            "progress": 100,
        }),
    );

    Ok(())
}

/// Run speaker diarization on f32 audio samples at the given sample rate.
/// Returns segments with speaker IDs and the audio samples for each segment.
pub fn diarize_audio(
    samples: &[f32],
    sample_rate: u32,
    seg_model: &Path,
    emb_model: &Path,
    max_speakers: usize,
    threshold: f32,
) -> Result<Vec<RawDiarizedSegment>, String> {
    // pyannote-rs expects i16 samples
    let i16_samples: Vec<i16> = samples
        .iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
        .collect();

    // Get speech segments
    let segments_iter = pyannote_rs::get_segments(&i16_samples, sample_rate, seg_model)
        .map_err(|e| format!("Segmentation failed: {}", e))?;

    let segments: Vec<pyannote_rs::Segment> = segments_iter
        .filter_map(|s| match s {
            Ok(seg) => Some(seg),
            Err(e) => {
                warn!("Skipping segment due to error: {}", e);
                None
            }
        })
        .collect();

    if segments.is_empty() {
        return Ok(vec![]);
    }

    info!("Diarization found {} speech segments", segments.len());

    // Initialize speaker embedding extractor and manager
    let mut extractor = pyannote_rs::EmbeddingExtractor::new(emb_model)
        .map_err(|e| format!("Failed to create embedding extractor: {}", e))?;
    let mut manager = pyannote_rs::EmbeddingManager::new(max_speakers);

    let mut result = Vec::with_capacity(segments.len());

    for segment in &segments {
        // Compute speaker embedding
        let embedding: Vec<f32> = extractor
            .compute(&segment.samples)
            .map_err(|e| format!("Embedding computation failed: {}", e))?
            .collect();

        // Assign speaker
        let speaker_id = if manager.get_all_speakers().len() >= max_speakers {
            manager
                .get_best_speaker_match(embedding.clone())
                .unwrap_or(0)
        } else {
            manager.search_speaker(embedding, threshold).unwrap_or(0)
        };

        // Convert i16 segment samples back to f32 for transcription
        let f32_samples: Vec<f32> = segment
            .samples
            .iter()
            .map(|&s| s as f32 / i16::MAX as f32)
            .collect();

        result.push(RawDiarizedSegment {
            speaker: Some(speaker_id as i32),
            start_ms: (segment.start * 1000.0) as i64,
            end_ms: (segment.end * 1000.0) as i64,
            samples: f32_samples,
        });
    }

    info!(
        "Diarization complete: {} segments, {} speakers detected",
        result.len(),
        manager.get_all_speakers().len()
    );

    Ok(result)
}

/// Get the segmentation model path (for use in commands).
pub fn get_seg_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    segmentation_model_path(app)
}

/// Get the embedding model path (for use in commands).
pub fn get_emb_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    embedding_model_path(app)
}
