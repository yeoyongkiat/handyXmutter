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
  Copy,
  Check,
  Pencil,
  FolderClosed,
  FolderPlus,
  BookOpen,
  ChevronRight,
  MessageCircle,
  Lightbulb,
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
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readFile } from "@tauri-apps/plugin-fs";
import { ask, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../../../hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { formatDateShort } from "@/utils/dateFormat";
import {
  journalCommands,
  videoCommands,
  MUTTER_DEFAULT_PROMPTS,
  MUTTER_DEFAULT_CHAT_INSTRUCTIONS,
  type JournalEntry,
  type JournalFolder,
  getModelContextWindow,
} from "@/lib/journal";
import { JotterEditor } from "@/components/mutter/JotterEditor";
import { useMutterStore } from "@/stores/mutterStore";

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

type ViewMode =
  | { mode: "loading" }
  | { mode: "welcome" }
  | { mode: "folders" }
  | { mode: "folder"; folderId: number }
  | { mode: "new-entry"; folderId: number }
  | { mode: "recording"; folderId: number }
  | { mode: "draft"; folderId: number; fileName: string; transcription: string }
  | { mode: "detail"; entryId: number; folderId: number; trail: number[]; fromTag?: string }
  | { mode: "tag"; tag: string; folderId: number; trail: number[] }
  | { mode: "search"; query: string }
  | { mode: "importing"; folderId: number }
  | { mode: "youtube-input"; folderId: number };

export type EntrySource = "voice" | "video";

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
  const cmds = source === "video" ? videoCommands : journalCommands;

  const loadData = useCallback(async () => {
    try {
      const [entryData, folderData] = await Promise.all([
        source === "video" ? videoCommands.getEntries() : journalCommands.getEntries(),
        source === "video" ? videoCommands.getFolders() : journalCommands.getFolders(),
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

      // Download + transcribe in background
      videoCommands.downloadYouTubeAudio(url).then(async (result) => {
        await videoCommands.updateEntryAfterProcessing(
          entry.id, result.file_name, result.title, result.transcription
        );
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

    try {
      // Create a pending entry immediately
      const title = new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
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

      // Import + transcribe in background
      videoCommands.importVideo(path).then(async (result) => {
        await videoCommands.updateEntryAfterProcessing(
          entry.id, result.file_name, title, result.transcription_text
        );
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
        createFolderFn={source === "video" ? videoCommands.createFolder : undefined}
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
    actionButton = <FolderCreateButton onFolderCreated={handleFolderCreated} createFolderFn={source === "video" ? videoCommands.createFolder : undefined} />;
  } else if (view.mode === "folder") {
    actionButton = (
      <MutterButton
        onClick={() => handleNewEntry(view.folderId)}
        className="flex items-center gap-2"
      >
        {source === "video" ? <Video className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
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
          createFolderFn={source === "video" ? videoCommands.createFolder : undefined}
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
        <VideoNewEntryView
          onYouTube={() => handleYouTubeInput(view.folderId)}
          onImportVideo={(filePath) => handleImportVideo(view.folderId, filePath)}
          onCancel={() => setView({ mode: "folder", folderId: view.folderId })}
        />
      )}
      {view.mode === "youtube-input" && (
        <YouTubeInputView
          onSubmit={(url) => handleYouTubeSubmit(view.folderId, url)}
          onCancel={() => setView({ mode: "new-entry", folderId: view.folderId })}
        />
      )}
      {view.mode === "recording" && (
        <RecordingView
          onStop={() => handleStopRecording(view.folderId)}
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

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_ABBR = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function parseDateRange(input: string): { start: number; end: number } | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Relative keywords
  if (input === "today") {
    return { start: today.getTime(), end: today.getTime() + 86400000 - 1 };
  }
  if (input === "yesterday") {
    const d = new Date(today.getTime() - 86400000);
    return { start: d.getTime(), end: d.getTime() + 86400000 - 1 };
  }
  if (input === "this week") {
    const day = today.getDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    const monday = new Date(today.getTime() - mondayOffset * 86400000);
    return { start: monday.getTime(), end: now.getTime() };
  }
  if (input === "last week") {
    const day = today.getDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    const thisMonday = new Date(today.getTime() - mondayOffset * 86400000);
    const lastMonday = new Date(thisMonday.getTime() - 7 * 86400000);
    return { start: lastMonday.getTime(), end: thisMonday.getTime() - 1 };
  }
  if (input === "this month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.getTime(), end: now.getTime() };
  }
  if (input === "last month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.getTime(), end: end.getTime() - 1 };
  }

  // YYYY-MM-DD exact date
  const exactMatch = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (exactMatch) {
    const d = new Date(+exactMatch[1], +exactMatch[2] - 1, +exactMatch[3]);
    return { start: d.getTime(), end: d.getTime() + 86400000 - 1 };
  }

  // YYYY-MM month range
  const monthNumMatch = input.match(/^(\d{4})-(\d{1,2})$/);
  if (monthNumMatch) {
    const y = +monthNumMatch[1], m = +monthNumMatch[2] - 1;
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 1);
    return { start: start.getTime(), end: end.getTime() - 1 };
  }

  // YYYY year range
  const yearMatch = input.match(/^(\d{4})$/);
  if (yearMatch) {
    const y = +yearMatch[1];
    return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() - 1 };
  }

  // "month year" or "month" (e.g. "jan 2024", "february", "mar")
  for (let i = 0; i < 12; i++) {
    if (input.startsWith(MONTH_NAMES[i]) || input.startsWith(MONTH_ABBR[i])) {
      const rest = input.replace(MONTH_NAMES[i], "").replace(MONTH_ABBR[i], "").trim();
      const year = rest.match(/^\d{4}$/) ? +rest : now.getFullYear();
      const start = new Date(year, i, 1);
      const end = new Date(year, i + 1, 1);
      return { start: start.getTime(), end: end.getTime() - 1 };
    }
  }

  return null;
}

/**
 * Parses search query and filters entries:
 * - Plain text: search entry titles (case-insensitive)
 * - @query: search folder names, show entries in matching folders
 * - #query: search tags
 * - [query]: find entries linked to entry whose title matches query
 */
function searchEntries(
  query: string,
  entries: JournalEntry[],
  folders: JournalFolder[],
): JournalEntry[] {
  const q = query.trim();
  if (!q) return [];

  // [text] — linked entry search
  const bracketMatch = q.match(/^\[(.+)\]$/);
  if (bracketMatch) {
    const linkQuery = bracketMatch[1].toLowerCase();
    // Find entries whose title matches the link query
    const matchedIds = new Set(
      entries
        .filter((e) => e.title.toLowerCase().includes(linkQuery))
        .map((e) => e.id),
    );
    // Return entries that link to any of the matched entries
    return entries.filter((e) =>
      e.linked_entry_ids.some((id) => matchedIds.has(id)),
    );
  }

  // @query — folder search
  if (q.startsWith("@")) {
    const folderQuery = q.slice(1).toLowerCase();
    if (!folderQuery) return [];
    const matchingFolderIds = new Set(
      folders
        .filter((f) => f.name.toLowerCase().includes(folderQuery))
        .map((f) => f.id),
    );
    return entries.filter(
      (e) => e.folder_id != null && matchingFolderIds.has(e.folder_id),
    );
  }

  // ::query — date search
  if (q.startsWith("::")) {
    const dateQuery = q.slice(2).trim().toLowerCase();
    if (!dateQuery) return [];
    const range = parseDateRange(dateQuery);
    if (!range) return [];
    return entries.filter((e) => {
      const ts = e.timestamp * 1000; // unix seconds → ms
      return ts >= range.start && ts <= range.end;
    });
  }

  // #query — tag search
  if (q.startsWith("#")) {
    const tagQuery = q.slice(1).toLowerCase();
    if (!tagQuery) return [];
    return entries.filter((e) =>
      e.tags.some((tag) => tag.toLowerCase().includes(tagQuery)),
    );
  }

  // Plain text — title search
  const lower = q.toLowerCase();
  return entries.filter((e) => e.title.toLowerCase().includes(lower));
}

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
          {!isFolderSearch && !isTagSearch && !isDateSearch && !isLinkSearch && (
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
        ) : (
          <BookOpen className="w-8 h-8 text-mutter-primary" />
        )}
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">
          {t(source === "video" ? "settings.video.welcome.title" : "settings.journal.welcome.title")}
        </h2>
        <p className="text-sm text-text/60 leading-relaxed">
          {t(source === "video" ? "settings.video.welcome.description" : "settings.journal.welcome.description")}
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
          <span>{t(source === "video" ? "settings.video.welcome.createFirstFolder" : "settings.journal.welcome.createFirstFolder")}</span>
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

  if (!folder) return null;

  return (
    <div className="px-4 space-y-2">
      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-mutter-primary/10 flex items-center justify-center">
            {isVideo ? <Video className="w-6 h-6 text-mutter-primary/60" /> : <Mic className="w-6 h-6 text-mutter-primary/60" />}
          </div>
          <p className="text-sm text-text/50">
            {isVideo ? t("settings.journal.folders.emptyFolderVideo") : t("settings.journal.folders.emptyFolder")}
          </p>
          <MutterButton
            onClick={onStartRecording}
            className="flex items-center gap-2"
          >
            {isVideo ? <Video className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
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

  // Use Tauri 2's native drag-drop event (HTML5 file.path doesn't work in WKWebView)
  useEffect(() => {
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

// --- Detail View (entry detail with edit/delete) ---

const DetailView: React.FC<{
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
  const [showCopied, setShowCopied] = useState(false);
  const [processingPromptId, setProcessingPromptId] = useState<string | null>(null);
  const [isRetranscribing, setIsRetranscribing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMaximised, setChatMaximised] = useState(false);
  const [chatMode, setChatMode] = useState<"jotter" | "retrieve" | "sharpen" | "brainstorm" | null>(null);
  const [jotterText, setJotterText] = useState("");
  const jotterSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<number | null>(null);
  const [chatSessions, setChatSessions] = useState<import("@/lib/journal").ChatSession[]>([]);
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
  const mutterPromptPipeline = React.useMemo(() => {
    return MUTTER_DEFAULT_PROMPTS.map((d) => ({
      label: d.name,
      prompt: promptOverrides[d.name.toLowerCase() as keyof typeof promptOverrides] ?? d.prompt,
    }));
  }, [promptOverrides]);

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
        if (!isEditingTranscription) {
          setEditTranscription(data.transcription_text);
        }
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

    const setup = async () => {
      unlistenProgress = await listen<number>("ytdlp-audio-progress", (event) => {
        setProcessingEntry(entryId, "downloading", Math.round(event.payload));
      });
      unlistenStatus = await listen<string>("ytdlp-status", (event) => {
        setProcessingEntry(entryId, event.payload, 0);
      });
    };
    setup();

    return () => {
      unlistenProgress?.();
      unlistenStatus?.();
    };
  }, [entryId, !!processingInfo]);

  // Reload entry when processing completes (entry gets updated by backend)
  useEffect(() => {
    if (!processingInfo) {
      loadEntry();
    }
  }, [processingInfo, loadEntry]);

  // Save helper — persists current field values
  const saveFields = useCallback(async (
    title: string,
    tags: string[],
    linkedIds: number[],
  ) => {
    if (!entry) return;
    try {
      await journalCommands.updateEntry({
        id: entry.id,
        title,
        tags,
        linkedEntryIds: linkedIds,
        folderId: entry.folder_id,
      });
      loadEntry();
    } catch (error) {
      console.error("Failed to update entry:", error);
    }
  }, [entry, loadEntry]);

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
    await navigator.clipboard.writeText(text);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
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
    if (chatMode === "jotter") return null;

    const linkedEntryDetails = allEntries
      .filter((e) => entry.linked_entry_ids.includes(e.id))
      .map((e) => `- "${e.title}" (${new Date(e.timestamp * 1000).toLocaleDateString()}): ${e.transcription_text}`)
      .join("\n");

    const entryContext = `

=== MAIN JOURNAL ENTRY ===
Title: ${entry.title}
Date: ${new Date(entry.timestamp * 1000).toLocaleString()}
Tags: ${entry.tags.join(", ") || "none"}
Linked entries: ${entry.linked_entry_ids.length > 0 ? allEntries.filter((e) => entry.linked_entry_ids.includes(e.id)).map((e) => `"${e.title}"`).join(", ") : "none"}

Transcript:
${entry.transcription_text}
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
    if (chatMode === "jotter") {
      // For jotter, auto-title from first line of text
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

          {/* Processing overlay */}
          {processingInfo && (
            <div className="bg-mutter-primary/5 border border-mutter-primary/20 rounded-lg p-6 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 text-mutter-primary animate-spin" />
              <p className="text-sm font-medium text-text/70">
                {processingInfo.status === "downloading" && processingInfo.progress > 0
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

          {/* Transcription */}
          {!processingInfo && <div>
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
            {isEditingTranscription ? (
              <textarea
                autoFocus
                value={editTranscription}
                onChange={(e) => handleTranscriptionChange(e.target.value)}
                onBlur={() => setIsEditingTranscription(false)}
                className="mt-2 w-full text-text/90 text-sm bg-mid-gray/10 rounded-md p-3 min-h-[120px] resize-y focus:outline-none focus:ring-1 focus:ring-mutter-primary"
              />
            ) : (
              <div
                onClick={() => { setIsEditingTranscription(true); setEditTranscription(entry.transcription_text); }}
                className="mt-2 text-text/90 text-sm select-text cursor-text bg-mid-gray/10 rounded-md p-3 hover:bg-mutter-primary/10 transition-colors [&_p]:mb-3 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:mb-3 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:mb-1 [&_strong]:font-bold [&_a]:text-mutter-primary [&_a]:underline"
              >
                <Markdown remarkPlugins={[remarkBreaks, remarkGfm]}>
                  {entry.transcription_text
                    .replace(/^"|"$/g, "")
                    .replace(/\\n/g, "\n")}
                </Markdown>
              </div>
            )}
            {/* Re-transcribe | prompt pipeline */}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                onClick={handleRetranscribe}
                disabled={processingPromptId !== null || isRetranscribing}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-mid-gray/10 text-text/60 hover:bg-mid-gray/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Mic className="w-3 h-3" />
                {isRetranscribing ? t("settings.journal.retranscribing") : t("settings.journal.retranscribe")}
              </button>
              {(() => {
                if (mutterPromptPipeline.length === 0) return null;
                // Current pipeline level: -1 = none applied, 0 = Clean, 1 = Structure, 2 = Organise
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
        const jotSessions = chatSessions.filter((s) => s.mode === "jotter");
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
                      setChatMode("jotter");
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
                        {session.title || t("settings.journal.chatModeJotter")}
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
        const chatOnlySessions = chatSessions.filter((s) => s.mode !== "jotter");
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
                      setChatMode(session.mode as "retrieve" | "sharpen" | "brainstorm");
                      setChatMessages(messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
                      setChatOpen(true);
                    } catch (error) {
                      console.error("Failed to load chat session:", error);
                    }
                  }}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="px-1.5 py-0.5 bg-mutter-primary/15 text-mutter-primary text-[10px] rounded-full font-medium shrink-0">
                      {session.mode === "retrieve" ? t("settings.journal.chatModeRetrieve") : session.mode === "sharpen" ? t("settings.journal.chatModeSharpen") : t("settings.journal.chatModeBrainstorm")}
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
              <span className="text-xs font-medium text-text/70 shrink-0">{t("settings.journal.chatAssistant")}</span>
              {chatMode && (
                <>
                  <ChevronRight className="w-3 h-3 text-text/30 shrink-0" />
                  <span className="px-1.5 py-0.5 bg-mutter-primary/15 text-mutter-primary text-[10px] rounded-full font-medium shrink-0">
                    {chatMode === "jotter" ? t("settings.journal.chatModeJotter") : chatMode === "retrieve" ? t("settings.journal.chatModeRetrieve") : chatMode === "sharpen" ? t("settings.journal.chatModeSharpen") : t("settings.journal.chatModeBrainstorm")}
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
                </div>
              </div>
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

// --- Entry Card for List ---

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

  // Mouse-based cross-panel drag
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragMouseRef.current) return;
      const dx = e.clientX - dragMouseRef.current.x;
      const dy = e.clientY - dragMouseRef.current.y;
      if (!isDraggingRef.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        isDraggingRef.current = true;
        setPanelDragEntryId(entry.id);
      }
    };
    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        // Drop is handled by the sidebar; just clear our state
        // Small delay so sidebar mouseup fires first
        setTimeout(() => setPanelDragEntryId(null), 0);
      }
      dragMouseRef.current = null;
      isDraggingRef.current = false;
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [entry.id, setPanelDragEntryId]);

  return (
    <div
      className="group px-4 py-3 cursor-pointer hover:bg-mid-gray/10 transition-colors"
      onMouseDown={(e) => {
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

