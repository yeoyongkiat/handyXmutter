# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity

**handyXmutter** — a voice journal built on [Handy](https://github.com/cjpais/Handy). Fork lives at `yeoyongkiat/handyXmutter` on GitHub.

- **App identifier**: `com.handyxmutter.journal`
- **Rust crate**: `handyxmutter` / `handyxmutter_app_lib`
- **Binary**: `handyxmutter`
- **Remotes**: `origin` = `github.com/yeoyongkiat/handyXmutter`, `upstream` = `github.com/cjpais/Handy`
- **Updater plugin**: Rust-side plugin removed (was causing SIGABRT crash). Frontend `UpdateChecker` component still exists in UI but is non-functional (`check()` calls fail silently). To re-enable, need to: add back `tauri-plugin-updater` to Cargo.toml + lib.rs, configure signing keys, set up update endpoint in tauri.conf.json, and publish signed artifacts to GitHub Releases.

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

Handy is a cross-platform desktop speech-to-text app built with Tauri 2.x (Rust backend + React/TypeScript frontend).

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
- `ytdlp.rs` - yt-dlp binary management (download/install binary, download audio, fetch video title via `tokio::process::Command`)
- `shortcut.rs` - Global keyboard shortcut handling
- `settings.rs` - Application settings management
- `llm_client.rs` - LLM API calls via any OpenAI-compatible API (BYOK — works with cloud providers and local LLMs like Ollama, LM Studio)

### Frontend Structure (src/)

- `App.tsx` - Main component with onboarding flow
- `components/settings/` - Settings UI (35+ files)
- `components/settings/journal/JournalSettings.tsx` - Full journal UI (DetailView, FoldersView, etc.)
- `components/mutter/MutterPanel.tsx` - Tab bar + content routing
- `components/mutter/MutterSettings.tsx` - Prompt customization + storage location picker
- `components/model-selector/` - Model management interface
- `components/onboarding/` - First-run experience
- `hooks/useSettings.ts`, `useModels.ts` - State management hooks
- `stores/settingsStore.ts` - Zustand store for settings
- `stores/mutterStore.ts` - Zustand store for journal cross-component state
- `lib/journal.ts` - Types, default prompts, command wrappers
- `bindings.ts` - Auto-generated Tauri type bindings (via tauri-specta)
- `overlay/` - Recording overlay window code

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
- The content/preview panel shows a tab bar at top (Journal tab, Video tab)
- Cross-component state (sidebar ↔ content panel) managed via `src/stores/mutterStore.ts` (Zustand)

### Search
- Search bar above folders in the Mutter sidebar, shared with main panel via `searchQuery` in Zustand store
- Plain text: searches entry titles (case-insensitive)
- `@query`: searches folder names, shows entries in matching folders
- `#query`: searches tags
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
  - 6 migrations: initial schema, folders/folder_id column, transcript_snapshots column, chat sessions/messages tables, source/source_url columns, meeting segments/speaker_names
  - `journal_entries` has `source` column (`voice`, `youtube`, `video`, `meeting`) and optional `source_url`
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

### Frontend (src/)
- `lib/journal.ts` - TypeScript types, `MUTTER_DEFAULT_PROMPTS`, `MUTTER_DEFAULT_CHAT_INSTRUCTIONS`, `getModelContextWindow()`, `journalCommands` and `videoCommands` wrappers
- `stores/mutterStore.ts` - Zustand store for `selectedEntryId`, `expandedFolderIds`, `searchQuery`, `promptOverrides`, `selectedVideoEntryId`, `selectedVideoFolderId`, `processingEntries` (tracks in-progress downloads/imports)
- `components/mutter/MutterPanel.tsx` - Tab bar (Journal + Video) + content routing via `JournalSettingsWithStore` and `VideoSettingsWithStore`
- `components/mutter/MutterSettings.tsx` - Prompt customization with reset-to-default icons, storage location picker
- `components/settings/journal/JournalSettings.tsx` - Full journal/video UI with subcomponents:
  - `WelcomeView`, `FoldersView`, `FolderDetailView`, `NewEntryView`, `RecordingView`, `DraftView`, `ImportingView`, `SearchResultsView`
  - `VideoNewEntryView` - Two cards: YouTube (download audio + transcribe via yt-dlp) and Import Video (extract audio + transcribe)
  - `YouTubeInputView` - URL input for YouTube audio download
  - `DetailView` - Entry detail with inline editing, prompt pipeline, jots, chat history, chat assistant. Shows processing overlay for in-progress downloads/imports
  - Parameterized by `source` prop (`"voice"` | `"video"`) — determines which commands to use and which new-entry flow to show

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
- **JournalSettings parameterized**: Accepts `source` prop (`"voice"` | `"video"` | `"meeting"`). Voice shows Record/Import Audio; Video shows YouTube/Import Video; Meeting shows model setup + record. All folder/entry management is identical.
- **Important**: When creating entries with empty `file_name` (pending entries), `save_entry_with_source` must check `!file_name.is_empty() && src_path.is_file()` before rename — otherwise `root.join("")` resolves to the recordings directory itself and `fs::rename` fails with EINVAL.

### Meeting Feature (Speaker Diarization)
- **Third tab**: Meetings tab in MutterPanel alongside Journal and Video
- **Speaker diarization**: Uses `pyannote-rs` (native Rust, same `ort = 2.0.0-rc.10` as `transcribe-rs`) for speaker segmentation and embedding
- **Pipeline**: Record audio → Stop → Save WAV → pyannote-rs segments → transcribe-rs per segment → merge with speaker labels → store
- **

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

## Git Workflow

- Push only to `origin` (`yeoyongkiat/handyXmutter`), never `upstream`
- Sync with upstream: `git fetch upstream && git merge upstream/main`
