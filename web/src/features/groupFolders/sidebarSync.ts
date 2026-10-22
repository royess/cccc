import { create } from "zustand";
import { apiJson } from "../../services/api/base";
import { useGroupStore } from "../../stores/useGroupStore";
import { mergeGroupOrder, saveGroupOrder, saveArchivedGroupIds } from "../../stores/groupStoreCore";
import { useGroupFolders, normalizeFolderPreferences, type GroupFolder } from "./useGroupFolders";
import { onSidebarChange, type SidebarOperation } from "./sidebarPreferenceEvents";
export type SyncedSidebar = {
  revision: number;
  folders: GroupFolder[];
  groupOrder: string[];
  archivedGroupIds: string[];
};
type Snapshot = { userId: string; initialized: boolean; preferences: SyncedSidebar };
type Pending = { clientId: string; operation: SidebarOperation; createdAt?: number };
type SyncState = {
  status: "loading" | "synced" | "saving" | "error" | "readOnly";
  error: string;
  userId: string;
  pending: number;
  retry: () => void;
};
export const useSidebarSync = create<SyncState>(() => ({
  status: "loading",
  error: "",
  userId: "",
  pending: 0,
  retry: () => {},
}));
const OWNER_KEY = "cccc.sidebar.legacyOwner";
const pendingPrefix = (userId: string) => `cccc.sidebar.pending.${encodeURIComponent(userId)}/`;
function restorePending(userId: string): Pending[] {
  try {
    const prefix = pendingPrefix(userId),
      pending: Pending[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const entry = JSON.parse(localStorage.getItem(key) || "null");
      if (
        entry &&
        typeof entry.clientId === "string" &&
        entry.operation &&
        typeof entry.operation.kind === "string"
      )
        pending.push(entry);
    }
    return pending.sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.clientId.localeCompare(b.clientId),
    );
  } catch {
    return [];
  }
}
let enqueueSequence = 0;
function pending(operation: SidebarOperation): Pending {
  return {
    clientId: crypto.randomUUID(),
    operation,
    createdAt: Date.now() * 1000 + (++enqueueSequence % 1000),
  };
}
function applySnapshot(preferences: SyncedSidebar) {
  const normalized = normalizeFolderPreferences({
    folders: preferences.folders,
    activeFolderId: useGroupFolders.getState().activeFolderId,
  });
  useGroupFolders.setState(normalized);
  const groups = useGroupStore.getState().groups;
  const groupOrder = groups.length
    ? mergeGroupOrder(preferences.groupOrder, groups)
    : [...preferences.groupOrder];
  useGroupStore.setState({ groupOrder, archivedGroupIds: preferences.archivedGroupIds });
  saveGroupOrder(groupOrder);
  saveArchivedGroupIds(preferences.archivedGroupIds);
}
// One browser owner; no Agent polling, inbox consumption or execution API calls.
export function startSidebarSync(readOnly = false): () => void {
  let alive = true,
    busy = false,
    initialized = false;
  let owner = "",
    queue: Pending[] = [],
    latest: Snapshot | null = null;
  const abort = new AbortController();
  const signal = () => AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]);
  const update = (patch: Partial<SyncState>) => {
    if (alive) useSidebarSync.setState(patch);
  };
  function persist() {
    if (!owner) return;
    try {
      for (const entry of queue)
        localStorage.setItem(pendingPrefix(owner) + entry.clientId, JSON.stringify(entry));
    } catch {
      update({
        error: "Pending sidebar changes cannot be cached. Keep this page open until synced.",
      });
    }
  }
  function accept(snapshot: Snapshot) {
    if (owner && owner !== snapshot.userId)
      throw Error("Account changed. Reload before syncing sidebar changes.");
    owner = snapshot.userId;
    if (!latest || snapshot.preferences.revision >= latest.preferences.revision) latest = snapshot;
  }
  async function run() {
    if (!alive || busy) return;
    busy = true;
    try {
      if (!initialized || !queue.length) {
        const response = await apiJson<Snapshot>("/api/v1/user/sidebar", { signal: signal() });
        if (!alive) return;
        if (!response.ok) throw Error(response.error.message);
        accept(response.result);
        if (!initialized) {
          if (!readOnly) queue = [...restorePending(owner), ...queue];
          if (!latest!.initialized && !readOnly) {
            let legacyOwner: string | null = null;
            try {
              legacyOwner = localStorage.getItem(OWNER_KEY);
            } catch {
              /* No legacy cache. */
            }
            const groups = useGroupStore.getState();
            queue.unshift(
              pending({
                kind: "seed",
                preferences:
                  !legacyOwner || legacyOwner === owner
                    ? {
                        folders: useGroupFolders.getState().folders,
                        groupOrder: groups.groupOrder,
                        archivedGroupIds: groups.archivedGroupIds,
                      }
                    : { folders: [], groupOrder: [], archivedGroupIds: [] },
              }),
            );
          }
          initialized = true;
          if (!readOnly) persist();
        }
      }
      while (alive && queue.length && !readOnly) {
        update({ status: "saving", pending: queue.length, userId: owner });
        const response = await apiJson<Snapshot>("/api/v1/user/sidebar", {
          method: "PATCH",
          body: JSON.stringify({ ...queue[0], userId: owner }),
          signal: signal(),
        });
        if (!alive) return;
        if (!response.ok) throw Error(response.error.message);
        accept(response.result);
        const accepted = queue.shift()!;
        try {
          localStorage.removeItem(pendingPrefix(owner) + accepted.clientId);
        } catch {
          /* A duplicate retry remains safe. */
        }
      }
      if (!alive) return;
      // An uninitialized read-only response is not a canonical empty sidebar.
      // Keep the legacy view and its ownership until an account record exists.
      if (latest?.initialized && !queue.length) {
        applySnapshot(latest.preferences);
        try {
          localStorage.setItem(OWNER_KEY, owner);
        } catch {
          /* Cache is optional after server acceptance. */
        }
      }
      update({
        status: readOnly ? "readOnly" : "synced",
        userId: owner,
        pending: queue.length,
        error: "",
      });
    } catch (error) {
      if (alive)
        update({
          status: "error",
          pending: queue.length,
          error: error instanceof Error ? error.message : "Sidebar synchronization failed.",
        });
    } finally {
      busy = false;
    }
  }
  const unsubscribe = onSidebarChange((operation) => {
    if (readOnly) return;
    queue.push(pending(operation));
    persist();
    update({ status: "saving", pending: queue.length });
    void run();
  });
  const refresh = () => {
    if (document.visibilityState !== "hidden") void run();
  };
  update({ status: "loading", error: "", pending: 0, userId: "", retry: refresh });
  const interval = window.setInterval(refresh, 60000);
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", refresh);
  void run();
  return () => {
    alive = false;
    abort.abort();
    unsubscribe();
    window.clearInterval(interval);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("online", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}
