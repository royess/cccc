import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import type { GroupMeta } from "../../types";
import { useModalA11y } from "../../hooks/useModalA11y";
import { useGroupFolders } from "./useGroupFolders";
import { useSidebarSync } from "./sidebarSync";
export function GroupFolderDialog({
  groups,
  groupId,
  onClose,
}: {
  groups: GroupMeta[];
  groupId?: string;
  onClose: () => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const { folders, createFolder, updateFolder, deleteFolder, moveFolder } = useGroupFolders();
  const sync = useSidebarSync();
  const [editing, setEditing] = useState(folders[0]?.id || "");
  const [newName, setNewName] = useState("");
  const [rename, setRename] = useState("");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState("");
  const current = folders.find((f) => f.id === editing) || folders[0];
  const { modalRef } = useModalA11y(true, onClose);
  useEffect(() => {
    setRename(current?.name || "");
    setDeleting("");
  }, [current?.id, current?.name]);
  const title = groupId
    ? `${zh ? "工作组文件夹" : "Folders for"} · ${groups.find((g) => g.group_id === groupId)?.title || groupId}`
    : zh
      ? "管理文件夹"
      : "Manage folders";
  const input = "glass-input min-h-10 w-full min-w-0 rounded-lg px-3 py-2 text-sm";
  const button = "glass-btn min-h-10 shrink-0 rounded-lg px-3 text-sm disabled:opacity-40";
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-dialog-title"
        className="flex max-h-[calc(100dvh-24px)] w-full max-w-xl min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--glass-border-subtle)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-2xl"
      >
        <div className="shrink-0 border-b border-[var(--glass-border-subtle)] px-5 py-4">
          <h2 id="folder-dialog-title" className="break-words text-lg font-semibold">
            {title}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {zh
              ? "一个工作组可加入多个文件夹。删除文件夹不会删除工作组。"
              : "Groups can belong to multiple folders. Deleting a folder does not delete Groups."}
          </p>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const id = createFolder(newName, groupId ? [groupId] : []);
              if (id) {
                setEditing(id);
                setNewName("");
              }
            }}
          >
            <input
              autoComplete="off"
              aria-label={zh ? "新文件夹名称" : "New folder name"}
              placeholder={zh ? "新文件夹名称" : "New folder name"}
              className={input}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" className={button} disabled={!newName.trim()}>
              {zh ? "创建" : "Create"}
            </button>
          </form>
          {groupId ? (
            <div className="space-y-2">
              {folders.map((f) => (
                <label
                  key={f.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-[var(--glass-border-subtle)] p-3"
                >
                  <input
                    type="checkbox"
                    checked={f.groupIds.includes(groupId)}
                    onChange={(e) =>
                      updateFolder(f.id, {
                        groupIds: e.target.checked
                          ? [...f.groupIds, groupId]
                          : f.groupIds.filter((id) => id !== groupId),
                      })
                    }
                  />
                  <span className="min-w-0 break-words text-sm">{f.name}</span>
                </label>
              ))}
            </div>
          ) : current ? (
            <>
              <label className="block text-sm">
                {zh ? "编辑文件夹" : "Edit folder"}
                <select
                  className={`${input} mt-1`}
                  value={current.id}
                  onChange={(e) => {
                    setEditing(e.target.value);
                    setQuery("");
                  }}
                  aria-label={zh ? "编辑文件夹" : "Edit folder"}
                >
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  updateFolder(current.id, { name: rename });
                }}
              >
                <input
                  aria-label={zh ? "文件夹名称" : "Folder name"}
                  className={input}
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                />
                <button
                  className={button}
                  type="submit"
                  disabled={!rename.trim() || rename.trim() === current.name}
                >
                  {zh ? "改名" : "Rename"}
                </button>
              </form>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={folders[0].id === current.id}
                  onClick={() => moveFolder(current.id, -1)}
                  aria-label={zh ? "文件夹前移" : "Move folder earlier"}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={folders[folders.length - 1].id === current.id}
                  onClick={() => moveFolder(current.id, 1)}
                  aria-label={zh ? "文件夹后移" : "Move folder later"}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type="button"
                  className={`${button} inline-flex items-center gap-2 text-red-600`}
                  onClick={() => setDeleting(current.id)}
                >
                  <Trash2 size={15} />
                  {zh ? "删除文件夹" : "Delete folder"}
                </button>
              </div>
              {deleting === current.id && (
                <div className="rounded-lg border border-[var(--glass-border-subtle)] p-3 text-sm">
                  <p>
                    {zh
                      ? `删除“${current.name}”？工作组仍保留在“全部”中。`
                      : `Delete “${current.name}”? Its Groups remain available in All.`}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className={`${button} text-red-600`}
                      onClick={() => {
                        deleteFolder(current.id);
                        setDeleting("");
                      }}
                    >
                      {zh ? "确认删除" : "Confirm delete"}
                    </button>
                    <button type="button" className={button} onClick={() => setDeleting("")}>
                      {zh ? "取消" : "Cancel"}
                    </button>
                  </div>
                </div>
              )}
              <label className="block text-sm">
                {zh ? "包含工作组" : "Included Groups"}
                <input
                  type="search"
                  className={`${input} mt-1`}
                  placeholder={zh ? "搜索工作组" : "Search Groups"}
                  aria-label={zh ? "搜索工作组" : "Search Groups"}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="max-h-[35vh] space-y-1 overflow-y-auto">
                {groups
                  .filter((g) =>
                    `${g.title || ""} ${g.group_id}`
                      .toLocaleLowerCase()
                      .includes(query.toLocaleLowerCase()),
                  )
                  .map((g) => (
                    <label
                      key={g.group_id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--glass-panel-bg)]"
                    >
                      <input
                        type="checkbox"
                        checked={current.groupIds.includes(g.group_id)}
                        onChange={(e) =>
                          updateFolder(current.id, {
                            groupIds: e.target.checked
                              ? [...current.groupIds, g.group_id]
                              : current.groupIds.filter((id) => id !== g.group_id),
                          })
                        }
                      />
                      <span className="min-w-0 break-words text-sm">{g.title || g.group_id}</span>
                    </label>
                  ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">
              {zh
                ? "创建第一个文件夹，然后选择包含的工作组。"
                : "Create a folder, then choose which Groups it includes."}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--glass-border-subtle)] px-5 py-3">
          <span
            role="status"
            className="min-w-0 break-words text-xs text-[var(--color-text-secondary)]"
          >
            {sync.status === "error"
              ? sync.error
              : sync.status === "synced"
                ? zh
                  ? "已同步到账户"
                  : "Synced to account"
                : zh
                  ? "正在同步…"
                  : "Syncing…"}
            {sync.status === "error" && (
              <button type="button" className="ml-2 underline" onClick={sync.retry}>
                {zh ? "重试" : "Retry"}
              </button>
            )}
          </span>
          <button type="button" className={button} onClick={onClose}>
            {zh ? "完成" : "Done"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
