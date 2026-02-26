import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Globe, Users, Settings } from "lucide-react";
import { JournalSettings } from "../settings/journal/JournalSettings";
import { MutterSettings } from "./MutterSettings";
import { useMutterStore, type MutterTab } from "@/stores/mutterStore";

const MUTTER_TABS = {
  journal: {
    labelKey: "mutter.tabs.journal",
    icon: BookOpen,
  },
  video: {
    labelKey: "mutter.tabs.video",
    icon: Globe,
  },
  meeting: {
    labelKey: "mutter.tabs.meeting",
    icon: Users,
  },
} as const;

export const MutterPanel: React.FC = () => {
  const { t } = useTranslation();
  const activeTab = useMutterStore((s) => s.activeTab);
  const setActiveTab = useMutterStore((s) => s.setActiveTab);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-mid-gray/20 shrink-0">
        <div className="flex items-center gap-1">
          {Object.entries(MUTTER_TABS).map(([key, tab]) => {
            const Icon = tab.icon;
            const isActive = activeTab === key && !showSettings;
            return (
              <button
                key={key}
                onClick={() => { setActiveTab(key as MutterTab); setShowSettings(false); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? "bg-mutter-primary/20 text-mutter-primary"
                    : "hover:bg-mid-gray/10 text-text/60"
                }`}
              >
                <Icon className="w-4 h-4" />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-1.5 rounded-md transition-colors cursor-pointer ${
            showSettings
              ? "text-mutter-primary bg-mutter-primary/10"
              : "text-text/40 hover:text-text/70 hover:bg-mid-gray/10"
          }`}
          title={t("common.settings")}
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center p-4 gap-4">
          {showSettings ? (
            <MutterSettings />
          ) : (
            <>
              {activeTab === "journal" && <JournalSettingsWithStore />}
              {activeTab === "video" && <VideoSettingsWithStore />}
              {activeTab === "meeting" && <MeetingSettingsWithStore />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// Wrapper that passes the selected entry/folder from the store into JournalSettings
const JournalSettingsWithStore: React.FC = () => {
  const selectedEntryId = useMutterStore((s) => s.selectedEntryId);
  const setSelectedEntryId = useMutterStore((s) => s.setSelectedEntryId);
  const selectedFolderId = useMutterStore((s) => s.selectedFolderId);
  const setSelectedFolderId = useMutterStore((s) => s.setSelectedFolderId);

  return (
    <JournalSettings
      source="voice"
      selectedEntryId={selectedEntryId}
      selectedFolderId={selectedFolderId}
      onSelectEntry={setSelectedEntryId}
      onSelectFolder={setSelectedFolderId}
    />
  );
};

// Wrapper for the Video tab — uses JournalSettings with source="video"
const VideoSettingsWithStore: React.FC = () => {
  const selectedEntryId = useMutterStore((s) => s.selectedVideoEntryId);
  const setSelectedEntryId = useMutterStore((s) => s.setSelectedVideoEntryId);
  const selectedFolderId = useMutterStore((s) => s.selectedVideoFolderId);
  const setSelectedFolderId = useMutterStore((s) => s.setSelectedVideoFolderId);

  return (
    <JournalSettings
      source="video"
      selectedEntryId={selectedEntryId}
      selectedFolderId={selectedFolderId}
      onSelectEntry={setSelectedEntryId}
      onSelectFolder={setSelectedFolderId}
    />
  );
};

// Wrapper for the Meeting tab — uses JournalSettings with source="meeting"
const MeetingSettingsWithStore: React.FC = () => {
  const selectedEntryId = useMutterStore((s) => s.selectedMeetingEntryId);
  const setSelectedEntryId = useMutterStore((s) => s.setSelectedMeetingEntryId);
  const selectedFolderId = useMutterStore((s) => s.selectedMeetingFolderId);
  const setSelectedFolderId = useMutterStore((s) => s.setSelectedMeetingFolderId);

  return (
    <JournalSettings
      source="meeting"
      selectedEntryId={selectedEntryId}
      selectedFolderId={selectedFolderId}
      onSelectEntry={setSelectedEntryId}
      onSelectFolder={setSelectedFolderId}
    />
  );
};
