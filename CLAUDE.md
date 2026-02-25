# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Prerequisites:** [Rust](https://rustup.rs/) (latest stable), [Bun](https://bun.sh/)

```bash
# Install dependencies
bun install

# Run in development mode
bun run tauri dev
# If cmake error on macOS:
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri dev

# Build for production
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
  - `history.rs` - Transcription history storage
- `audio_toolkit/` - Low-level audio processing:
  - `audio/` - Device enumeration, recording, resampling
  - `vad/` - Voice Activity Detection (Silero VAD)
- `commands/` - Tauri command handlers for frontend communication
- `shortcut.rs` - Global keyboard shortcut handling
- `settings.rs` - Application settings management

### Frontend Structure (src/)

- `App.tsx` - Main component with onboarding flow
- `components/settings/` - Settings UI (35+ files)
- `components/model-selector/` - Model management interface
- `components/onboarding/` - First-run experience
- `hooks/useSettings.ts`, `useModels.ts` - State management hooks
- `stores/settingsStore.ts` - Zustand store for settings
- `bindings.ts` - Auto-generated Tauri type bindings (via tauri-specta)
- `overlay/` - Recording overlay window code

### Key Patterns

**Manager Pattern:** Core functionality organized into managers (Audio, Model, Transcription) initialized at startup and managed via Tauri state.

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

## Mutter Plugin

Mutter is a branded journal plugin built on top of Handy. It lives in the same codebase (fork: `yeoyongkiat/Handy`) and reuses Handy's audio recording, transcription, and post-processing pipeline.

**Git workflow:** `origin` = fork, `upstream` = `cjpais/Handy`. Sync upstream with `git fetch upstream && git merge upstream/main`.

### Mutter Architecture

**UI structure:**
- Sidebar has two modes (Handy / Mutter) with CSS transition animations between them
- Clicking the mutter logo at the bottom of Handy's sidebar switches to the Mutter sidebar
- Mutter sidebar shows the mutter logo at top, a file explorer with folders and journal entries, and Handy logo at bottom to switch back
- The content/preview panel shows a tab bar at top (Journal tab, extensible for future features like Minutes)
- Cross-component state (sidebar ↔ content panel) managed via `src/stores/mutterStore.ts` (Zustand)

**Search:**
- Search bar above folders in the Mutter sidebar, shared with main panel via `searchQuery` in Zustand store
- Plain text: searches entry titles (case-insensitive)
- `@query`: searches folder names, shows entries in matching folders
- `#query`: searches tags
- `[query]`: finds entries that link to entries whose title matches query
- `?` icon in search bar shows tooltip explaining syntax
- Search results rendered as `SearchResultsView` in the main panel with `ViewMode = "search"`
- `searchEntries()` helper function in JournalSettings.tsx performs client-side filtering

**Navigation model:**
- Folder-centric: Folders view → Folder detail → Entry detail
- Breadcrumb navigation at top of content panel (`Folders > folder > entry`)
- Linked entry traversal: clicking a linked entry appends to breadcrumb trail (`Folders > folder > A > B > C`)
- Tag navigation: clicking a tag chip shows all entries with that tag (`Folders > folder > A > [tag badge]`)
- Navigating from tag view to entry: `Folders > folder > A > [tag badge] > B`
- `ViewMode` discriminated union tracks navigation state: `loading | welcome | folders | folder | new-entry | recording | draft | detail | tag | search`
- Detail mode includes `trail: number[]` for linked entry history and `fromTag?: string` for tag-originated navigation

**Backend files (src-tauri/src/):**
- `managers/journal.rs` - JournalManager with `journal.db` (SQLite) and `journal_recordings/` directory
  - DB tables: `journal_entries` (id, file_name, timestamp, title, transcription_text, post_processed_text, post_process_prompt_id, tags JSON, linked_entry_ids JSON, folder_id FK, transcript_snapshots JSON), `journal_folders` (id, name, created_at), `journal_chat_sessions` (id, entry_id FK, mode, title, created_at, updated_at), `journal_chat_messages` (id, session_id FK, role, content, created_at)
  - 4 migrations: initial schema, folders/folder_id column, transcript_snapshots column, chat sessions/messages tables
  - Folders correspond to real filesystem directories inside `journal_recordings/`
  - Moving entries between folders moves the WAV file on disk
  - `update_transcription_text` method for re-transcribe and manual edits (preserves prompt_id)
  - `apply_prompt_with_snapshot` pushes current text to snapshot stack before applying prompt
  - `undo_last_prompt` pops last snapshot to restore previous text
  - `clear_snapshots` resets snapshot stack (called on re-transcribe)
- `commands/journal.rs` - 28 Tauri commands: start/stop/discard recording, CRUD entries, post-processing, audio file path, CRUD folders, move entry to folder, retranscribe, apply prompt, undo prompt, update transcription text, chat, CRUD chat sessions/messages, import audio, get/set storage path
- `llm_client.rs` - Added `send_chat_messages` for multi-turn chat (role/content tuple pairs)

**Frontend files (src/):**
- `lib/journal.ts` - TypeScript types (`JournalEntry` with `transcript_snapshots`, `JournalFolder`, `JournalRecordingResult`, `ChatSession`, `ChatMessage`), `MUTTER_DEFAULT_PROMPTS` (Clean/Structure/Organise/Report), `getModelContextWindow()` for dynamic context window lookup by model name, and `invoke` wrappers for all 26 commands
- `stores/mutterStore.ts` - Zustand store for `selectedEntryId`, `expandedFolderIds`, `toggleFolder`
- `components/mutter/MutterPanel.tsx` - Tab bar + content routing; auto-injects `MUTTER_DEFAULT_PROMPTS` into Handy's post_process_prompts on mount
- `components/settings/journal/JournalSettings.tsx` - Full journal UI with subcomponents:
  - `WelcomeView` - First-run folder creation prompt
  - `FoldersView` - Grid of folders with inline rename/delete
  - `FolderDetailView` - Entry list within a folder
  - `NewEntryView` - Record or Import audio choice screen (file dialog + drag-and-drop WAV)
  - `RecordingView` - Recording in progress with timer
  - `DraftView` - New entry form (title, transcription, post-processing, tags, linked entries, folder selector)
  - `DetailView` - Entry detail with:
    - Inline editing: click-to-edit title, editable transcript with 500ms debounced auto-save
    - Tag/link dropdowns with outside-click dismissal
    - Sequential prompt pipeline: `Re-transcribe | Clean > Structure > Organise > Report` with unlock logic (Clean first, then Structure, then Organise, then Report)
    - Undo: click last active prompt badge to restore previous transcript from snapshot stack
    - **Jots section**: Non-AI markdown notepad sessions displayed between transcription box and chat history
    - **Chat history section**: Persistent AI chat sessions (Retrieve, Sharpen, Brainstorm) displayed below jots
    - Chat assistant "mutter": FAB button opens expandable panel with 4 modes (Jotter, Retrieve, Sharpen, Brainstorm)
    - Persistent chat: sessions and messages stored in SQLite, resumed on click
    - Context window meter: token usage bar with model name, auto-compaction at 80%, clickable for custom limit override
    - Dynamic context window detection via `getModelContextWindow()` (supports Gemma, Gemini, GPT, Claude, Llama, Mixtral, Mistral, Qwen, DeepSeek, Phi, Command-R)
    - LLM-generated chat titles on first close; inline rename via double-click
    - Auto-growing chat textarea with send button
    - Markdown rendering with custom code component for tag badges
  - `JournalEntryCard` - Reusable entry list item
  - `FolderCreateButton` - Inline folder creation in breadcrumb action area
  - `MutterButton` - Baby blue themed button component
- `assets/mutter-logo.png` - Mutter branding logo

**Modified Handy files:**
- `Sidebar.tsx` - Extended `SidebarSection` type with `"mutter"`, dual-panel sidebar with transitions. MutterFileExplorer component shows collapsible folders with entry counts, drag-and-drop entries into folders, inline folder create/rename/delete
- `App.tsx` - Conditional rendering: MutterPanel for mutter section, standard settings for Handy sections
- `App.css` - Added `--color-mutter-primary` CSS custom property (light: `#5ba8c8`, dark: `#5dade2`)
- `tailwind.config.js` - Added `mutter-primary` color token (legacy v3 config; Tailwind v4 uses `@theme` in App.css)
- `i18n/locales/en/translation.json` - Added `settings.journal.*` and `mutter.tabs.*` keys

**Key patterns:**
- Journal commands are registered in both `bindings.ts` (auto-generated via tauri-specta) and `lib/journal.ts` (manual `invoke` wrappers); frontend components use the manual wrappers from `lib/journal.ts`
- Recording reuses Handy's AudioRecordingManager and TranscriptionManager with `"journal"` binding_id; defensive `stopRecording()` call before start to clear stale state
- Post-processing reuses `crate::llm_client::send_chat_completion`; multi-turn chat uses `crate::llm_client::send_chat_messages`
- Re-transcribe reads WAV file via `hound::WavReader`, converts samples to f32, re-runs transcription pipeline, clears snapshot stack
- File explorer listens for `journal-updated` Tauri events for real-time updates
- Sidebar drag-and-drop uses mouse-event-based drag (mousedown/mousemove/mouseup) with a 5px threshold, not HTML5 drag API (unreliable in Tauri WKWebView); preview panel entries use `dataTransfer` with `application/x-journal-entry-id` type
- Folder operations are atomic: DB update + filesystem move happen together
- **File naming convention**: Audio and markdown files use the entry title as base name (`{title}.wav`, `{title}.md`). Chat files: `{title} - Chat - {Mode} - {session_title}.md`. Jot files: `{title} - Jot - {session_title}.md`. Filenames are sanitized (unsafe chars replaced with `_`). Conflicts resolved by appending `(2)`, `(3)`, etc.
- **Markdown file sync**: Transcript `.md` files auto-written on save, edit, prompt apply, prompt undo. Chat/jot `.md` files auto-written on each message save. Files renamed when entry title changes. Files moved when entry moves between folders. Files deleted when entry is deleted.
- **Configurable storage path**: `journal_storage_path` in AppSettings. `effective_recordings_dir()` method returns configured path or default. Migration copies files from old to new path on change.
- DetailView uses inline editing: title saves on blur, tags/links save immediately on add/remove, transcript editable with 500ms debounce
- Transcription rendered with react-markdown + remark-breaks + remark-gfm; text preprocessed to strip quotes and convert literal `\n`; custom `code` component renders inline backtick text as tag badges when matching known tags
- Tag/link dropdowns use outside-click detection with refs for dismissal
- Breadcrumb trail preserved during linked entry and tag navigation; `selectedEntryId` useEffect only fires for direct sidebar selection (trail.length === 0)
- Prompt pipeline: `MUTTER_DEFAULT_PROMPTS` (Clean, Structure, Organise, Report) auto-injected on mount; sequential unlock; undo via `transcript_snapshots` stack
- New entry flow: clicking "New Entry" shows Record/Import choice screen (not auto-start recording)
- Audio import: reads WAV (int16/int32/float), mixes to mono, resamples to 16kHz via linear interpolation, transcribes, saves
- Chat assistant "mutter" with 4 modes:
  - **Jotter**: Non-AI free-form markdown notepad with Edit/Preview toggle; sessions saved to "Jots" section (separate from chat history); auto-titled from first line of text on close; 500ms debounced auto-save
  - **Retrieve**: Strict factual retrieval from entry + linked entries; no speculation
  - **Sharpen**: Summarise, paraphrase, reframe; grounded in entry content
  - **Brainstorm**: Coaching mode — mutter asks probing questions, teases out assumptions, encourages deeper thinking; auto-starts with opening questions when selected
- Persistent chat sessions stored in SQLite; create session lazily on first message (or immediately for brainstorm auto-start)
- Context window management: token estimation (~4 chars/token), auto-compaction at 80% via LLM summarization, clickable meter for manual override
- LLM-generated chat titles on first close (6-word summary); inline rename via double-click on session badge
- DetailView layout order: entry box → Jots section → Chat History section → FAB button

## Tailwind CSS v4

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

Handy supports command-line parameters on all platforms for integration with scripts, window managers, and autostart configurations.

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

**Key design decisions:**

- CLI flags are runtime-only overrides — they do NOT modify persisted settings
- Remote control flags (`--toggle-transcription`, `--toggle-post-process`, `--cancel`) work by launching a second instance that sends its args to the running instance via `tauri_plugin_single_instance`, then exits
- `send_transcription_input()` in `signal_handle.rs` is shared between signal handlers and CLI to avoid code duplication
- `CliArgs` is stored in Tauri managed state (`.manage()`) so it's accessible in `on_window_event` and other handlers

## Debug Mode

Access debug features: `Cmd+Shift+D` (macOS) or `Ctrl+Shift+D` (Windows/Linux)

## Environment Notes

Binary paths (needed when shell profile isn't loaded, e.g., in Claude Code):
- **Bun**: `~/.bun/bin/bun`
- **Cargo/Rust**: `~/.cargo/bin/cargo`
- Use: `export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"` before running commands

## Platform Notes

- **macOS**: Metal acceleration, accessibility permissions required
- **Windows**: Vulkan acceleration, code signing
- **Linux**: OpenBLAS + Vulkan, limited Wayland support, overlay disabled by default
