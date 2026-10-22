// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import {
  useGroupFolders,
  normalizeFolderPreferences,
  folderReorderIndices,
} from "./useGroupFolders";
import { onSidebarChange, type SidebarOperation } from "./sidebarPreferenceEvents";
let stop: () => void;
let operations: SidebarOperation[];
beforeEach(() => {
  localStorage.clear();
  useGroupFolders.setState({ folders: [], activeFolderId: null, storageError: false });
  operations = [];
  stop = onSidebarChange((op) => operations.push(op));
});
afterEach(() => stop());
it("supports overlapping membership, local selection, rename and deletion without deleting Groups", () => {
  const state = useGroupFolders.getState();
  const one = state.createFolder("One", ["g_one", "g_two"])!;
  const two = state.createFolder("Two", ["g_one"])!;
  state.selectFolder(one);
  state.updateFolder(one, { name: "Renamed", groupIds: ["g_two"] });
  expect(useGroupFolders.getState().folders).toEqual([
    { id: one, name: "Renamed", groupIds: ["g_two"] },
    { id: two, name: "Two", groupIds: ["g_one"] },
  ]);
  expect(operations).toContainEqual({
    kind: "folder_membership",
    id: one,
    groupId: "g_one",
    included: false,
  });
  state.deleteFolder(one);
  expect(useGroupFolders.getState().activeFolderId).toBeNull();
  expect(useGroupFolders.getState().folders[0].groupIds).toEqual(["g_one"]);
});
it("moves folders with a stable anchor instead of a repeatable relative swap", () => {
  const state = useGroupFolders.getState();
  const one = state.createFolder("One")!,
    two = state.createFolder("Two")!,
    three = state.createFolder("Three")!;
  state.moveFolder(three, -1);
  expect(useGroupFolders.getState().folders.map((f) => f.id)).toEqual([one, three, two]);
  expect(operations.at(-1)).toEqual({ kind: "move_folder", id: three, beforeId: two });
});
it("recovers malformed cache entries and maps filtered drag positions to native section positions", () => {
  expect(
    normalizeFolderPreferences({
      folders: [
        null,
        { id: "one", name: " One ", groupIds: ["g_one", "g_one", 9] },
        { id: "one", name: "duplicate" },
      ],
      activeFolderId: "missing",
    }),
  ).toEqual({ folders: [{ id: "one", name: "One", groupIds: ["g_one"] }], activeFolderId: null });
  expect(folderReorderIndices(["g_one", "g_hidden", "g_two"], ["g_one", "g_two"], 0, 1)).toEqual([
    0, 2,
  ]);
  expect(folderReorderIndices(["g_one"], ["g_one"], 1, 0)).toBeNull();
});
