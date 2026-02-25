<p align="center">
  <img src="handyxmutter.png" alt="handyXmutter" width="280" />
</p>

<p align="center">
  <em>Where <a href="https://github.com/cjpais/Handy">Handy</a> meets journaling — record, transcribe, think.</em>
</p>

<p align="center">
  <a href="https://github.com/cjpais/Handy">
    <img src="https://img.shields.io/badge/built%20on-Handy-ff69b4?style=flat-square" alt="Built on Handy" />
  </a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

---

## What is handyXmutter?

**handyXmutter** is a voice journal that extends [Handy](https://github.com/cjpais/Handy), the open-source speech-to-text desktop app. Record voice notes, get instant offline transcriptions, refine them with AI, and organise everything into folders — all from within Handy's interface.

The name says it: **Handy × Mutter**. Handy gives you the voice pipeline. Mutter ("to speak quietly, almost to yourself") gives you the journal. Together they're a thinking tool.

## Built on Handy

This project is a **fork of [Handy](https://github.com/cjpais/Handy)** by [@cjpais](https://github.com/cjpais). We believe in Handy's philosophy:

> *"Handy isn't trying to be the best speech-to-text app — it's trying to be the most forkable one."*

handyXmutter is what happens when you take that invitation seriously. Every feature is built on top of Handy's audio pipeline, transcription engine, and Tauri architecture. We sync regularly with upstream to stay current.

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
| **Clean** | Deduplicates repeated words, chunks into paragraphs |
| **Structure** | Adds headings and bullet points |
| **Organise** | Regroups by theme, adds a summary |
| **Report** | Generates a professional report with action items |

Each step builds on the previous one. Undo any step to restore the earlier version. Consecutive duplicate words (a common speech-to-text artefact) are automatically stripped before each prompt.

### Chat Assistant ("mutter")
Four modes for interacting with your journal entries:

- **Jotter** — Free-form markdown notepad (no AI). Edit/preview toggle, auto-saved.
- **Retrieve** — Strict factual Q&A from your entry and linked entries. No speculation.
- **Sharpen** — Summarise, paraphrase, and reframe. Grounded in your content.
- **Brainstorm** — Thinking coach — asks probing questions, challenges assumptions, encourages deeper reflection.

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

### Tags & Links
- **Tags** — Add custom tags to entries, click tag badges to browse by tag
- **Linked entries** — Connect related journal entries, navigate between them via breadcrumb trail

### File Management
- **Markdown sync** — Every transcript, chat, and jot is automatically written as `.md` files alongside the audio
- **Configurable storage** — Choose where your recordings and files are stored
- **Atomic operations** — Renaming, moving, or deleting an entry updates all associated files

### Everything Handy Offers
Since handyXmutter is built on Handy, you also get:
- Offline speech-to-text with Whisper, Parakeet, Moonshine, and more
- Global keyboard shortcuts and push-to-talk
- Post-processing with any OpenAI-compatible API
- Multi-language support
- Recording overlay
- Transcription history
- Cross-platform (macOS, Windows, Linux)

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Bun](https://bun.sh/)

### Setup

```bash
# Clone the repo
git clone https://github.com/yeoyongkiat/handyXmutter.git
cd handyXmutter

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

### Using handyXmutter

1. Launch the app — you'll see Handy's standard interface
2. Click the **mutter** logo at the bottom of the sidebar
3. Create your first folder
4. Click **New Entry** → **Record** or **Import Audio**
5. Your voice note is transcribed automatically
6. Use the prompt pipeline (Clean → Structure → Organise → Report) to refine
7. Add tags, link related entries, and chat with mutter about your thoughts

## Architecture

handyXmutter extends Handy's architecture without modifying its core contracts:

```
┌─────────────────────────────────────────────┐
│               handyXmutter                   │
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

## Direction

handyXmutter is a personal thinking tool. The goal isn't to build a feature-heavy note-taking app — it's to close the loop between *speaking your thoughts* and *making sense of them*.

What we're exploring:
- **Voice-first journaling** — Speaking is faster and more honest than typing. The journal should make that effortless.
- **AI as a thinking partner** — Not to write for you, but to help you think more clearly about what you already said.
- **Local-first** — Your journal stays on your machine. Transcription runs offline. LLM calls are optional and configurable.
- **Handy as a platform** — Demonstrating that Handy's architecture can support domain-specific tools beyond clipboard transcription.

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

- **[Handy](https://github.com/cjpais/Handy)** by [@cjpais](https://github.com/cjpais) — the foundation that makes this possible
- **[Whisper](https://github.com/openai/whisper)** by OpenAI — speech recognition
- **[Tauri](https://tauri.app)** — Rust-based app framework
- **[Claude Code](https://claude.ai/code)** — pair programming partner

---

<p align="center">
  <em>Mutter your thoughts. Let them become something.</em>
</p>
