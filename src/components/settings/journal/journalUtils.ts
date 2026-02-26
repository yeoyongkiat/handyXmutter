import type { JournalEntry, JournalFolder } from "@/lib/journal";

// --- View Mode ---

export type ViewMode =
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
  | { mode: "youtube-input"; folderId: number }

export type EntrySource = "voice" | "video" | "meeting";

// --- Date Search Helpers ---

export const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
export const MONTH_ABBR = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

export function parseDateRange(input: string): { start: number; end: number } | null {
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

// --- Entry Search ---

/**
 * Parses search query and filters entries:
 * - Plain text: search entry titles (case-insensitive)
 * - @query: search folder names, show entries in matching folders
 * - #query: search tags
 * - /s query: search by user_source field
 * - ::date: search by date
 * - [query]: find entries linked to entry whose title matches query
 */
export function searchEntries(
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

  // /s query — user source search
  if (q.startsWith("/s ")) {
    const sourceQuery = q.slice(3).toLowerCase();
    if (!sourceQuery) return [];
    return entries.filter((e) =>
      (e.user_source || "").toLowerCase().includes(sourceQuery),
    );
  }

  // Plain text — title search
  const lower = q.toLowerCase();
  return entries.filter((e) => e.title.toLowerCase().includes(lower));
}

// --- Speaker Color Constants ---

export const SPEAKER_COLORS = [
  "text-blue-600",
  "text-green-600",
  "text-orange-500",
  "text-purple-600",
  "text-pink-600",
  "text-teal-600",
];

export const SPEAKER_DOT_COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-orange-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-teal-500",
];

export const SPEAKER_BG_COLORS = [
  "bg-blue-500/8",
  "bg-green-500/8",
  "bg-orange-500/8",
  "bg-purple-500/8",
  "bg-pink-500/8",
  "bg-teal-500/8",
];

// --- Time Formatting ---

export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
