import { invoke } from "@tauri-apps/api/core";

export interface JournalEntry {
  id: number;
  file_name: string;
  timestamp: number;
  title: string;
  transcription_text: string;
  post_processed_text: string | null;
  post_process_prompt_id: string | null;
  tags: string[];
  linked_entry_ids: number[];
  folder_id: number | null;
  transcript_snapshots: string[];
  source: string;
  source_url: string | null;
  speaker_names: string;
  user_source: string;
}

export interface MeetingSegment {
  id: number | null;
  speaker: number | null;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface JournalFolder {
  id: number;
  name: string;
  created_at: number;
  source: string;
}

export interface YouTubeDownloadResult {
  title: string;
  transcription: string;
  file_name: string;
}

export interface JournalRecordingResult {
  file_name: string;
  transcription_text: string;
}

export interface ChatSession {
  id: number;
  entry_id: number;
  mode: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface ChatMessage {
  id: number;
  session_id: number;
  role: string;
  content: string;
  created_at: number;
}

// Default Mutter prompts — injected into Handy's post_process_prompts on first load
export const MUTTER_DEFAULT_PROMPTS = [
  {
    name: "Clean",
    prompt: `Clean this transcript:
1. Fix spelling, capitalization, and punctuation errors
2. Convert number words to digits (twenty-five → 25, ten percent → 10%, five dollars → $5)
3. Replace spoken punctuation with symbols (period → ., comma → ,, question mark → ?)
4. Remove filler words (um, uh, like as filler)
5. Remove consecutively repeated words in sentences, retaining only one instance of the word.

Preserve exact meaning and word order. Do not paraphrase or reorder content.

Return only the cleaned transcript.

Transcript:
\${output}`,
  },
  {
    name: "Structure",
    prompt: `Format this transcript:
1. Chunk the transcript into coherent paragraphs.
2. Leave double new lines in between each paragraph.

Preserve exact meaning and word order. Do not paraphrase or reorder content.

Return only the cleaned transcript.

Transcript:
\${output}`,
  },
  {
    name: "Organise",
    prompt: `Format this transcript:
1. Group paragraphs into coherent groups.
2. For each coherent group, give a sub-header.

Preserve exact meaning and word order. Do not paraphrase or reorder content.

Return only the structured transcript.

Transcript:
\${output}`,
  },
  {
    name: "Report",
    prompt: `Format this transcript into reported speech:
1. Group paragraphs into coherent groups.
2. Use bullets to elaborate sub-points.
3. For each coherent group, give a sub-header.

Return only the reformatted transcript.

Transcript:
\${output}`,
  },
];

export const MEETING_PROMPTS = [
  {
    name: "Minutes",
    prompt: `Generate government-style Notes of Meeting (NOMs) from this transcript.

## Grammar & Style Rules

| Element | Rule |
|---------|------|
| Tense | Reported speech |
| Person | Third person - be specific who said what |
| Voice | Active voice. NEVER use passive voice (e.g., "It was agreed...") - passive obscures attribution. |
| Format | Prose, not bullet points |
| Tone | Neutral, factual, concise |
| Attribution | Always attribute positions/statements to specific people |

Common constructions:
- "[Person] highlighted/noted/clarified/explained that..."
- "[Person] agreed that..."
- "[Person] decided that..."
- "The meeting discussed..."
- "Action: [Person] to [verb] by [date]"

## Structure

### 1. Title
- Ad-hoc/one-off meeting: Describe what the meeting is about
- Regular meeting platform: Name of the platform

### 2. Date
- Date of the meeting

### 3. Attendees
- Bullet point list, most senior person first
- Format: Name / Designation (Organisation)
- Abbreviation rule: Because attendees' full names, designations, and orgs are stated here, the body can use abbreviations: Designation/Org.

### 4. Contents
Before the body table, include a simple contents list showing topics and sub-topics at a glance.

### 5. Body
Format: Table with 3 columns: S/N | Notes | For Action

Two-row structure per topic:
- Row 1 (header): S/N number + Topic title in Notes column. Merge Notes and For Action cells.
- Row 2 (content): Blank S/N + detailed notes in Notes column, For Action as applicable.

Notes column enumeration:
- Each idea discussed under a topic: a., b., c. etc.
- Sub-points if needed: i., ii., iii. etc.

Sub-topic organisation:
- Main topics (S/N) are often split into smaller sub-topics
- Sub-topics appear as italics (sub-header)
- Under each sub-topic, list notes as a., b., c. etc.
- Leave a blank line between sub-topics

For Action column rules:
- Action items must be clear from the language in the Notes column
- The For Action column states who is responsible - aligned to the specific bullet point where the action appears

Return only the Notes of Meeting. Use the speaker labels from the transcript for attribution.

Transcript:
\${output}`,
  },
];

// Default chat mode instructions (editable by user in Mutter settings)
export const MUTTER_DEFAULT_CHAT_INSTRUCTIONS = {
  retrieve: `You are mutter, a strict information retrieval assistant. You have access to a journal entry and its linked entries. Your job is to answer questions ONLY based on what is explicitly stated in these entries.

Rules:
- ONLY answer based on information explicitly present in the journal entry and its linked entries below.
- If the answer is not in any of these entries, say so clearly. Do not guess, infer, or speculate.
- Do not brainstorm, generate ideas, or offer creative suggestions.
- Do not answer questions unrelated to the content of these entries.
- Be concise and accurate. Quote the entries where helpful.
- If asked to summarise, summarise only what is in the entries.
- When referencing information from a linked entry, mention which entry it came from.
- When mentioning tags, always format them using backticks like \`tagname\` so they render as badges.`,

  sharpen: `You are mutter, a writing assistant that helps sharpen and refine journal entries. You have access to a journal entry and its linked entries.

Your capabilities:
- Summarise content concisely
- Paraphrase for clarity and readability
- Reframe ideas from different angles
- Make text more succinct without losing meaning
- Suggest clearer wording or structure
- Highlight key takeaways or action items

Rules:
- Stay grounded in the content of the entries. Do not introduce new facts or information.
- You may rephrase, condense, and restructure — but preserve the original meaning.
- Do not brainstorm new ideas, generate creative content, or go beyond what the entries discuss.
- When referencing information from a linked entry, mention which entry it came from.
- When mentioning tags, always format them using backticks like \`tagname\` so they render as badges.
- Be direct and concise in your responses.`,

  brainstorm: `You are mutter, a thinking coach and active brainstorming companion. You have read the user's journal entry and your role is to help them think more deeply about what they wrote.

Your approach:
- Ask thoughtful, probing questions — one or two at a time, not a long list.
- Help the user surface their own assumptions and unstated beliefs.
- Push them to articulate their reasoning more clearly ("What makes you think that?" "What would change your mind?").
- Identify opportunities, challenges, or tensions they may not have noticed.
- Encourage them to think about next steps or possible actions.
- Mirror back what they've said in ways that reveal new angles.

Rules:
- You are a COACH, not an advisor. Your primary job is to ASK, not to TELL.
- Keep your own commentary brief. The user should be doing most of the thinking.
- Do not lecture, give long answers, or provide unsolicited advice.
- You may offer brief observations or reframings, but always follow them with a question.
- Do not introduce facts or information from outside the entry.
- When mentioning tags, always format them using backticks like \`tagname\` so they render as badges.
- Start the conversation by reading the entry and asking 1-2 targeted questions to get the user thinking.`,

  synthesise: `You are mutter, an information retrieval and synthesis assistant for meeting transcripts. You have access to a meeting transcript with speaker-attributed segments and any linked entries.

Your capabilities:
- Answer questions based on what was discussed in the meeting.
- Identify and list follow-up actions, owners, and deadlines mentioned in the meeting.
- Summarise key decisions and outcomes.
- Attribute statements and commitments to specific speakers.
- Cross-reference with linked entries when relevant.

Rules:
- ONLY answer based on information explicitly present in the meeting transcript and linked entries below.
- If the answer is not in the transcript, say so clearly. Do not guess, infer, or speculate.
- When listing actions, clearly state who is responsible and any deadlines mentioned.
- Be concise and accurate. Quote the transcript where helpful.
- When referencing information from a linked entry, mention which entry it came from.
- When mentioning tags, always format them using backticks like \`tagname\` so they render as badges.`,
} as const;

// Known model context windows (tokens). Patterns matched case-insensitively against model name.
// Order matters: first match wins, so put specific patterns before broad ones.
const MODEL_CONTEXT_WINDOWS: [RegExp, number][] = [
  // Gemma
  [/gemma-3.*27b/i, 128000],
  [/gemma-3/i, 32000],
  [/gemma-2.*27b/i, 8192],
  [/gemma-2/i, 8192],
  [/gemma/i, 8192],

  // Google Gemini
  [/gemini-2\.5/i, 1048576],
  [/gemini-2/i, 1048576],
  [/gemini-1\.5-pro/i, 2097152],
  [/gemini-1\.5/i, 1048576],
  [/gemini/i, 32000],

  // OpenAI GPT
  [/gpt-4o/i, 128000],
  [/gpt-4-turbo/i, 128000],
  [/gpt-4-32k/i, 32768],
  [/gpt-4/i, 8192],
  [/gpt-3\.5-turbo-16k/i, 16384],
  [/gpt-3\.5/i, 4096],
  [/o1-mini/i, 128000],
  [/o1-preview/i, 128000],
  [/o1/i, 200000],
  [/o3-mini/i, 200000],
  [/o3/i, 200000],
  [/o4-mini/i, 200000],

  // Anthropic Claude
  [/claude-3[.-]5/i, 200000],
  [/claude-3/i, 200000],
  [/claude-4/i, 200000],
  [/claude/i, 200000],

  // Meta Llama
  [/llama-?3\.3/i, 128000],
  [/llama-?3\.2/i, 128000],
  [/llama-?3\.1/i, 128000],
  [/llama-?3/i, 8192],
  [/llama-?2/i, 4096],
  [/llama/i, 8192],

  // Mistral / Mixtral
  [/mixtral.*8x22b/i, 65536],
  [/mixtral.*8x7b/i, 32768],
  [/mixtral/i, 32768],
  [/mistral-large/i, 128000],
  [/mistral-medium/i, 32768],
  [/mistral-small/i, 32768],
  [/mistral-nemo/i, 128000],
  [/mistral.*7b.*instruct.*v0\.3/i, 32768],
  [/mistral.*7b/i, 8192],
  [/mistral/i, 32768],

  // Qwen
  [/qwen-?2\.5/i, 131072],
  [/qwen-?2/i, 32768],
  [/qwen/i, 32768],

  // DeepSeek
  [/deepseek-v3/i, 128000],
  [/deepseek-v2/i, 128000],
  [/deepseek-coder/i, 128000],
  [/deepseek/i, 64000],

  // Phi
  [/phi-?4/i, 16384],
  [/phi-?3/i, 128000],
  [/phi/i, 4096],

  // Cohere Command
  [/command-r-plus/i, 128000],
  [/command-r/i, 128000],
  [/command/i, 4096],
];

const DEFAULT_CONTEXT_WINDOW = 8192;

/**
 * Look up the context window size for a model by name.
 * Matches against known patterns; falls back to 8192 tokens.
 */
export function getModelContextWindow(modelName: string): number {
  if (!modelName) return DEFAULT_CONTEXT_WINDOW;
  for (const [pattern, tokens] of MODEL_CONTEXT_WINDOWS) {
    if (pattern.test(modelName)) return tokens;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

export const journalCommands = {
  startRecording: () => invoke<void>("start_journal_recording"),

  stopRecording: () =>
    invoke<JournalRecordingResult>("stop_journal_recording"),

  getPartialTranscription: () =>
    invoke<string>("get_partial_journal_transcription"),

  discardRecording: (fileName: string) =>
    invoke<void>("discard_journal_recording", { fileName }),

  saveEntry: (params: {
    fileName: string;
    title: string;
    transcriptionText: string;
    postProcessedText: string | null;
    postProcessPromptId: string | null;
    tags: string[];
    linkedEntryIds: number[];
    folderId: number | null;
  }) => invoke<JournalEntry>("save_journal_entry", params),

  getEntries: () => invoke<JournalEntry[]>("get_journal_entries"),

  getEntry: (id: number) =>
    invoke<JournalEntry | null>("get_journal_entry", { id }),

  updateEntry: (params: {
    id: number;
    title: string;
    tags: string[];
    linkedEntryIds: number[];
    folderId: number | null;
    userSource?: string;
  }) => invoke<void>("update_journal_entry", params),

  deleteEntry: (id: number) =>
    invoke<void>("delete_journal_entry", { id }),

  applyPostProcess: (text: string, promptId: string) =>
    invoke<string>("apply_journal_post_process", { text, promptId }),

  applyPromptTextToText: (text: string, promptText: string) =>
    invoke<string>("apply_prompt_text_to_text", { text, promptText }),

  updatePostProcessedText: (id: number, text: string, promptId: string) =>
    invoke<void>("update_journal_post_processed_text", { id, text, promptId }),

  getAudioFilePath: (fileName: string, folderId: number | null) =>
    invoke<string>("get_journal_audio_file_path", { fileName, folderId }),

  updateTranscriptionText: (id: number, text: string) =>
    invoke<void>("update_journal_transcription_text", { id, text }),

  retranscribe: (id: number) =>
    invoke<string>("retranscribe_journal_entry", { id }),

  applyPromptToEntry: (id: number, promptId: string) =>
    invoke<string>("apply_prompt_to_journal_entry", { id, promptId }),

  applyPromptTextToEntry: (id: number, promptText: string, promptLabel: string) =>
    invoke<string>("apply_prompt_text_to_journal_entry", { id, promptText, promptLabel }),

  undoPrompt: (id: number, previousPromptId: string | null) =>
    invoke<string>("undo_journal_prompt", { id, previousPromptId }),

  updateEntryAfterProcessing: (id: number, fileName: string, title: string, transcriptionText: string) =>
    invoke<void>("update_entry_after_processing", { id, fileName, title, transcriptionText }),

  importAudio: (filePath: string) =>
    invoke<JournalRecordingResult>("import_audio_for_journal", { filePath }),

  chat: (messages: [string, string][]) =>
    invoke<string>("journal_chat", { messages }),

  // Chat session commands
  createChatSession: (entryId: number, mode: string) =>
    invoke<ChatSession>("create_chat_session", { entryId, mode }),

  getChatSessions: (entryId: number) =>
    invoke<ChatSession[]>("get_chat_sessions", { entryId }),

  saveChatMessage: (sessionId: number, role: string, content: string) =>
    invoke<ChatMessage>("save_chat_message", { sessionId, role, content }),

  getChatMessages: (sessionId: number) =>
    invoke<ChatMessage[]>("get_chat_messages", { sessionId }),

  updateChatSessionTitle: (sessionId: number, title: string) =>
    invoke<void>("update_chat_session_title", { sessionId, title }),

  deleteChatSession: (sessionId: number) =>
    invoke<void>("delete_chat_session", { sessionId }),

  // Folder commands
  createFolder: (name: string) =>
    invoke<JournalFolder>("create_journal_folder", { name }),

  renameFolder: (id: number, name: string) =>
    invoke<void>("rename_journal_folder", { id, name }),

  deleteFolder: (id: number) =>
    invoke<void>("delete_journal_folder", { id }),

  getFolders: () => invoke<JournalFolder[]>("get_journal_folders"),

  moveEntryToFolder: (entryId: number, folderId: number | null) =>
    invoke<void>("move_journal_entry_to_folder", { entryId, folderId }),

  // Storage path
  getStoragePath: () => invoke<string>("get_journal_storage_path"),

  setStoragePath: (path: string) =>
    invoke<void>("set_journal_storage_path", { path }),
};

// --- Video commands ---

export const videoCommands = {
  checkYtDlpInstalled: () => invoke<boolean>("check_ytdlp_installed"),

  installYtDlp: () => invoke<void>("install_ytdlp"),

  downloadYouTubeAudio: (url: string) =>
    invoke<YouTubeDownloadResult>("download_youtube_audio", { url }),

  importVideo: (filePath: string) =>
    invoke<JournalRecordingResult>("import_video_for_journal", { filePath }),

  getEntries: () => invoke<JournalEntry[]>("get_video_entries"),

  getFolders: () => invoke<JournalFolder[]>("get_video_folders"),

  createFolder: (name: string) =>
    invoke<JournalFolder>("create_video_folder", { name }),

  saveEntry: (params: {
    fileName: string;
    title: string;
    transcriptionText: string;
    source: string;
    sourceUrl: string | null;
    folderId: number | null;
  }) => invoke<JournalEntry>("save_video_entry", params),

  // Diarization (shared — works on any entry with audio)
  diarizeEntry: (entryId: number, maxSpeakers?: number, threshold?: number) =>
    invoke<void>("diarize_entry", { entryId, maxSpeakers: maxSpeakers ?? null, threshold: threshold ?? null }),

  getSegments: (entryId: number) =>
    invoke<MeetingSegment[]>("get_meeting_segments", { entryId }),

  updateSegmentText: (segmentId: number, text: string) =>
    invoke<void>("update_meeting_segment_text", { segmentId, text }),

  updateSegmentSpeaker: (segmentId: number, speaker: number | null) =>
    invoke<void>("update_meeting_segment_speaker", { segmentId, speaker }),

  updateSpeakerName: (entryId: number, speakerId: number, name: string) =>
    invoke<void>("update_meeting_speaker_name", { entryId, speakerId, name }),

  getSpeakerNames: (entryId: number) =>
    invoke<Record<string, string>>("get_meeting_speaker_names", { entryId }),

  // Reuse journal commands for operations on individual entries
  getEntry: journalCommands.getEntry,
  updateEntry: journalCommands.updateEntry,
  deleteEntry: journalCommands.deleteEntry,
  applyPostProcess: journalCommands.applyPostProcess,
  applyPromptTextToText: journalCommands.applyPromptTextToText,
  updatePostProcessedText: journalCommands.updatePostProcessedText,
  getAudioFilePath: journalCommands.getAudioFilePath,
  updateTranscriptionText: journalCommands.updateTranscriptionText,
  updateEntryAfterProcessing: journalCommands.updateEntryAfterProcessing,
  applyPromptToEntry: journalCommands.applyPromptToEntry,
  applyPromptTextToEntry: journalCommands.applyPromptTextToEntry,
  undoPrompt: journalCommands.undoPrompt,
  chat: journalCommands.chat,
  createChatSession: journalCommands.createChatSession,
  getChatSessions: journalCommands.getChatSessions,
  saveChatMessage: journalCommands.saveChatMessage,
  getChatMessages: journalCommands.getChatMessages,
  updateChatSessionTitle: journalCommands.updateChatSessionTitle,
  deleteChatSession: journalCommands.deleteChatSession,
  renameFolder: journalCommands.renameFolder,
  deleteFolder: journalCommands.deleteFolder,
  moveEntryToFolder: journalCommands.moveEntryToFolder,
  getStoragePath: journalCommands.getStoragePath,
  setStoragePath: journalCommands.setStoragePath,
};

// --- Meeting commands ---

export const meetingCommands = {
  checkDiarizeModelsInstalled: () => invoke<boolean>("check_diarize_models_installed"),

  installDiarizeModels: () => invoke<void>("install_diarize_models"),

  getEntries: () => invoke<JournalEntry[]>("get_meeting_entries"),

  getFolders: () => invoke<JournalFolder[]>("get_meeting_folders"),

  createFolder: (name: string) =>
    invoke<JournalFolder>("create_meeting_folder", { name }),

  saveEntry: (params: {
    fileName: string;
    title: string;
    transcriptionText: string;
    folderId: number | null;
  }) => invoke<JournalEntry>("save_meeting_entry", params),

  transcribeMeeting: (entryId: number, maxSpeakers?: number, threshold?: number) =>
    invoke<void>("transcribe_meeting", { entryId, maxSpeakers: maxSpeakers ?? null, threshold: threshold ?? null }),

  getSegments: (entryId: number) =>
    invoke<MeetingSegment[]>("get_meeting_segments", { entryId }),

  updateSegmentText: (segmentId: number, text: string) =>
    invoke<void>("update_meeting_segment_text", { segmentId, text }),

  updateSegmentSpeaker: (segmentId: number, speaker: number | null) =>
    invoke<void>("update_meeting_segment_speaker", { segmentId, speaker }),

  updateSpeakerName: (entryId: number, speakerId: number, name: string) =>
    invoke<void>("update_meeting_speaker_name", { entryId, speakerId, name }),

  getSpeakerNames: (entryId: number) =>
    invoke<Record<string, string>>("get_meeting_speaker_names", { entryId }),

  // Reuse journal commands for shared operations
  getEntry: journalCommands.getEntry,
  updateEntry: journalCommands.updateEntry,
  deleteEntry: journalCommands.deleteEntry,
  applyPostProcess: journalCommands.applyPostProcess,
  applyPromptTextToText: journalCommands.applyPromptTextToText,
  updatePostProcessedText: journalCommands.updatePostProcessedText,
  getAudioFilePath: journalCommands.getAudioFilePath,
  updateTranscriptionText: journalCommands.updateTranscriptionText,
  updateEntryAfterProcessing: journalCommands.updateEntryAfterProcessing,
  applyPromptToEntry: journalCommands.applyPromptToEntry,
  applyPromptTextToEntry: journalCommands.applyPromptTextToEntry,
  undoPrompt: journalCommands.undoPrompt,
  chat: journalCommands.chat,
  createChatSession: journalCommands.createChatSession,
  getChatSessions: journalCommands.getChatSessions,
  saveChatMessage: journalCommands.saveChatMessage,
  getChatMessages: journalCommands.getChatMessages,
  updateChatSessionTitle: journalCommands.updateChatSessionTitle,
  deleteChatSession: journalCommands.deleteChatSession,
  renameFolder: journalCommands.renameFolder,
  deleteFolder: journalCommands.deleteFolder,
  moveEntryToFolder: journalCommands.moveEntryToFolder,
  getStoragePath: journalCommands.getStoragePath,
  setStoragePath: journalCommands.setStoragePath,

  // Recording + import (reuse journal recording commands)
  startRecording: journalCommands.startRecording,
  stopRecording: journalCommands.stopRecording,
  getPartialTranscription: journalCommands.getPartialTranscription,
  discardRecording: journalCommands.discardRecording,
  importAudio: journalCommands.importAudio,
};
