import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface MutterPromptOverrides {
  clean?: string;
  structure?: string;
  organise?: string;
  report?: string;
  retrieve?: string;
  sharpen?: string;
  brainstorm?: string;
}

interface MutterStore {
  selectedEntryId: number | null;
  setSelectedEntryId: (id: number | null) => void;
  selectedFolderId: number | null;
  setSelectedFolderId: (id: number | null) => void;
  expandedFolderIds: Set<number>;
  toggleFolder: (id: number) => void;
  promptOverrides: MutterPromptOverrides;
  setPromptOverride: (key: keyof MutterPromptOverrides, value: string | undefined) => void;
  /** Cross-panel drag: entry being dragged from main panel */
  panelDragEntryId: number | null;
  setPanelDragEntryId: (id: number | null) => void;
  /** Sidebar search query — shared with main panel */
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const useMutterStore = create<MutterStore>()(
  persist(
    (set) => ({
      selectedEntryId: null,
      setSelectedEntryId: (id) => set({ selectedEntryId: id }),
      selectedFolderId: null,
      setSelectedFolderId: (id) => set({ selectedFolderId: id }),
      expandedFolderIds: new Set<number>(),
      toggleFolder: (id) =>
        set((state) => {
          const next = new Set(state.expandedFolderIds);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return { expandedFolderIds: next };
        }),
      promptOverrides: {},
      setPromptOverride: (key, value) =>
        set((state) => ({
          promptOverrides: { ...state.promptOverrides, [key]: value },
        })),
      panelDragEntryId: null,
      setPanelDragEntryId: (id) => set({ panelDragEntryId: id }),
      searchQuery: "",
      setSearchQuery: (query) => set({ searchQuery: query }),
    }),
    {
      name: "mutter-store",
      partialize: (state) => ({ promptOverrides: state.promptOverrides }),
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          return str ? JSON.parse(str) : null;
        },
        setItem: (name, value) => localStorage.setItem(name, JSON.stringify(value)),
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
);
