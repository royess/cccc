// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
import { useGroupStore } from "../../stores/useGroupStore";
import { useGroupFolders } from "./useGroupFolders";
import { startSidebarSync, useSidebarSync, type SyncedSidebar } from "./sidebarSync";
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../services/api/base", () => ({ apiJson: (...args: unknown[]) => mock.api(...args) }));
let stop: (() => void) | undefined;
const initial = useGroupStore.getState();
const empty: SyncedSidebar = { revision: 0, folders: [], groupOrder: [], archivedGroupIds: [] };
const snapshot = (preferences = empty, initialized = true, userId = "viewer-one") => ({
  ok: true,
  result: { userId, initialized, preferences },
});
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
beforeEach(() => {
  localStorage.clear();
  mock.api.mockReset();
  useGroupStore.setState({
    groups: [
      { group_id: "g_one", title: "One" },
      { group_id: "g_two", title: "Two" },
    ],
    groupOrder: ["g_two", "g_one"],
    archivedGroupIds: ["g_two"],
  });
  useGroupFolders.setState({ folders: [], activeFolderId: null });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  useGroupStore.setState(initial, true);
});
it("imports legacy order/archive once, then uses the account's canonical state", async () => {
  const server = {
    ...empty,
    revision: 1,
    groupOrder: ["g_two", "g_one"],
    archivedGroupIds: ["g_two"],
  };
  mock.api.mockResolvedValueOnce(snapshot(empty, false)).mockResolvedValue(snapshot(server));
  stop = startSidebarSync();
  await settle();
  const sent = JSON.parse(mock.api.mock.calls[1][1].body);
  expect(sent.operation).toEqual({
    kind: "seed",
    preferences: { folders: [], groupOrder: ["g_two", "g_one"], archivedGroupIds: ["g_two"] },
  });
  stop();
  useGroupStore.setState({ groupOrder: ["g_one", "g_two"], archivedGroupIds: [] });
  mock.api.mockClear();
  mock.api.mockResolvedValue(snapshot(server));
  stop = startSidebarSync();
  await settle();
  expect(mock.api).toHaveBeenCalledOnce();
  expect(useGroupStore.getState().archivedGroupIds).toEqual(["g_two"]);
  expect(useGroupStore.getState().groupOrder).toEqual(["g_two", "g_one"]);
});
it("syncs native archive and reorder intents instead of replacing an old preference document", async () => {
  const base = { ...empty, revision: 1, groupOrder: ["g_one", "g_two"] };
  mock.api.mockResolvedValue(snapshot(base));
  stop = startSidebarSync();
  await settle();
  mock.api.mockResolvedValue(snapshot({ ...base, revision: 2, archivedGroupIds: ["g_two"] }));
  useGroupStore.getState().archiveGroup("g_two");
  await settle();
  expect(JSON.parse(mock.api.mock.calls.at(-1)![1].body).operation).toEqual({
    kind: "archive",
    groupId: "g_two",
    archived: true,
  });
  mock.api.mockResolvedValue(snapshot({ ...base, revision: 3, groupOrder: ["g_two", "g_one"] }));
  useGroupStore.getState().restoreGroup("g_two");
  await settle();
  useGroupStore.getState().reorderGroupsInSection("working", 0, 1);
  await settle();
  expect(JSON.parse(mock.api.mock.calls.at(-1)![1].body).operation.kind).toBe("reorder");
});
it("keeps an uncertain operation across reload under the same key and account", async () => {
  mock.api.mockResolvedValueOnce(snapshot()).mockRejectedValue(new Error("network interrupted"));
  stop = startSidebarSync();
  await settle();
  const id = useGroupFolders.getState().createFolder("Research", ["g_one"])!;
  await settle();
  expect(useSidebarSync.getState().status).toBe("error");
  const first = JSON.parse(mock.api.mock.calls.at(-1)![1].body);
  stop();
  const accepted = {
    ...empty,
    revision: 1,
    folders: [{ id, name: "Research", groupIds: ["g_one"] }],
  };
  mock.api.mockClear();
  mock.api.mockResolvedValue(snapshot(accepted));
  stop = startSidebarSync();
  await settle();
  const retried = JSON.parse(mock.api.mock.calls[1][1].body);
  expect(retried).toEqual(first);
  expect(useSidebarSync.getState().status).toBe("synced");
  expect(localStorage.getItem("cccc.sidebar.pending.viewer-one/" + first.clientId)).toBeNull();
});
it("does not replay another account's pending edits or write in exhibit mode", async () => {
  localStorage.setItem(
    "cccc.sidebar.pending.viewer-one/old",
    JSON.stringify({ clientId: "old", operation: { kind: "delete_folder", id: "private" } }),
  );
  mock.api.mockResolvedValue(snapshot(empty, true, "viewer-two"));
  stop = startSidebarSync();
  await settle();
  expect(mock.api).toHaveBeenCalledOnce();
  stop();
  mock.api.mockClear();
  mock.api.mockResolvedValue(snapshot(empty, true, "viewer-one"));
  stop = startSidebarSync(true);
  await settle();
  expect(mock.api).toHaveBeenCalledOnce();
  expect(localStorage.getItem("cccc.sidebar.pending.viewer-one/old")).not.toBeNull();
});
it("preserves legacy preferences in read-only mode until a canonical record exists", async () => {
  const legacyFolders = [{ id: "legacy", name: "Legacy folder", groupIds: ["g_two"] }];
  useGroupFolders.setState({ folders: legacyFolders, activeFolderId: "legacy" });
  const legacyCache = JSON.stringify({ folders: legacyFolders, activeFolderId: "legacy" });
  localStorage.setItem("cccc.groupFolders.v1", legacyCache);
  localStorage.setItem("cccc-group-order", JSON.stringify(["g_two", "g_one"]));
  localStorage.setItem("cccc-archived-group-ids", JSON.stringify(["g_two"]));
  mock.api.mockResolvedValue(snapshot(empty, false));
  stop = startSidebarSync(true);
  await settle();
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(mock.api.mock.calls.every(([, options]) => !options.method)).toBe(true);
  expect(useSidebarSync.getState().status).toBe("readOnly");
  expect(useGroupFolders.getState().folders).toEqual(legacyFolders);
  expect(useGroupFolders.getState().activeFolderId).toBe("legacy");
  expect(useGroupStore.getState().groupOrder).toEqual(["g_two", "g_one"]);
  expect(useGroupStore.getState().archivedGroupIds).toEqual(["g_two"]);
  expect(localStorage.getItem("cccc.groupFolders.v1")).toBe(legacyCache);
  expect(localStorage.getItem("cccc-group-order")).toBe(JSON.stringify(["g_two", "g_one"]));
  expect(localStorage.getItem("cccc-archived-group-ids")).toBe(JSON.stringify(["g_two"]));
  expect(localStorage.getItem("cccc.sidebar.legacyOwner")).toBeNull();

  // A later canonical empty record is authoritative even in read-only mode.
  mock.api.mockResolvedValue(snapshot({ ...empty, revision: 1 }));
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(useGroupFolders.getState().folders).toEqual([]);
  expect(useGroupStore.getState().archivedGroupIds).toEqual([]);
  expect(localStorage.getItem("cccc.sidebar.legacyOwner")).toBe("viewer-one");
});
it("ignores a response after its owner is unmounted and refreshes a visible second device", async () => {
  let resolve: (value: unknown) => void = () => {};
  mock.api.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  stop = startSidebarSync();
  stop();
  const server = {
    ...empty,
    revision: 2,
    folders: [{ id: "one", name: "Remote folder", groupIds: ["g_one"] }],
  };
  mock.api.mockResolvedValue(snapshot(server));
  stop = startSidebarSync();
  await settle();
  resolve(snapshot(empty, false));
  await settle();
  expect(mock.api).toHaveBeenCalledTimes(2);
  expect(useGroupFolders.getState().folders[0].name).toBe("Remote folder");
  mock.api.mockResolvedValue(snapshot({ ...server, revision: 3, archivedGroupIds: ["g_one"] }));
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(useGroupStore.getState().archivedGroupIds).toEqual(["g_one"]);
});

it("retains synced order when preferences arrive before the initial Group list", async () => {
  useGroupStore.setState({ groups: [], groupOrder: [], archivedGroupIds: [] });
  mock.api.mockResolvedValue(snapshot({ ...empty, revision: 1, groupOrder: ["g_two", "g_one"] }));
  stop = startSidebarSync();
  await settle();
  expect(useGroupStore.getState().groupOrder).toEqual(["g_two", "g_one"]);
  useGroupStore.getState().setGroups([
    { group_id: "g_one", title: "One" },
    { group_id: "g_two", title: "Two" },
  ]);
  expect(useGroupStore.getState().groupOrder).toEqual(["g_two", "g_one"]);
});

it("does not overwrite or erase a different tab's pending operation", async () => {
  mock.api.mockResolvedValue(snapshot());
  stop = startSidebarSync();
  await settle();
  const other = {
    clientId: "other-tab",
    createdAt: 1,
    operation: { kind: "archive", groupId: "g_two", archived: true },
  };
  localStorage.setItem("cccc.sidebar.pending.viewer-one/other-tab", JSON.stringify(other));
  useGroupFolders.getState().createFolder("New folder");
  await settle();
  expect(JSON.parse(localStorage.getItem("cccc.sidebar.pending.viewer-one/other-tab")!)).toEqual(
    other,
  );
});
