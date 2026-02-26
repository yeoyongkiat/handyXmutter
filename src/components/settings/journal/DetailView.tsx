import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { AudioPlayer } from "../../ui/AudioPlayer";
import { Button } from "../../ui/Button";
import {
  Mic,
  Trash2,
  X,
  Tag,
  Link2,
  Sparkles,
  Copy,
  Check,
  Pencil,
  ChevronRight,
  MessageCircle,
  Lightbulb,
  Clock,
  Globe,
  Loader2,
  Users,
  Eye,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readFile } from "@tauri-apps/plugin-fs";
import { ask } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../../../hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { formatDateShort } from "@/utils/dateFormat";
import {
  journalCommands,
  videoCommands,
  meetingCommands,
  MUTTER_DEFAULT_PROMPTS,
  MEETING_PROMPTS,
  MUTTER_DEFAULT_CHAT_INSTRUCTIONS,
  type JournalEntry,
  type JournalFolder,
  type ChatSession,
  type MeetingSegment,
  getModelContextWindow,
} from "@/lib/journal";
import { JotterEditor } from "@/components/mutter/JotterEditor";
import { useMutterStore, type MutterPromptOverrides } from "@/stores/mutterStore";
import {
  SPEAKER_COLORS,
  SPEAKER_DOT_COLORS,
  SPEAKER_BG_COLORS,
  formatMs,
} from "./journalUtils";

// Mutter-themed button that uses baby blue instead of Handy's pink
const MutterButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: "sm" | "md" }
> = ({ children, className = "", size = "sm", ...props }) => {
  const sizeClasses = size === "sm" ? "px-2 py-1 text-xs" : "px-4 py-1.5 text-sm";
  return (
    <button
      className={`font-medium rounded-lg text-white bg-mutter-primary hover:bg-mutter-primary/80 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${sizeClasses} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

// --- NOMs Editor (meeting minutes canvas with context input) ---

const NomsEditor: React.FC<{
  entry: JournalEntry | null;
  jotterText: string;
  onJotterChange: (text: string) => void;
  promptOverrides: MutterPromptOverrides;
}> = ({ entry, jotterText, onJotterChange, promptOverrides }) => {
  const { t } = useTranslation();
  const [meetingName, setMeetingName] = useState("");
  const [attendees, setAttendees] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [generating, setGenerating] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-populate date from entry timestamp
  useEffect(() => {
    if (entry && !meetingDate) {
      const d = new Date(entry.timestamp * 1000);
      setMeetingDate(d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }));
    }
  }, [entry]);

  const handleGenerate = async () => {
    if (!entry) return;
    setGenerating(true);
    try {
      const nomsPrompt = promptOverrides.minutes ?? MEETING_PROMPTS[0].prompt;

      // Build context block
      const contextLines: string[] = [];
      if (meetingName.trim()) contextLines.push(`Meeting: ${meetingName.trim()}`);
      if (meetingDate.trim()) contextLines.push(`Date: ${meetingDate.trim()}`);
      if (attendees.trim()) contextLines.push(`Attendees:\n${attendees.trim()}`);
      if (additionalContext.trim()) contextLines.push(`Additional context:\n${additionalContext.trim()}`);

      const contextBlock = contextLines.length > 0
        ? `\n\n=== MEETING CONTEXT ===\n${contextLines.join("\n\n")}\n`
        : "";

      // Substitute speaker names into transcript
      const speakerNames = await meetingCommands.getSpeakerNames(entry.id);
      let transcript = entry.transcription_text;
      for (const [id, name] of Object.entries(speakerNames)) {
        if (name) {
          transcript = transcript.split(`[Speaker ${id}]`).join(`[${name}]`);
        }
      }

      // Replace ${output} with transcript + context
      const fullPrompt = nomsPrompt.replace("${output}", contextBlock + "\n" + transcript);

      const history: [string, string][] = [["user", fullPrompt]];
      const result = await journalCommands.chat(history);
      onJotterChange(result);
      setContextCollapsed(true);
    } catch (error) {
      console.error("Failed to generate NOMs:", error);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Meeting context section */}
      <div className="shrink-0 border-b border-mid-gray/10 pb-3">
        <button
          onClick={() => setContextCollapsed(!contextCollapsed)}
          className="flex items-center gap-1.5 text-xs font-medium text-text/60 uppercase tracking-wide mb-2 cursor-pointer hover:text-text/80"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${contextCollapsed ? "" : "rotate-90"}`} />
          {t("settings.meeting.nomsContext")}
        </button>
        {!contextCollapsed && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-text/40 block mb-0.5">{t("settings.meeting.nomsName")}</label>
                <input
                  value={meetingName}
                  onChange={(e) => setMeetingName(e.target.value)}
                  placeholder={t("settings.meeting.nomsNamePlaceholder")}
                  className="w-full px-2 py-1.5 text-xs bg-background border border-mid-gray/20 rounded-md focus:outline-none focus:border-mutter-primary"
                />
              </div>
              <div>
                <label className="text-[10px] text-text/40 block mb-0.5">{t("settings.meeting.nomsDate")}</label>
                <input
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs bg-background border border-mid-gray/20 rounded-md focus:outline-none focus:border-mutter-primary"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-text/40 block mb-0.5">{t("settings.meeting.nomsAttendees")}</label>
              <textarea
                value={attendees}
                onChange={(e) => setAttendees(e.target.value)}
                placeholder={t("settings.meeting.nomsAttendeesPlaceholder")}
                rows={3}
                className="w-full px-2 py-1.5 text-xs bg-background border border-mid-gray/20 rounded-md focus:outline-none focus:border-mutter-primary resize-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-text/40 block mb-0.5">{t("settings.meeting.nomsAdditional")}</label>
              <textarea
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                placeholder={t("settings.meeting.nomsAdditionalPlaceholder")}
                rows={2}
                className="w-full px-2 py-1.5 text-xs bg-background border border-mid-gray/20 rounded-md focus:outline-none focus:border-mutter-primary resize-none"
              />
            </div>
            <MutterButton
              onClick={handleGenerate}
              disabled={generating || !entry?.transcription_text}
              size="sm"
              className="flex items-center gap-1.5 w-full justify-center"
            >
              {generating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t("settings.meeting.nomsGenerating")}
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  {t("settings.meeting.nomsGenerate")}
                </>
              )}
            </MutterButton>
          </div>
        )}
      </div>

      {/* NOMs canvas — preview / edit toggle */}
      <div className="flex-1 min-h-0 flex flex-col">
        {jotterText && (
          <div className="flex items-center justify-end gap-1 mb-1 shrink-0">
            <button
              onClick={() => setEditMode(!editMode)}
              className={`p-1 rounded transition-colors cursor-pointer ${editMode ? "text-mutter-primary bg-mutter-primary/10" : "text-text/40 hover:text-text/60 hover:bg-mid-gray/10"}`}
              title={editMode ? t("settings.meeting.nomsPreview") : t("settings.meeting.nomsEdit")}
            >
              {editMode ? <Eye className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {editMode ? (
            <textarea
              ref={textareaRef}
              value={jotterText}
              onChange={(e) => onJotterChange(e.target.value)}
              className="w-full h-full text-xs text-text/80 bg-background border border-mid-gray/20 rounded-md p-3 resize-none focus:outline-none focus:border-mutter-primary font-mono"
              placeholder={t("settings.meeting.nomsPlaceholder")}
            />
          ) : jotterText ? (
            <div className="text-sm text-text/90 select-text [&_p]:mb-3 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:mb-3 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:mb-1 [&_strong]:font-bold [&_em]:italic [&_a]:text-mutter-primary [&_a]:underline [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_table]:mb-3 [&_th]:border [&_th]:border-mid-gray/20 [&_th]:px-2 [&_th]:py-1.5 [&_th]:bg-mid-gray/10 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-mid-gray/20 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_hr]:my-3 [&_hr]:border-mid-gray/20 [&_blockquote]:border-l-2 [&_blockquote]:border-mutter-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-text/60 [&_blockquote]:mb-3">
              <Markdown remarkPlugins={[remarkBreaks, remarkGfm]}>
                {jotterText}
              </Markdown>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-text/30">{t("settings.meeting.nomsPlaceholder")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Diarized Transcript View ---

// Wrapper for a single diarized segment using JotterEditor
const DiarizedSegmentEditor: React.FC<{
  segment: MeetingSegment;
  onChange: (segmentId: number, text: string) => void;
}> = ({ segment, onChange }) => {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback((text: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (segment.id != null) onChange(segment.id, text);
      saveTimer.current = null;
    }, 500);
  }, [segment.id, onChange]);

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <JotterEditor
      content={segment.text}
      onChange={handleChange}
      placeholder=""
      tags={[]}
      entries={[]}
      folders={[]}
    />
  );
};

export const DiarizedTranscriptView: React.FC<{
  entryId: number;
}> = ({ entryId }) => {
  const { t } = useTranslation();
  const [segments, setSegments] = useState<MeetingSegment[]>([]);
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [editingSpeakerName, setEditingSpeakerName] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [reassigningSegmentId, setReassigningSegmentId] = useState<number | null>(null);

  useEffect(() => {
    meetingCommands.getSegments(entryId).then(setSegments);
    meetingCommands.getSpeakerNames(entryId).then(setSpeakerNames);
  }, [entryId]);

  const handleRenameSpeaker = async (speakerId: number) => {
    const name = editName.trim();
    if (!name) return;
    try {
      await meetingCommands.updateSpeakerName(entryId, speakerId, name);
      setSpeakerNames((prev) => ({ ...prev, [String(speakerId)]: name }));
    } catch (error) {
      console.error("Failed to rename speaker:", error);
    }
    setEditingSpeakerName(null);
    setEditName("");
  };

  const handleSaveSegmentText = useCallback(async (segmentId: number, text: string) => {
    try {
      await meetingCommands.updateSegmentText(segmentId, text);
      setSegments((prev) => prev.map((s) => s.id === segmentId ? { ...s, text } : s));
    } catch (error) {
      console.error("Failed to save segment text:", error);
    }
  }, []);

  const handleReassignSpeaker = async (segmentId: number, newSpeaker: number | null) => {
    try {
      await meetingCommands.updateSegmentSpeaker(segmentId, newSpeaker);
      setSegments((prev) => prev.map((s) => s.id === segmentId ? { ...s, speaker: newSpeaker } : s));
    } catch (error) {
      console.error("Failed to reassign speaker:", error);
    }
    setReassigningSegmentId(null);
  };

  const getSpeakerLabel = (speaker: number | null): string => {
    if (speaker === null) return t("settings.meeting.speaker");
    const name = speakerNames[String(speaker)];
    return name || `${t("settings.meeting.speaker")} ${speaker}`;
  };

  if (segments.length === 0) return null;

  // Detect unique speakers
  const uniqueSpeakers = [...new Set(segments.map((s) => s.speaker).filter((s): s is number => s !== null))];

  return (
    <div className="space-y-0">
      {uniqueSpeakers.length > 0 && (
        <p className="text-xs text-text/40 mb-3">
          {t("settings.meeting.speakersDetected", { count: uniqueSpeakers.length })}
        </p>
      )}
      {segments.map((seg, i) => {
        const colorIdx = (seg.speaker ?? 0) % SPEAKER_COLORS.length;
        const isNewSpeaker = i === 0 || seg.speaker !== segments[i - 1].speaker;
        const isReassigning = reassigningSegmentId === seg.id;
        return (
          <div key={seg.id ?? i} className={`flex gap-3 ${isNewSpeaker ? "pt-3 pb-1.5" : "py-1"} px-2 rounded-sm ${SPEAKER_BG_COLORS[colorIdx]} group`}>
            <div className="flex flex-col items-center shrink-0 w-14">
              <span className="text-[10px] text-text/30 font-mono">
                {formatMs(seg.start_ms)}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              {isNewSpeaker && (
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${SPEAKER_DOT_COLORS[colorIdx]}`} />
                  {editingSpeakerName === seg.speaker ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameSpeaker(seg.speaker!);
                        if (e.key === "Escape") setEditingSpeakerName(null);
                      }}
                      onBlur={() => handleRenameSpeaker(seg.speaker!)}
                      className="text-xs font-semibold bg-transparent border-b border-mutter-primary outline-none px-0 py-0 w-32"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        if (seg.speaker !== null) {
                          setEditingSpeakerName(seg.speaker);
                          setEditName(speakerNames[String(seg.speaker)] || "");
                        }
                      }}
                      className={`text-xs font-semibold cursor-pointer hover:underline ${SPEAKER_COLORS[colorIdx]}`}
                      title={t("settings.meeting.renameSpeaker")}
                    >
                      {getSpeakerLabel(seg.speaker)}
                    </button>
                  )}
                </div>
              )}
              <div className="relative">
                <div className="diarized-segment-editor text-sm text-text/80 leading-relaxed">
                  <DiarizedSegmentEditor
                    segment={seg}
                    onChange={handleSaveSegmentText}
                  />
                </div>
                {/* Speaker reassign button — visible on hover */}
                {seg.id != null && !isReassigning && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setReassigningSegmentId(seg.id); }}
                    className="absolute -right-1 top-0 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-text/30 hover:text-mutter-primary cursor-pointer"
                    title={t("settings.meeting.reassignSpeaker")}
                  >
                    <Users className="w-3 h-3" />
                  </button>
                )}
                {/* Speaker reassign picker */}
                {isReassigning && (
                  <div className="flex items-center gap-1 mt-1">
                    {uniqueSpeakers.map((spk) => {
                      const ci = spk % SPEAKER_COLORS.length;
                      return (
                        <button
                          key={spk}
                          onClick={() => handleReassignSpeaker(seg.id!, spk)}
                          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border cursor-pointer transition-colors ${
                            seg.speaker === spk
                              ? "border-mutter-primary bg-mutter-primary/10"
                              : "border-mid-gray/20 hover:border-mutter-primary/50"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${SPEAKER_DOT_COLORS[ci]}`} />
                          <span className={SPEAKER_COLORS[ci]}>{getSpeakerLabel(spk)}</span>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setReassigningSegmentId(null)}
                      className="text-text/30 hover:text-text/60 cursor-pointer ml-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// --- Detail View (entry detail with edit/delete) ---

export const DetailView: React.FC<{
  entryId: number;
  allEntries: JournalEntry[];
  allFolders: JournalFolder[];
  onBack: () => void;
  onNavigateToEntry: (entryId: number) => void;
  onOpenTag: (tag: string) => void;
}> = ({ entryId, allEntries, allFolders, onBack, onNavigateToEntry, onOpenTag }) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const osType = useOsType();
  const promptOverrides = useMutterStore((s) => s.promptOverrides);
  const processingInfo = useMutterStore((s) => s.processingEntries[entryId]);
  const setProcessingEntry = useMutterStore((s) => s.setProcessingEntry);
  const clearProcessingEntry = useMutterStore((s) => s.clearProcessingEntry);

  const activeProviderId = settings?.post_process_provider_id ?? "";
  const activeModelName = activeProviderId ? (settings?.post_process_models?.[activeProviderId] ?? "") : "";

  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editLinkedIds, setEditLinkedIds] = useState<number[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkDropdownOpen, setLinkDropdownOpen] = useState(false);
  const [editTranscription, setEditTranscription] = useState("");
  const [isEditingTranscription, setIsEditingTranscription] = useState(false);
  const speakerNamesRef = useRef<Record<string, string>>({});
  const [showCopied, setShowCopied] = useState(false);
  const [processingPromptId, setProcessingPromptId] = useState<string | null>(null);
  const [isRetranscribing, setIsRetranscribing] = useState(false);
  const [isDiarizing, setIsDiarizing] = useState(false);
  const [diarizeProgress, setDiarizeProgress] = useState("");
  const [hasSegments, setHasSegments] = useState(false);
  const [showDiarizedView, setShowDiarizedView] = useState(true);
  const [diarizeRefreshKey, setDiarizeRefreshKey] = useState(0);
  const [diarizeMaxSpeakers, setDiarizeMaxSpeakers] = useState(6);
  const [diarizeThreshold, setDiarizeThreshold] = useState(0.5);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMaximised, setChatMaximised] = useState(false);
  const [chatMode, setChatMode] = useState<"jotter" | "retrieve" | "sharpen" | "brainstorm" | "noms" | "synthesise" | null>(null);
  const [jotterText, setJotterText] = useState("");
  const jotterSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<number | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [isCompacting, setIsCompacting] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextOverride, setContextOverride] = useState<number | null>(null);
  const [editingContext, setEditingContext] = useState(false);
  const [contextInputValue, setContextInputValue] = useState("");
  const titleGeneratedForSession = useRef<Set<number>>(new Set());
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  const chatMessagesContainerRef = useRef<HTMLDivElement>(null);
  const transcriptionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rough token estimate: ~4 chars per token (common heuristic)
  const detectedContextWindow = getModelContextWindow(activeModelName);
  const MAX_CONTEXT_TOKENS = contextOverride || detectedContextWindow;
  const COMPACTION_THRESHOLD = 0.8;
  const estimateTokens = (messages: { role: string; content: string }[], systemPromptLen?: number) => {
    let chars = systemPromptLen || 0;
    messages.forEach((m) => { chars += m.content.length + m.role.length + 4; });
    return Math.ceil(chars / 4);
  };

  const tagDropdownRef = React.useRef<HTMLDivElement>(null);
  const linkSearchRef = React.useRef<HTMLDivElement>(null);

  // Mutter's own prompt pipeline (independent from Handy's post_process_prompts)
  const isMeetingEntry = entry?.source === "meeting";
  const promptDefaults = isMeetingEntry ? MEETING_PROMPTS : MUTTER_DEFAULT_PROMPTS;
  const mutterPromptPipeline = React.useMemo(() => {
    return promptDefaults.map((d) => ({
      label: d.name,
      prompt: promptOverrides[d.name.toLowerCase() as keyof typeof promptOverrides] ?? d.prompt,
    }));
  }, [promptOverrides, promptDefaults]);

  // Collect all unique tags across all entries for the dropdown
  const allKnownTags = React.useMemo(() => {
    const tagSet = new Set<string>();
    allEntries.forEach((e) => e.tags.forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [allEntries]);

  const loadEntry = useCallback(async () => {
    try {
      const data = await journalCommands.getEntry(entryId);
      if (data) {
        setEntry(data);
        setEditTitle(data.title);
        setEditTags([...data.tags]);
        setEditLinkedIds([...data.linked_entry_ids]);
        setEditUserSource(data.user_source || "");
        if (!isEditingTranscription) {
          setEditTranscription(data.transcription_text);
        }
        // Load speaker names and check for segments
        meetingCommands.getSegments(entryId).then((segs) => {
          setHasSegments(segs.length > 0);
        });
        meetingCommands.getSpeakerNames(entryId).then((names) => {
          speakerNamesRef.current = names;
        });
      }
    } catch (error) {
      console.error("Failed to load journal entry:", error);
    }
  }, [entryId]);

  const loadChatSessions = useCallback(async () => {
    try {
      const sessions = await journalCommands.getChatSessions(entryId);
      setChatSessions(sessions);
    } catch (error) {
      console.error("Failed to load chat sessions:", error);
    }
  }, [entryId]);

  useEffect(() => {
    loadEntry();
    loadChatSessions();
  }, [loadEntry, loadChatSessions]);

  // Listen for processing events to update progress in the store
  useEffect(() => {
    if (!processingInfo) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let unlistenMeeting: (() => void) | undefined;

    const setup = async () => {
      unlistenProgress = await listen<number>("ytdlp-audio-progress", (event) => {
        setProcessingEntry(entryId, "downloading", Math.round(event.payload));
      });
      unlistenStatus = await listen<string>("ytdlp-status", (event) => {
        setProcessingEntry(entryId, event.payload, 0);
      });
      unlistenMeeting = await listen<{ entryId: number; stage: string; current?: number; total?: number }>("meeting-status", (event) => {
        const data = event.payload;
        if (data.entryId !== entryId) return;
        if (data.stage === "done") {
          clearProcessingEntry(entryId);
        } else if (data.stage === "transcribing" && data.current && data.total) {
          setProcessingEntry(entryId, "transcribing-meeting", data.current);
        } else {
          setProcessingEntry(entryId, data.stage, 0);
        }
      });
    };
    setup();

    return () => {
      unlistenProgress?.();
      unlistenStatus?.();
      unlistenMeeting?.();
    };
  }, [entryId, !!processingInfo]);

  // Listen for diarize-status events (for user-triggered diarization on video/voice entries)
  useEffect(() => {
    if (!isDiarizing) return;
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await listen<{ entryId: number; stage: string; current?: number; total?: number }>("diarize-status", (event) => {
        const data = event.payload;
        if (data.entryId !== entryId) return;
        if (data.stage === "done") {
          setDiarizeProgress("");
          setIsDiarizing(false);
          // Reload segments to check if diarization actually found any
          meetingCommands.getSegments(entryId).then((segs) => {
            setHasSegments(segs.length > 0);
          });
          setDiarizeRefreshKey((k) => k + 1);
          loadEntry();
          meetingCommands.getSpeakerNames(entryId).then((names) => {
            speakerNamesRef.current = names;
          });
        } else if (data.stage === "transcribing" && data.current && data.total) {
          setDiarizeProgress(`${data.current}/${data.total}`);
        } else {
          setDiarizeProgress(data.stage);
        }
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, [isDiarizing, entryId, loadEntry]);

  // Reload entry when processing completes (entry gets updated by backend)
  useEffect(() => {
    if (!processingInfo) {
      loadEntry();
    }
  }, [processingInfo, loadEntry]);

  const [editUserSource, setEditUserSource] = useState("");

  // Save helper — persists current field values
  const saveFields = useCallback(async (
    title: string,
    tags: string[],
    linkedIds: number[],
    userSource?: string,
  ) => {
    if (!entry) return;
    try {
      await journalCommands.updateEntry({
        id: entry.id,
        title,
        tags,
        linkedEntryIds: linkedIds,
        folderId: entry.folder_id,
        userSource: userSource ?? editUserSource,
      });
      loadEntry();
    } catch (error) {
      console.error("Failed to update entry:", error);
    }
  }, [entry, loadEntry, editUserSource]);

  // Title — save on blur
  const handleTitleBlur = () => {
    if (entry && editTitle !== entry.title) {
      saveFields(editTitle, editTags, editLinkedIds);
    }
  };

  // Tags — save immediately on add/remove
  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !editTags.includes(trimmed)) {
      const next = [...editTags, trimmed];
      setEditTags(next);
      saveFields(editTitle, next, editLinkedIds);
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    const next = editTags.filter((t) => t !== tag);
    setEditTags(next);
    saveFields(editTitle, next, editLinkedIds);
  };

  // Linked entries — save immediately on toggle
  const toggleLink = (id: number) => {
    setEditLinkedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id];
      saveFields(editTitle, editTags, next);
      return next;
    });
  };

  const removeLink = (id: number) => {
    const next = editLinkedIds.filter((i) => i !== id);
    setEditLinkedIds(next);
    saveFields(editTitle, editTags, next);
  };

  // Transcription — debounced auto-save on keystroke (500ms)
  const handleTranscriptionChange = (text: string) => {
    setEditTranscription(text);
    if (transcriptionSaveTimer.current) clearTimeout(transcriptionSaveTimer.current);
    transcriptionSaveTimer.current = setTimeout(async () => {
      if (entry) {
        try {
          await journalCommands.updateTranscriptionText(entry.id, text);
        } catch (error) {
          console.error("Failed to save transcription:", error);
        }
      }
    }, 500);
  };

  // Flush pending transcription save on unmount
  useEffect(() => {
    return () => {
      if (transcriptionSaveTimer.current) clearTimeout(transcriptionSaveTimer.current);
    };
  }, []);

  // Close link dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (linkSearchRef.current && !linkSearchRef.current.contains(e.target as Node)) {
        setLinkDropdownOpen(false);
        setLinkSearch("");
      }
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDelete = async () => {
    if (!entry) return;
    const confirmed = await ask(t("settings.journal.deleteConfirm"), {
      title: t("common.delete"),
      kind: "warning",
    });
    if (!confirmed) return;
    try {
      await journalCommands.deleteEntry(entry.id);
      onBack();
    } catch (error) {
      console.error("Failed to delete entry:", error);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    } catch {
      toast.error(t("settings.journal.copyFailed"));
    }
  };

  const handleApplyPrompt = async (promptLabel: string) => {
    if (!entry) return;
    const pipeline = mutterPromptPipeline.find((p) => p.label === promptLabel);
    if (!pipeline) return;
    setProcessingPromptId(promptLabel);
    try {
      await journalCommands.applyPromptTextToEntry(entry.id, pipeline.prompt, promptLabel);
      loadEntry();
    } catch (error) {
      console.error("Failed to apply prompt:", error);
    } finally {
      setProcessingPromptId(null);
    }
  };

  const handleRetranscribe = async () => {
    if (!entry) return;
    setIsRetranscribing(true);
    try {
      await journalCommands.retranscribe(entry.id);
      loadEntry();
    } catch (error) {
      console.error("Failed to re-transcribe:", error);
    } finally {
      setIsRetranscribing(false);
    }
  };

  const handleDiarize = async (maxSpeakers?: number, threshold?: number) => {
    if (!entry) return;
    const modelsInstalled = await meetingCommands.checkDiarizeModelsInstalled();
    if (!modelsInstalled) {
      try {
        setDiarizeProgress("installing models");
        await meetingCommands.installDiarizeModels();
      } catch (error) {
        console.error("Failed to install diarize models:", error);
        setDiarizeProgress("");
        return;
      }
    }
    setIsDiarizing(true);
    setDiarizeProgress("loading");
    try {
      await videoCommands.diarizeEntry(entry.id, maxSpeakers ?? diarizeMaxSpeakers, threshold ?? diarizeThreshold);
      // Event listener handles the "done" state update
    } catch (error) {
      console.error("Failed to diarize entry:", error);
      setIsDiarizing(false);
      setDiarizeProgress("");
    }
  };

  const handleUndoPrompt = async (previousPromptId: string | null) => {
    if (!entry) return;
    setProcessingPromptId("__undo__");
    try {
      await journalCommands.undoPrompt(entry.id, previousPromptId);
      loadEntry();
    } catch (error) {
      console.error("Failed to undo prompt:", error);
    } finally {
      setProcessingPromptId(null);
    }
  };

  const getSystemPrompt = (): string | null => {
    if (!entry || !chatMode) return null;
    if (chatMode === "jotter" || chatMode === "noms") return null;

    const linkedEntryDetails = allEntries
      .filter((e) => entry.linked_entry_ids.includes(e.id))
      .map((e) => `- "${e.title}" (${new Date(e.timestamp * 1000).toLocaleDateString()}): ${e.transcription_text}`)
      .join("\n");

    // Substitute speaker names into transcript for any diarized entry
    let transcript = entry.transcription_text;
    if (Object.keys(speakerNamesRef.current).length > 0) {
      for (const [id, name] of Object.entries(speakerNamesRef.current)) {
        if (name) {
          transcript = transcript.split(`[Speaker ${id}]`).join(`[${name}]`);
        }
      }
    }

    const entryContext = `

=== MAIN JOURNAL ENTRY ===
Title: ${entry.title}
Date: ${new Date(entry.timestamp * 1000).toLocaleString()}
Tags: ${entry.tags.join(", ") || "none"}
Linked entries: ${entry.linked_entry_ids.length > 0 ? allEntries.filter((e) => entry.linked_entry_ids.includes(e.id)).map((e) => `"${e.title}"`).join(", ") : "none"}

Transcript:
${transcript}
${linkedEntryDetails ? `
=== LINKED ENTRIES ===
${linkedEntryDetails}` : ""}`;

    const instructions = promptOverrides[chatMode] ?? MUTTER_DEFAULT_CHAT_INSTRUCTIONS[chatMode];
    return instructions + entryContext;
  };

  // Jotter: debounced auto-save
  const handleJotterChange = (text: string) => {
    setJotterText(text);
    if (jotterSaveTimer.current) clearTimeout(jotterSaveTimer.current);
    jotterSaveTimer.current = setTimeout(async () => {
      if (!entry) return;
      let sessionId = chatSessionId;
      if (!sessionId) {
        const session = await journalCommands.createChatSession(entry.id, "jotter");
        sessionId = session.id;
        setChatSessionId(sessionId);
      }
      await journalCommands.saveChatMessage(sessionId, "user", text);
      loadChatSessions();
    }, 500);
  };

  // Cleanup jotter timer on unmount
  useEffect(() => {
    return () => { if (jotterSaveTimer.current) clearTimeout(jotterSaveTimer.current); };
  }, []);

  const systemPromptLen = getSystemPrompt()?.length || 0;
  const currentTokens = estimateTokens(chatMessages, systemPromptLen);
  const contextUsage = Math.min(currentTokens / MAX_CONTEXT_TOKENS, 1);

  const compactConversation = async () => {
    if (!entry || !chatMode || !chatSessionId || chatMessages.length < 4) return;
    setIsCompacting(true);
    try {
      // Ask LLM to create a concise summary of the conversation so far
      const summaryPrompt: [string, string][] = [
        ["system", "You are a conversation compactor. Summarise the following conversation into a concise recap that preserves all key points, decisions, questions asked, and insights discussed. The summary should allow the conversation to continue seamlessly. Format as a brief narrative, not bullet points. Keep it under 500 words."],
        ["user", chatMessages.map((m) => `${m.role}: ${m.content}`).join("\n\n")],
      ];
      const summary = await journalCommands.chat(summaryPrompt);

      // Replace all messages with a single system-like summary + keep last 2 messages for continuity
      const lastMessages = chatMessages.slice(-2);
      const compactedMessages = [
        { role: "assistant" as const, content: `*[Previous conversation compacted]*\n\n${summary}` },
        ...lastMessages,
      ];
      setChatMessages(compactedMessages);

      // Clear old messages in DB and save compacted version
      await journalCommands.deleteChatSession(chatSessionId);
      const session = await journalCommands.createChatSession(entry.id, chatMode);
      setChatSessionId(session.id);
      for (const msg of compactedMessages) {
        await journalCommands.saveChatMessage(session.id, msg.role, msg.content);
      }
      loadChatSessions();
    } catch (error) {
      console.error("Failed to compact conversation:", error);
    } finally {
      setIsCompacting(false);
    }
  };

  const generateChatTitle = async (sessionId: number, messages: { role: string; content: string }[]) => {
    if (titleGeneratedForSession.current.has(sessionId) || messages.length < 2) return;
    titleGeneratedForSession.current.add(sessionId);
    try {
      const convo = messages.slice(0, 10).map((m) => `${m.role}: ${m.content}`).join("\n");
      const titlePrompt: [string, string][] = [
        ["system", "Generate a very short title (max 6 words) for this conversation. Return ONLY the title, no quotes or punctuation."],
        ["user", convo],
      ];
      const title = await journalCommands.chat(titlePrompt);
      const cleanTitle = title.replace(/^["']|["']$/g, "").trim();
      await journalCommands.updateChatSessionTitle(sessionId, cleanTitle);
      loadChatSessions();
    } catch (error) {
      console.error("Failed to generate chat title:", error);
    }
  };

  const handleCloseChat = async () => {
    setChatOpen(false);
    if (!chatSessionId) return;
    if (chatMode === "jotter" || chatMode === "noms") {
      // For jotter/noms, auto-title from first line of text
      if (jotterText.trim() && !titleGeneratedForSession.current.has(chatSessionId)) {
        titleGeneratedForSession.current.add(chatSessionId);
        const firstLine = jotterText.trim().split("\n")[0].replace(/^#+\s*/, "").slice(0, 50);
        if (firstLine) {
          await journalCommands.updateChatSessionTitle(chatSessionId, firstLine);
          loadChatSessions();
        }
      }
    } else if (chatMessages.length >= 2) {
      // Generate LLM title on first close for chat modes
      generateChatTitle(chatSessionId, chatMessages);
    }
  };

  const handleChatSend = async () => {
    if (!chatInput.trim() || chatLoading || !entry || !chatMode) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setChatLoading(true);
    try {
      // Create session on first user message if needed
      let sessionId = chatSessionId;
      if (!sessionId) {
        const session = await journalCommands.createChatSession(entry.id, chatMode);
        sessionId = session.id;
        setChatSessionId(sessionId);
      }

      // Persist user message
      await journalCommands.saveChatMessage(sessionId, "user", userMsg);

      // Build message history with system prompt
      const history: [string, string][] = [];
      const systemPrompt = getSystemPrompt();
      if (systemPrompt) {
        history.push(["system", systemPrompt]);
      }
      chatMessages.forEach((m) => history.push([m.role, m.content]));
      history.push(["user", userMsg]);
      const reply = await journalCommands.chat(history);
      setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);

      // Persist assistant reply
      await journalCommands.saveChatMessage(sessionId, "assistant", reply);
      loadChatSessions();

      // Check if context usage is above threshold — trigger compaction
      const updatedMessages = [...chatMessages, { role: "user", content: userMsg }, { role: "assistant", content: reply }];
      const newTokens = estimateTokens(updatedMessages, systemPromptLen);
      if (newTokens / MAX_CONTEXT_TOKENS >= COMPACTION_THRESHOLD) {
        // Defer compaction to next tick so UI updates first
        setTimeout(() => compactConversation(), 100);
      }
    } catch (error) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${error}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // Auto-scroll chat to bottom (scroll only the chat container, not the page)
  useEffect(() => {
    const container = chatMessagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [chatMessages]);

  // Auto-start brainstorm mode: mutter sends opening questions without user prompt
  useEffect(() => {
    if (chatMode !== "brainstorm" || chatMessages.length > 0 || !entry || chatSessionId) return;
    const startBrainstorm = async () => {
      setChatLoading(true);
      try {
        const systemPrompt = getSystemPrompt();
        if (!systemPrompt) return;

        // Create session for brainstorm
        const session = await journalCommands.createChatSession(entry.id, "brainstorm");
        setChatSessionId(session.id);

        const history: [string, string][] = [
          ["system", systemPrompt],
          ["user", "I just wrote this journal entry. Help me think deeper about it."],
        ];
        const reply = await journalCommands.chat(history);
        setChatMessages([
          { role: "assistant", content: reply },
        ]);

        // Persist the auto-generated messages
        await journalCommands.saveChatMessage(session.id, "user", "I just wrote this journal entry. Help me think deeper about it.");
        await journalCommands.saveChatMessage(session.id, "assistant", reply);
        loadChatSessions();
      } catch (error) {
        setChatMessages([
          { role: "assistant", content: `Error: ${error}` },
        ]);
      } finally {
        setChatLoading(false);
      }
    };
    startBrainstorm();
  }, [chatMode]);

  const getAudioUrl = useCallback(async () => {
    if (!entry) return null;
    try {
      const filePath = await journalCommands.getAudioFilePath(entry.file_name, entry.folder_id);
      if (osType === "linux") {
        const fileData = await readFile(filePath);
        const blob = new Blob([fileData], { type: "audio/wav" });
        return URL.createObjectURL(blob);
      }
      return convertFileSrc(filePath, "asset");
    } catch {
      return null;
    }
  }, [entry, osType]);

  if (!entry) {
    return (
      <div className="px-4 py-3 text-center text-text/60">
        {t("common.loading")}
      </div>
    );
  }

  const otherEntries = allEntries.filter((e) => e.id !== entry.id);
  const linkedEntries = otherEntries.filter((e) => editLinkedIds.includes(e.id));
  const formattedDate = formatDateShort(String(entry.timestamp));

  return (
    <div className="px-4 space-y-3 relative">
      <div className="flex items-center justify-end">
        <Button onClick={handleDelete} variant="danger-ghost" size="sm" className="flex items-center gap-1">
          <Trash2 className="w-3 h-3" />
          {t("common.delete")}
        </Button>
      </div>

      <div className="bg-background border border-mid-gray/20 rounded-lg p-4 space-y-4">
          {/* Title — inline editable */}
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            className="w-full text-lg font-medium bg-transparent rounded-md px-2 py-1 -mx-2 hover:bg-mutter-primary/10 focus:bg-mutter-primary/10 focus:outline-none transition-colors"
          />

          <p className="text-xs text-text/50">{formattedDate}</p>

          {/* Tags — click to show dropdown */}
          <div className="relative" ref={tagDropdownRef}>
            <label className="text-xs font-medium text-text/60 uppercase tracking-wide flex items-center gap-1">
              <Tag className="w-3 h-3" />
              {t("settings.journal.tags")}
            </label>
            <div
              onClick={() => setTagDropdownOpen(!tagDropdownOpen)}
              className="mt-1 min-h-[32px] flex flex-wrap gap-1 items-center px-2 py-1 rounded-md cursor-pointer transition-colors hover:bg-mutter-primary/10"
            >
              {editTags.length > 0 ? (
                editTags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-mutter-primary/20 text-mutter-primary text-xs rounded-full">
                    <button
                      onClick={(ev) => { ev.stopPropagation(); onOpenTag(tag); }}
                      className="hover:text-mutter-primary/80 cursor-pointer"
                    >
                      {tag}
                    </button>
                    <button
                      onClick={(ev) => { ev.stopPropagation(); removeTag(tag); }}
                      className="hover:text-red-400 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-xs text-text/30">{t("settings.journal.addTagPlaceholder")}</span>
              )}
            </div>
            {tagDropdownOpen && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-background border border-mid-gray/20 rounded-md shadow-lg max-h-48 overflow-y-auto">
                {/* Text input to create new tag */}
                <div className="px-3 py-1.5 border-b border-mid-gray/10">
                  <input
                    autoFocus
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); addTag(); }
                    }}
                    placeholder={t("settings.journal.newTagPlaceholder")}
                    className="w-full text-sm bg-transparent focus:outline-none placeholder:text-text/30"
                  />
                </div>
                {/* Existing tags from all entries */}
                {allKnownTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => {
                      if (editTags.includes(tag)) {
                        removeTag(tag);
                      } else {
                        const next = [...editTags, tag];
                        setEditTags(next);
                        saveFields(editTitle, next, editLinkedIds);
                      }
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm cursor-pointer truncate transition-colors flex items-center justify-between ${
                      editTags.includes(tag)
                        ? "bg-mutter-primary/10 text-mutter-primary"
                        : "hover:bg-mutter-primary/5"
                    }`}
                  >
                    <span className="truncate">{tag}</span>
                    {editTags.includes(tag) && <Check className="w-3 h-3 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Linked Entries — click to show dropdown */}
          <div className="relative" ref={linkSearchRef}>
            <label className="text-xs font-medium text-text/60 uppercase tracking-wide flex items-center gap-1">
              <Link2 className="w-3 h-3" />
              {t("settings.journal.linkedEntries")}
            </label>
            <div
              onClick={() => { if (otherEntries.length > 0) setLinkDropdownOpen(!linkDropdownOpen); }}
              className="mt-1 min-h-[32px] flex flex-wrap gap-1 items-center px-2 py-1 rounded-md cursor-pointer transition-colors hover:bg-mutter-primary/10"
            >
              {linkedEntries.length > 0 ? (
                linkedEntries.map((e) => (
                  <span key={e.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-mid-gray/15 text-xs rounded-full">
                    <button
                      onClick={(ev) => { ev.stopPropagation(); onNavigateToEntry(e.id); }}
                      className="text-mutter-primary hover:text-mutter-primary/80 cursor-pointer"
                    >
                      {e.title}
                    </button>
                    <button
                      onClick={(ev) => { ev.stopPropagation(); removeLink(e.id); }}
                      className="text-text/40 hover:text-red-400 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-xs text-text/30">{t("settings.journal.addLinkedEntry")}</span>
              )}
            </div>
            {linkDropdownOpen && otherEntries.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-background border border-mid-gray/20 rounded-md shadow-lg max-h-48 overflow-y-auto">
                <div className="px-3 py-1.5 border-b border-mid-gray/10">
                  <input
                    autoFocus
                    type="text"
                    value={linkSearch}
                    onChange={(e) => setLinkSearch(e.target.value)}
                    placeholder={t("settings.journal.searchEntries")}
                    className="w-full text-sm bg-transparent focus:outline-none placeholder:text-text/30"
                  />
                </div>
                {otherEntries
                  .filter((e) => !linkSearch.trim() || e.title.toLowerCase().includes(linkSearch.toLowerCase()))
                  .map((e) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      toggleLink(e.id);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm cursor-pointer truncate transition-colors flex items-center justify-between ${
                      editLinkedIds.includes(e.id)
                        ? "bg-mutter-primary/10 text-mutter-primary"
                        : "hover:bg-mutter-primary/5"
                    }`}
                  >
                    <span className="truncate">{e.title}</span>
                    {editLinkedIds.includes(e.id) && <Check className="w-3 h-3 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User source (for journal + video entries, not meetings) */}
          {!isMeetingEntry && (
            <div>
              <label className="text-xs font-medium text-text/60 uppercase tracking-wide mb-1 block">
                {t("settings.journal.userSource")}
              </label>
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-text/30 shrink-0" />
                <input
                  type="text"
                  value={editUserSource}
                  onChange={(e) => setEditUserSource(e.target.value)}
                  onBlur={() => {
                    if (entry && editUserSource !== (entry.user_source || "")) {
                      saveFields(editTitle, editTags, editLinkedIds, editUserSource);
                    }
                  }}
                  placeholder={t("settings.journal.userSourcePlaceholder")}
                  className="flex-1 text-sm bg-transparent border-b border-mid-gray/20 focus:border-mutter-primary focus:outline-none px-1 py-0.5 placeholder:text-text/20"
                />
              </div>
            </div>
          )}

          {/* Processing overlay */}
          {processingInfo && (
            <div className="bg-mutter-primary/5 border border-mutter-primary/20 rounded-lg p-6 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 text-mutter-primary animate-spin" />
              <p className="text-sm font-medium text-text/70">
                {processingInfo.status === "diarizing"
                  ? t("settings.meeting.diarizing")
                  : processingInfo.status === "transcribing-meeting"
                    ? t("settings.meeting.transcribingSegment", {
                        current: processingInfo.progress,
                        total: processingInfo.progress, // approximate
                      })
                    : processingInfo.status === "downloading" && processingInfo.progress > 0
                      ? t("settings.video.downloadingAudio", { progress: processingInfo.progress })
                      : processingInfo.status === "extracting"
                        ? t("settings.video.extractingAudio")
                        : processingInfo.status === "transcribing"
                          ? t("settings.video.transcribingAudio")
                          : t("settings.video.processing")}
              </p>
              <div className="w-full max-w-xs bg-mid-gray/10 rounded-full h-1.5 overflow-hidden">
                {processingInfo.status === "downloading" && processingInfo.progress > 0 ? (
                  <div
                    className="h-full bg-mutter-primary rounded-full transition-all duration-300"
                    style={{ width: `${processingInfo.progress}%` }}
                  />
                ) : (
                  <div className="h-full bg-mutter-primary/60 rounded-full animate-pulse w-full" />
                )}
              </div>
            </div>
          )}

          {/* Diarized transcript (for meeting/video entries with segments, not journal) */}
          {!processingInfo && hasSegments && entry.source !== "voice" && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-text/60 uppercase tracking-wide">
                  {t("settings.meeting.speaker") + "s"}
                </label>
                <button
                  onClick={() => setShowDiarizedView(!showDiarizedView)}
                  className="text-[10px] text-text/40 hover:text-mutter-primary cursor-pointer transition-colors"
                >
                  {showDiarizedView ? t("settings.journal.showTranscript") : t("settings.journal.showSpeakers")}
                </button>
              </div>
              {/* Diarization controls (speakers, threshold, re-diarize) below header */}
              {showDiarizedView && entry.file_name && entry.file_name.endsWith(".wav") && (
                <div className="mb-3 flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] text-text/50">{t("settings.meeting.expectedSpeakers")}</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={diarizeMaxSpeakers}
                      onChange={(e) => setDiarizeMaxSpeakers(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                      className="w-12 px-1.5 py-0.5 text-xs rounded border border-mid-gray/20 bg-background text-text"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] text-text/50">{t("settings.meeting.threshold")}</label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={diarizeThreshold}
                      onChange={(e) => setDiarizeThreshold(Number(e.target.value))}
                      className="w-20 h-1 accent-mutter-primary"
                    />
                    <span className="text-[10px] text-text/50 w-7">{diarizeThreshold.toFixed(2)}</span>
                  </div>
                  <button
                    onClick={() => handleDiarize(diarizeMaxSpeakers, diarizeThreshold)}
                    disabled={isDiarizing || processingPromptId !== null}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-md bg-mutter-primary text-white hover:bg-mutter-primary/80 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Users className="w-3 h-3" />
                    {isDiarizing
                      ? diarizeProgress
                        ? `${t("settings.meeting.diarizing").replace("...", "")} (${diarizeProgress})`
                        : t("settings.meeting.diarizing")
                      : hasSegments ? t("settings.meeting.reDiarize") : t("settings.journal.diarize")}
                  </button>
                </div>
              )}
              {showDiarizedView && <DiarizedTranscriptView key={diarizeRefreshKey} entryId={entryId} />}
            </div>
          )}

          {/* Transcription (hidden when diarized view is showing for entries with segments) */}
          {!processingInfo && !(hasSegments && showDiarizedView && entry.source !== "voice") && <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text/60 uppercase tracking-wide">
                {t("settings.journal.transcription")}
              </label>
              <button
                onClick={() => handleCopy(editTranscription)}
                className="text-text/50 hover:text-mutter-primary transition-colors cursor-pointer"
                title={t("settings.journal.copy")}
              >
                {showCopied ? <Check width={14} height={14} /> : <Copy width={14} height={14} />}
              </button>
            </div>
            {entry.file_name && (
              <AudioPlayer onLoadRequest={getAudioUrl} className="w-full mt-1" />
            )}
            <div className="mt-2">
              <JotterEditor
                content={hasSegments && !showDiarizedView ? editTranscription.replace(/\[(?:Speaker \d+|Unknown)\]\s*/g, "") : editTranscription}
                onChange={handleTranscriptionChange}
                placeholder={t("settings.journal.transcription")}
                tags={allKnownTags}
                entries={allEntries.map((e) => ({ id: e.id, title: e.title }))}
                folders={allFolders.map((f) => ({ id: f.id, name: f.name }))}
              />
            </div>
            {/* Re-transcribe | Diarize | prompt pipeline */}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                onClick={handleRetranscribe}
                disabled={processingPromptId !== null || isRetranscribing || isDiarizing}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-mid-gray/10 text-text/60 hover:bg-mid-gray/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Mic className="w-3 h-3" />
                {isRetranscribing ? t("settings.journal.retranscribing") : t("settings.journal.retranscribe")}
              </button>
              {(() => {
                if (mutterPromptPipeline.length === 0) return null;
                const activeIdx = mutterPromptPipeline.findIndex((p) => p.label === entry.post_process_prompt_id);
                const isBusy = processingPromptId !== null || isRetranscribing;
                return (
                  <>
                    <span className="text-text/20">|</span>
                    {mutterPromptPipeline.map((p, idx) => {
                      const isApplied = activeIdx >= 0 && idx <= activeIdx;
                      const isLast = idx === activeIdx;
                      const isNext = idx === activeIdx + 1;
                      const canApply = isNext && !isBusy;
                      const canUndo = isLast && isApplied && !isBusy;
                      const canClick = canApply || canUndo;
                      return (
                        <React.Fragment key={p.label}>
                          {idx > 0 && <ChevronRight className="w-3 h-3 text-text/30 shrink-0" />}
                          <button
                            onClick={() => {
                              if (canUndo) {
                                const prevLabel = idx > 0 ? mutterPromptPipeline[idx - 1].label : null;
                                handleUndoPrompt(prevLabel);
                              } else if (canApply) {
                                handleApplyPrompt(p.label);
                              }
                            }}
                            disabled={!canClick}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                              canClick ? "cursor-pointer" : "cursor-not-allowed"
                            } ${
                              processingPromptId === p.label || (processingPromptId === "__undo__" && isLast)
                                ? "bg-mutter-primary/60 text-white"
                                : isApplied
                                  ? "bg-mutter-primary text-white hover:bg-mutter-primary/70"
                                  : canApply
                                    ? "bg-mid-gray/15 text-text/50 hover:bg-mid-gray/25"
                                    : "bg-mid-gray/10 text-text/25"
                            }`}
                          >
                            {processingPromptId === p.label ? t("settings.journal.applyingPrompt") : p.label}
                          </button>
                        </React.Fragment>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </div>}

        </div>

      {/* Jots section — jotter sessions displayed between entry and chat history */}
      {(() => {
        const jotSessions = chatSessions.filter((s) => s.mode === "jotter" || s.mode === "noms");
        if (jotSessions.length === 0) return null;
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text/60 uppercase tracking-wide flex items-center gap-1">
                <Pencil className="w-3 h-3" />
                {t("settings.journal.jots")}
              </label>
              <Button
                onClick={async () => {
                  const confirmed = await ask(t("settings.journal.deleteAllJotsConfirm"), { kind: "warning" });
                  if (!confirmed) return;
                  try {
                    for (const s of jotSessions) {
                      if (chatSessionId === s.id) {
                        setChatSessionId(null);
                        setChatMessages([]);
                        setChatMode(null);
                        setChatOpen(false);
                        setJotterText("");
                      }
                      await journalCommands.deleteChatSession(s.id);
                    }
                    loadChatSessions();
                  } catch (error) {
                    console.error("Failed to clear jots:", error);
                  }
                }}
                variant="danger-ghost"
                size="sm"
                className="flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                {t("settings.journal.deleteAllJots")}
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {jotSessions.map((session) => (
                <div
                  key={session.id}
                  className={`group flex items-center justify-between gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                    chatSessionId === session.id
                      ? "border-mutter-primary bg-mutter-primary/10"
                      : "border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5"
                  }`}
                  onClick={async () => {
                    try {
                      const messages = await journalCommands.getChatMessages(session.id);
                      setChatSessionId(session.id);
                      setChatMode(session.mode as "jotter" | "noms");
                      setChatMessages(messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
                      if (messages.length > 0) {
                        setJotterText(messages[messages.length - 1].content);
                      }
                      setChatOpen(true);
                    } catch (error) {
                      console.error("Failed to load jot session:", error);
                    }
                  }}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {renamingSessionId === session.id ? (
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={async () => {
                          const trimmed = renameValue.trim();
                          if (trimmed && trimmed !== session.title) {
                            await journalCommands.updateChatSessionTitle(session.id, trimmed);
                            loadChatSessions();
                          }
                          setRenamingSessionId(null);
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenamingSessionId(null); }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-text/70 bg-transparent border-b border-mutter-primary focus:outline-none flex-1 min-w-0"
                      />
                    ) : (
                      <span
                        className="text-xs text-text/70 truncate flex-1"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => { e.stopPropagation(); setRenamingSessionId(session.id); setRenameValue(session.title); }}
                      >
                        {session.title || (session.mode === "noms" ? t("settings.meeting.chatModeNoms") : t("settings.journal.chatModeJotter"))}
                      </span>
                    )}
                    <span className="flex items-center gap-0.5 text-[10px] text-text/30 shrink-0">
                      <Clock className="w-2.5 h-2.5" />
                      {formatDateShort(String(session.updated_at))}
                    </span>
                  </div>
                  <button
                    onClick={async (ev) => {
                      ev.stopPropagation();
                      const confirmed = await ask(t("settings.journal.jotDeleteConfirm"), {
                        title: t("common.delete"),
                        kind: "warning",
                      });
                      if (!confirmed) return;
                      try {
                        await journalCommands.deleteChatSession(session.id);
                        if (chatSessionId === session.id) {
                          setChatSessionId(null);
                          setChatMessages([]);
                          setChatMode(null);
                          setChatOpen(false);
                          setJotterText("");
                        }
                        loadChatSessions();
                      } catch (error) {
                        console.error("Failed to delete jot session:", error);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text/30 hover:text-red-400 transition-all cursor-pointer shrink-0"
                    title={t("settings.journal.chatDeleteSession")}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Chat history badges — non-jotter sessions only */}
      {(() => {
        const chatOnlySessions = chatSessions.filter((s) => s.mode !== "jotter" && s.mode !== "noms");
        if (chatOnlySessions.length === 0) return null;
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text/60 uppercase tracking-wide flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />
                {t("settings.journal.chatHistory")}
              </label>
              <Button
                onClick={async () => {
                  const confirmed = await ask(t("settings.journal.deleteAllChatsConfirm"), { kind: "warning" });
                  if (!confirmed) return;
                  try {
                    for (const s of chatOnlySessions) {
                      if (chatSessionId === s.id) {
                        setChatSessionId(null);
                        setChatMessages([]);
                        setChatMode(null);
                        setChatOpen(false);
                      }
                      await journalCommands.deleteChatSession(s.id);
                    }
                    loadChatSessions();
                  } catch (error) {
                    console.error("Failed to clear chats:", error);
                  }
                }}
                variant="danger-ghost"
                size="sm"
                className="flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                {t("settings.journal.deleteAllChats")}
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {chatOnlySessions.map((session) => (
                <div
                  key={session.id}
                  className={`group flex items-center justify-between gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                    chatSessionId === session.id
                      ? "border-mutter-primary bg-mutter-primary/10"
                      : "border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5"
                  }`}
                  onClick={async () => {
                    try {
                      const messages = await journalCommands.getChatMessages(session.id);
                      setChatSessionId(session.id);
                      setChatMode(session.mode as "retrieve" | "sharpen" | "brainstorm" | "synthesise");
                      setChatMessages(messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
                      setChatOpen(true);
                    } catch (error) {
                      console.error("Failed to load chat session:", error);
                    }
                  }}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="px-1.5 py-0.5 bg-mutter-primary/15 text-mutter-primary text-[10px] rounded-full font-medium shrink-0">
                      {session.mode === "retrieve" ? t("settings.journal.chatModeRetrieve") : session.mode === "synthesise" ? t("settings.meeting.chatModeSynthesise") : session.mode === "sharpen" ? t("settings.journal.chatModeSharpen") : t("settings.journal.chatModeBrainstorm")}
                    </span>
                    {renamingSessionId === session.id ? (
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={async () => {
                          const trimmed = renameValue.trim();
                          if (trimmed && trimmed !== session.title) {
                            await journalCommands.updateChatSessionTitle(session.id, trimmed);
                            loadChatSessions();
                          }
                          setRenamingSessionId(null);
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenamingSessionId(null); }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-text/70 bg-transparent border-b border-mutter-primary focus:outline-none flex-1 min-w-0"
                      />
                    ) : (
                      <span
                        className="text-xs text-text/70 truncate flex-1"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => { e.stopPropagation(); setRenamingSessionId(session.id); setRenameValue(session.title); }}
                      >
                        {session.title || t("settings.journal.chatAssistant")}
                      </span>
                    )}
                    <span className="flex items-center gap-0.5 text-[10px] text-text/30 shrink-0">
                      <Clock className="w-2.5 h-2.5" />
                      {formatDateShort(String(session.updated_at))}
                    </span>
                  </div>
                  <button
                    onClick={async (ev) => {
                      ev.stopPropagation();
                      const confirmed = await ask(t("settings.journal.chatDeleteConfirm"), {
                        title: t("common.delete"),
                        kind: "warning",
                      });
                      if (!confirmed) return;
                      try {
                        await journalCommands.deleteChatSession(session.id);
                        if (chatSessionId === session.id) {
                          setChatSessionId(null);
                          setChatMessages([]);
                          setChatMode(null);
                          setChatOpen(false);
                        }
                        loadChatSessions();
                      } catch (error) {
                        console.error("Failed to delete chat session:", error);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text/30 hover:text-red-400 transition-all cursor-pointer shrink-0"
                    title={t("settings.journal.chatDeleteSession")}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Chat assistant FAB — sticky to bottom-right of scroll container */}
      <div className="sticky bottom-4 flex justify-end pointer-events-none">
        <button
          onClick={() => { if (chatOpen) { handleCloseChat(); } else { setChatOpen(true); } }}
          className="w-12 h-12 rounded-full bg-mutter-primary text-white shadow-lg hover:bg-mutter-primary/80 transition-colors cursor-pointer flex items-center justify-center pointer-events-auto"
          title={t("settings.journal.chatAssistant")}
        >
          {chatOpen ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
        </button>
      </div>

      {/* Chat panel */}
      {chatOpen && (
        <div
          className={`sticky bottom-4 bg-background border border-mid-gray/20 rounded-lg shadow-xl flex flex-col overflow-hidden transition-all max-w-2xl ml-auto ${
            chatMaximised ? "h-[80vh]" : "h-[28rem]"
          }`}
        >
          {/* Chat header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-mid-gray/20 shrink-0">
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <button
                onClick={() => { setChatMessages([]); setChatInput(""); setChatMode(null); setChatSessionId(null); setJotterText(""); }}
                className="text-xs font-medium text-text/70 shrink-0 hover:text-mutter-primary hover:underline cursor-pointer"
              >{t("settings.journal.chatAssistant")}</button>
              {chatMode && (
                <>
                  <ChevronRight className="w-3 h-3 text-text/30 shrink-0" />
                  <span className="px-1.5 py-0.5 bg-mutter-primary/15 text-mutter-primary text-[10px] rounded-full font-medium shrink-0">
                    {chatMode === "jotter" ? t("settings.journal.chatModeJotter") : chatMode === "noms" ? t("settings.meeting.chatModeNoms") : chatMode === "retrieve" ? t("settings.journal.chatModeRetrieve") : chatMode === "synthesise" ? t("settings.meeting.chatModeSynthesise") : chatMode === "sharpen" ? t("settings.journal.chatModeSharpen") : t("settings.journal.chatModeBrainstorm")}
                  </span>
                </>
              )}
              {chatSessionId && (() => {
                const session = chatSessions.find((s) => s.id === chatSessionId);
                return session?.title ? (
                  <>
                    <ChevronRight className="w-3 h-3 text-text/30 shrink-0" />
                    <span className="text-xs font-bold text-text/80 truncate">{session.title}</span>
                  </>
                ) : null;
              })()}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setChatMessages([]); setChatInput(""); setChatMode(null); setChatSessionId(null); setJotterText(""); }}
                className="p-1 rounded text-text/40 hover:text-text/70 hover:bg-mid-gray/10 cursor-pointer"
                title={t("settings.journal.chatNewSession")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
              <button
                onClick={() => setChatMaximised(!chatMaximised)}
                className="p-1 rounded text-text/40 hover:text-text/70 hover:bg-mid-gray/10 cursor-pointer"
              >
                {chatMaximised ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                )}
              </button>
              <button
                onClick={handleCloseChat}
                className="p-1 rounded text-text/40 hover:text-text/70 hover:bg-mid-gray/10 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Chat messages area */}
          <div ref={chatMessagesContainerRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {!chatMode ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <MessageCircle className="w-6 h-6 text-mutter-primary/30 shrink-0" />
                <p className="text-xs text-text/40 shrink-0">{t("settings.journal.chatPickMode")}</p>
                <div className="grid grid-cols-2 gap-2 w-full">
                  {isMeetingEntry ? (
                    <>
                      <button
                        onClick={() => { setChatMode("noms"); setJotterText(""); }}
                        className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5 transition-colors cursor-pointer text-center"
                      >
                        <div className="w-7 h-7 rounded-full bg-mutter-primary/15 flex items-center justify-center shrink-0">
                          <Pencil className="w-3.5 h-3.5 text-mutter-primary" />
                        </div>
                        <p className="text-xs font-medium">{t("settings.meeting.chatModeNoms")}</p>
                        <p className="text-[9px] text-text/40 leading-tight">{t("settings.meeting.chatModeNomsDesc")}</p>
                      </button>
                      <button
                        onClick={() => setChatMode("synthesise")}
                        className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5 transition-colors cursor-pointer text-center"
                      >
                        <div className="w-7 h-7 rounded-full bg-mutter-primary/15 flex items-center justify-center shrink-0">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-mutter-primary"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                        </div>
                        <p className="text-xs font-medium">{t("settings.meeting.chatModeSynthesise")}</p>
                        <p className="text-[9px] text-text/40 leading-tight">{t("settings.meeting.chatModeSynthesiseDesc")}</p>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { setChatMode("jotter"); setJotterText(""); }}
                        className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5 transition-colors cursor-pointer text-center"
                      >
                        <div className="w-7 h-7 rounded-full bg-mutter-primary/15 flex items-center justify-center shrink-0">
                          <Pencil className="w-3.5 h-3.5 text-mutter-primary" />
                        </div>
                        <p className="text-xs font-medium">{t("settings.journal.chatModeJotter")}</p>
                        <p className="text-[9px] text-text/40 leading-tight">{t("settings.journal.chatModeJotterDesc")}</p>
                      </button>
                      <button
                        onClick={() => setChatMode("retrieve")}
                        className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5 transition-colors cursor-pointer text-center"
                      >
                        <div className="w-7 h-7 rounded-full bg-mutter-primary/15 flex items-center justify-center shrink-0">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-mutter-primary"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                        </div>
                        <p className="text-xs font-medium">{t("settings.journal.chatModeRetrieve")}</p>
                        <p className="text-[9px] text-text/40 leading-tight">{t("settings.journal.chatModeRetrieveDesc")}</p>
                      </button>
                      <button
                        onClick={() => setChatMode("sharpen")}
                        className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5 transition-colors cursor-pointer text-center"
                      >
                        <div className="w-7 h-7 rounded-full bg-mutter-primary/15 flex items-center justify-center shrink-0">
                          <Pencil className="w-3.5 h-3.5 text-mutter-primary" />
                        </div>
                        <p className="text-xs font-medium">{t("settings.journal.chatModeSharpen")}</p>
                        <p className="text-[9px] text-text/40 leading-tight">{t("settings.journal.chatModeSharpenDesc")}</p>
                      </button>
                      <button
                        onClick={() => setChatMode("brainstorm")}
                        className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5 transition-colors cursor-pointer text-center"
                      >
                        <div className="w-7 h-7 rounded-full bg-mutter-primary/15 flex items-center justify-center shrink-0">
                          <Lightbulb className="w-3.5 h-3.5 text-mutter-primary" />
                        </div>
                        <p className="text-xs font-medium">{t("settings.journal.chatModeBrainstorm")}</p>
                        <p className="text-[9px] text-text/40 leading-tight">{t("settings.journal.chatModeBrainstormDesc")}</p>
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : chatMode === "noms" ? (
              <NomsEditor
                entry={entry}
                jotterText={jotterText}
                onJotterChange={handleJotterChange}
                promptOverrides={promptOverrides}
              />
            ) : chatMode === "jotter" ? (
              <div className="flex flex-col h-full">
                <JotterEditor
                  content={jotterText}
                  onChange={handleJotterChange}
                  placeholder={t("settings.journal.jotterPlaceholder")}
                  tags={allKnownTags}
                  entries={allEntries.map((e) => ({ id: e.id, title: e.title }))}
                  folders={allFolders.map((f) => ({ id: f.id, name: f.name }))}
                />
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                <MessageCircle className="w-8 h-8 text-mutter-primary/30" />
                <p className="text-xs text-text/40">{t("settings.journal.chatPlaceholder")}</p>
              </div>
            ) : (
              chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                      msg.role === "user"
                        ? "bg-mutter-primary text-white"
                        : "text-text/90 [&_p]:mb-3 [&_p:last-child]:mb-0"
                    }`}
                  >
                    <Markdown
                      remarkPlugins={[remarkBreaks, remarkGfm]}
                      components={msg.role === "assistant" ? {
                        // Render inline code as tag badges if it matches a known tag
                        code: ({ children }) => {
                          const text = String(children).trim();
                          if (entry && entry.tags.includes(text)) {
                            return (
                              <span className="inline-flex px-1.5 py-0.5 bg-mutter-primary/20 text-mutter-primary text-[10px] rounded-full font-medium align-middle mx-0.5">
                                {text}
                              </span>
                            );
                          }
                          return <code className="px-1 py-0.5 bg-mid-gray/20 rounded text-xs">{children}</code>;
                        },
                      } : undefined}
                    >
                      {msg.content.replace(/^"|"$/g, "").replace(/\\n/g, "\n")}
                    </Markdown>
                  </div>
                </div>
              ))
            )}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-lg bg-mid-gray/15 text-text/40 text-sm animate-pulse">
                  ...
                </div>
              </div>
            )}
            <div ref={chatMessagesEndRef} />
          </div>

          {/* Context meter + Chat input (hidden in jotter mode) */}
          {chatMode !== "jotter" && (
          <div className="px-3 py-2 border-t border-mid-gray/20 shrink-0 space-y-1.5">
            {/* Context usage meter */}
            {chatMode && chatMessages.length > 0 && (
              <div className="space-y-0.5">
                <span className="text-[10px] text-text/30">{t("settings.journal.chatContextLabel")}</span>
                {isCompacting ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-mid-gray/10 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-mutter-primary/60 via-mutter-primary to-mutter-primary/60 rounded-full animate-pulse" style={{ width: "100%" }} />
                    </div>
                    <span className="text-[10px] text-mutter-primary animate-pulse">{t("settings.journal.chatCompacting")}</span>
                  </div>
                ) : editingContext ? (
                  <div className="flex items-center gap-2">
                    {activeModelName && (
                      <span className="text-[10px] text-text/30 shrink-0 truncate max-w-[100px]" title={activeModelName}>
                        {activeModelName}
                      </span>
                    )}
                    <input
                      autoFocus
                      type="number"
                      value={contextInputValue}
                      onChange={(e) => setContextInputValue(e.target.value)}
                      onBlur={() => {
                        const val = parseInt(contextInputValue, 10);
                        if (val > 0) {
                          setContextOverride(val);
                        } else {
                          setContextOverride(null);
                        }
                        setEditingContext(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") { setEditingContext(false); }
                      }}
                      placeholder={String(detectedContextWindow)}
                      className="flex-1 text-[10px] text-text/50 bg-mid-gray/10 border border-mutter-primary/40 rounded px-1.5 py-0.5 focus:outline-none focus:border-mutter-primary min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-[10px] text-text/30 shrink-0">{t("settings.journal.chatContextTokens")}</span>
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-2 cursor-pointer group/ctx"
                    onClick={() => { setEditingContext(true); setContextInputValue(String(MAX_CONTEXT_TOKENS)); }}
                    title={t("settings.journal.chatContextClickToEdit")}
                  >
                    {activeModelName && (
                      <span className="text-[10px] text-text/30 shrink-0 truncate max-w-[100px]" title={activeModelName}>
                        {activeModelName}
                      </span>
                    )}
                    <div className="flex-1 h-1.5 bg-mid-gray/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          contextUsage >= COMPACTION_THRESHOLD ? "bg-amber-500" : contextUsage >= 0.5 ? "bg-mutter-primary" : "bg-mutter-primary/60"
                        }`}
                        style={{ width: `${Math.max(contextUsage * 100, 2)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-text/30 shrink-0 group-hover/ctx:text-mutter-primary transition-colors">
                      {Math.round(contextUsage * 100)}%
                      {contextOverride ? ` (${(MAX_CONTEXT_TOKENS / 1000).toFixed(0)}k)` : ""}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={chatInput}
                onChange={(e) => {
                  setChatInput(e.target.value);
                  // Auto-resize
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
                placeholder={t("settings.journal.chatInputPlaceholder")}
                disabled={chatLoading || !chatMode}
                rows={1}
                className="flex-1 px-3 py-1.5 bg-mid-gray/10 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-mutter-primary disabled:opacity-50 resize-none overflow-y-auto"
                style={{ maxHeight: "120px" }}
              />
              <button
                onClick={handleChatSend}
                disabled={chatLoading || !chatMode || !chatInput.trim()}
                className="p-1.5 rounded-md bg-mutter-primary text-white hover:bg-mutter-primary/80 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
              </button>
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  );
};
