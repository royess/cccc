import type { GroupFolder } from "./useGroupFolders";
export type SidebarOperation =
  | {
      kind: "seed";
      preferences: { folders: GroupFolder[]; groupOrder: string[]; archivedGroupIds: string[] };
    }
  | { kind: "create_folder"; id: string; name: string; groupIds: string[] }
  | { kind: "rename_folder"; id: string; name: string }
  | { kind: "folder_membership"; id: string; groupId: string; included: boolean }
  | { kind: "delete_folder"; id: string }
  | { kind: "move_folder"; id: string; beforeId: string | null }
  | { kind: "archive"; groupId: string; archived: boolean }
  | {
      kind: "reorder";
      fromId: string;
      toId: string;
      after: boolean;
      archived: boolean;
      knownIds: string[];
    };
const listeners = new Set<(operation: SidebarOperation) => void>();
export function emitSidebarChange(operation: SidebarOperation) {
  for (const listener of listeners) listener(operation);
}
export function onSidebarChange(listener: (operation: SidebarOperation) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
