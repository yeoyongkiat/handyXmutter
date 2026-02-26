#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod audio;
pub mod history;
pub mod journal;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod model;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod transcription;
