//! Cloud-based audio transcription via Whisper-compatible APIs.
//!
//! Used on mobile where native ONNX transcription is not yet available.
//! Sends WAV audio to a provider's `/v1/audio/transcriptions` endpoint
//! (OpenAI Whisper API format, supported by OpenAI, Groq, Together, etc.).

use crate::settings::{get_settings, PostProcessProvider};
use log::{debug, info};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use reqwest::multipart;
use serde::Deserialize;
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
struct TranscriptionResponse {
    text: String,
}

/// Transcribe a WAV file using the user's configured post-processing API provider.
/// Uses the Whisper API format: POST /v1/audio/transcriptions with multipart form data.
///
/// Returns the transcription text, or an error if the API call fails or no provider is configured.
pub async fn transcribe_audio_cloud(app: &AppHandle, wav_path: &str) -> Result<String, String> {
    let settings = get_settings(app);

    let provider = settings
        .post_process_providers
        .iter()
        .find(|p| p.id == settings.post_process_provider_id)
        .ok_or_else(|| "No post-processing provider configured".to_string())?
        .clone();

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if api_key.is_empty() {
        return Err(
            "No API key configured for transcription. Set one in Mutter Settings.".to_string(),
        );
    }

    transcribe_with_provider(&provider, &api_key, wav_path).await
}

async fn transcribe_with_provider(
    provider: &PostProcessProvider,
    api_key: &str,
    wav_path: &str,
) -> Result<String, String> {
    let base_url = provider.base_url.trim_end_matches('/');
    let url = format!("{}/audio/transcriptions", base_url);

    debug!("Sending audio transcription request to: {}", url);

    let mut headers = HeaderMap::new();
    if !api_key.is_empty() {
        if provider.id == "anthropic" {
            // Anthropic doesn't have a Whisper API — can't transcribe
            return Err("Anthropic does not support audio transcription. Please use OpenAI, Groq, or another Whisper-compatible provider.".to_string());
        }
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", api_key))
                .map_err(|e| format!("Invalid API key: {}", e))?,
        );
    }

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    // Read the WAV file
    let wav_bytes =
        std::fs::read(wav_path).map_err(|e| format!("Failed to read WAV file: {}", e))?;

    let file_name = std::path::Path::new(wav_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Build multipart form
    let file_part = multipart::Part::bytes(wav_bytes)
        .file_name(file_name)
        .mime_str("audio/wav")
        .map_err(|e| format!("Failed to create file part: {}", e))?;

    let form = multipart::Form::new()
        .part("file", file_part)
        .text("model", "whisper-1")
        .text("response_format", "json");

    let response = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Transcription API request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Transcription API returned status {}: {}",
            status, body
        ));
    }

    let result: TranscriptionResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse transcription response: {}", e))?;

    info!("Cloud transcription complete: {} chars", result.text.len());

    Ok(result.text)
}
