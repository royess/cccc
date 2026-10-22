import { create } from "zustand";
import { emitSidebarChange } from "./sidebarPreferenceEvents";

export const GROUP_FOLDERS_KEY = "cccc.groupFolders.v1";
export type GroupFolder = { id: string; name: string; groupIds: string[] };
export type FolderPreferences = { folders: GroupFolder[]; activeFolderId: string | null };

export function normalizeFolderPreferences(value: unknown): FolderPreferences {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const folders: GroupFolder[] = [];
  for (const item of Array.isArray(source.folders) ? source.folders : []) {
    if (!item || typeof item !== "object") continue;
    const { id, name, groupIds } = item as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      seen.has(id) ||
      typeof name !== "string" ||
      !name.trim()
    )
      continue;
    seen.add(id);
    folders.push({
      id,
      name: name.trim(),
      groupIds: [
        ...new Set(
          (Array.isArray(groupIds) ? groupIds : []).filter(
            (id): id is string => typeof id === "string" && !!id.trim(),
          ),
        ),
      ],
    });
  }
  return {
    folders,
    activeFolderId:
      typeof source.activeFolderId === "string" && seen.has(source.activeFolderId)
        ? source.activeFolderId
        : null,
  };
}
function load(): FolderPreferences {
  try {
    return normalizeFolderPreferences(
      typeof window === "undefined"
        ? null
        : JSON.parse(window.localStorage.getItem(GROUP_FOLDERS_KEY) || "null"),
    );
  } catch {
    return { folders: [], activeFolderId: null };
  }
}
type FolderStore = FolderPreferences & {
  storageError: boolean;
  selectFolder: (id: string | null) => void;
  createFolder: (name: string, groupIds?: string[]) => string | null;
  updateFolder: (id: string, patch: Partial<Pick<GroupFolder, "name" | "groupIds">>) => void;
  deleteFolder: (id: string) => void;
  moveFolder: (id: string, direction: -1 | 1) => void;
};
export const useGroupFolders = create<FolderStore>((set, get) => {
  function save(next: FolderPreferences) {
    let storageError = false;
    try {
      window.localStorage.setItem(GROUP_FOLDERS_KEY, JSON.stringify(next));
    } catch {
      storageError = true;
    }
    set({ ...next, storageError });
  }
  const prefs = (): FolderPreferences => ({
    folders: get().folders,
    activeFolderId: get().activeFolderId,
  });
  return {
    ...load(),
    storageError: false,
    selectFolder: (id) =>
      save({ ...prefs(), activeFolderId: get().folders.some((f) => f.id === id) ? id : null }),
    createFolder: (name, groupIds = []) => {
      if (!name.trim()) return null;
      const id = crypto.randomUUID();
      const next = normalizeFolderPreferences({
        ...prefs(),
        folders: [...get().folders, { id, name, groupIds }],
      });
      save(next);
      emitSidebarChange({ kind: "create_folder", id, name: name.trim(), groupIds });
      return id;
    },
    updateFolder: (id, patch) => {
      if (patch.name !== undefined && !patch.name.trim()) return;
      const previous = get().folders.find((f) => f.id === id);
      if (!previous) return;
      save(
        normalizeFolderPreferences({
          ...prefs(),
          folders: get().folders.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        }),
      );
      if (patch.name !== undefined)
        emitSidebarChange({ kind: "rename_folder", id, name: patch.name.trim() });
      if (patch.groupIds) {
        for (const groupId of new Set([...previous.groupIds, ...patch.groupIds])) {
          const included = patch.groupIds.includes(groupId);
          if (included !== previous.groupIds.includes(groupId))
            emitSidebarChange({ kind: "folder_membership", id, groupId, included });
        }
      }
    },
    deleteFolder: (id) => {
      save(
        normalizeFolderPreferences({
          ...prefs(),
          folders: get().folders.filter((f) => f.id !== id),
        }),
      );
      emitSidebarChange({ kind: "delete_folder", id });
    },
    moveFolder: (id, direction) => {
      const folders = [...get().folders];
      const from = folders.findIndex((f) => f.id === id),
        to = from + direction;
      if (from < 0 || to < 0 || to >= folders.length) return;
      [folders[from], folders[to]] = [folders[to], folders[from]];
      save({ ...prefs(), folders });
      emitSidebarChange({ kind: "move_folder", id, beforeId: folders[to + 1]?.id || null });
    },
  };
});
// Folder filtering keeps the native global order. Map visible drag indices back
// to the full section before invoking its native reorder callback.
export function folderReorderIndices(
  allIds: string[],
  visibleIds: string[],
  from: number,
  to: number,
): [number, number] | null {
  if (from < 0 || to < 0 || from >= visibleIds.length || to >= visibleIds.length) return null;
  const a = allIds.indexOf(visibleIds[from]),
    b = allIds.indexOf(visibleIds[to]);
  return a < 0 || b < 0 || a === b ? null : [a, b];
}
