<p align="center">
  <img src="mutter.png" alt="mutter" width="280" />
</p>

<p align="center">
  <em>A voice journal built on <a href="https://github.com/cjpais/Handy">Handy</a> — record, transcribe, think.</em>
</p>

<p align="center">
  <a href="https://github.com/cjpais/Handy">
    <img src="https://img.shields.io/badge/built%20on-Handy-ff69b4?style=flat-square" alt="Built on Handy" />
  </a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

---

## What is Mutter?

**Mutter** is a voice journal plugin for [Handy](https://github.com/cjpais/Handy), the open-source speech-to-text desktop app. It extends Handy with a full journaling experience — record voice notes, get instant transcriptions, refine them with AI, and organise everything into folders.

Mutter lives inside Handy as a second sidebar mode. Switch between Handy's transcription tools and Mutter's journal with a single click. All of Handy's core features — offline transcription, model selection, keyboard shortcuts — remain fully available.

### Why "Mutter"?

To mutter is to speak quietly, almost to yourself — which is exactly what journaling is. You mutter your thoughts, and Mutter captures them.

## Built on Handy (with love)

This project is a **fork of [Handy](https://github.com/cjpais/Handy)** by [@cjpais](https://github.com/cjpais). We believe in Handy's philosophy:

> *"Handy isn't trying to be the best speech-to-text app — it's trying to be the most forkable one."*

Mutter is what happens when you take that invitation seriously. Every feature in Mutter is built on top of Handy's excellent audio pipeline, transcription engine, and Tauri architecture. We sync regularly with upstream to stay current with Handy's improvements.

**Handy gives you the voice. Mutter gives you the journal.**

## Features

### Journal Management
- **Folder-based organisation** — Create folders, drag-and-drop entries between them
- **Record or import** — Speak into your mic or import existing WAV files
- **Instant transcription** — Powered by Handy's offline Whisper/Parakeet models
- **Inline editing** — Click to edit titles, transcripts auto-save with debounce

### AI Post-Processing Pipeline
Sequential prompt pipeline that progressively refines your transcript:

| Step | What it does |
|------|-------------|
| **Clean** | Chunks into paragraphs, preserves exact wording |
| **Structure** | Adds headings and bullet points |
| **Organise** | Regroups by theme, adds a summary |
| **Report** | Generates a professional report with action items |

Each step builds on the previous one. Undo any step to restore the earlier version.

### Chat Assistant ("mutter")
Four modes for interacting with your journal entries:

- **Jotter** — Free-form markdown notepad (no AI). Edit/preview toggle, auto-saved.
- **Retrieve** — Strict factual Q&A from your entry and linked entries. No speculation.
- **Sharpen** — Summarise, paraphrase, and reframe. Grounded in your content.
- **Brainstorm** — Mutter becomes a thinking coach — asks probing questions, challenges assumptions, encourages deeper reflection.

Chat sessions are persistent (stored in SQLite) and resume where you left off.

### Search
Search bar in the sidebar with advanced syntax:

| Syntax | What it searches |
|--------|-----------------|
| `text` | Entry titles |
| `@query` | Folder names (shows entries in matching folders) |
| `#query` | Tags |
| `::date` | Dates — `today`, `this week`, `jan 2025`, `2025-01` |
| `[name]` | Entries linked to entries matching the name |

Click the **?** icon in the search bar for a quick reference.

### Tags & Links
- **Tags** — Add custom tags to entries, click tag badges to browse by tag
- **Linked entries** — Connect related journal entries, navigate between them via breadcrumb trail

### File Management
- **Markdown sync** — Every transcript, chat, and jot is automatically written as `.md` files alongside the audio
- **Configurable storage** — Choose where your recordings and files are stored
- **File naming** — `{title}.wav`, `{title}.md`, `{title} - Chat - {Mode} - {session}.md`
- **Atomic operations** — Renaming, moving, or deleting an entry updates all associated files

### Everything Handy Offers
Since Mutter is built on Handy, you also get:
- Offline speech-to-text with Whisper, Parakeet, Moonshine, and more
- Global keyboard shortcuts and push-to-talk
- Post-processing with any OpenAI-compatible API
- Multi-language support
- Recording overlay
- Transcription history
- Cross-platform (macOS, Windows, Linux)

## Screenshots

*Coming soon*

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Bun](https://bun.sh/)

### Setup

```bash
# Clone the repo
git clone https://github.com/yeoyongkiat/Handy.git mutter
cd mutter

# Install dependencies
bun install

# Download the VAD model
mkdir -p src-tauri/resources/models
curl -o src-tauri/resources/models/silero_vad_v4.onnx https://blob.handy.computer/silero_vad_v4.onnx

# Run in development mode
bun run tauri dev

# If cmake error on macOS:
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri dev
```

### Using Mutter

1. Launch the app — you'll see Handy's standard interface
2. Click the **mutter** logo at the bottom of the sidebar
3. Create your first folder
4. Click **New Entry** → **Record** or **Import Audio**
5. Your voice note is transcribed automatically
6. Use the prompt pipeline (Clean → Structure → Organise → Report) to refine
7. Add tags, link related entries, and chat with mutter about your thoughts

## Architecture

Mutter extends Handy's architecture without modifying its core contracts:

```
┌─────────────────────────────────────────────┐
│                   Mutter                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Journal   │  │ Chat     │  │ Search    │  │
│  │ Manager   │  │ Sessions │  │ (client)  │  │
│  │ (SQLite)  │  │ (SQLite) │  │           │  │
│  └──────────┘  └──────────┘  └───────────┘  │
├─────────────────────────────────────────────┤
│                   Handy                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Audio    │  │ Transcrip│  │ LLM       │  │
│  │ Pipeline │  │ tion     │  │ Client    │  │
│  │ (cpal)   │  │ (whisper)│  │ (OpenAI)  │  │
│  └──────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────┘
```

**Backend (Rust):**
- `src-tauri/src/managers/journal.rs` — JournalManager with SQLite DB and file management
- `src-tauri/src/commands/journal.rs` — 28 Tauri commands for CRUD, recording, chat, and file operations

**Frontend (React/TypeScript):**
- `src/components/settings/journal/JournalSettings.tsx` — Full journal UI
- `src/components/mutter/MutterPanel.tsx` — Tab bar and content routing
- `src/lib/journal.ts` — Types and command wrappers
- `src/stores/mutterStore.ts` — Zustand store for cross-component state

## The Plugin Vision

Mutter demonstrates that Handy is genuinely forkable. We'd love to see Handy evolve a plugin architecture where extensions like Mutter can be developed and distributed independently — without forking the entire codebase.

Until then, we'll keep building on top of Handy's excellent foundation, syncing upstream changes, and showing what's possible when a speech-to-text tool is designed to be extended.

If you're thinking about building your own Handy plugin, Mutter's code is a practical reference for:
- Adding new Tauri managers and commands alongside Handy's existing ones
- Extending the sidebar with new modes
- Reusing Handy's audio, transcription, and LLM pipelines
- Adding SQLite-backed features with migration support

## Syncing with Upstream

```bash
# Add upstream remote (one-time)
git remote add upstream https://github.com/cjpais/Handy.git

# Sync
git fetch upstream
git merge upstream/main
```

## License

MIT License — same as Handy. See [LICENSE](LICENSE) for details.

## Acknowledgments

- **[Handy](https://github.com/cjpais/Handy)** by [@cjpais](https://github.com/cjpais) — the foundation that makes Mutter possible
- **[Whisper](https://github.com/openai/whisper)** by OpenAI — speech recognition
- **[Tauri](https://tauri.app)** — Rust-based app framework
- **[Claude Code](https://claude.ai/code)** — pair programming partner for building Mutter

---

<p align="center">
  <em>Mutter your thoughts. Let them become something.</em>
</p>
