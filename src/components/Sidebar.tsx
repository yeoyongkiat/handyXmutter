import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Cog,
  FlaskConical,
  History,
  Info,
  Sparkles,
  Cpu,
  FileText,
  FolderOpen,
  FolderClosed,
  Search,
  CircleHelp,
  X,
} from "lucide-react";
import HandyTextLogo from "./icons/HandyTextLogo";
import HandyHand from "./icons/HandyHand";
import { useSettings } from "../hooks/useSettings";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
} from "./settings";
import { listen } from "@tauri-apps/api/event";
import mutterLogo from "@/assets/mutter-logo.png";
import { journalCommands, type JournalEntry, type JournalFolder } from "@/lib/journal";
import { useMutterStore } from "@/stores/mutterStore";
import { formatDateShort } from "@/utils/dateFormat";

export type SidebarSection = keyof typeof SECTIONS_CONFIG | "mutter";

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  [key: string]: any;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: any) => boolean;
}

export const SECTIONS_CONFIG = {
  general: {
    labelKey: "sidebar.general",
    icon: HandyHand,
    component: GeneralSettings,
    enabled: () => true,
  },
  models: {
    labelKey: "sidebar.models",
    icon: Cpu,
    component: ModelsSettings,
    enabled: () => true,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Cog,
    component: AdvancedSettings,
    enabled: () => true,
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    icon: Sparkles,
    component: PostProcessingSettings,
    enabled: (settings) => settings?.post_process_enabled ?? false,
  },
  history: {
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const isMutterMode = activeSection === "mutter";

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled(settings))
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  return (
    <div className="flex flex-col w-40 h-full border-e border-mid-gray/20 items-center px-2 relative overflow-hidden">
      {/* === Handy sidebar === */}
      <div
        className={`flex flex-col w-full h-full items-center absolute inset-0 px-2 transition-all duration-300 ease-in-out ${
          isMutterMode
            ? "opacity-0 -translate-x-4 pointer-events-none"
            : "opacity-100 translate-x-0"
        }`}
      >
        <HandyTextLogo width={120} className="m-4 shrink-0" />

        <div className="flex flex-col w-full items-center gap-1 pt-2 border-t border-mid-gray/20 flex-1 overflow-y-auto">
          {availableSections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;

            return (
              <div
                key={section.id}
                className={`flex gap-2 items-center p-2 w-full rounded-lg cursor-pointer transition-colors ${
                  isActive
                    ? "bg-logo-primary/80"
                    : "hover:bg-mid-gray/20 hover:opacity-100 opacity-85"
                }`}
                onClick={() => onSectionChange(section.id)}
              >
                <Icon width={24} height={24} className="shrink-0" />
                <p
                  className="text-sm font-medium truncate"
                  title={t(section.labelKey)}
                >
                  {t(section.labelKey)}
                </p>
              </div>
            );
          })}
        </div>

        {/* Mutter logo at bottom */}
        <div className="w-full pt-2 mt-2 border-t border-mid-gray/20 pb-2 shrink-0">
          <div
            className="flex items-center justify-center p-2 w-full rounded-lg cursor-pointer transition-colors hover:bg-mid-gray/20 opacity-70 hover:opacity-100"
            onClick={() => onSectionChange("mutter")}
          >
            <img
              src={mutterLogo}
              alt="mutter"
              className="w-20 h-auto"
              draggable={false}
            />
          </div>
        </div>
      </div>

      {/* === Mutter sidebar === */}
      <div
        className={`flex flex-col w-full h-full items-center absolute inset-0 px-2 transition-all duration-300 ease-in-out ${
          isMutterMode
            ? "opacity-100 translate-x-0"
            : "opacity-0 translate-x-4 pointer-events-none"
        }`}
      >
        {/* Mutter logo at top */}
        <div className="m-4 shrink-0">
          <img
            src={mutterLogo}
            alt="mutter"
            className="w-[120px] h-auto"
            draggable={false}
          />
        </div>

        {/* File explorer */}
        <MutterFileExplorer />

        {/* Handy logo at bottom to go back */}
        <div className="w-full pt-2 mt-2 border-t border-mid-gray/20 pb-2 shrink-0">
          <div
            className="flex items-center justify-center p-2 w-full rounded-lg cursor-pointer transition-colors hover:bg-mid-gray/20 opacity-70 hover:opacity-100"
            onClick={() => onSectionChange("general")}
          >
            <HandyTextLogo width={80} />
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Mutter File Explorer ---
// Uses mouse-event-based drag instead of HTML5 drag-and-drop (unreliable in Tauri WKWebView)

const DRAG_THRESHOLD = 5; // pixels of movement before drag starts

const MutterFileExplorer: React.FC = () => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [folders, setFolders] = useState<JournalFolder[]>([]);
  const selectedEntryId = useMutterStore((s) => s.selectedEntryId);
  const setSelectedEntryId = useMutterStore((s) => s.setSelectedEntryId);
  const setSelectedFolderId = useMutterStore((s) => s.setSelectedFolderId);
  const expandedFolderIds = useMutterStore((s) => s.expandedFolderIds);
  const toggleFolder = useMutterStore((s) => s.toggleFolder);
  const searchQuery = useMutterStore((s) => s.searchQuery);
  const setSearchQuery = useMutterStore((s) => s.setSearchQuery);
  const [showSearchHelp, setShowSearchHelp] = useState(false);
  const searchHelpRef = useRef<HTMLDivElement>(null);

  // Mouse-based drag state (sidebar entries)
  const [dragEntryId, setDragEntryId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<number | null>(null);
  const mouseDownRef = useRef<{ entryId: number; x: number; y: number } | null>(null);

  // Cross-panel drag from main panel (shared via Zustand)
  const panelDragEntryId = useMutterStore((s) => s.panelDragEntryId);
  const [panelDropTargetFolderId, setPanelDropTargetFolderId] = useState<number | null>(null);

  // Cancel drag on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDragging) {
        setDragEntryId(null);
        setIsDragging(false);
        setDropTargetFolderId(null);
        mouseDownRef.current = null;
      }
    };
    if (isDragging) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isDragging]);

  // Global mousemove/mouseup listeners for drag
  useEffect(() => {
    if (!mouseDownRef.current && !isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (mouseDownRef.current && !isDragging) {
        const dx = e.clientX - mouseDownRef.current.x;
        const dy = e.clientY - mouseDownRef.current.y;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          setDragEntryId(mouseDownRef.current.entryId);
          setIsDragging(true);
        }
      }
    };

    const handleMouseUp = () => {
      if (isDragging && dragEntryId != null && dropTargetFolderId != null) {
        const targetFolder = folders.find((f) => f.id === dropTargetFolderId);
        const draggedEntry = entries.find((e) => e.id === dragEntryId);
        journalCommands.moveEntryToFolder(dragEntryId, dropTargetFolderId).then(() => {
          if (targetFolder && draggedEntry) toast(<span><strong>{draggedEntry.title}</strong> moved to <strong>{targetFolder.name}</strong></span>);
        }).catch((error) => {
          console.error("Failed to move entry:", error);
        });
      }
      setDragEntryId(null);
      setIsDragging(false);
      setDropTargetFolderId(null);
      mouseDownRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragEntryId, dropTargetFolderId]);

  const handleEntryMouseDown = useCallback((entryId: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    mouseDownRef.current = { entryId, x: e.clientX, y: e.clientY };
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [entryData, folderData] = await Promise.all([
        journalCommands.getEntries(),
        journalCommands.getFolders(),
      ]);
      setEntries(entryData);
      setFolders(folderData);
    } catch (error) {
      console.error("Failed to load journal data:", error);
    }
  }, []);

  useEffect(() => {
    loadData();
    const setupListener = async () => {
      return await listen("journal-updated", () => loadData());
    };
    const unlistenPromise = setupListener();
    return () => {
      unlistenPromise.then((unlisten) => unlisten?.());
    };
  }, [loadData]);

  // Outside-click to close search help (check both anchor and portaled popup)
  useEffect(() => {
    if (!showSearchHelp) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't close if clicking inside the search bar area
      if (searchHelpRef.current?.contains(target)) return;
      // Don't close if clicking inside the portaled popup
      const popup = document.querySelector("[data-search-help-popup]");
      if (popup?.contains(target)) return;
      setShowSearchHelp(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSearchHelp]);

  const handleFolderClick = (folderId: number) => {
    toggleFolder(folderId);
    setSelectedFolderId(folderId);
    setSelectedEntryId(null);
  };

  return (
    <div
      className={`flex flex-col w-full flex-1 pt-2 border-t border-mid-gray/20 overflow-hidden gap-0.5 ${
        isDragging || panelDragEntryId != null ? "cursor-grabbing" : ""
      }`}
    >
      {/* Search bar */}
      <div className="px-1 pb-1 shrink-0" ref={searchHelpRef}>
        <div className="relative flex items-center">
          <Search className="absolute left-2 w-3 h-3 text-text/30 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("settings.journal.search.placeholder")}
            className="w-full pl-6 pr-7 py-1 bg-mid-gray/5 border border-mid-gray/15 rounded text-[11px] text-text/80 placeholder:text-text/30 focus:outline-none focus:border-mutter-primary/50"
          />
          <div className="absolute right-1 flex items-center gap-0.5">
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="p-0.5 text-text/30 hover:text-text/60 cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
            <button
              onClick={() => setShowSearchHelp(!showSearchHelp)}
              className="p-0.5 text-text/25 hover:text-mutter-primary cursor-pointer transition-colors"
            >
              <CircleHelp className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
      {showSearchHelp && (
        <SearchHelpPopup anchorRef={searchHelpRef} />
      )}

      {/* Folder tree (scrollable) */}
      <div className={`flex-1 overflow-y-auto`}>
      {/* Folders */}
      {folders.map((folder) => {
        const isExpanded = expandedFolderIds.has(folder.id);
        const folderEntries = entries.filter(
          (e) => e.folder_id === folder.id
        );
        const isDropTarget = (isDragging && dropTargetFolderId === folder.id) || (panelDragEntryId != null && panelDropTargetFolderId === folder.id);
        const FolderIcon = isExpanded ? FolderOpen : FolderClosed;

        return (
          <div key={`folder-${folder.id}`}>
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer transition-colors group ${
                isDropTarget
                  ? "bg-mutter-primary/30 ring-1 ring-mutter-primary"
                  : "hover:bg-mid-gray/10"
              }`}
              onClick={() => {
                if (!isDragging) handleFolderClick(folder.id);
              }}
              onMouseEnter={() => {
                if (isDragging) setDropTargetFolderId(folder.id);
                if (panelDragEntryId != null) setPanelDropTargetFolderId(folder.id);
              }}
              onMouseLeave={() => {
                if (isDragging && dropTargetFolderId === folder.id) setDropTargetFolderId(null);
                if (panelDragEntryId != null && panelDropTargetFolderId === folder.id) setPanelDropTargetFolderId(null);
              }}
              onMouseUp={() => {
                if (panelDragEntryId != null && panelDropTargetFolderId === folder.id) {
                  const draggedEntry = entries.find((e) => e.id === panelDragEntryId);
                  journalCommands.moveEntryToFolder(panelDragEntryId, folder.id).then(() => {
                    if (draggedEntry) toast(<span><strong>{draggedEntry.title}</strong> moved to <strong>{folder.name}</strong></span>);
                  }).catch((error) => {
                    console.error("Failed to move entry:", error);
                  });
                  setPanelDropTargetFolderId(null);
                }
              }}
            >
              <FolderIcon className="w-3.5 h-3.5 shrink-0 text-text/50" />
              <span className="text-xs font-medium truncate flex-1">
                {folder.name}
              </span>
              <span className="text-[10px] text-text/30">
                {folderEntries.length}
              </span>
            </div>

            {/* Folder entries */}
            {isExpanded && (
              <div className="ml-3 border-l border-mid-gray/15 pl-1">
                {folderEntries.length === 0 ? (
                  <p className="text-[10px] text-text/30 px-2 py-1">Empty</p>
                ) : (
                  folderEntries.map((entry) => (
                    <EntryItem
                      key={entry.id}
                      entry={entry}
                      isSelected={selectedEntryId === entry.id}
                      isDragged={dragEntryId === entry.id}
                      isDragMode={isDragging}
                      onClick={() => { if (!isDragging) setSelectedEntryId(entry.id); }}
                      onMouseDown={(e) => handleEntryMouseDown(entry.id, e)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {folders.length === 0 && (
        <p className="text-xs text-text/40 text-center px-2 py-4">
          No folders yet
        </p>
      )}
      </div>
    </div>
  );
};

// --- Search help popup (fixed position, floats over main panel) ---

const SearchHelpPopup: React.FC<{ anchorRef: React.RefObject<HTMLDivElement | null> }> = ({ anchorRef }) => {
  const { t } = useTranslation();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.right + 6 });
  }, [anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      data-search-help-popup
      className="fixed z-[100] bg-background border border-mid-gray/20 rounded-lg shadow-lg p-3 w-[240px]"
      style={{ top: pos.top, left: pos.left }}
    >
      <p className="text-[10px] font-semibold text-text/70 mb-1.5">
        {t("settings.journal.search.helpTitle")}
      </p>
      <p className="text-[10px] text-text/50 mb-2 leading-relaxed">
        {t("settings.journal.search.helpText")}
      </p>
      <div className="space-y-1">
        <div className="flex items-baseline gap-2">
          <code className="text-[10px] bg-mutter-primary/10 text-mutter-primary px-1 py-0.5 rounded font-mono shrink-0">@</code>
          <span className="text-[10px] text-text/50">{t("settings.journal.search.helpAt")}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <code className="text-[10px] bg-mutter-primary/10 text-mutter-primary px-1 py-0.5 rounded font-mono shrink-0">#</code>
          <span className="text-[10px] text-text/50">{t("settings.journal.search.helpHash")}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <code className="text-[10px] bg-mutter-primary/10 text-mutter-primary px-1 py-0.5 rounded font-mono shrink-0">::</code>
          <span className="text-[10px] text-text/50">{t("settings.journal.search.helpColons")}</span>
        </div>
        <div className="pl-5">
          <span className="text-[9px] text-text/30 italic">{t("settings.journal.search.helpColonsExamples")}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <code className="text-[10px] bg-mutter-primary/10 text-mutter-primary px-1 py-0.5 rounded font-mono shrink-0">{t("settings.journal.search.helpBracketsSyntax")}</code>
          <span className="text-[10px] text-text/50">{t("settings.journal.search.helpBrackets")}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// --- Entry item ---

const EntryItem: React.FC<{
  entry: JournalEntry;
  isSelected: boolean;
  isDragged: boolean;
  isDragMode: boolean;
  onClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}> = ({ entry, isSelected, isDragged, isDragMode, onClick, onMouseDown }) => {
  const date = formatDateShort(String(entry.timestamp));
  return (
    <div
      onMouseDown={onMouseDown}
      onClick={onClick}
      className={`flex items-start gap-1.5 px-2 py-1.5 rounded-md transition-colors ${
        isDragged
          ? "bg-mutter-primary/30 opacity-60 cursor-grabbing"
          : isSelected
            ? "bg-mutter-primary/20 cursor-pointer"
            : isDragMode
              ? "cursor-grabbing"
              : "hover:bg-mid-gray/10 cursor-pointer"
      }`}
    >
      <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0 text-text/40" />
      <div className="min-w-0">
        <p className="text-xs font-medium truncate">{entry.title}</p>
        <p className="text-[10px] text-text/40 truncate">{date}</p>
      </div>
    </div>
  );
};
