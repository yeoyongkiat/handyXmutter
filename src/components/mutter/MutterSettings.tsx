import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, RotateCcw, FolderOpen } from "lucide-react";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  MUTTER_DEFAULT_PROMPTS,
  MUTTER_DEFAULT_CHAT_INSTRUCTIONS,
  journalCommands,
} from "@/lib/journal";
import { useMutterStore } from "@/stores/mutterStore";

type MutterSettingsProps = Record<string, never>;

interface PromptEditorProps {
  label: string;
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
  onReset: () => void;
  isCustomised: boolean;
}

const PromptEditor: React.FC<PromptEditorProps> = ({
  label,
  value,
  defaultValue,
  onChange,
  onReset,
  isCustomised,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-mid-gray/20 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-mid-gray/5 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {isCustomised && (
            <span className="px-1.5 py-0.5 bg-mutter-primary/15 text-mutter-primary text-[9px] rounded-full font-medium">
              {t("mutter.settings.customised")}
            </span>
          )}
        </div>
        <ChevronLeft
          className={`w-3.5 h-3.5 text-text/40 transition-transform ${expanded ? "-rotate-90" : ""}`}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={defaultValue}
            rows={8}
            className="w-full text-xs text-text/80 bg-background border border-mid-gray/20 rounded-md p-2 resize-y focus:outline-none focus:border-mutter-primary/50 font-mono leading-relaxed"
          />
          {isCustomised && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 text-[10px] text-text/40 hover:text-mutter-primary transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              {t("mutter.settings.resetToDefault")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const MutterSettings: React.FC<MutterSettingsProps> = () => {
  const { t } = useTranslation();
  const promptOverrides = useMutterStore((s) => s.promptOverrides);
  const setPromptOverride = useMutterStore((s) => s.setPromptOverride);
  const [storagePath, setStoragePath] = useState("");
  const [isChangingPath, setIsChangingPath] = useState(false);

  useEffect(() => {
    journalCommands.getStoragePath().then(setStoragePath).catch(console.error);
  }, []);

  const handleChangeStoragePath = async () => {
    const selected = await openFolderDialog({
      directory: true,
      title: t("mutter.settings.chooseStorageFolder"),
    });
    if (!selected) return;
    setIsChangingPath(true);
    try {
      await journalCommands.setStoragePath(selected);
      setStoragePath(selected);
      toast(t("mutter.settings.storagePathUpdated"));
    } catch (error) {
      console.error("Failed to set storage path:", error);
      toast.error(String(error));
    } finally {
      setIsChangingPath(false);
    }
  };

  const defaultClean = MUTTER_DEFAULT_PROMPTS.find((p) => p.name === "Clean")!.prompt;
  const defaultStructure = MUTTER_DEFAULT_PROMPTS.find((p) => p.name === "Structure")!.prompt;
  const defaultOrganise = MUTTER_DEFAULT_PROMPTS.find((p) => p.name === "Organise")!.prompt;
  const defaultReport = MUTTER_DEFAULT_PROMPTS.find((p) => p.name === "Report")!.prompt;

  return (
    <div className="w-full max-w-2xl space-y-6">

      {/* Storage Location */}
      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-medium text-text/60 uppercase tracking-wide">
            {t("mutter.settings.storageLocation")}
          </h3>
          <p className="text-[10px] text-text/40 mt-0.5">
            {t("mutter.settings.storageLocationDesc")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 text-xs text-text/70 bg-background border border-mid-gray/20 rounded-md px-3 py-2 truncate font-mono">
            {storagePath || "..."}
          </div>
          <button
            onClick={handleChangeStoragePath}
            disabled={isChangingPath}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg text-white bg-mutter-primary hover:bg-mutter-primary/80 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {isChangingPath ? t("mutter.settings.migrating") : t("mutter.settings.changeFolder")}
          </button>
        </div>
      </div>

      {/* Post-Processing Prompts */}
      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-medium text-text/60 uppercase tracking-wide">
            {t("mutter.settings.postProcessPrompts")}
          </h3>
          <p className="text-[10px] text-text/40 mt-0.5">
            {t("mutter.settings.postProcessPromptsDesc")}
          </p>
        </div>
        <div className="space-y-2">
          <PromptEditor
            label={t("mutter.settings.clean")}
            value={promptOverrides.clean ?? defaultClean}
            defaultValue={defaultClean}
            isCustomised={promptOverrides.clean !== undefined}
            onChange={(v) => setPromptOverride("clean", v)}
            onReset={() => setPromptOverride("clean", undefined)}
          />
          <PromptEditor
            label={t("mutter.settings.structure")}
            value={promptOverrides.structure ?? defaultStructure}
            defaultValue={defaultStructure}
            isCustomised={promptOverrides.structure !== undefined}
            onChange={(v) => setPromptOverride("structure", v)}
            onReset={() => setPromptOverride("structure", undefined)}
          />
          <PromptEditor
            label={t("mutter.settings.organise")}
            value={promptOverrides.organise ?? defaultOrganise}
            defaultValue={defaultOrganise}
            isCustomised={promptOverrides.organise !== undefined}
            onChange={(v) => setPromptOverride("organise", v)}
            onReset={() => setPromptOverride("organise", undefined)}
          />
          <PromptEditor
            label={t("mutter.settings.report")}
            value={promptOverrides.report ?? defaultReport}
            defaultValue={defaultReport}
            isCustomised={promptOverrides.report !== undefined}
            onChange={(v) => setPromptOverride("report", v)}
            onReset={() => setPromptOverride("report", undefined)}
          />
        </div>
      </div>

      {/* Chat Prompts */}
      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-medium text-text/60 uppercase tracking-wide">
            {t("mutter.settings.chatPrompts")}
          </h3>
          <p className="text-[10px] text-text/40 mt-0.5">
            {t("mutter.settings.chatPromptsDesc")}
          </p>
        </div>
        <div className="space-y-2">
          <PromptEditor
            label={t("mutter.settings.retrieve")}
            value={promptOverrides.retrieve ?? MUTTER_DEFAULT_CHAT_INSTRUCTIONS.retrieve}
            defaultValue={MUTTER_DEFAULT_CHAT_INSTRUCTIONS.retrieve}
            isCustomised={promptOverrides.retrieve !== undefined}
            onChange={(v) => setPromptOverride("retrieve", v)}
            onReset={() => setPromptOverride("retrieve", undefined)}
          />
          <PromptEditor
            label={t("mutter.settings.sharpen")}
            value={promptOverrides.sharpen ?? MUTTER_DEFAULT_CHAT_INSTRUCTIONS.sharpen}
            defaultValue={MUTTER_DEFAULT_CHAT_INSTRUCTIONS.sharpen}
            isCustomised={promptOverrides.sharpen !== undefined}
            onChange={(v) => setPromptOverride("sharpen", v)}
            onReset={() => setPromptOverride("sharpen", undefined)}
          />
          <PromptEditor
            label={t("mutter.settings.brainstorm")}
            value={promptOverrides.brainstorm ?? MUTTER_DEFAULT_CHAT_INSTRUCTIONS.brainstorm}
            defaultValue={MUTTER_DEFAULT_CHAT_INSTRUCTIONS.brainstorm}
            isCustomised={promptOverrides.brainstorm !== undefined}
            onChange={(v) => setPromptOverride("brainstorm", v)}
            onReset={() => setPromptOverride("brainstorm", undefined)}
          />
        </div>
      </div>
    </div>
  );
};
