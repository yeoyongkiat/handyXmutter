use anyhow::Result;
use std::path::Path;

/// Save audio samples as a WAV file.
/// Delegates to the cross-platform `audio_save` module.
pub async fn save_wav_file<P: AsRef<Path>>(file_path: P, samples: &[f32]) -> Result<()> {
    crate::audio_save::save_wav_file(file_path, samples).await
}
