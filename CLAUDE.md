# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity

**handyXmutter** — a voice journal built on [Handy](https://github.com/cjpais/Handy). Fork lives at `yeoyongkiat/handyXmutter` on GitHub.

- **App identifier**: `com.handyxmutter.journal`
- **Rust crate**: `handyxmutter` / `handyxmutter_app_lib`
- **Binary**: `handyxmutter`
- **Remotes**: `origin` = `github.com/yeoyongkiat/handyXmutter`, `upstream` = `github.com/cjpais/Handy`
- **Updater plugin**: Rust-side plugin removed (was causing SIGABRT crash). Frontend `UpdateChecker` component also removed (was dead code). To re-enable updates: add back `tauri-plugin-updater` to Cargo.toml + lib.rs, create new UpdateChecker component, configure signing keys, set up update endpoint in tauri.conf.json, and publish signed artifacts to GitHub Releases.

## Development Commands

**Prerequisites:** [Rust](https://rustup.rs/) (latest stable), [Bun](https://bun.sh/)

```bash
# Install dependencies
bun install

# Run in development mode
bun run tauri dev
# If cmake error on macOS:
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri dev

# Build for production (.dmg)
bun run tauri build

# Linting and formatting (run before committing)
bun run lint              # ESLint for frontend
bun run lint:fix          # ESLint with auto-fix
bun run format            # Prettier + cargo fmt
bun run format:check      # Check formatting without changes
```

**Model Setup (Required for Development):**

```bash
mkdir -p src-tauri/resources/models
curl -o src-tauri/resources/models/silero_vad_v4.onnx https://blob.handy.computer/silero_vad_v4.onnx
```

## Architecture Overview

Handy is a cross-platform speech-to-text app built with Tauri 2.x (Rust backend + React/TypeScript frontend). Desktop (macOS/Windows/Linux) is fully functional. Android support is in progress — Phases 1-3 complete (compiles, launches, mobile-responsive UI), Phase 4 partially done (model download works on Android, audio recording backend pending).

### Backend Structure (src-tauri/src/)

- `lib.rs` - Main entry point, Tauri setup, manager initialization
- `managers/` - Core business logic:
  - `audio.rs` - Audio recording and device management
  - `model.rs` - Model downloading and management
  - `transcription.rs` - Speech-to-text processing pipeline
  - `history.rs` - Transcription history storage (SQLite via rusqlite)
  - `journal.rs` - Journal entries, folders, chat sessions (SQLite via rusqlite)
- `audio_toolkit/` - Low-level audio processing:
  - `audio/` - Device enumeration, recording, resampling
  - `vad/` - Voice Activity Detection (Silero VAD)
- `commands/` - Tauri command handlers for frontend communication
  - `journal.rs` - 28 journal commands + `dedup_consecutive_words()` utility + `update_entry_after_processing`
  - `video.rs` - Video feature commands (yt-dlp management, YouTube audio download, video import, source-filtered CRUD)
  - `meeting.rs` - Meeting/diarization commands (model management, diarized transcription, source-filtered CRUD, speaker names)
- `diarize.rs` - Speaker diarization via pyannote-rs (ONNX model download, segmentation, embedding, speaker assignment)
- `ytdlp.rs` - yt-dlp binary management (download/install binary, download audio, fetch video title via `tokio::process::Command`)
- `shortcut.rs` - Global keyboard shortcut handling
- `settings.rs` - Application settings management
- `llm_client.rs` - LLM API calls via any OpenAI-compatible API (BYOK — works with cloud providers and local LLMs like Ollama, LM Studio)

### Frontend Structure (src/)

- `App.tsx` - Main component with onboarding flow (mobile skips accessibility step)
- `components/settings/` - Settings UI (35+ files)
- `components/settings/journal/JournalSettings.tsx` - Journal UI: FoldersView, FolderDetailView, NewEntryView, RecordingView, DraftView, ImportingView, SearchResultsView, YouTubeInputView, WelcomeView (~2,500 lines after C1 split)
- `components/settings/journal/DetailView.tsx` - Extracted from JournalSettings: DetailView, DiarizedTranscriptView, DiarizedSegmentEditor, NomsEditor (~2,000 lines)
- `components/settings/journal/journalUtils.ts` - Shared types (ViewMode, EntrySource) and utilities (searchEntries, parseDateRange, speaker colors, formatMs)
- `components/mutter/MutterPanel.tsx` - Tab bar + content routing
- `components/mutter/MutterSettings.tsx` - Prompt customization + storage location picker
- `components/model-selector/` - Model management interface
- `components/onboarding/` - First-run experience
- `hooks/useSettings.ts`, `useModels.ts` - State management hooks
- `stores/settingsStore.ts` - Zustand store for settings
- `stores/mutterStore.ts` - Zustand store for journal cross-component state
- `lib/journal.ts` - Types, default prompts, command wrappers
- `lib/platform.ts` - Platform detection: `isMobile`, `isDesktop`, `isMacOS`, `isAndroid`, `isIOS` (uses `@tauri-apps/plugin-os`)
- `bindings.ts` - Auto-generated Tauri type bindings (via tauri-specta)
- `overlay/` - Recording overlay window code (desktop only)

### Key Patterns

**Manager Pattern:** Core functionality organized into managers (Audio, Model, Transcription, Journal) initialized at startup and managed via Tauri state.

**Command-Event Architecture:** Frontend → Backend via Tauri commands; Backend → Frontend via events.

**Pipeline Processing:** Audio → VAD → Whisper/Parakeet → Text output → Clipboard/Paste

**State Flow:** Zustand → Tauri Command → Rust State → Persistence (tauri-plugin-store)

## Internationalization (i18n)

All user-facing strings must use i18next translations. ESLint enforces this (no hardcoded strings in JSX).

**Adding new text:**

1. Add key to `src/i18n/locales/en/translation.json`
2. Use in component: `const { t } = useTranslation(); t('key.path')`

**File structure:**

```
src/i18n/
├── index.ts           # i18n setup
├── languages.ts       # Language metadata
└── locales/
    ├── en/translation.json  # English (source)
    ├── es/translation.json  # Spanish
    ├── fr/translation.json  # French
    └── vi/translation.json  # Vietnamese
```

## handyXmutter Journal Plugin

### UI Structure
- Sidebar has two modes (Handy / Mutter) with CSS transition animations between them
- Clicking the mutter logo at the bottom of Handy's sidebar switches to the Mutter sidebar
- Mutter sidebar shows the mutter logo at top, a file explorer with folders and journal entries, and Handy logo at bottom to switch back
- The content/preview panel shows a tab bar at top (Journal, URL, Meeting tabs)
- Cross-component state (sidebar ↔ content panel) managed via `src/stores/mutterStore.ts` (Zustand)

### Search
- Search bar above folders in the Mutter sidebar, shared with main panel via `searchQuery` in Zustand store
- Plain text: searches entry titles (case-insensitive)
- `@query`: searches folder names, shows entries in matching folders
- `#query`: searches tags
- `/s query`: searches by user_source field
- `::date`: searches by date — `today`, `yesterday`, `this week`, `last month`, `jan 2025`, `2025-01`, month names
- `[query]`: finds entries that link to entries whose title matches query
- `?` icon in search bar shows tooltip explaining syntax (rendered via React portal on document.body)
- Search results rendered as `SearchResultsView` in the main panel with `ViewMode = "search"`
- `searchEntries()` helper function in JournalSettings.tsx performs client-side filtering

### Navigation Model
- Folder-centric: Folders view → Folder detail → Entry detail
- Breadcrumb navigation at top of content panel (`Folders > folder > entry`)
- Linked entry traversal: clicking a linked entry appends to breadcrumb trail
- Tag navigation: clicking a tag chip shows all entries with that tag
- `ViewMode` discriminated union: `loading | welcome | folders | folder | new-entry | recording | draft | detail | tag | search | importing | youtube-input`
- Detail mode includes `trail: number[]` for linked entry history and `fromTag?: string` for tag-originated navigation

### Backend (src-tauri/src/)
- `managers/journal.rs` - JournalManager with `journal.db` (SQLite) and `journal_recordings/` directory
  - DB tables: `journal_entries`, `journal_folders`, `journal_chat_sessions`, `journal_chat_messages`, `meeting_segments`
  - 7 migrations: initial schema, folders/folder_id column, transcript_snapshots column, chat sessions/messages tables, source/source_url columns, meeting segments/speaker_names, user_source column
  - `journal_entries` has `source` column (`voice`, `youtube`, `video`, `meeting`) and optional `source_url`
  - `journal_entries` has `user_source` column (user-editable free-text source/reference field, searchable via `/s` prefix)
  - `journal_entries` has `speaker_names` column (JSON map of speaker_id → custom name, for meeting entries)
  - `journal_folders` has `source` column (`voice`, `video`, `meeting`) to separate journal, video, and meeting folders
  - Folders correspond to real filesystem directories inside `journal_recordings/`
- `commands/journal.rs` - 28 Tauri commands + `dedup_consecutive_words()` function
  - **Word dedup**: Programmatically removes consecutively repeated words before every LLM prompt call (local LLMs can't handle many repetitions)
- `commands/video.rs` - 8 Tauri commands for video feature
  - `check_ytdlp_installed`, `install_ytdlp` - yt-dlp binary management
  - `download_youtube_audio` - Downloads audio via yt-dlp, extracts via symphonia, transcribes in 30-second chunks, saves WAV. Returns `YouTubeDownloadResult { title, transcription, file_name }`
  - `import_video_for_journal` - Extracts audio from video files via symphonia, resamples to 16kHz mono, transcribes in chunks
  - `get_video_entries`, `get_video_folders`, `create_video_folder`, `save_video_entry` - Source-filtered CRUD
  - `transcribe_chunked()` helper - Splits long audio into 30-second segments to avoid Parakeet ORT errors
- `commands/meeting.rs` - 10 Tauri commands for meeting/diarization feature
  - `check_diarize_models_installed`, `install_diarize_models` - pyannote model management
  - `transcribe_meeting` - Diarized transcription pipeline (WAV → diarize → transcribe per segment → store)
  - `diarize_entry` - Adds speaker segments to any existing entry (video, meeting)
  - `get_meeting_entries`, `get_meeting_folders`, `create_meeting_folder`, `save_meeting_entry` - Source-filtered CRUD
  - `get_meeting_segments`, `update_meeting_speaker_name`, `get_meeting_speaker_names` - Segment/speaker queries
- `diarize.rs` - Speaker diarization via pyannote-rs (segmentation + embedding ONNX models, auto-downloaded to app data dir)

### Frontend (src/)
- `lib/journal.ts` - TypeScript types, `MUTTER_DEFAULT_PROMPTS`, `MUTTER_DEFAULT_CHAT_INSTRUCTIONS`, `getModelContextWindow()`, `journalCommands`, `videoCommands`, and `meetingCommands` wrappers
- `stores/mutterStore.ts` - Zustand store for `selectedEntryId`, `expandedFolderIds`, `searchQuery`, `promptOverrides`, `selectedVideoEntryId`, `selectedVideoFolderId`, `selectedMeetingEntryId`, `selectedMeetingFolderId`, `processingEntries` (tracks in-progress downloads/imports)
- `components/mutter/MutterPanel.tsx` - Tab bar (Journal + Video + Meeting) + content routing via `JournalSettingsWithStore`, `VideoSettingsWithStore`, and `MeetingSettingsWithStore`
- `components/mutter/MutterSettings.tsx` - Prompt customization with reset-to-default icons, storage location picker
- `components/settings/journal/JournalSettings.tsx` - Full journal/video UI with subcomponents:
  - `WelcomeView`, `FoldersView`, `FolderDetailView`, `NewEntryView`, `RecordingView`, `DraftView`, `ImportingView`, `SearchResultsView`
  - `FolderDetailView` includes ephemeral folder-level chat assistant (floating button, context built from folder entries)
  - `YouTubeInputView` - URL input for YouTube audio download
  - `DetailView` - Entry detail with inline editing, prompt pipeline, jots, chat history, chat assistant, diarized transcript view with JotterEditor per segment (meeting/video only), user_source field. Shows processing overlay for in-progress downloads/imports
  - `DiarizedTranscriptView` - Each segment uses a `JotterEditor` (TipTap WYSIWYG) for seamless inline editing with live markdown rendering. Speaker reassignment, rename, re-diarize controls shown post-transcription only
  - Parameterized by `source` prop (`"voice"` | `"video"` | `"meeting"`) — determines which commands to use and which new-entry flow to show

### Post-Processing Pipeline
- `MUTTER_DEFAULT_PROMPTS`: Clean → Structure → Organise → Report (sequential unlock)
- **Clean**: Fix spelling/punctuation, convert number words to digits, remove filler words, dedup repeated words
- **Structure**: Chunk into coherent paragraphs with double newlines
- **Organise**: Group paragraphs with sub-headers
- **Report**: Reported speech format with bullets and sub-headers
- Prompts customizable in MutterSettings with per-prompt reset-to-default icons
- Undo via `transcript_snapshots` stack in SQLite
- Backend `dedup_consecutive_words()` runs before every LLM call

### Chat Assistant ("mutter")
- 4 modes: Jotter (non-AI notepad), Retrieve, Sharpen, Brainstorm
- Persistent sessions stored in SQLite; create session lazily on first message
- Chat panel: sticky bottom, minimised height `h-[28rem]`, maximised `h-[80vh]`
- Auto-scroll uses `container.scrollTop = container.scrollHeight` (NOT `scrollIntoView` which scrolls the page)
- LLM responses: no shaded background box, paragraph spacing via `[&_p]:mb-3`
- Double-click session title to rename (title span has `onClick stopPropagation` to prevent parent click from firing)
- LLM-generated chat titles on first close; context window meter with auto-compaction at 80%
- Chat header breadcrumb "mutter" is clickable — resets chat state back to mode picker
- **Folder-level chat**: Ephemeral (non-persistent) chat in FolderDetailView. Floating button opens sticky chat panel. System prompt built client-side from folder context (name, entry count, date range, tags, entry titles + previews). Reuses `journal_chat` backend command.

### Key Patterns
- Journal commands registered in both `bindings.ts` and `lib/journal.ts`; frontend uses manual wrappers from `lib/journal.ts`
- Recording reuses Handy's AudioRecordingManager and TranscriptionManager with `"journal"` binding_id
- Post-processing reuses `crate::llm_client::send_chat_completion`; multi-turn chat uses `crate::llm_client::send_chat_messages`
- File explorer listens for `journal-updated` Tauri events for real-time updates
- Sidebar drag-and-drop uses mouse events (not HTML5 drag API — unreliable in Tauri WKWebView)
- **File naming**: `{title}.wav`, `{title}.md`, `{title} - Chat - {Mode} - {session_title}.md`, `{title} - Jot - {jot_title}.md`
- **Markdown file sync**: Transcript `.md` auto-written on save/edit/prompt apply/undo. Chat/jot `.md` on each message save. Files renamed/moved/deleted with entry.
- **Configurable storage path**: `journal_storage_path` in AppSettings; migration copies files on change
- Audio import: reads WAV (int16/int32/float), mixes to mono, resamples to 16kHz, transcribes, saves; `ImportingView` shows indeterminate progress bar

### Video Feature
- **Two entry points**: YouTube audio download + transcription, and local video file import
- **YouTube (yt-dlp)**: Downloads audio via yt-dlp binary (`-f bestaudio[ext=m4a]/bestaudio`), extracts with symphonia, resamples to 16kHz mono, transcribes in 30-second chunks, saves as WAV. yt-dlp binary auto-downloaded from GitHub Releases to `app_data_dir()`, ad-hoc code-signed on macOS. Entries have `source="youtube"`, `source_url` set to YouTube URL, and playable audio files.
- **yt-dlp events**: `ytdlp-download-progress` (binary install), `ytdlp-audio-progress` (download percentage), `ytdlp-status` (stage transitions: fetching-title → downloading → extracting → transcribing → done), `ytdlp-cancel` (user cancellation)
- **Video import**: Uses `symphonia` crate to extract audio from MP4/MKV/WebM containers (AAC, Vorbis, MP3, PCM codecs). Resamples to 16kHz mono, transcribes in chunks via TranscriptionManager, saves extracted audio as WAV. Entries have `source="video"`.
- **Processing persistence**: YouTube downloads and video imports create a pending entry immediately (empty fileName/transcription), navigate to DetailView, and process in the background. Progress tracked in `processingEntries` Zustand store. DetailView shows processing overlay with status and progress bar. JournalEntryCard shows spinner for in-progress entries. `update_entry_after_processing` backend command updates file_name, title, and transcription when done.
- **Shared infrastructure**: Video entries use the same `journal_entries`/`journal_folders` tables, same post-processing pipeline, same chat/jots system. Separated by `source` column filtering.
- **JournalSettings parameterized**: Accepts `source` prop (`"voice"` | `"video"` | `"meeting"`). Voice shows Record/Import Audio; Video shows YouTube URL input; Meeting shows record + import. All auto-diarize with 1 speaker default. Diarize controls only in post-transcription DetailView.
- **Important**: When creating entries with empty `file_name` (pending entries), `save_entry_with_source` must check `!file_name.is_empty() && src_path.is_file()` before rename — otherwise `root.join("")` resolves to the recordings directory itself and `fs::rename` fails with EINVAL.

### Meeting Feature (Speaker Diarization)
- **Third tab**: Meetings tab in MutterPanel alongside Journal and Video
- **Speaker diarization**: Uses `pyannote-rs` (native Rust, same `ort = 2.0.0-rc.10` as `transcribe-rs`) for speaker segmentation and embedding
- **ONNX models**: segmentation-3.0.onnx + wespeaker_en_voxceleb_CAM++.onnx, auto-downloaded to `app_data_dir()/diarize_models/` on first use. Download progress emitted via `diarize-download-progress` event
- **Pipeline**: Record audio → Stop → Save WAV → auto-diarize (1 speaker default, 0.5 threshold) → transcribe per segment → merge with speaker labels → store in `meeting_segments` table
- **Diarization parameters**: Configurable `max_speakers` (default 1, range 1-20) and `threshold` (default 0.5, range 0.0-1.0). Lower threshold = more speakers distinguished. Controls only shown post-transcription in DetailView when user toggles "Show speakers"
- **UX flow**: All entry types (YouTube URL, video import, meeting recording, meeting import) auto-diarize with 1 speaker default immediately after transcription. User can re-diarize with different parameters from the DetailView speaker controls
- **No diarization for journal tab**: Voice entries (journal tab) have no diarization UI
- **Diarize any entry**: `diarize_entry` command can add speaker segments to video/meeting entries without replacing transcript
- **DiarizedTranscriptView**: Each segment rendered with JotterEditor (TipTap WYSIWYG) for seamless inline editing — no separate edit mode. Speaker labels, timestamps, editable speaker names (stored in `speaker_names` JSON column). Re-diarize button with adjustable params shown above diarized content
- **Events**: `meeting-status` (stages: loading → diarizing → transcribing → done), `diarize-status` (same stages for `diarize_entry`)
- **Shared infrastructure**: Meeting entries use same `journal_entries`/`journal_folders` tables, same post-processing pipeline, same chat/jots system. Separated by `source="meeting"` filtering

This project uses **Tailwind CSS v4** with the `@tailwindcss/vite` plugin. Configuration is CSS-based, NOT via `tailwind.config.js`.

- All custom colors/tokens defined in `@theme` block in `src/App.css`
- `tailwind.config.js` exists as a legacy file but is **not used** by Tailwind v4
- Do NOT use `require()` in `tailwind.config.js` (project is ESM with `"type": "module"`)
- Dark mode colors are overridden via `@media (prefers-color-scheme: dark)` in `App.css`
- The `@tailwindcss/typography` plugin (v0.5.x) is NOT loaded in v4; `prose` classes have no effect — use custom Tailwind utility overrides instead (e.g., `[&_p]:mb-3`)

## Code Style

**Rust:**

- Run `cargo fmt` and `cargo clippy` before committing
- Handle errors explicitly (avoid unwrap in production)
- Use descriptive names, add doc comments for public APIs

**TypeScript/React:**

- Strict TypeScript, avoid `any` types
- Functional components with hooks
- Tailwind CSS for styling
- Path aliases: `@/` → `./src/`

## Commit Guidelines

Use conventional commits:

- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation
- `refactor:` code refactoring
- `chore:` maintenance

## CLI Parameters

handyXmutter supports command-line parameters on all platforms.

**Implementation files:**

- `src-tauri/src/cli.rs` - CLI argument definitions (clap derive)
- `src-tauri/src/main.rs` - Argument parsing before Tauri launch
- `src-tauri/src/lib.rs` - Applying CLI overrides (setup closure + single-instance callback)
- `src-tauri/src/signal_handle.rs` - `send_transcription_input()` reusable function

**Available flags:**

| Flag                     | Description                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `--toggle-transcription` | Toggle recording on/off on a running instance (via `tauri_plugin_single_instance`) |
| `--toggle-post-process`  | Toggle recording with post-processing on/off on a running instance                 |
| `--cancel`               | Cancel the current operation on a running instance                                 |
| `--start-hidden`         | Launch without showing the main window (tray icon still visible)                   |
| `--no-tray`              | Launch without the system tray icon (closing window quits the app)                 |
| `--debug`                | Enable debug mode with verbose (Trace) logging                                     |

## Debug Mode

Access debug features: `Cmd+Shift+D` (macOS) or `Ctrl+Shift+D` (Windows/Linux)

## Environment Notes

Binary paths (needed when shell profile isn't loaded, e.g., in Claude Code):
- **Bun**: `~/.bun/bin/bun`
- **Cargo/Rust**: `~/.cargo/bin/cargo`
- Use: `export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"` before running commands
- When running via Claude Code Bash tool, also include `/usr/bin:/usr/sbin:/bin:/sbin` in PATH (sandbox strips system paths)

## Platform Notes

- **macOS**: Metal acceleration, accessibility permissions required
- **Windows**: Vulkan acceleration, code signing
- **Linux**: OpenBLAS + Vulkan, limited Wayland support, overlay disabled by default
- **Android**: In progress — see [Android Port](#android-port) section below

## Android Port

### Status: Phases 1-3 Complete, Phase 4 In Progress

The app compiles for `aarch64-linux-android`, launches on the Android emulator, and displays a mobile-responsive UI. Model download works on Android. Desktop-only features (audio recording, transcription, diarization, global shortcuts, tray, overlay) are gated at compile time. The Android build currently supports: journal CRUD, folders, chat, history, LLM post-processing, settings, and model management.

**What works on Android today:**
- App launches and renders the model selection onboarding
- Model download/delete/select (full ModelManager available)
- Journal entry CRUD, folders, chat sessions, post-processing
- History entries, settings read/write
- Mobile-responsive sidebar (drawer pattern), touch events, viewport units

**What does NOT work on Android yet:**
- Audio recording (no Android audio backend — needs oboe-rs or Tauri mobile plugin)
- Transcription (TranscriptionManager gated — depends on transcribe-rs/ort ONNX)
- Video/YouTube download (yt-dlp subprocess execution not supported on Android)
- Meeting/diarization (pyannote-rs gated)
- Share intent handling (manifest filters declared but no Kotlin handler code)
- Runtime permission request UI for RECORD_AUDIO (manifest declares permission, no runtime prompt)

### Platform Conditional Compilation

Desktop-only code is gated with `#[cfg(not(any(target_os = "android", target_os = "ios")))]`. This applies to:

**Gated Rust modules** (not compiled on Android):
- `actions`, `audio_feedback`, `audio_toolkit`, `clipboard`, `diarize`, `input`, `overlay`, `shortcut`, `signal_handle`, `transcription_coordinator`, `tray`, `tray_i18n`, `utils`, `ytdlp`

**Gated command modules**: `audio`, `meeting`, `transcription`, `video`

**Cross-platform command modules**: `journal`, `history`, `models` (models has platform-conditional variants for commands that depend on TranscriptionManager)

**Gated commands in journal.rs**: `start_journal_recording`, `stop_journal_recording`, `get_partial_journal_transcription`, `retranscribe_journal_entry`, `import_audio_for_journal`

**Platform-conditional model commands** (in `commands/models.rs`):
- `delete_model`, `set_active_model` — desktop version uses TranscriptionManager to unload/load; mobile version just updates settings
- `get_transcription_model_status`, `is_model_loading` — desktop version queries TranscriptionManager; mobile version returns from settings/false

**Gated managers**: `audio`, `transcription`

**Cross-platform managers**: `journal`, `history`, `model` (ModelManager works on Android — uses reqwest/tar/flate2)

**Gated journal manager methods**: `save_meeting_segments()`, `get_meeting_segments()` (depend on `diarize::DiarizedSegment`)

**Gated history manager**: `save_transcription()` method (depends on `audio_toolkit::save_wav_file`)

**Gated plugins**: `single-instance`, `global-shortcut`, `autostart`, `macos-permissions`

**Specta bindings export**: Gated with `#[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]` — writing `../src/bindings.ts` fails on Android's read-only APK filesystem.

### Frontend Platform Detection

`src/lib/platform.ts` provides platform flags used throughout the frontend:
```typescript
import { platform } from "@tauri-apps/plugin-os";
export const isMobile = platform() === "android" || platform() === "ios";
export const isDesktop = !isMobile;
export const isMacOS = platform() === "macos";
export const isAndroid = platform() === "android";
```

**Where platform detection is used:**
- `App.tsx` — Mobile skips accessibility onboarding, skips audio device refresh, skips enigo/shortcuts init
- `App.tsx` — macOS-specific permission checks use dynamic `import("tauri-plugin-macos-permissions-api")`
- `Sidebar.tsx` — Mobile renders slide-out drawer instead of fixed sidebar
- `JournalSettings.tsx` — Desktop-only `onDragDropEvent` guards, pointer events for cross-platform DnD
- `AccessibilityOnboarding.tsx`, `AccessibilityPermissions.tsx` — Dynamic macOS permission imports

### Mobile UI Adaptations (Phase 2 completed)

- **Pointer Events**: All drag-and-drop uses Pointer Events API (`onPointerDown/pointermove/pointerup`) instead of mouse events — works on both touch and mouse
- **Touch visibility**: `@media (hover: none)` CSS override in `App.css` forces `group-hover:opacity-100` elements to always be visible on touch devices
- **Responsive sidebar**: Mobile uses a drawer pattern (slide-out with overlay backdrop); desktop keeps fixed 160px sidebar
- **Viewport units**: `h-screen` replaced with `h-dvh` (dynamic viewport height) throughout
- **Dynamic imports**: `tauri-plugin-macos-permissions-api` lazy-loaded only on macOS via `await import()`
- **Desktop-only guards**: `onDragDropEvent` wrapped with `if (!isDesktop) return`; `initializeEnigo`/`initializeShortcuts` behind `if (isDesktop)`
- **Clipboard error handling**: Try-catch with toast notification on failure

### Desktop-Only Dependencies (Cargo.toml)

These crates are under `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`:
- `cpal`, `rubato`, `rustfft`, `vad-rs` — audio recording/processing
- `enigo` — keyboard/mouse simulation
- `rdev` — global input hooks
- `rodio` — audio playback
- `symphonia` — audio extraction from video containers
- `transcribe-rs` — speech-to-text (Whisper/Parakeet/Moonshine)
- `pyannote-rs` — speaker diarization
- `handy-keys` — keyboard shortcut handling
- `tauri-plugin-autostart`, `tauri-plugin-global-shortcut`, `tauri-plugin-single-instance`, `tauri-plugin-macos-permissions`

Cross-platform deps: `reqwest` uses `rustls-tls` (not OpenSSL), `tar`/`flate2`/`futures-util` for model download.

All git dependencies pinned to specific commit hashes (no `branch` — `branch` + `rev` is ambiguous in Cargo.toml).

### Entry Points (lib.rs)

```rust
// Desktop: takes CLI args
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn run(cli_args: CliArgs) { run_inner(cli_args); }

// Mobile: no args, annotated with mobile_entry_point
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::mobile_entry_point]
pub fn run() { run_inner(CliArgs::default()); }
```

**Mobile command set** (registered in `collect_commands!` for mobile): journal CRUD (28 commands minus 5 recording/transcription), folders, chat, history, settings, model management (11 commands). Desktop has the full set including audio, video, meeting, transcription, shortcuts.

**Mobile init** (`initialize_core_logic_mobile`): Creates `HistoryManager`, `JournalManager`, and `ModelManager`. Desktop additionally creates `AudioRecordingManager`, `TranscriptionManager`, `TranscriptionCoordinator`.

### Android Manifest & Permissions

`src-tauri/gen/android/app/src/main/AndroidManifest.xml` declares:
- `INTERNET`, `ACCESS_NETWORK_STATE` — network access for model download + LLM API
- `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` — for future audio recording
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE` — for future background recording
- `POST_NOTIFICATIONS` — for recording indicator notification

Share intent filters declared for `text/plain`, `audio/*`, `video/*` — but no Kotlin handler code yet.

`RustWebChromeClient.kt` (Tauri-generated) auto-handles WebView-level `AUDIO_CAPTURE` permission requests.

### Capabilities (src-tauri/capabilities/)

- `default.json` — Cross-platform permissions (fs, store, dialog, opener, clipboard, log, os, process, shell)
- `desktop.json` — Desktop-only: `global-shortcut:*`, `macos-permissions:default`, `recording_overlay` window. Platforms: `["macOS", "windows", "linux"]`
- `mobile.json` — Mobile: `clipboard-manager:default`, `dialog:default`, `fs:default`, `opener:default`, `os:default`, `process:default`, `store:default`. Platforms: `["android", "iOS"]`

### Android Development Setup

**Prerequisites**: JDK 21+, Android SDK, Android NDK 27.0.12077973

**Emulator**: Pixel_9_API_35 AVD exists at `~/.android/avd/`. Launch via Android Studio or `emulator -avd Pixel_9_API_35`.

```bash
# Environment variables (absolute paths required — $HOME expansion fails in sandbox)
export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="/Users/yeoyongkiat/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.0.12077973"
export CC_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android24-clang"
export AR_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ar"

# Check compilation only (fast)
cargo check --target aarch64-linux-android --lib

# Build + deploy to connected emulator/device
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri android dev

# View app logs
adb logcat | grep -i "handyxmutter\|RustStdoutStderr\|panic"

# Take screenshot
adb shell screencap -p /sdcard/screenshot.png && adb pull /sdcard/screenshot.png /tmp/screenshot.png
```

NDK linker paths configured in `.cargo/config.toml` for all 4 Android targets (aarch64, armv7, i686, x86_64).

**Build check workflow**: Always verify all three targets compile after changes:
1. `cargo check --target aarch64-linux-android --lib` (Android)
2. `cargo check --lib` (desktop)
3. `bun run tsc --noEmit` (TypeScript)

### build.rs Notes

`build.rs` runs on the **host** machine, not the target. Use `CARGO_CFG_TARGET_OS` / `CARGO_CFG_TARGET_ARCH` env vars (not `#[cfg]` attributes) to check the compilation target. The Apple Intelligence bridge build is gated this way.

### Phase 4 Remaining Work (Android-Specific Features)

**Foreground service for audio recording** (CRITICAL for recording to work):
1. Create `AudioRecordingService.kt` in `src-tauri/gen/android/app/src/main/java/com/handyxmutter/journal/`
2. Declare `<service android:name=".AudioRecordingService" android:foregroundServiceType="microphone" />` in AndroidManifest.xml
3. Create notification channel for recording indicator
4. Implement Rust↔Android bridge via Tauri mobile plugin or JNI

**Android audio recording backend**:
- Desktop uses `cpal` (CoreAudio/WASAPI/ALSA) — zero Android support
- Options: `oboe-rs` (Android high-perf audio) behind `#[cfg(target_os = "android")]`, or Tauri mobile plugin bridge to Android MediaRecorder API
- Implement `AudioBackend` trait with desktop (cpal) and Android (oboe/MediaRecorder) implementations
- Wire up to existing `AudioRecordingManager` pattern

**ONNX transcription on Android**:
- `ort 2.0.0-rc.10` has theoretical Android support (NNAPI backend)
- Test with tiny Whisper model (~40MB) on emulator
- Pre-bundle tiny model in APK or download on first launch
- Models are 100MB-1.5GB — need download-on-demand with progress

**Share intent handler**:
- `AndroidManifest.xml` already has intent filters for text/audio/video
- Need Kotlin code in `MainActivity.kt` to handle `ACTION_SEND` intents
- Bridge received data to frontend via Tauri event (`share-received`)

**Runtime permission request UI**:
- `RECORD_AUDIO` declared in manifest but no runtime prompt
- Android 6.0+ requires runtime permission request before first use
- Add permission check/request flow in frontend before recording starts

### Android Port Plan Reference

Full audit and phased plan at: `.claude/plans/lucky-juggling-cookie.md`

### Android Gotchas

- **Specta bindings crash**: `specta_builder.export()` writes to `../src/bindings.ts` — fails on Android's read-only APK filesystem with `ReadOnlyFilesystem` error. Must gate with `#[cfg(not(android/ios))]`.
- **Port conflicts**: `tauri android dev` starts a Vite dev server on port 1420. Kill stale processes with `lsof -ti:1420 | xargs kill -9` before retrying.
- **`$HOME` expansion**: In Claude Code sandbox, `$HOME` may not expand properly. Use absolute paths for NDK env vars.
- **`branch` + `rev` in Cargo.toml**: Cannot have both — Cargo treats it as ambiguous. Use only `rev` for pinned git deps.
- **`build.rs` target detection**: Uses `CARGO_CFG_TARGET_OS` env var, NOT `#[cfg]` attributes (build.rs runs on host).
- **`#[tauri::mobile_entry_point]`**: Requires a 0-argument function — split desktop/mobile entry points.
- **OpenSSL cross-compile**: Won't work for Android — use `rustls-tls` feature for reqwest.
- **Emulator window focus**: After `tauri android dev`, the emulator window may be behind other windows. Use `adb shell dumpsys activity top` to verify app is running, `adb shell screencap` to take screenshots.

## Git Workflow

- Push only to `origin` (`yeoyongkiat/handyXmutter`), never `upstream`
- Sync with upstream: `git fetch upstream && git merge upstream/main`
