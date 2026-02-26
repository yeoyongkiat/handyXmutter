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
  Square,
  Trash2,
  X,
  Tag,
  Link2,
  Sparkles,
  Check,
  Pencil,
  FolderClosed,
  FolderPlus,
  BookOpen,
  ChevronRight,
  MessageCircle,
  Clock,
  Upload,
  Play,
  Search,
  FolderOpen,
  Calendar,
  Youtube,
  Video,
  Globe,
  Loader2,
  Users,
  Download,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readFile } from "@tauri-apps/plugin-fs";
import { ask, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useOsType } from "@/hooks/useOsType";
import { formatDateShort } from "@/utils/dateFormat";
import {
  journalCommands,
  videoCommands,
  meetingCommands,
  MUTTER_DEFAULT_PROMPTS,
  type JournalEntry,
  type JournalFolder,
} from "@/lib/journal";
import { useMutterStore } from "@/stores/mutterStore";
import { isDesktop } from "@/lib/platform";
import {
  type ViewMode,
  type EntrySource,
  searchEntries,
} from "./journalUtils";
import { DetailView } from "./DetailView";

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

// Inline folder creation button for breadcrumb action area
const FolderCreateButton: React.FC<{ onFolderCreated: () => void; createFolderFn?: (name: string) => Promise<JournalFolder> }> = ({ onFolderCreated, createFolderFn }) => {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");

  const doCreateFolder = createFolderFn ?? journalCommands.createFolder;

  const handleCreate = async () => {
    const trimmed = folderName.trim();
    if (!trimmed) return;
    try {
      await doCreateFolder(trimmed);
      setFolderName("");
      setCreating(false);
      onFolderCreated();
    } catch (error) {
      console.error("Failed to create folder:", error);
    }
  };

  if (creating) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
            if (e.key === "Escape") { setCreating(false); setFolderName(""); }
          }}
          placeholder={t("settings.journal.folderName")}
          className="px-2 py-1 bg-background border border-mid-gray/20 rounded text-xs focus:outline-none focus:border-mutter-primary w-32"
        />
        <button onClick={handleCreate} className="text-text/60 hover:text-green-500 cursor-pointer">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => { setCreating(false); setFolderName(""); }} className="text-text/60 hover:text-red-400 cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <MutterButton onClick={() => setCreating(true)} className="flex items-center gap-1">
      <FolderPlus className="w-3.5 h-3.5" />
      <span>{t("settings.journal.newFolder")}</span>
    </MutterButton>
  );
};

// ViewMode and EntrySource types are in ./journalUtils
export type { EntrySource } from "./journalUtils";

interface JournalSettingsProps {
  source?: EntrySource;
  selectedEntryId?: number | null;
  selectedFolderId?: number | null;
  onSelectEntry?: (id: number | null) => void;
  onSelectFolder?: (id: number | null) => void;
}

export const JournalSettings: React.FC<JournalSettingsProps> = ({
  source = "voice",
  selectedEntryId,
  selectedFolderId,
  onSelectEntry,
  onSelectFolder,
}) => {
  const { t } = useTranslation();
  const [view, setView] = useState<ViewMode>({ mode: "loading" });
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [folders, setFolders] = useState<JournalFolder[]>([]);

  // Select the right commands based on source
  const cmds = source === "video" ? videoCommands : source === "meeting" ? meetingCommands : journalCommands;

  const loadData = useCallback(async () => {
    try {
      const [entryData, folderData] = await Promise.all([
        source === "video" ? videoCommands.getEntries() : source === "meeting" ? meetingCommands.getEntries() : journalCommands.getEntries(),
        source === "video" ? videoCommands.getFolders() : source === "meeting" ? meetingCommands.getFolders() : journalCommands.getFolders(),
      ]);
      setEntries(entryData);
      setFolders(folderData);
      return { entries: entryData, folders: folderData };
    } catch (error) {
      console.error("Failed to load data:", error);
      return null;
    }
  }, [source]);

  // Initial load — determine starting view
  useEffect(() => {
    loadData().then((data) => {
      if (!data) return;
      if (data.folders.length === 0) {
        setView({ mode: "welcome" });
      } else {
        setView({ mode: "folders" });
      }
    });
  }, [loadData]);

  // Listen for backend updates
  useEffect(() => {
    const setupListener = async () => {
      return await listen("journal-updated", () => loadData());
    };
    const unlistenPromise = setupListener();
    return () => {
      unlistenPromise.then((unlisten) => unlisten?.());
    };
  }, [loadData]);

  // Navigate to entry detail when sidebar selects an entry
  useEffect(() => {
    if (selectedEntryId != null) {
      const entry = entries.find((e) => e.id === selectedEntryId);
      if (entry && entry.folder_id != null) {
        setView({ mode: "detail", entryId: selectedEntryId, folderId: entry.folder_id, trail: [] });
      }
    }
  }, [selectedEntryId, entries]);

  // Navigate into folder when sidebar selects a folder
  useEffect(() => {
    if (selectedFolderId != null) {
      setView({ mode: "folder", folderId: selectedFolderId });
    }
  }, [selectedFolderId]);

  // Processing entries state (for entries being downloaded/imported/transcribed)
  const processingEntries = useMutterStore((s) => s.processingEntries);
  const setProcessingEntry = useMutterStore((s) => s.setProcessingEntry);
  const clearProcessingEntry = useMutterStore((s) => s.clearProcessingEntry);

  // React to sidebar search query changes
  const searchQuery = useMutterStore((s) => s.searchQuery);
  const setSearchQuery = useMutterStore((s) => s.setSearchQuery);
  const prevSearchRef = useRef("");
  useEffect(() => {
    const q = searchQuery.trim();
    const prev = prevSearchRef.current;
    prevSearchRef.current = q;
    if (q && !prev) {
      // Entered search mode
      setView({ mode: "search", query: q });
    } else if (q && prev) {
      // Updated search query
      setView({ mode: "search", query: q });
    } else if (!q && prev) {
      // Cleared search — go back to folders
      if (folders.length > 0) {
        setView({ mode: "folders" });
      } else {
        setView({ mode: "welcome" });
      }
    }
  }, [searchQuery, folders.length]);

  const handleFolderCreated = async () => {
    const data = await loadData();
    if (!data) return;
    if (data.folders.length > 0) {
      setView({ mode: "folders" });
    } else {
      setView({ mode: "welcome" });
    }
  };

  const handleOpenFolder = (folderId: number) => {
    setView({ mode: "folder", folderId });
    onSelectFolder?.(folderId);
    onSelectEntry?.(null);
  };

  const handleBackToFolders = () => {
    setView({ mode: "folders" });
    onSelectFolder?.(null);
    onSelectEntry?.(null);
  };

  const handleNewEntry = (folderId: number) => {
    setView({ mode: "new-entry", folderId });
  };

  const handleStartRecording = async (folderId: number) => {
    try {
      // Clear any stale recording state before starting
      try { await journalCommands.stopRecording(); } catch { /* no prior recording, that's fine */ }
      await journalCommands.startRecording();
      setView({ mode: "recording", folderId });
    } catch (error) {
      console.error("Failed to start recording:", error);
    }
  };

  const handleImportAudio = async (folderId: number, filePath?: string) => {
    const path = filePath || await (async () => {
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav", "wave"] }],
      });
      return selected ?? null;
    })();
    if (!path) return;

    try {
      // Create a pending entry immediately
      const title = new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const entry = await journalCommands.saveEntry({
        fileName: "",
        title,
        transcriptionText: "",
        postProcessedText: null,
        postProcessPromptId: null,
        tags: [],
        linkedEntryIds: [],
        folderId,
      });
      await loadData();
      setProcessingEntry(entry.id, "importing", 0);
      setView({ mode: "detail", entryId: entry.id, folderId, trail: [] });

      // Import + transcribe in background
      journalCommands.importAudio(path).then(async (result) => {
        await journalCommands.updateEntryAfterProcessing(
          entry.id, result.file_name, title, result.transcription_text
        );
        clearProcessingEntry(entry.id);
        loadData();
      }).catch((error) => {
        console.error("Failed to import audio:", error);
        clearProcessingEntry(entry.id);
        toast.error(String(error));
      });
    } catch (error) {
      console.error("Failed to create entry:", error);
      setView({ mode: "new-entry", folderId });
    }
  };

  const handleStopRecording = async (folderId: number) => {
    try {
      const result = await journalCommands.stopRecording();
      // Auto-save entry and go straight to detail view
      const title = new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      await journalCommands.saveEntry({
        fileName: result.file_name,
        title,
        transcriptionText: result.transcription_text,
        postProcessedText: null,
        postProcessPromptId: null,
        tags: [],
        linkedEntryIds: [],
        folderId,
      });
      await loadData();
      // Find the newly saved entry (most recent)
      const updated = await journalCommands.getEntries();
      const newest = updated.sort((a, b) => b.timestamp - a.timestamp)[0];
      if (newest) {
        setView({ mode: "detail", entryId: newest.id, folderId, trail: [] });
      } else {
        setView({ mode: "folder", folderId });
      }
    } catch (error) {
      console.error("Failed to stop recording:", error);
      setView({ mode: "folder", folderId });
    }
  };

  const handleCancelRecording = (folderId: number) => {
    journalCommands.stopRecording().catch(() => {});
    setView({ mode: "folder", folderId });
  };

  const handleDiscard = async (fileName: string, folderId: number) => {
    try {
      await journalCommands.discardRecording(fileName);
    } catch (error) {
      console.error("Failed to discard recording:", error);
    }
    setView({ mode: "folder", folderId });
  };

  // --- Video-specific handlers ---

  const handleYouTubeInput = (folderId: number) => {
    setView({ mode: "youtube-input", folderId });
  };

  const handleYouTubeSubmit = async (folderId: number, url: string) => {
    try {
      // Check if yt-dlp is installed
      const installed = await videoCommands.checkYtDlpInstalled();
      if (!installed) {
        const shouldInstall = await ask(
          t("settings.video.ytdlpInstallPrompt"),
          { title: "yt-dlp", kind: "info" }
        );
        if (!shouldInstall) {
          return;
        }
        toast.info(t("settings.video.ytdlpInstalling"));
        await videoCommands.installYtDlp();
        toast.success(t("settings.video.ytdlpInstalled"));
      }

      // Create a pending entry immediately so the user sees it
      const entry = await videoCommands.saveEntry({
        fileName: "",
        title: "YouTube Video",
        transcriptionText: "",
        source: "youtube",
        sourceUrl: url,
        folderId,
      });
      await loadData();
      setProcessingEntry(entry.id, "downloading", 0);
      setView({ mode: "detail", entryId: entry.id, folderId, trail: [] });

      // Download + transcribe in background, then auto-diarize with 1 speaker default
      videoCommands.downloadYouTubeAudio(url).then(async (result) => {
        await videoCommands.updateEntryAfterProcessing(
          entry.id, result.file_name, result.title, result.transcription
        );
        // Auto-diarize with default 1 speaker
        setProcessingEntry(entry.id, "diarizing", 0);
        await videoCommands.diarizeEntry(entry.id, 1, 0.5);
        clearProcessingEntry(entry.id);
        loadData();
      }).catch((error) => {
        console.error("Failed to download YouTube audio:", error);
        clearProcessingEntry(entry.id);
        toast.error(String(error));
      });
    } catch (error) {
      console.error("YouTube submit failed:", error);
      toast.error(String(error));
      setView({ mode: "youtube-input", folderId });
    }
  };

  const handleImportVideo = async (folderId: number, filePath?: string) => {
    const path = filePath || await (async () => {
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "m4a", "mp3"] }],
      });
      return selected ?? null;
    })();
    if (!path) return;

    // Import video directly with auto-diarize (1 speaker default)
    const title = new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    try {
      const entry = await videoCommands.saveEntry({
        fileName: "",
        title,
        transcriptionText: "",
        source: "video",
        sourceUrl: null,
        folderId,
      });
      await loadData();
      setProcessingEntry(entry.id, "importing", 0);
      setView({ mode: "detail", entryId: entry.id, folderId, trail: [] });

      videoCommands.importVideo(path).then(async (result) => {
        await videoCommands.updateEntryAfterProcessing(
          entry.id, result.file_name, title, result.transcription_text
        );
        // Auto-diarize with default 1 speaker
        setProcessingEntry(entry.id, "diarizing", 0);
        await videoCommands.diarizeEntry(entry.id, 1, 0.5);
        clearProcessingEntry(entry.id);
        loadData();
      }).catch((error) => {
        console.error("Failed to import video:", error);
        clearProcessingEntry(entry.id);
        toast.error(String(error));
      });
    } catch (error) {
      console.error("Failed to create video entry:", error);
      toast.error(String(error));
      setView({ mode: "new-entry", folderId });
    }
  };

  // --- Meeting-specific handlers ---

  const handleMeetingStopRecording = async (folderId: number) => {
    try {
      const result = await journalCommands.stopRecording();
      const title = new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const entry = await meetingCommands.saveEntry({
        fileName: result.file_name,
        title,
        transcriptionText: "",
        folderId,
      });
      await loadData();
      // Auto-diarize with default 1 speaker
      setProcessingEntry(entry.id, "diarizing", 0);
      setView({ mode: "detail", entryId: entry.id, folderId, trail: [] });
      meetingCommands.transcribeMeeting(entry.id, 1, 0.5).then(() => {
        clearProcessingEntry(entry.id);
        loadData();
      }).catch((error) => {
        console.error("Meeting transcription failed:", error);
        clearProcessingEntry(entry.id);
        toast.error(String(error));
      });
    } catch (error) {
      console.error("Failed to stop meeting recording:", error);
      setView({ mode: "folder", folderId });
    }
  };

  const handleImportMeeting = async (folderId: number, filePath?: string) => {
    const path = filePath || await (async () => {
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav"] }],
      });
      return selected ?? null;
    })();
    if (!path) return;

    // Import audio directly with auto-diarize (1 speaker default)
    const title = new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    try {
      const entry = await meetingCommands.saveEntry({
        fileName: "",
        title,
        transcriptionText: "",
        folderId,
      });
      await loadData();
      setProcessingEntry(entry.id, "importing", 0);
      setView({ mode: "detail", entryId: entry.id, folderId, trail: [] });

      meetingCommands.importAudio(path).then(async (result) => {
        await meetingCommands.updateEntryAfterProcessing(
          entry.id, result.file_name, title, ""
        );
        // Auto-diarize with default 1 speaker
        setProcessingEntry(entry.id, "diarizing", 0);
        await meetingCommands.transcribeMeeting(entry.id, 1, 0.5);
        clearProcessingEntry(entry.id);
        loadData();
      }).catch((error) => {
        console.error("Failed to import meeting audio:", error);
        clearProcessingEntry(entry.id);
        toast.error(String(error));
      });
    } catch (error) {
      console.error("Failed to create meeting entry:", error);
      toast.error(String(error));
      setView({ mode: "new-entry", folderId });
    }
  };


  const handleSaved = (folderId: number) => {
    setView({ mode: "folder", folderId });
    onSelectEntry?.(null);
    loadData();
  };

  const handleOpenDetail = (entryId: number, folderId: number, trail: number[] = [], fromTag?: string) => {
    setView({ mode: "detail", entryId, folderId, trail, fromTag });
    // Only update sidebar selection for direct navigation (not linked entry traversal)
    if (trail.length === 0 && !fromTag) {
      onSelectEntry?.(entryId);
    }
  };

  const handleOpenTag = (tag: string, folderId: number, trail: number[]) => {
    setView({ mode: "tag", tag, folderId, trail });
  };

  const handleBackToFolder = (folderId: number) => {
    setView({ mode: "folder", folderId });
    onSelectEntry?.(null);
    loadData();
  };

  if (view.mode === "loading") {
    return (
      <div className="max-w-3xl w-full mx-auto">
        <div className="px-4 py-3 text-center text-text/60">
          {t("settings.journal.loading")}
        </div>
      </div>
    );
  }

  if (view.mode === "welcome") {
    return (
      <WelcomeView
        onFolderCreated={handleFolderCreated}
        source={source}
        createFolderFn={source === "video" ? videoCommands.createFolder : source === "meeting" ? meetingCommands.createFolder : undefined}
      />
    );
  }

  // Build breadcrumb segments
  const breadcrumbs: { label: string; onClick?: () => void; isBadge?: boolean }[] = [];
  const folderName = ("folderId" in view && view.folderId)
    ? folders.find((f) => f.id === view.folderId)?.name
    : undefined;
  const entryTitle = ("entryId" in view && view.entryId)
    ? entries.find((e) => e.id === view.entryId)?.title
    : undefined;

  if (view.mode === "search") {
    breadcrumbs.push({ label: t("settings.journal.folders.title"), onClick: () => { setSearchQuery(""); handleBackToFolders(); } });
    breadcrumbs.push({ label: t("settings.journal.search.results") });
  } else if (view.mode === "folders") {
    breadcrumbs.push({ label: t("settings.journal.folders.title") });
  } else if (view.mode === "tag") {
    breadcrumbs.push({ label: t("settings.journal.folders.title"), onClick: handleBackToFolders });
    // Folder
    const tagFolderName = folders.find((f) => f.id === view.folderId)?.name;
    if (tagFolderName) {
      breadcrumbs.push({ label: tagFolderName, onClick: () => handleBackToFolder(view.folderId) });
    }
    // Trail entries (clickable)
    view.trail.forEach((trailId, idx) => {
      const trailEntry = entries.find((e) => e.id === trailId);
      if (trailEntry) {
        breadcrumbs.push({
          label: trailEntry.title,
          onClick: () => handleOpenDetail(trailId, view.folderId, view.trail.slice(0, idx)),
        });
      }
    });
    // Tag badge (current, not clickable)
    breadcrumbs.push({ label: view.tag, isBadge: true });
  } else {
    // All other modes have "Folders" as clickable root
    breadcrumbs.push({ label: t("settings.journal.folders.title"), onClick: handleBackToFolders });
    if (folderName) {
      const fid = (view as { folderId: number }).folderId;
      if (view.mode === "folder") {
        breadcrumbs.push({ label: folderName });
      } else {
        breadcrumbs.push({ label: folderName, onClick: () => handleBackToFolder(fid) });
      }
    }
    if (view.mode === "detail") {
      // Add trail entries as clickable breadcrumbs
      const trail = view.trail;
      trail.forEach((trailId, idx) => {
        const trailEntry = entries.find((e) => e.id === trailId);
        if (trailEntry) {
          breadcrumbs.push({
            label: trailEntry.title,
            onClick: () => handleOpenDetail(trailId, view.folderId, trail.slice(0, idx)),
          });
        }
      });
      // Tag badge if navigated from a tag view
      if (view.fromTag) {
        breadcrumbs.push({
          label: view.fromTag,
          isBadge: true,
          onClick: () => handleOpenTag(view.fromTag!, view.folderId, view.trail),
        });
      }
      // Current entry (not clickable)
      if (entryTitle) {
        breadcrumbs.push({ label: entryTitle });
      }
    }
    if (view.mode === "new-entry") {
      breadcrumbs.push({ label: t("settings.journal.newEntry") });
    }
    if (view.mode === "recording") {
      breadcrumbs.push({ label: t("settings.journal.recording") });
    }
    if (view.mode === "draft") {
      breadcrumbs.push({ label: t("settings.journal.newEntryTitle") });
    }
    if (view.mode === "importing") {
      breadcrumbs.push({ label: source === "video" ? t("settings.video.importingVideo") : t("settings.journal.importingAudio") });
    }
    if (view.mode === "youtube-input") {
      breadcrumbs.push({ label: t("settings.video.youtubeInput") });
    }
  }

  // Determine right-side action button
  let actionButton: React.ReactNode = null;
  if (view.mode === "folders") {
    actionButton = <FolderCreateButton onFolderCreated={handleFolderCreated} createFolderFn={source === "video" ? videoCommands.createFolder : source === "meeting" ? meetingCommands.createFolder : undefined} />;
  } else if (view.mode === "folder") {
    actionButton = (
      <MutterButton
        onClick={() => handleNewEntry(view.folderId)}
        className="flex items-center gap-2"
      >
        {source === "video" ? <Globe className="w-4 h-4" /> : source === "meeting" ? <Users className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        <span>{t("settings.journal.newEntry")}</span>
      </MutterButton>
    );
  }

  return (
    <div className="w-full mx-auto px-6 space-y-4">
      {/* Breadcrumb header */}
      <div className="px-4 flex items-center justify-between">
        <nav className="flex items-center gap-1 text-xs min-w-0">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight className="w-3 h-3 text-text/30 shrink-0" />}
              {crumb.isBadge ? (
                crumb.onClick ? (
                  <button
                    onClick={crumb.onClick}
                    className="px-2 py-0.5 bg-mutter-primary/20 text-mutter-primary text-xs rounded-full font-medium hover:bg-mutter-primary/30 cursor-pointer transition-colors"
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className="px-2 py-0.5 bg-mutter-primary/20 text-mutter-primary text-xs rounded-full font-medium">
                    {crumb.label}
                  </span>
                )
              ) : crumb.onClick ? (
                <button
                  onClick={crumb.onClick}
                  className="text-mutter-primary hover:text-mutter-primary/80 font-medium cursor-pointer truncate"
                >
                  {crumb.label}
                </button>
              ) : (
                <span className="font-medium text-text/70 truncate">{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
        {actionButton}
      </div>

      {/* View content */}
      {view.mode === "folders" && (
        <FoldersView
          folders={folders}
          entries={entries}
          onOpenFolder={handleOpenFolder}
          onFolderCreated={handleFolderCreated}
          createFolderFn={source === "video" ? videoCommands.createFolder : source === "meeting" ? meetingCommands.createFolder : undefined}
        />
      )}
      {view.mode === "folder" && (() => {
        const folderEntries = entries.filter((e) => e.folder_id === view.folderId);
        const folder = folders.find((f) => f.id === view.folderId);
        return (
          <FolderDetailView
            folder={folder}
            folders={folders}
            entries={folderEntries}
            source={source}
            onStartRecording={() => handleNewEntry(view.folderId)}
            onOpenDetail={(entryId) => handleOpenDetail(entryId, view.folderId)}
            onDeleteEntry={async (entryId) => {
              const confirmed = await ask(t("settings.journal.deleteEntryConfirm"), { kind: "warning" });
              if (!confirmed) return;
              try {
                await journalCommands.deleteEntry(entryId);
                await loadData();
              } catch (error) {
                console.error("Failed to delete entry:", error);
              }
            }}
            onDeleteAll={async () => {
              const confirmed = await ask(t("settings.journal.deleteAllEntriesConfirm"), { kind: "warning" });
              if (!confirmed) return;
              try {
                for (const entry of folderEntries) {
                  await journalCommands.deleteEntry(entry.id);
                }
                await loadData();
              } catch (error) {
                console.error("Failed to delete entries:", error);
              }
            }}
            onMoveEntry={async (entryId, folderId) => {
              try {
                await journalCommands.moveEntryToFolder(entryId, folderId);
                const movedEntry = entries.find((e) => e.id === entryId);
                const targetFolder = folders.find((f) => f.id === folderId);
                if (targetFolder && movedEntry) toast(<span><strong>{movedEntry.title}</strong> moved to <strong>{targetFolder.name}</strong></span>);
                await loadData();
              } catch (error) {
                console.error("Failed to move entry:", error);
              }
            }}
          />
        );
      })()}
      {view.mode === "new-entry" && source === "voice" && (
        <NewEntryView
          onRecord={() => handleStartRecording(view.folderId)}
          onImport={(filePath) => handleImportAudio(view.folderId, filePath)}
          onCancel={() => setView({ mode: "folder", folderId: view.folderId })}
        />
      )}
      {view.mode === "new-entry" && source === "video" && (
        <YouTubeInputView
          onSubmit={(url) => handleYouTubeSubmit(view.folderId, url)}
          onCancel={() => setView({ mode: "folder", folderId: view.folderId })}
        />
      )}
      {view.mode === "new-entry" && source === "meeting" && (
        <MeetingNewEntryView
          onRecord={() => handleStartRecording(view.folderId)}
          onImport={() => handleImportMeeting(view.folderId)}
          onCancel={() => setView({ mode: "folder", folderId: view.folderId })}
        />
      )}
      {view.mode === "youtube-input" && (
        <YouTubeInputView
          onSubmit={(url) => handleYouTubeSubmit(view.folderId, url)}
          onCancel={() => setView({ mode: "folder", folderId: view.folderId })}
        />
      )}
      {view.mode === "recording" && (
        <RecordingView
          onStop={() => source === "meeting" ? handleMeetingStopRecording(view.folderId) : handleStopRecording(view.folderId)}
          onCancel={() => handleCancelRecording(view.folderId)}
        />
      )}
      {view.mode === "importing" && <ImportingView />}
      {view.mode === "draft" && (
        <DraftView
          fileName={view.fileName}
          transcription={view.transcription}
          folderId={view.folderId}
          allEntries={entries}
          onSave={() => handleSaved(view.folderId)}
          onDiscard={() => handleDiscard(view.fileName, view.folderId)}
        />
      )}
      {view.mode === "detail" && (
        <DetailView
          entryId={view.entryId}
          allEntries={entries}
          allFolders={folders}
          onBack={() => handleBackToFolder(view.folderId)}
          onNavigateToEntry={(linkedId) =>
            handleOpenDetail(linkedId, view.folderId, [...view.trail, view.entryId])
          }
          onOpenTag={(tag) => handleOpenTag(tag, view.folderId, [...view.trail, view.entryId])}
        />
      )}
      {view.mode === "tag" && (() => {
        const tagEntries = entries.filter((e) => e.tags.includes(view.tag));
        return (
          <div className="px-4">
            {tagEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
                <p className="text-sm text-text/50">{t("settings.journal.noEntriesForTag")}</p>
              </div>
            ) : (
              <div className="bg-background border border-mid-gray/20 rounded-lg overflow-visible">
                <div className="divide-y divide-mid-gray/20">
                  {tagEntries.map((entry) => (
                    <JournalEntryCard
                      key={entry.id}
                      entry={entry}
                      onClick={() => {
                        const folderId = entry.folder_id ?? view.folderId;
                        handleOpenDetail(entry.id, folderId, view.trail, view.tag);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
      {view.mode === "search" && (
        <SearchResultsView
          query={view.query}
          entries={entries}
          folders={folders}
          onOpenDetail={(entryId) => {
            const entry = entries.find((e) => e.id === entryId);
            const folderId = entry?.folder_id ?? 0;
            setSearchQuery("");
            handleOpenDetail(entryId, folderId);
          }}
        />
      )}
    </div>
  );
};

// --- Search Results View ---
// MONTH_NAMES, MONTH_ABBR, parseDateRange, searchEntries moved to ./journalUtils

const SearchResultsView: React.FC<{
  query: string;
  entries: JournalEntry[];
  folders: JournalFolder[];
  onOpenDetail: (entryId: number) => void;
}> = ({ query, entries, folders, onOpenDetail }) => {
  const { t } = useTranslation();
  const results = searchEntries(query, entries, folders);

  // Determine search type for display
  const isFolderSearch = query.startsWith("@");
  const isTagSearch = query.startsWith("#");
  const isDateSearch = query.startsWith("::");
  const isLinkSearch = /^\[.+\]$/.test(query);
  const isSourceSearch = query.startsWith("/s ");

  return (
    <div className="px-4">
      {/* Search type indicator */}
      <div className="flex items-center gap-2 mb-3">
        <Search className="w-3.5 h-3.5 text-text/40" />
        <span className="text-xs text-text/50">
          {isFolderSearch && (
            <span className="inline-flex items-center gap-1">
              <FolderOpen className="w-3 h-3 text-mutter-primary" />
              <span className="text-mutter-primary font-medium">{query.slice(1)}</span>
            </span>
          )}
          {isTagSearch && (
            <span className="px-1.5 py-0.5 bg-mutter-primary/15 text-mutter-primary text-[10px] rounded-full">
              {query.slice(1)}
            </span>
          )}
          {isDateSearch && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3 h-3 text-mutter-primary" />
              <span className="text-mutter-primary font-medium">{query.slice(2)}</span>
            </span>
          )}
          {isLinkSearch && (
            <span className="inline-flex items-center gap-1">
              <Link2 className="w-3 h-3 text-mutter-primary" />
              <span className="text-mutter-primary font-medium">{query.slice(1, -1)}</span>
            </span>
          )}
          {isSourceSearch && (
            <span className="inline-flex items-center gap-1">
              <Globe className="w-3 h-3 text-mutter-primary" />
              <span className="text-mutter-primary font-medium">{query.slice(3)}</span>
            </span>
          )}
          {!isFolderSearch && !isTagSearch && !isDateSearch && !isLinkSearch && !isSourceSearch && (
            <span className="text-text/60">&ldquo;{query}&rdquo;</span>
          )}
          <span className="ml-2 text-text/30">
            {results.length} {results.length === 1 ? "result" : "results"}
          </span>
        </span>
      </div>

      {results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-mid-gray/10 flex items-center justify-center">
            <Search className="w-6 h-6 text-text/20" />
          </div>
          <p className="text-sm text-text/50">
            {t("settings.journal.search.noResults")}
          </p>
        </div>
      ) : (
        <div className="bg-background border border-mid-gray/20 rounded-lg overflow-visible">
          <div className="divide-y divide-mid-gray/20">
            {results.map((entry) => {
              const folder = folders.find((f) => f.id === entry.folder_id);
              return (
                <div key={entry.id} className="relative">
                  <JournalEntryCard
                    entry={entry}
                    onClick={() => onOpenDetail(entry.id)}
                  />
                  {folder && (
                    <span className="absolute top-3 right-4 text-[10px] text-text/30 flex items-center gap-1">
                      <FolderClosed className="w-2.5 h-2.5" />
                      {folder.name}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// --- Welcome View (no folders yet) ---

const WelcomeView: React.FC<{
  onFolderCreated: () => void;
  source?: EntrySource;
  createFolderFn?: (name: string) => Promise<JournalFolder>;
}> = ({ onFolderCreated, source = "voice", createFolderFn }) => {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");
  const doCreateFolder = createFolderFn ?? journalCommands.createFolder;

  const handleCreate = async () => {
    const trimmed = folderName.trim();
    if (!trimmed) return;
    try {
      await doCreateFolder(trimmed);
      setFolderName("");
      setCreating(false);
      onFolderCreated();
    } catch (error) {
      console.error("Failed to create folder:", error);
    }
  };

  return (
    <div className="max-w-md w-full mx-auto flex flex-col items-center justify-center py-16 px-4 text-center gap-6">
      <div className="w-16 h-16 rounded-full bg-mutter-primary/20 flex items-center justify-center">
        {source === "video" ? (
          <Video className="w-8 h-8 text-mutter-primary" />
        ) : source === "meeting" ? (
          <Users className="w-8 h-8 text-mutter-primary" />
        ) : (
          <BookOpen className="w-8 h-8 text-mutter-primary" />
        )}
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">
          {t(source === "video" ? "settings.video.welcome.title" : source === "meeting" ? "settings.meeting.welcome.title" : "settings.journal.welcome.title")}
        </h2>
        <p className="text-sm text-text/60 leading-relaxed">
          {t(source === "video" ? "settings.video.welcome.description" : source === "meeting" ? "settings.meeting.welcome.description" : "settings.journal.welcome.description")}
        </p>
      </div>
      {creating ? (
        <div className="flex items-center gap-2 w-full max-w-xs">
          <input
            autoFocus
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder={t("settings.journal.folderName")}
            className="flex-1 px-3 py-2 bg-background border border-mid-gray/20 rounded-md text-sm focus:outline-none focus:border-mutter-primary"
          />
          <MutterButton onClick={handleCreate}>
            <Check className="w-4 h-4" />
          </MutterButton>
          <Button onClick={() => setCreating(false)} variant="ghost" size="sm">
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <MutterButton
          onClick={() => setCreating(true)}
          size="md"
          className="flex items-center gap-2"
        >
          <FolderPlus className="w-4 h-4" />
          <span>{t(source === "video" ? "settings.video.welcome.createFirstFolder" : source === "meeting" ? "settings.meeting.welcome.createFirstFolder" : "settings.journal.welcome.createFirstFolder")}</span>
        </MutterButton>
      )}
    </div>
  );
};

// --- Folders Grid View ---

const FoldersView: React.FC<{
  folders: JournalFolder[];
  entries: JournalEntry[];
  onOpenFolder: (id: number) => void;
  onFolderCreated: () => void;
  createFolderFn?: (name: string) => Promise<JournalFolder>;
}> = ({ folders, entries, onOpenFolder, onFolderCreated, createFolderFn }) => {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameName, setRenameName] = useState("");
  const doCreateFolder = createFolderFn ?? journalCommands.createFolder;

  const handleCreate = async () => {
    const trimmed = folderName.trim();
    if (!trimmed) return;
    try {
      await doCreateFolder(trimmed);
      setFolderName("");
      setCreating(false);
      onFolderCreated();
    } catch (error) {
      console.error("Failed to create folder:", error);
    }
  };

  const handleRename = async (id: number) => {
    const trimmed = renameName.trim();
    if (!trimmed) return;
    try {
      await journalCommands.renameFolder(id, trimmed);
      setRenamingId(null);
      setRenameName("");
    } catch (error) {
      console.error("Failed to rename folder:", error);
    }
  };

  const handleDelete = async (id: number) => {
    const folderEntries = entries.filter((e) => e.folder_id === id);
    const confirmMsg = folderEntries.length > 0
      ? t("settings.journal.deleteFolderWithEntriesConfirm", { count: folderEntries.length })
      : t("settings.journal.deleteFolderConfirm");
    const confirmed = await ask(confirmMsg, {
      title: t("settings.journal.deleteFolder"),
      kind: "warning",
    });
    if (!confirmed) return;
    try {
      // Delete all entries in the folder first
      for (const entry of folderEntries) {
        await journalCommands.deleteEntry(entry.id);
      }
      await journalCommands.deleteFolder(id);
      onFolderCreated(); // refresh
    } catch (error) {
      console.error("Failed to delete folder:", error);
    }
  };

  const handleDeleteAll = async () => {
    const confirmed = await ask(t("settings.journal.deleteAllFoldersConfirm"), {
      title: t("settings.journal.deleteAllFolders"),
      kind: "warning",
    });
    if (!confirmed) return;
    try {
      // Delete all entries in all folders, then delete the folders
      for (const folder of folders) {
        const folderEntries = entries.filter((e) => e.folder_id === folder.id);
        for (const entry of folderEntries) {
          await journalCommands.deleteEntry(entry.id);
        }
        await journalCommands.deleteFolder(folder.id);
      }
      onFolderCreated(); // refresh
    } catch (error) {
      console.error("Failed to delete all folders:", error);
    }
  };

  return (
    <>
      {folders.length > 0 && (
        <div className="flex justify-end px-4">
          <Button
            onClick={handleDeleteAll}
            variant="danger-ghost"
            size="sm"
            className="flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            {t("settings.journal.deleteAllFolders")}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 px-4">
        {folders.map((folder) => {
          const count = entries.filter((e) => e.folder_id === folder.id).length;
          const isRenaming = renamingId === folder.id;

          return (
            <div
              key={folder.id}
              className="relative group flex items-center gap-3 p-4 bg-background border border-mid-gray/20 rounded-lg cursor-pointer hover:border-mutter-primary/50 hover:bg-mutter-primary/5 transition-colors"
              onClick={() => { if (!isRenaming) onOpenFolder(folder.id); }}
            >
              <FolderClosed className="w-6 h-6 text-mutter-primary shrink-0" />
              <div className="min-w-0 flex-1">
                {isRenaming ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      autoFocus
                      type="text"
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(folder.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="flex-1 min-w-0 px-2 py-0.5 bg-background border border-mid-gray/20 rounded text-sm focus:outline-none focus:border-mutter-primary"
                    />
                    <button onClick={() => handleRename(folder.id)} className="text-text/60 hover:text-green-500 cursor-pointer">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setRenamingId(null)} className="text-text/60 hover:text-red-400 cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium truncate">{folder.name}</p>
                    <p className="text-xs text-text/40">
                      {t("settings.journal.folders.entryCount", { count })}
                    </p>
                  </>
                )}
              </div>
              {/* Rename / Delete buttons */}
              {!isRenaming && (
                <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => { setRenamingId(folder.id); setRenameName(folder.name); }}
                    className="p-1 rounded text-text/40 hover:text-text/70 hover:bg-mid-gray/10 cursor-pointer"
                    title={t("settings.journal.renameFolder")}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(folder.id)}
                    className="p-1 rounded text-text/40 hover:text-red-400 hover:bg-mid-gray/10 cursor-pointer"
                    title={t("settings.journal.deleteFolder")}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

// --- Folder Detail View (entries within a folder) ---

const FolderDetailView: React.FC<{
  folder?: JournalFolder;
  folders: JournalFolder[];
  entries: JournalEntry[];
  source?: EntrySource;
  onStartRecording: () => void;
  onOpenDetail: (entryId: number) => void;
  onDeleteEntry: (entryId: number) => void;
  onDeleteAll: () => void;
  onMoveEntry: (entryId: number, folderId: number | null) => void;
}> = ({ folder, folders, entries, source = "voice", onStartRecording, onOpenDetail, onDeleteEntry, onDeleteAll, onMoveEntry }) => {
  const { t } = useTranslation();
  const isVideo = source === "video";
  const isMeeting = source === "meeting";

  // Folder-level chat state (ephemeral — resets when leaving folder)
  const [folderChatOpen, setFolderChatOpen] = useState(false);
  const [folderChatMessages, setFolderChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [folderChatInput, setFolderChatInput] = useState("");
  const [folderChatLoading, setFolderChatLoading] = useState(false);
  const folderChatContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll folder chat (must be before conditional return for hooks rules)
  useEffect(() => {
    if (folderChatContainerRef.current) {
      folderChatContainerRef.current.scrollTop = folderChatContainerRef.current.scrollHeight;
    }
  }, [folderChatMessages, folderChatLoading]);

  if (!folder) return null;

  const SourceIcon = isMeeting ? Users : isVideo ? Video : Mic;

  // Build folder context for LLM
  const buildFolderContext = () => {
    if (entries.length === 0) return "";
    const timestamps = entries.map((e) => e.timestamp);
    const earliest = new Date(Math.min(...timestamps) * 1000).toLocaleDateString();
    const latest = new Date(Math.max(...timestamps) * 1000).toLocaleDateString();
    const allTags = Array.from(new Set(entries.flatMap((e) => e.tags))).join(", ");
    const entryDetails = entries
      .map((e) => {
        const date = new Date(e.timestamp * 1000).toLocaleDateString();
        const tags = e.tags.length > 0 ? ` [tags: ${e.tags.join(", ")}]` : "";
        const preview = e.transcription_text.slice(0, 200);
        return `- "${e.title}" (${date})${tags}: ${preview}`;
      })
      .join("\n");
    return `Folder: ${folder.name}\nEntries: ${entries.length}\nDate range: ${earliest} to ${latest}\nTags: ${allTags || "none"}\n\nEntries:\n${entryDetails}`;
  };

  const handleFolderChatSend = async () => {
    const msg = folderChatInput.trim();
    if (!msg || folderChatLoading) return;
    setFolderChatInput("");
    const userMsg = { role: "user" as const, content: msg };
    const updated = [...folderChatMessages, userMsg];
    setFolderChatMessages(updated);
    setFolderChatLoading(true);

    try {
      const systemPrompt = `You are mutter, a helpful assistant for a folder of journal entries. Answer questions based on the folder context provided.\n\n${buildFolderContext()}`;
      const apiMessages: [string, string][] = [
        ["system", systemPrompt],
        ...updated.map((m): [string, string] => [m.role, m.content]),
      ];
      const response = await journalCommands.chat(apiMessages);
      setFolderChatMessages((prev) => [...prev, { role: "assistant", content: response }]);
    } catch (error) {
      console.error("Folder chat failed:", error);
      setFolderChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${error}` }]);
    } finally {
      setFolderChatLoading(false);
    }
  };

  return (
    <div className="px-4 space-y-2 relative">
      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-mutter-primary/10 flex items-center justify-center">
            <SourceIcon className="w-6 h-6 text-mutter-primary/60" />
          </div>
          <p className="text-sm text-text/50">
            {isMeeting ? t("settings.journal.folders.emptyFolderMeeting") : isVideo ? t("settings.journal.folders.emptyFolderVideo") : t("settings.journal.folders.emptyFolder")}
          </p>
          <MutterButton
            onClick={onStartRecording}
            className="flex items-center gap-2"
          >
            <SourceIcon className="w-4 h-4" />
            <span>{t("settings.journal.newEntry")}</span>
          </MutterButton>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <Button
              onClick={onDeleteAll}
              variant="danger-ghost"
              size="sm"
              className="flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              {t("settings.journal.deleteAllEntries")}
            </Button>
          </div>
          <div className="bg-background border border-mid-gray/20 rounded-lg overflow-visible">
            <div className="divide-y divide-mid-gray/20">
              {entries.map((entry) => (
                <JournalEntryCard
                  key={entry.id}
                  entry={entry}
                  onClick={() => onOpenDetail(entry.id)}
                  onDelete={() => onDeleteEntry(entry.id)}
                  folders={folders}
                  onMoveToFolder={(folderId) => onMoveEntry(entry.id, folderId)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Folder chat floating button */}
      {entries.length > 0 && !folderChatOpen && (
        <button
          onClick={() => setFolderChatOpen(true)}
          className="fixed bottom-6 right-6 w-10 h-10 rounded-full bg-mutter-primary text-white shadow-lg flex items-center justify-center hover:bg-mutter-primary/80 transition-colors cursor-pointer z-20"
          title={t("settings.journal.folderChat.title")}
        >
          <MessageCircle className="w-5 h-5" />
        </button>
      )}

      {/* Folder chat panel */}
      {folderChatOpen && (
        <div className="sticky bottom-4 bg-background border border-mid-gray/20 rounded-lg shadow-xl flex flex-col overflow-hidden h-[28rem] max-w-2xl ml-auto z-20">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-mid-gray/20 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="w-3.5 h-3.5 text-mutter-primary shrink-0" />
              <span className="text-xs font-medium text-text/70 truncate">{folder.name}</span>
              <span className="text-[10px] text-text/40 shrink-0">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="flex items-center gap-1">
              {folderChatMessages.length > 0 && (
                <button
                  onClick={() => setFolderChatMessages([])}
                  className="p-1 rounded text-text/40 hover:text-text/70 hover:bg-mid-gray/10 cursor-pointer"
                  title={t("common.reset")}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </button>
              )}
              <button
                onClick={() => setFolderChatOpen(false)}
                className="p-1 rounded text-text/40 hover:text-text/70 hover:bg-mid-gray/10 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={folderChatContainerRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {folderChatMessages.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <MessageCircle className="w-6 h-6 text-mutter-primary/30" />
                <p className="text-xs text-text/40 text-center">{t("settings.journal.folderChat.welcome")}</p>
              </div>
            ) : (
              folderChatMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                    m.role === "user"
                      ? "bg-mutter-primary text-white rounded-br-sm"
                      : "text-text [&_p]:mb-3 [&_p:last-child]:mb-0"
                  }`}>
                    {m.role === "assistant" ? (
                      <Markdown remarkPlugins={[remarkBreaks, remarkGfm]}>{m.content}</Markdown>
                    ) : m.content}
                  </div>
                </div>
              ))
            )}
            {folderChatLoading && (
              <div className="flex justify-start">
                <div className="flex gap-1 px-3 py-2">
                  <span className="w-1.5 h-1.5 bg-mutter-primary/40 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-mutter-primary/40 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-mutter-primary/40 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-mid-gray/20 p-2 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                value={folderChatInput}
                onChange={(e) => setFolderChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleFolderChatSend(); } }}
                placeholder={t("settings.journal.chatInputPlaceholder")}
                rows={1}
                className="flex-1 resize-none text-sm bg-transparent focus:outline-none placeholder:text-text/30 max-h-20"
              />
              <button
                onClick={handleFolderChatSend}
                disabled={!folderChatInput.trim() || folderChatLoading}
                className="p-1.5 rounded-lg bg-mutter-primary text-white disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Recording View ---

// --- New Entry View (choose record or import) ---

const NewEntryView: React.FC<{
  onRecord: () => void;
  onImport: (filePath?: string) => void;
  onCancel: () => void;
}> = ({ onRecord, onImport, onCancel }) => {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Use Tauri 2's native drag-drop event (HTML5 file.path doesn't work in WKWebView) — desktop only
  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDragOver(true);
        } else if (event.payload.type === "drop") {
          setIsDragOver(false);
          const paths = event.payload.paths;
          if (paths.length > 0) {
            const filePath = paths[0];
            // Only accept wav/wave files
            if (/\.wav(e)?$/i.test(filePath)) {
              setIsImporting(true);
              onImport(filePath);
            }
          }
        } else {
          // "leave"
          setIsDragOver(false);
        }
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, [onImport]);

  const handleBrowse = async () => {
    setIsImporting(true);
    onImport();
  };

  return (
    <div className="px-4">
      <div className={`bg-background border rounded-lg p-8 flex flex-col items-center gap-6 transition-colors ${
        isDragOver
          ? "border-mutter-primary bg-mutter-primary/5"
          : "border-mid-gray/20"
      }`}>
        <div className="flex gap-4 w-full max-w-md">
          {/* Record option */}
          <button
            onClick={onRecord}
            disabled={isImporting}
            className="flex-1 flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-dashed border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center">
              <Mic className="w-7 h-7 text-red-500" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">{t("settings.journal.recordAudio")}</p>
              <p className="text-[10px] text-text/40 mt-1">{t("settings.journal.recordAudioDesc")}</p>
            </div>
          </button>

          {/* Import option */}
          <button
            onClick={handleBrowse}
            disabled={isImporting}
            className={`flex-1 flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-dashed transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              isDragOver
                ? "border-mutter-primary bg-mutter-primary/10"
                : "border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5"
            }`}
          >
            <div className="w-14 h-14 rounded-full bg-mutter-primary/15 flex items-center justify-center">
              {isImporting ? (
                <div className="w-7 h-7 border-2 border-mutter-primary/30 border-t-mutter-primary rounded-full animate-spin" />
              ) : (
                <Upload className="w-7 h-7 text-mutter-primary" />
              )}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">
                {isImporting ? t("settings.journal.importingAudio") : t("settings.journal.importAudio")}
              </p>
              <p className="text-[10px] text-text/40 mt-1">{t("settings.journal.importAudioDesc")}</p>
            </div>
          </button>
        </div>

        <Button onClick={onCancel} variant="ghost" size="sm" disabled={isImporting}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
};

// --- Recording View ---

// --- Importing View (transcribing imported audio) ---

const ImportingView: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-6">
      {/* Animated mic icon */}
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full bg-mutter-primary/20 animate-ping" />
        <div className="relative w-16 h-16 rounded-full bg-mutter-primary/15 flex items-center justify-center">
          <Mic className="w-8 h-8 text-mutter-primary animate-pulse" />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("settings.journal.transcribing")}</h3>
        <p className="text-xs text-text/50">{t("settings.journal.importingTranscribeHint")}</p>
      </div>

      {/* Indeterminate progress bar */}
      <div className="w-48 h-1.5 bg-mid-gray/15 rounded-full overflow-hidden">
        <div
          className="h-full bg-mutter-primary rounded-full"
          style={{
            width: "40%",
            animation: "importSlide 1.5s ease-in-out infinite",
          }}
        />
      </div>

      <style>{`
        @keyframes importSlide {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(150%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
};

const RecordingView: React.FC<{
  onStop: () => void;
  onCancel: () => void;
}> = ({ onStop, onCancel }) => {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcribeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveTextEndRef = useRef<HTMLDivElement>(null);

  // Timer
  useEffect(() => {
    intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Live transcription polling — every 5 seconds
  useEffect(() => {
    const poll = async () => {
      if (isTranscribing) return; // skip if previous transcription still running
      setIsTranscribing(true);
      try {
        const text = await journalCommands.getPartialTranscription();
        if (text) setLiveText(text);
      } catch {
        // silently ignore — recording may have stopped
      } finally {
        setIsTranscribing(false);
      }
    };

    // First poll after 3 seconds (give some audio to accumulate)
    const initialTimeout = setTimeout(() => {
      poll();
      transcribeRef.current = setInterval(poll, 5000);
    }, 3000);

    return () => {
      clearTimeout(initialTimeout);
      if (transcribeRef.current) clearInterval(transcribeRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll live text
  useEffect(() => {
    liveTextEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveText]);

  const handlePause = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setPaused(true);
  };

  const handleResume = () => {
    intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    setPaused(false);
  };

  const formatTime = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="px-4">
      <div className="bg-background border border-mid-gray/20 rounded-lg p-8 flex flex-col items-center gap-6">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
          paused ? "bg-mid-gray/20" : "bg-red-500/20 animate-pulse"
        }`}>
          <Mic className={`w-8 h-8 ${paused ? "text-mid-gray" : "text-red-500"}`} />
        </div>
        <div className="flex items-center gap-2">
          <p className="text-2xl font-mono text-text/80">{formatTime(elapsed)}</p>
          {paused && <span className="text-xs text-text/40 uppercase">{t("settings.journal.paused")}</span>}
        </div>

        {/* Live transcription preview */}
        {liveText ? (
          <div className="w-full max-h-40 overflow-y-auto bg-mid-gray/5 border border-mid-gray/15 rounded-lg px-3 py-2">
            <p className="text-xs text-text/60 whitespace-pre-wrap">{liveText}</p>
            <div ref={liveTextEndRef} />
          </div>
        ) : (
          <p className="text-sm text-text/60">
            {isTranscribing ? t("settings.journal.transcribing") : t("settings.journal.recordingHint")}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={onCancel} variant="ghost" size="sm">
            <X className="w-4 h-4" />
          </Button>
          {paused ? (
            <button
              onClick={handleResume}
              className="w-12 h-12 rounded-full bg-mutter-primary/20 flex items-center justify-center hover:bg-mutter-primary/30 transition-colors cursor-pointer"
              title={t("settings.journal.resumeRecording")}
            >
              <Play className="w-5 h-5 text-mutter-primary ml-0.5" />
            </button>
          ) : (
            <button
              onClick={handlePause}
              className="w-12 h-12 rounded-full bg-mid-gray/15 flex items-center justify-center hover:bg-mid-gray/25 transition-colors cursor-pointer"
              title={t("settings.journal.pauseRecording")}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-text/60">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            </button>
          )}
          <button
            onClick={onStop}
            className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center hover:bg-red-500/30 transition-colors cursor-pointer"
            title={t("settings.journal.stopRecording")}
          >
            <Square className="w-5 h-5 text-red-500" fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Draft View (new entry form, folder is fixed) ---

const DraftView: React.FC<{
  fileName: string;
  transcription: string;
  folderId: number;
  allEntries: JournalEntry[];
  onSave: () => void;
  onDiscard: () => void;
}> = ({ fileName, transcription, folderId, allEntries, onSave, onDiscard }) => {
  const { t } = useTranslation();
  const osType = useOsType();
  const promptOverrides = useMutterStore((s) => s.promptOverrides);

  const [title, setTitle] = useState(
    new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  );
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [linkedIds, setLinkedIds] = useState<number[]>([]);
  const [selectedPromptLabel, setSelectedPromptLabel] = useState<string>("");
  const [postProcessedText, setPostProcessedText] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Mutter's own prompt pipeline (independent from Handy's post_process_prompts)
  const mutterPrompts = React.useMemo(() => {
    return MUTTER_DEFAULT_PROMPTS.map((d) => ({
      label: d.name,
      prompt: promptOverrides[d.name.toLowerCase() as keyof typeof promptOverrides] ?? d.prompt,
    }));
  }, [promptOverrides]);

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const toggleLink = (entryId: number) => {
    setLinkedIds((prev) =>
      prev.includes(entryId)
        ? prev.filter((id) => id !== entryId)
        : [...prev, entryId]
    );
  };

  const handleApplyPrompt = async () => {
    if (!selectedPromptLabel) return;
    const found = mutterPrompts.find((p) => p.label === selectedPromptLabel);
    if (!found) return;
    setIsProcessing(true);
    try {
      const result = await journalCommands.applyPromptTextToText(transcription, found.prompt);
      setPostProcessedText(result);
    } catch (error) {
      console.error("Post-processing failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await journalCommands.saveEntry({
        fileName,
        title,
        transcriptionText: transcription,
        postProcessedText: postProcessedText,
        postProcessPromptId: selectedPromptLabel || null,
        tags,
        linkedEntryIds: linkedIds,
        folderId,
      });
      onSave();
    } catch (error) {
      console.error("Failed to save journal entry:", error);
    } finally {
      setSaving(false);
    }
  };

  const getAudioUrl = useCallback(async () => {
    try {
      const filePath = await journalCommands.getAudioFilePath(fileName, null);
      if (osType === "linux") {
        const fileData = await readFile(filePath);
        const blob = new Blob([fileData], { type: "audio/wav" });
        return URL.createObjectURL(blob);
      }
      return convertFileSrc(filePath, "asset");
    } catch {
      return null;
    }
  }, [fileName, osType]);

  return (
    <div className="px-4 space-y-3">
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onDiscard} variant="ghost" size="sm">
          {t("common.cancel")}
        </Button>
        <MutterButton onClick={handleSave} disabled={saving}>
          {saving ? t("common.loading") : t("common.save")}
        </MutterButton>
      </div>

      <div className="bg-background border border-mid-gray/20 rounded-lg p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="text-xs font-medium text-text/60 uppercase tracking-wide">
              {t("settings.journal.entryTitle")}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-background border border-mid-gray/20 rounded-md text-sm focus:outline-none focus:border-mutter-primary"
            />
          </div>

          {/* Transcription */}
          <div>
            <label className="text-xs font-medium text-text/60 uppercase tracking-wide">
              {t("settings.journal.transcription")}
            </label>
            <p className="mt-1 italic text-text/90 text-sm select-text cursor-text bg-mid-gray/10 rounded-md p-3">
              {transcription}
            </p>
          </div>

          {/* Audio Player */}
          <AudioPlayer onLoadRequest={getAudioUrl} className="w-full" />

          {/* Post-Processing */}
          {mutterPrompts.length > 0 && (
            <div>
              <label className="text-xs font-medium text-text/60 uppercase tracking-wide flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                {t("settings.journal.applyPrompt")}
              </label>
              <div className="mt-1 flex gap-2">
                <select
                  value={selectedPromptLabel}
                  onChange={(e) => setSelectedPromptLabel(e.target.value)}
                  className="flex-1 px-3 py-2 bg-background border border-mid-gray/20 rounded-md text-sm focus:outline-none focus:border-mutter-primary"
                >
                  <option value="">{t("settings.journal.selectPrompt")}</option>
                  {mutterPrompts.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={handleApplyPrompt}
                  variant="secondary"
                  size="sm"
                  disabled={!selectedPromptLabel || isProcessing}
                >
                  {isProcessing ? t("common.loading") : t("settings.journal.apply")}
                </Button>
              </div>
              {postProcessedText && (
                <div className="mt-2">
                  <label className="text-xs font-medium text-text/60 uppercase tracking-wide">
                    {t("settings.journal.processedText")}
                  </label>
                  <p className="mt-1 text-text/90 text-sm select-text cursor-text bg-mutter-primary/10 rounded-md p-3">
                    {postProcessedText}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Tags */}
          <div>
            <label className="text-xs font-medium text-text/60 uppercase tracking-wide flex items-center gap-1">
              <Tag className="w-3 h-3" />
              {t("settings.journal.tags")}
            </label>
            <div className="mt-1 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-mutter-primary/20 text-mutter-primary text-xs rounded-full"
                >
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-400 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                placeholder={t("settings.journal.addTagPlaceholder")}
                className="flex-1 px-3 py-1.5 bg-background border border-mid-gray/20 rounded-md text-sm focus:outline-none focus:border-mutter-primary"
              />
              <Button onClick={addTag} variant="ghost" size="sm">
                {t("common.add")}
              </Button>
            </div>
          </div>

          {/* Linked Entries */}
          {allEntries.length > 0 && (
            <div>
              <label className="text-xs font-medium text-text/60 uppercase tracking-wide flex items-center gap-1">
                <Link2 className="w-3 h-3" />
                {t("settings.journal.linkedEntries")}
              </label>
              <div className="mt-1 max-h-32 overflow-y-auto border border-mid-gray/20 rounded-md divide-y divide-mid-gray/10">
                {allEntries.map((entry) => (
                  <label
                    key={entry.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-mid-gray/10 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={linkedIds.includes(entry.id)}
                      onChange={() => toggleLink(entry.id)}
                      className="rounded"
                    />
                    <span className="truncate">{entry.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
    </div>
  );
};

// DetailView moved to ./DetailView.tsx



const JournalEntryCard: React.FC<{
  entry: JournalEntry;
  onClick: () => void;
  onDelete?: (e: React.MouseEvent) => void;
  folders?: JournalFolder[];
  onMoveToFolder?: (folderId: number | null) => void;
}> = ({ entry, onClick, onDelete, folders, onMoveToFolder }) => {
  const { t } = useTranslation();
  const formattedDate = formatDateShort(String(entry.timestamp));
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [folderSearch, setFolderSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const folderSearchRef = useRef<HTMLInputElement>(null);
  const setPanelDragEntryId = useMutterStore((s) => s.setPanelDragEntryId);
  const isProcessing = useMutterStore((s) => !!s.processingEntries[entry.id]);
  const dragMouseRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  // Outside-click dismissal
  useEffect(() => {
    if (!showFolderPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowFolderPicker(false);
        setFolderSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showFolderPicker]);

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (showFolderPicker) folderSearchRef.current?.focus();
  }, [showFolderPicker]);

  // Pointer-based cross-panel drag (supports mouse + touch)
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragMouseRef.current) return;
      const dx = e.clientX - dragMouseRef.current.x;
      const dy = e.clientY - dragMouseRef.current.y;
      if (!isDraggingRef.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        isDraggingRef.current = true;
        setPanelDragEntryId(entry.id);
      }
    };
    const handlePointerUp = () => {
      if (isDraggingRef.current) {
        // Drop is handled by the sidebar; just clear our state
        // Small delay so sidebar pointerup fires first
        setTimeout(() => setPanelDragEntryId(null), 0);
      }
      dragMouseRef.current = null;
      isDraggingRef.current = false;
    };
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [entry.id, setPanelDragEntryId]);

  return (
    <div
      className="group px-4 py-3 cursor-pointer hover:bg-mid-gray/10 transition-colors"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        dragMouseRef.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={onClick}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isProcessing && <Loader2 className="w-3.5 h-3.5 text-mutter-primary animate-spin shrink-0" />}
            <h4 className="text-sm font-medium truncate">{entry.title}</h4>
          </div>
          <p className="text-xs text-text/50 mt-0.5">{formattedDate}</p>
          <p className="text-xs text-text/70 mt-1 line-clamp-2">
            {isProcessing ? t("settings.video.processing") : entry.transcription_text}
          </p>
          {entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {entry.tags.map((tag) => (
                <span key={tag} className="px-1.5 py-0.5 bg-mutter-primary/15 text-mutter-primary text-[10px] rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 mt-0.5 transition-all">
          {folders && onMoveToFolder && (
            <div className="relative" ref={pickerRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowFolderPicker(!showFolderPicker); setFolderSearch(""); }}
                className="p-1 rounded text-text/30 hover:text-mutter-primary transition-colors cursor-pointer"
                title={t("settings.journal.moveToFolder")}
              >
                <FolderClosed className="w-3.5 h-3.5" />
              </button>
              {showFolderPicker && (() => {
                const otherFolders = folders.filter((f) => f.id !== entry.folder_id);
                const filtered = folderSearch.trim()
                  ? otherFolders.filter((f) => f.name.toLowerCase().includes(folderSearch.toLowerCase()))
                  : otherFolders;
                return (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-mid-gray/20 rounded-lg shadow-lg py-1 min-w-[160px] max-h-[200px] flex flex-col">
                    <div className="px-2 pb-1">
                      <input
                        ref={folderSearchRef}
                        type="text"
                        value={folderSearch}
                        onChange={(e) => setFolderSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { if (e.key === "Escape") { setShowFolderPicker(false); setFolderSearch(""); } }}
                        placeholder={t("settings.journal.searchFolders")}
                        className="w-full px-2 py-1 bg-mid-gray/5 border border-mid-gray/15 rounded text-[11px] focus:outline-none focus:border-mutter-primary/50"
                      />
                    </div>
                    <div className="overflow-y-auto">
                      {filtered.map((f) => (
                        <button
                          key={f.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onMoveToFolder(f.id);
                            setShowFolderPicker(false);
                            setFolderSearch("");
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text/70 hover:bg-mid-gray/10 transition-colors cursor-pointer"
                        >
                          <FolderClosed className="w-3 h-3 text-mutter-primary shrink-0" />
                          <span className="truncate">{f.name}</span>
                        </button>
                      ))}
                      {filtered.length === 0 && (
                        <p className="px-3 py-1.5 text-[10px] text-text/40">
                          {otherFolders.length === 0 ? t("settings.journal.noOtherFolders") : t("settings.journal.noResults")}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(e); }}
              className="p-1 rounded text-text/30 hover:text-red-400 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};


// --- Video New Entry View (choose YouTube or Import Video) ---

const VideoNewEntryView: React.FC<{
  onYouTube: () => void;
  onImportVideo: (filePath?: string) => void;
  onCancel: () => void;
}> = ({ onYouTube, onImportVideo, onCancel }) => {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDragOver(true);
        } else if (event.payload.type === "drop") {
          setIsDragOver(false);
          const paths = event.payload.paths;
          if (paths.length > 0) {
            const filePath = paths[0];
            if (/\.(mp4|mov|mkv|webm|m4a|mp3)$/i.test(filePath)) {
              setIsImporting(true);
              onImportVideo(filePath);
            }
          }
        } else {
          setIsDragOver(false);
        }
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, [onImportVideo]);

  return (
    <div className="px-4">
      <div className={`bg-background border rounded-lg p-8 flex flex-col items-center gap-6 transition-colors ${
        isDragOver ? "border-mutter-primary bg-mutter-primary/5" : "border-mid-gray/20"
      }`}>
        <div className="flex gap-4 w-full max-w-md">
          {/* YouTube option */}
          <button
            onClick={onYouTube}
            disabled={isImporting}
            className="flex-1 flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-dashed border-mid-gray/20 hover:border-red-400/50 hover:bg-red-500/5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center">
              <Youtube className="w-7 h-7 text-red-500" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">{t("settings.video.youtube")}</p>
              <p className="text-[10px] text-text/40 mt-1">{t("settings.video.youtubeDesc")}</p>
            </div>
          </button>

          {/* Import Video option */}
          <button
            onClick={() => { setIsImporting(true); onImportVideo(); }}
            disabled={isImporting}
            className={`flex-1 flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-dashed transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              isDragOver
                ? "border-mutter-primary bg-mutter-primary/10"
                : "border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5"
            }`}
          >
            <div className="w-14 h-14 rounded-full bg-mutter-primary/15 flex items-center justify-center">
              {isImporting ? (
                <div className="w-7 h-7 border-2 border-mutter-primary/30 border-t-mutter-primary rounded-full animate-spin" />
              ) : (
                <Video className="w-7 h-7 text-mutter-primary" />
              )}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">
                {isImporting ? t("settings.video.importingVideo") : t("settings.video.importVideo")}
              </p>
              <p className="text-[10px] text-text/40 mt-1">{t("settings.video.importVideoDesc")}</p>
            </div>
          </button>
        </div>

        <button
          onClick={onCancel}
          className="text-xs text-text/40 hover:text-text/60 cursor-pointer"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
};

// --- YouTube URL Input View ---

const YouTubeInputView: React.FC<{
  onSubmit: (url: string) => void;
  onCancel: () => void;
}> = ({ onSubmit, onCancel }) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");

  const handleSubmit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div className="px-4">
      <div className="bg-background border border-mid-gray/20 rounded-lg p-8 flex flex-col items-center gap-6 max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center">
          <Youtube className="w-8 h-8 text-red-500" />
        </div>
        <div className="text-center space-y-1">
          <h3 className="text-sm font-semibold">{t("settings.video.youtubeInput")}</h3>
          <p className="text-xs text-text/50">{t("settings.video.youtubeInputDesc")}</p>
        </div>
        <div className="w-full space-y-3">
          <input
            autoFocus
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
              if (e.key === "Escape") onCancel();
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full px-3 py-2 bg-background border border-mid-gray/20 rounded-md text-sm focus:outline-none focus:border-mutter-primary"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs text-text/60 hover:text-text/80 rounded-md hover:bg-mid-gray/10 cursor-pointer"
            >
              {t("common.cancel")}
            </button>
            <MutterButton
              onClick={handleSubmit}
              disabled={!url.trim()}
              size="sm"
              className="flex items-center gap-1.5"
            >
              <Globe className="w-3.5 h-3.5" />
              {t("settings.video.fetchTranscript")}
            </MutterButton>
          </div>
        </div>
      </div>
    </div>
  );
};


// --- Meeting New Entry View ---

const MeetingNewEntryView: React.FC<{
  onRecord: () => void;
  onImport: () => void;
  onCancel: () => void;
}> = ({ onRecord, onImport, onCancel }) => {
  const { t } = useTranslation();
  const [modelsInstalled, setModelsInstalled] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [downloadLabel, setDownloadLabel] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    meetingCommands.checkDiarizeModelsInstalled().then(setModelsInstalled);
  }, []);

  useEffect(() => {
    if (!installing) return;
    let unlisten: (() => void) | undefined;
    listen<{ label: string; progress: number }>("diarize-download-progress", (event) => {
      const { label, progress } = event.payload;
      if (label !== "done") {
        setDownloadLabel(label);
        setDownloadProgress(progress);
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [installing]);

  const handleInstallModels = async () => {
    setInstalling(true);
    setDownloadLabel("");
    setDownloadProgress(0);
    try {
      await meetingCommands.installDiarizeModels();
      setModelsInstalled(true);
    } catch (error) {
      console.error("Failed to install diarize models:", error);
      toast.error(String(error));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="px-4">
      <div className="bg-background border border-mid-gray/20 rounded-lg p-8 flex flex-col items-center gap-6 max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-mutter-primary/15 flex items-center justify-center">
          <Users className="w-8 h-8 text-mutter-primary" />
        </div>
        <div className="text-center space-y-1">
          <h3 className="text-sm font-semibold">{t("settings.meeting.setup.title")}</h3>
          <p className="text-xs text-text/50">{t("settings.meeting.setup.description")}</p>
        </div>

        {modelsInstalled === null ? (
          <Loader2 className="w-5 h-5 text-mutter-primary animate-spin" />
        ) : !modelsInstalled ? (
          <div className="flex flex-col items-center gap-3 w-full max-w-xs">
            <MutterButton
              onClick={handleInstallModels}
              disabled={installing}
              size="md"
              className="flex items-center gap-2"
            >
              {installing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("settings.meeting.setup.installing")}
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  {t("settings.meeting.setup.installModels")}
                </>
              )}
            </MutterButton>
            {installing && downloadLabel && (
              <div className="w-full space-y-1.5">
                <p className="text-[11px] text-text/40 text-center">
                  {t(`settings.meeting.setup.model.${downloadLabel}`)} — {downloadProgress}%
                </p>
                <div className="w-full bg-mid-gray/10 rounded-full h-1 overflow-hidden">
                  <div
                    className="h-full bg-mutter-primary rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 w-full">
            <p className="text-xs text-green-600">{t("settings.meeting.setup.ready")}</p>
            <div className="flex gap-4 w-full max-w-sm">
              <button
                onClick={onRecord}
                className="flex-1 flex flex-col items-center gap-3 p-5 rounded-lg border-2 border-dashed border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5 transition-colors cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center">
                  <Mic className="w-6 h-6 text-red-500" />
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium">{t("settings.meeting.startMeeting")}</p>
                  <p className="text-[10px] text-text/40 mt-0.5">{t("settings.meeting.startMeetingDesc")}</p>
                </div>
              </button>
              <button
                onClick={onImport}
                className="flex-1 flex flex-col items-center gap-3 p-5 rounded-lg border-2 border-dashed border-mid-gray/20 hover:border-mutter-primary/50 hover:bg-mutter-primary/5 transition-colors cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full bg-mutter-primary/15 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-mutter-primary" />
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium">{t("settings.meeting.importAudio")}</p>
                  <p className="text-[10px] text-text/40 mt-0.5">{t("settings.meeting.importAudioDesc")}</p>
                </div>
              </button>
            </div>
          </div>
        )}

        <button
          onClick={onCancel}
          className="text-xs text-text/40 hover:text-text/60 cursor-pointer"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
};


