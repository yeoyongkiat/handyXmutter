use crate::commands::video::transcribe_chunked;
use crate::diarize::{self, DiarizedSegment};
use crate::managers::journal::{JournalEntry, JournalFolder, JournalManager};
use crate::managers::transcription::TranscriptionManager;
use log::{info, warn};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

// --- Diarize model management ---

#[tauri::command]
#[specta::specta]
pub async fn check_diarize_models_installed(app: AppHandle) -> Result<bool, String> {
    diarize::models_installed(&app)
}

#[tauri::command]
#[specta::specta]
pub async fn install_diarize_models(app: AppHandle) -> Result<(), String> {
    diarize::install_models(&app).await
}

// --- Source-filtered CRUD (same pattern as video.rs) ---

#[tauri::command]
#[specta::specta]
pub async fn get_meeting_entries(
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<Vec<JournalEntry>, String> {
    journal_manager
        .get_entries_by_source(Some("meeting"))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_meeting_folders(
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<Vec<JournalFolder>, String> {
    journal_manager
        .get_folders_by_source(Some("meeting"))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn create_meeting_folder(
    name: String,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<JournalFolder, String> {
    journal_manager
        .create_folder_with_source(name, "meeting".to_string())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn save_meeting_entry(
    app: AppHandle,
    file_name: String,
    title: String,
    transcription_text: String,
    folder_id: Option<i64>,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<JournalEntry, String> {
    let _ = &app;
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
            "meeting".to_string(),
            None,
        )
        .await
        .map_err(|e| e.to_string())
}

// --- Diarized transcription (background processing after recording) ---

#[tauri::command]
#[specta::specta]
pub async fn transcribe_meeting(
    app: AppHandle,
    entry_id: i64,
    max_speakers: Option<usize>,
    threshold: Option<f32>,
    journal_manager: State<'_, Arc<JournalManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<(), String> {
    let max_speakers = max_speakers.unwrap_or(6);
    let threshold = threshold.unwrap_or(0.5);
    info!(
        "[meeting] Starting diarized transcription for entry {}",
        entry_id
    );

    // 1. Load entry to get file path
    let entry = journal_manager
        .get_entry_by_id(entry_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found".to_string())?;

    let file_path = journal_manager
        .get_audio_file_path_in_folder(&entry.file_name, entry.folder_id)
        .map_err(|e| e.to_string())?;

    if !file_path.exists() {
        return Err(format!("Audio file not found: {}", file_path.display()));
    }

    // 2. Read WAV file
    let _ = app.emit(
        "meeting-status",
        serde_json::json!({
            "entryId": entry_id,
            "stage": "loading",
        }),
    );

    let reader = hound::WavReader::open(&file_path)
        .map_err(|e| format!("Failed to read WAV file: {}", e))?;
    let spec = reader.spec();

    let raw_samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let bits = spec.bits_per_sample;
            reader
                .into_samples::<i32>()
                .filter_map(|s| s.ok())
                .map(move |s| s as f32 / (1_i64 << (bits - 1)) as f32)
                .collect()
        }
        hound::SampleFormat::Float => reader
            .into_samples::<f32>()
            .filter_map(|s| s.ok())
            .collect(),
    };

    // Mix to mono if multichannel
    let mono_samples = if spec.channels > 1 {
        raw_samples
            .chunks(spec.channels as usize)
            .map(|frame| frame.iter().sum::<f32>() / spec.channels as f32)
            .collect::<Vec<f32>>()
    } else {
        raw_samples
    };

    // Resample to 16kHz if needed
    let target_rate = 16000u32;
    let samples = if spec.sample_rate != target_rate {
        let ratio = spec.sample_rate as f64 / target_rate as f64;
        let new_len = (mono_samples.len() as f64 / ratio) as usize;
        (0..new_len)
            .map(|i| {
                let src_idx = i as f64 * ratio;
                let idx = src_idx as usize;
                let frac = src_idx - idx as f64;
                let a = mono_samples.get(idx).copied().unwrap_or(0.0);
                let b = mono_samples.get(idx + 1).copied().unwrap_or(a);
                a + (b - a) * frac as f32
            })
            .collect::<Vec<f32>>()
    } else {
        mono_samples
    };

    // 3. Run diarization
    let _ = app.emit(
        "meeting-status",
        serde_json::json!({
            "entryId": entry_id,
            "stage": "diarizing",
        }),
    );

    let seg_model = diarize::get_seg_model_path(&app)?;
    let emb_model = diarize::get_emb_model_path(&app)?;

    let raw_segments = diarize::diarize_audio(
        &samples,
        target_rate,
        &seg_model,
        &emb_model,
        max_speakers,
        threshold,
    )?;

    if raw_segments.is_empty() {
        warn!("[meeting] No speech segments found in audio");
        // Update entry with empty transcription
        journal_manager
            .update_entry_after_processing(entry_id, entry.file_name, entry.title, String::new())
            .await
            .map_err(|e| e.to_string())?;

        let _ = app.emit(
            "meeting-status",
            serde_json::json!({
                "entryId": entry_id,
                "stage": "done",
            }),
        );
        return Ok(());
    }

    // 4. Transcribe each segment
    let _ = app.emit(
        "meeting-status",
        serde_json::json!({
            "entryId": entry_id,
            "stage": "transcribing",
            "total": raw_segments.len(),
        }),
    );

    transcription_manager.initiate_model_load();

    let mut diarized_segments: Vec<DiarizedSegment> = Vec::new();
    let mut flat_lines: Vec<String> = Vec::new();

    for (i, seg) in raw_segments.iter().enumerate() {
        let _ = app.emit(
            "meeting-status",
            serde_json::json!({
                "entryId": entry_id,
                "stage": "transcribing",
                "current": i + 1,
                "total": raw_segments.len(),
            }),
        );

        let text = if seg.samples.is_empty() {
            String::new()
        } else {
            transcribe_chunked(&transcription_manager, seg.samples.clone()).unwrap_or_else(|e| {
                warn!("[meeting] Transcription failed for segment {}: {}", i, e);
                String::new()
            })
        };

        let trimmed = text.trim().to_string();

        if !trimmed.is_empty() {
            let speaker_label = seg
                .speaker
                .map(|s| format!("[Speaker {}]", s))
                .unwrap_or_else(|| "[Unknown]".to_string());

            flat_lines.push(format!("{} {}", speaker_label, trimmed));

            diarized_segments.push(DiarizedSegment {
                id: None,
                speaker: seg.speaker,
                start_ms: seg.start_ms,
                end_ms: seg.end_ms,
                text: trimmed,
            });
        }
    }

    let flat_text = flat_lines.join("\n");

    // 5. Save segments to DB
    journal_manager
        .save_meeting_segments(entry_id, &diarized_segments)
        .await
        .map_err(|e| e.to_string())?;

    // 6. Update entry with flattened transcription
    journal_manager
        .update_entry_after_processing(entry_id, entry.file_name, entry.title, flat_text)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "meeting-status",
        serde_json::json!({
            "entryId": entry_id,
            "stage": "done",
        }),
    );

    info!(
        "[meeting] Diarized transcription complete: {} segments for entry {}",
        diarized_segments.len(),
        entry_id
    );

    Ok(())
}

// --- Diarize any entry (video, voice, etc.) — adds speaker segments without replacing transcript ---

#[tauri::command]
#[specta::specta]
pub async fn diarize_entry(
    app: AppHandle,
    entry_id: i64,
    max_speakers: Option<usize>,
    threshold: Option<f32>,
    journal_manager: State<'_, Arc<JournalManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<(), String> {
    let max_speakers = max_speakers.unwrap_or(6);
    let threshold = threshold.unwrap_or(0.5);
    info!("[diarize] Starting diarization for entry {}", entry_id);

    let entry = journal_manager
        .get_entry_by_id(entry_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found".to_string())?;

    let file_path = journal_manager
        .get_audio_file_path_in_folder(&entry.file_name, entry.folder_id)
        .map_err(|e| e.to_string())?;

    if !file_path.exists() {
        return Err(format!("Audio file not found: {}", file_path.display()));
    }

    let _ = app.emit(
        "diarize-status",
        serde_json::json!({ "entryId": entry_id, "stage": "loading" }),
    );

    let reader = hound::WavReader::open(&file_path)
        .map_err(|e| format!("Failed to read WAV file: {}", e))?;
    let spec = reader.spec();

    let raw_samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let bits = spec.bits_per_sample;
            reader
                .into_samples::<i32>()
                .filter_map(|s| s.ok())
                .map(move |s| s as f32 / (1_i64 << (bits - 1)) as f32)
                .collect()
        }
        hound::SampleFormat::Float => reader
            .into_samples::<f32>()
            .filter_map(|s| s.ok())
            .collect(),
    };

    let mono_samples = if spec.channels > 1 {
        raw_samples
            .chunks(spec.channels as usize)
            .map(|frame| frame.iter().sum::<f32>() / spec.channels as f32)
            .collect::<Vec<f32>>()
    } else {
        raw_samples
    };

    let target_rate = 16000u32;
    let samples = if spec.sample_rate != target_rate {
        let ratio = spec.sample_rate as f64 / target_rate as f64;
        let new_len = (mono_samples.len() as f64 / ratio) as usize;
        (0..new_len)
            .map(|i| {
                let src_idx = i as f64 * ratio;
                let idx = src_idx as usize;
                let frac = src_idx - idx as f64;
                let a = mono_samples.get(idx).copied().unwrap_or(0.0);
                let b = mono_samples.get(idx + 1).copied().unwrap_or(a);
                a + (b - a) * frac as f32
            })
            .collect::<Vec<f32>>()
    } else {
        mono_samples
    };

    let _ = app.emit(
        "diarize-status",
        serde_json::json!({ "entryId": entry_id, "stage": "diarizing" }),
    );

    let seg_model = diarize::get_seg_model_path(&app)?;
    let emb_model = diarize::get_emb_model_path(&app)?;

    let raw_segments = diarize::diarize_audio(
        &samples,
        target_rate,
        &seg_model,
        &emb_model,
        max_speakers,
        threshold,
    )?;

    if raw_segments.is_empty() {
        warn!(
            "[diarize] No speech segments found for entry {} (audio file: {})",
            entry_id,
            file_path.display()
        );
        let _ = app.emit(
            "diarize-status",
            serde_json::json!({ "entryId": entry_id, "stage": "done" }),
        );
        return Ok(());
    }

    let _ = app.emit(
        "diarize-status",
        serde_json::json!({ "entryId": entry_id, "stage": "transcribing", "total": raw_segments.len() }),
    );

    transcription_manager.initiate_model_load();

    let mut diarized_segments: Vec<DiarizedSegment> = Vec::new();

    for (i, seg) in raw_segments.iter().enumerate() {
        let _ = app.emit(
            "diarize-status",
            serde_json::json!({
                "entryId": entry_id,
                "stage": "transcribing",
                "current": i + 1,
                "total": raw_segments.len(),
            }),
        );

        let text = if seg.samples.is_empty() {
            String::new()
        } else {
            transcribe_chunked(&transcription_manager, seg.samples.clone()).unwrap_or_else(|e| {
                warn!("[diarize] Transcription failed for segment {}: {}", i, e);
                String::new()
            })
        };

        let trimmed = text.trim().to_string();
        if !trimmed.is_empty() {
            diarized_segments.push(DiarizedSegment {
                id: None,
                speaker: seg.speaker,
                start_ms: seg.start_ms,
                end_ms: seg.end_ms,
                text: trimmed,
            });
        }
    }

    journal_manager
        .save_meeting_segments(entry_id, &diarized_segments)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "diarize-status",
        serde_json::json!({ "entryId": entry_id, "stage": "done" }),
    );

    info!(
        "[diarize] Complete: {} segments for entry {}",
        diarized_segments.len(),
        entry_id
    );

    Ok(())
}

// --- Meeting segment queries ---

#[tauri::command]
#[specta::specta]
pub async fn get_meeting_segments(
    entry_id: i64,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<Vec<DiarizedSegment>, String> {
    journal_manager
        .get_meeting_segments(entry_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_meeting_segment_text(
    segment_id: i64,
    text: String,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<(), String> {
    journal_manager
        .update_segment_text(segment_id, text)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_meeting_segment_speaker(
    segment_id: i64,
    speaker: Option<i32>,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<(), String> {
    journal_manager
        .update_segment_speaker(segment_id, speaker)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_meeting_speaker_name(
    entry_id: i64,
    speaker_id: i32,
    name: String,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<(), String> {
    journal_manager
        .update_speaker_name(entry_id, speaker_id, name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_meeting_speaker_names(
    entry_id: i64,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<std::collections::HashMap<String, String>, String> {
    journal_manager
        .get_speaker_names(entry_id)
        .await
        .map_err(|e| e.to_string())
}
