use crate::managers::audio::AudioRecordingManager;
use crate::managers::journal::{
    ChatMessage, ChatSession, JournalEntry, JournalFolder, JournalManager, JournalRecordingResult,
};
use crate::managers::transcription::TranscriptionManager;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Remove consecutively repeated words from text.
/// "your your your thing" → "your thing"
fn dedup_consecutive_words(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut prev_word_lower = String::new();
    let mut first = true;

    for word in text.split_whitespace() {
        let word_lower = word.to_lowercase();
        if word_lower != prev_word_lower || first {
            if !first {
                result.push(' ');
            }
            result.push_str(word);
            first = false;
        }
        prev_word_lower = word_lower;
    }

    result
}

#[tauri::command]
#[specta::specta]
pub async fn start_journal_recording(
    _app: AppHandle,
    recording_manager: State<'_, Arc<AudioRecordingManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<(), String> {
    // Initiate model load in background so it's ready when we stop
    transcription_manager.initiate_model_load();

    // Start recording with "journal" binding_id
    let started = recording_manager.try_start_recording("journal");
    if !started {
        return Err("Failed to start recording. Another recording may be in progress.".to_string());
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn stop_journal_recording(
    _app: AppHandle,
    recording_manager: State<'_, Arc<AudioRecordingManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<JournalRecordingResult, String> {
    let samples = recording_manager
        .stop_recording("journal")
        .ok_or_else(|| "No recording in progress or failed to stop recording".to_string())?;

    // Clone samples before transcription (transcribe takes ownership)
    let samples_for_wav = samples.clone();

    // Transcribe the audio
    let transcription = transcription_manager
        .transcribe(samples)
        .map_err(|e| format!("Transcription failed: {}", e))?;

    // Save WAV file immediately (temporary name; renamed to title-based on save_entry)
    let timestamp = chrono::Utc::now().timestamp();
    let file_name = format!("mutter-{}.wav", timestamp);
    let file_path = journal_manager.effective_recordings_dir().join(&file_name);

    crate::audio_toolkit::save_wav_file(file_path, &samples_for_wav)
        .await
        .map_err(|e| format!("Failed to save recording: {}", e))?;

    Ok(JournalRecordingResult {
        file_name,
        transcription_text: transcription,
    })
}

/// Get a partial transcription of the audio recorded so far (live transcription).
/// Returns the transcription text, or an empty string if no audio is available yet.
#[tauri::command]
#[specta::specta]
pub async fn get_partial_journal_transcription(
    _app: AppHandle,
    recording_manager: State<'_, Arc<AudioRecordingManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<String, String> {
    let samples = recording_manager
        .get_partial_samples()
        .ok_or_else(|| "No recording in progress".to_string())?;

    if samples.is_empty() {
        return Ok(String::new());
    }

    let transcription = transcription_manager
        .transcribe(samples)
        .map_err(|e| format!("Transcription failed: {}", e))?;

    Ok(transcription)
}

#[tauri::command]
#[specta::specta]
pub async fn discard_journal_recording(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    file_name: String,
) -> Result<(), String> {
    journal_manager
        .delete_recording_file(&file_name)
        .map_err(|e| format!("Failed to discard recording: {}", e))
}

#[tauri::command]
#[specta::specta]
pub async fn save_journal_entry(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    file_name: String,
    title: String,
    transcription_text: String,
    post_processed_text: Option<String>,
    post_process_prompt_id: Option<String>,
    tags: Vec<String>,
    linked_entry_ids: Vec<i64>,
    folder_id: Option<i64>,
) -> Result<JournalEntry, String> {
    journal_manager
        .save_entry(
            file_name,
            title,
            transcription_text,
            post_processed_text,
            post_process_prompt_id,
            tags,
            linked_entry_ids,
            folder_id,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_journal_entries(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<Vec<JournalEntry>, String> {
    journal_manager
        .get_entries_by_source(Some("voice"))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_journal_entry(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    id: i64,
) -> Result<Option<JournalEntry>, String> {
    journal_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_journal_entry(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    id: i64,
    title: String,
    tags: Vec<String>,
    linked_entry_ids: Vec<i64>,
    folder_id: Option<i64>,
    user_source: Option<String>,
) -> Result<(), String> {
    journal_manager
        .update_entry(id, title, tags, linked_entry_ids, folder_id, user_source.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_journal_entry(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    id: i64,
) -> Result<(), String> {
    journal_manager
        .delete_entry(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn apply_journal_post_process(
    app: AppHandle,
    text: String,
    prompt_id: String,
) -> Result<String, String> {
    let settings = crate::settings::get_settings(&app);

    // Find the prompt
    let prompt = settings
        .post_process_prompts
        .iter()
        .find(|p| p.id == prompt_id)
        .ok_or_else(|| "Prompt not found".to_string())?
        .clone();

    // Get provider (clone to own it across the await boundary)
    let provider = settings
        .active_post_process_provider()
        .ok_or_else(|| {
            "No post-processing provider configured. Set one up in the Post Process tab."
                .to_string()
        })?
        .clone();

    // Get API key
    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    // Get model
    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.is_empty() {
        return Err("No model configured for the post-processing provider.".to_string());
    }

    // Build the prompt with the text
    let processed_prompt = prompt.prompt.replace("${output}", &text);

    // Call LLM
    let result =
        crate::llm_client::send_chat_completion(&provider, api_key, &model, processed_prompt)
            .await
            .map_err(|e| format!("LLM call failed: {}", e))?;

    result.ok_or_else(|| "No response from LLM".to_string())
}

/// Run a prompt template against text using the configured LLM, without looking up a prompt by ID.
/// The prompt_text should contain ${output} as a placeholder for the text.
#[tauri::command]
#[specta::specta]
pub async fn apply_prompt_text_to_text(
    app: AppHandle,
    text: String,
    prompt_text: String,
) -> Result<String, String> {
    let settings = crate::settings::get_settings(&app);

    let provider = settings
        .active_post_process_provider()
        .ok_or_else(|| {
            "No post-processing provider configured. Set one up in the Post Process tab."
                .to_string()
        })?
        .clone();

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.is_empty() {
        return Err("No model configured for the post-processing provider.".to_string());
    }

    let processed_prompt = prompt_text.replace("${output}", &text);

    let result =
        crate::llm_client::send_chat_completion(&provider, api_key, &model, processed_prompt)
            .await
            .map_err(|e| format!("LLM call failed: {}", e))?;

    result.ok_or_else(|| "No response from LLM".to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_journal_post_processed_text(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    id: i64,
    text: String,
    prompt_id: String,
) -> Result<(), String> {
    journal_manager
        .update_post_processed_text(id, text, prompt_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_journal_audio_file_path(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    file_name: String,
    folder_id: Option<i64>,
) -> Result<String, String> {
    let path = journal_manager
        .get_audio_file_path_in_folder(&file_name, folder_id)
        .map_err(|e| e.to_string())?;
    path.to_str()
        .ok_or_else(|| "Invalid file path".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn retranscribe_journal_entry(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    id: i64,
) -> Result<String, String> {
    // Look up the entry to get its file_name and folder_id
    let entry = journal_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found".to_string())?;

    // Get the audio file path
    let file_path = journal_manager
        .get_audio_file_path_in_folder(&entry.file_name, entry.folder_id)
        .map_err(|e| e.to_string())?;

    // Read WAV file back into f32 samples
    let reader = hound::WavReader::open(&file_path)
        .map_err(|e| format!("Failed to read WAV file: {}", e))?;
    let samples: Vec<f32> = reader
        .into_samples::<i16>()
        .filter_map(|s| s.ok())
        .map(|s| s as f32 / i16::MAX as f32)
        .collect();

    // Ensure model is loaded
    transcription_manager.initiate_model_load();

    // Transcribe
    let transcription = transcription_manager
        .transcribe(samples)
        .map_err(|e| format!("Transcription failed: {}", e))?;

    // Update the entry's transcription text in DB (reset prompt_id and clear snapshots)
    journal_manager
        .update_transcription_text(id, transcription.clone(), None)
        .await
        .map_err(|e| e.to_string())?;
    journal_manager
        .clear_snapshots(id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(transcription)
}

#[tauri::command]
#[specta::specta]
pub async fn apply_prompt_to_journal_entry(
    app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    id: i64,
    prompt_id: String,
) -> Result<String, String> {
    // Get the entry
    let entry = journal_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found".to_string())?;

    // Apply post-processing (reuse existing logic)
    let processed =
        apply_journal_post_process(app, entry.transcription_text, prompt_id.clone()).await?;

    // Save snapshot of current text, then update with processed result
    journal_manager
        .apply_prompt_with_snapshot(id, processed.clone(), prompt_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(processed)
}

/// Apply a prompt to a journal entry using the prompt text directly (not by ID lookup).
/// Used by Mutter which stores its own prompts independently from Handy's settings.
#[tauri::command]
#[specta::specta]
pub async fn apply_prompt_text_to_journal_entry(
    app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    id: i64,
    prompt_text: String,
    prompt_label: String,
) -> Result<String, String> {
    let entry = journal_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found".to_string())?;

    let settings = crate::settings::get_settings(&app);

    let provider = settings
        .active_post_process_provider()
        .ok_or_else(|| {
            "No post-processing provider configured. Set one up in the Post Process tab."
                .to_string()
        })?
        .clone();

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.is_empty() {
        return Err("No model configured for the post-processing provider.".to_string());
    }

    // Programmatically remove consecutively repeated words before sending to LLM.
    // Local LLMs struggle with many duplicates (e.g. "your your your your ...").
    let mut clean_text = dedup_consecutive_words(&entry.transcription_text);

    // Substitute speaker names (e.g. [Speaker 1] → [Alice]) if available
    if let Ok(names) = journal_manager.get_speaker_names(id).await {
        for (speaker_id, name) in &names {
            if !name.is_empty() {
                clean_text =
                    clean_text.replace(&format!("[Speaker {}]", speaker_id), &format!("[{}]", name));
            }
        }
    }

    let processed_prompt = prompt_text.replace("${output}", &clean_text);

    let result =
        crate::llm_client::send_chat_completion(&provider, api_key, &model, processed_prompt)
            .await
            .map_err(|e| format!("LLM call failed: {}", e))?;

    let processed = result.ok_or_else(|| "No response from LLM".to_string())?;

    journal_manager
        .apply_prompt_with_snapshot(id, processed.clone(), prompt_label)
        .await
        .map_err(|e| e.to_string())?;

    Ok(processed)
}

#[tauri::command]
#[specta::specta]
pub async fn undo_journal_prompt(
    journal_manager: State<'_, Arc<JournalManager>>,
    id: i64,
    previous_prompt_id: Option<String>,
) -> Result<String, String> {
    journal_manager
        .undo_last_prompt(id, previous_prompt_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_journal_transcription_text(
    journal_manager: State<'_, Arc<JournalManager>>,
    id: i64,
    text: String,
) -> Result<(), String> {
    // Get current entry to preserve its prompt_id
    let entry = journal_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found".to_string())?;

    journal_manager
        .update_transcription_text(id, text, entry.post_process_prompt_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Update entry after async processing ---

#[tauri::command]
#[specta::specta]
pub async fn update_entry_after_processing(
    journal_manager: State<'_, Arc<JournalManager>>,
    id: i64,
    file_name: String,
    title: String,
    transcription_text: String,
) -> Result<(), String> {
    journal_manager
        .update_entry_after_processing(id, file_name, title, transcription_text)
        .await
        .map_err(|e| e.to_string())
}

// --- Import audio command ---

#[tauri::command]
#[specta::specta]
pub async fn import_audio_for_journal(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    file_path: String,
) -> Result<JournalRecordingResult, String> {
    use std::path::Path;

    let src = Path::new(&file_path);
    if !src.exists() {
        return Err("File not found".to_string());
    }

    // Read audio file into f32 samples
    let reader =
        hound::WavReader::open(src).map_err(|e| format!("Failed to read audio file: {}", e))?;
    let spec = reader.spec();
    let samples: Vec<f32> = match spec.sample_format {
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

    if samples.is_empty() {
        return Err("Audio file contains no samples".to_string());
    }

    // Resample to 16kHz mono if needed
    let target_rate = 16000u32;
    let mono_samples = if spec.channels > 1 {
        // Mix down to mono
        samples
            .chunks(spec.channels as usize)
            .map(|frame| frame.iter().sum::<f32>() / spec.channels as f32)
            .collect::<Vec<f32>>()
    } else {
        samples.clone()
    };

    let resampled = if spec.sample_rate != target_rate {
        // Simple linear resampling
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

    // Clone for WAV saving
    let samples_for_wav = resampled.clone();

    // Ensure model is loaded
    transcription_manager.initiate_model_load();

    // Transcribe
    let transcription = transcription_manager
        .transcribe(resampled)
        .map_err(|e| format!("Transcription failed: {}", e))?;

    // Copy to journal recordings dir with new name (temporary; renamed on save_entry)
    let timestamp = chrono::Utc::now().timestamp();
    let file_name = format!("mutter-import-{}.wav", timestamp);
    let dest_path = journal_manager.effective_recordings_dir().join(&file_name);

    // Save as 16kHz mono WAV
    crate::audio_toolkit::save_wav_file(dest_path, &samples_for_wav)
        .await
        .map_err(|e| format!("Failed to save imported audio: {}", e))?;

    Ok(JournalRecordingResult {
        file_name,
        transcription_text: transcription,
    })
}

// --- Chat command ---

#[tauri::command]
#[specta::specta]
pub async fn journal_chat(
    app: AppHandle,
    messages: Vec<(String, String)>, // (role, content) pairs
) -> Result<String, String> {
    let settings = crate::settings::get_settings(&app);

    let provider = settings
        .active_post_process_provider()
        .ok_or_else(|| {
            "No LLM provider configured. Set one up in the Post Process tab.".to_string()
        })?
        .clone();

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.is_empty() {
        return Err("No model configured for the LLM provider.".to_string());
    }

    let result = crate::llm_client::send_chat_messages(&provider, api_key, &model, messages)
        .await
        .map_err(|e| format!("Chat failed: {}", e))?;

    result.ok_or_else(|| "No response from LLM".to_string())
}

// --- Chat session commands ---

#[tauri::command]
#[specta::specta]
pub async fn create_chat_session(
    journal_manager: State<'_, Arc<JournalManager>>,
    entry_id: i64,
    mode: String,
) -> Result<ChatSession, String> {
    journal_manager
        .create_chat_session(entry_id, mode)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_chat_sessions(
    journal_manager: State<'_, Arc<JournalManager>>,
    entry_id: i64,
) -> Result<Vec<ChatSession>, String> {
    journal_manager
        .get_chat_sessions_for_entry(entry_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn save_chat_message(
    journal_manager: State<'_, Arc<JournalManager>>,
    session_id: i64,
    role: String,
    content: String,
) -> Result<ChatMessage, String> {
    journal_manager
        .save_chat_message(session_id, role, content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_chat_messages(
    journal_manager: State<'_, Arc<JournalManager>>,
    session_id: i64,
) -> Result<Vec<ChatMessage>, String> {
    journal_manager
        .get_chat_messages(session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_chat_session_title(
    journal_manager: State<'_, Arc<JournalManager>>,
    session_id: i64,
    title: String,
) -> Result<(), String> {
    journal_manager
        .update_chat_session_title(session_id, title)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_chat_session(
    journal_manager: State<'_, Arc<JournalManager>>,
    session_id: i64,
) -> Result<(), String> {
    journal_manager
        .delete_chat_session(session_id)
        .await
        .map_err(|e| e.to_string())
}

// --- Folder commands ---

#[tauri::command]
#[specta::specta]
pub async fn create_journal_folder(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    name: String,
) -> Result<JournalFolder, String> {
    journal_manager
        .create_folder(name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn rename_journal_folder(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    id: i64,
    name: String,
) -> Result<(), String> {
    journal_manager
        .rename_folder(id, name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_journal_folder(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    id: i64,
) -> Result<(), String> {
    journal_manager
        .delete_folder(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_journal_folders(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<Vec<JournalFolder>, String> {
    journal_manager
        .get_folders_by_source(Some("voice"))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn move_journal_entry_to_folder(
    _app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    entry_id: i64,
    folder_id: Option<i64>,
) -> Result<(), String> {
    journal_manager
        .move_entry_to_folder(entry_id, folder_id)
        .await
        .map_err(|e| e.to_string())
}

// --- Storage path commands ---

#[tauri::command]
#[specta::specta]
pub async fn get_journal_storage_path(
    app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
) -> Result<String, String> {
    let settings = crate::settings::get_settings(&app);
    let path = settings.journal_storage_path.unwrap_or_else(|| {
        journal_manager
            .recordings_dir()
            .to_string_lossy()
            .to_string()
    });
    Ok(path)
}

#[tauri::command]
#[specta::specta]
pub async fn set_journal_storage_path(
    app: AppHandle,
    journal_manager: State<'_, Arc<JournalManager>>,
    path: String,
) -> Result<(), String> {
    // Migrate existing files to new path
    journal_manager
        .migrate_storage(&path)
        .map_err(|e| format!("Failed to migrate files: {}", e))?;

    // Save the new path to settings
    let mut settings = crate::settings::get_settings(&app);
    settings.journal_storage_path = Some(path);
    crate::settings::write_settings(&app, settings);

    Ok(())
}
