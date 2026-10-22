import { useRef } from "react";
import { Folder, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GroupMeta } from "../../types";
import { useSidebarSync } from "./sidebarSync";
import { useGroupFolders } from "./useGroupFolders";

export function GroupFolderBar({
  groups,
  panelId,
  collapsed,
  onManage,
  readOnly,
}: {
  groups: GroupMeta[];
  panelId: string;
  collapsed: boolean;
  onManage: () => void;
  readOnly?: boolean;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const { folders, activeFolderId, selectFolder } = useGroupFolders();
  const sync = useSidebarSync();
  const tabs = useRef<HTMLDivElement>(null);
  const known = new Set(groups.map((g) => g.group_id));
  const choices = [
    { id: "", name: zh ? "全部" : "All", count: groups.length },
    ...folders.map((f) => ({ ...f, count: f.groupIds.filter((id) => known.has(id)).length })),
  ];
  const label = zh ? "工作组文件夹" : "Group folders";
  return (
    <div
      className="shrink-0 border-b border-[var(--glass-border-subtle)] p-2"
      data-group-folder-bar
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-1">
          <label
            className="relative flex h-10 w-10 items-center justify-center rounded-xl glass-btn"
            title={choices.find((f) => f.id === (activeFolderId || ""))?.name}
          >
            <Folder size={18} aria-hidden="true" />
            <select
              aria-label={label}
              value={activeFolderId || ""}
              onChange={(e) => selectFolder(e.target.value || null)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              {choices.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.count})
                </option>
              ))}
            </select>
          </label>
          {!readOnly && (
            <button
              type="button"
              className="glass-btn flex h-9 w-9 items-center justify-center rounded-xl"
              onClick={onManage}
              aria-label={zh ? "管理文件夹" : "Manage folders"}
            >
              <Settings2 size={15} />
            </button>
          )}
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-1">
          <div
            ref={tabs}
            role="tablist"
            aria-label={label}
            className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1"
            onKeyDown={(event) => {
              const buttons = Array.from(
                tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || [],
              );
              const current = buttons.indexOf(event.target as HTMLButtonElement);
              if (current < 0) return;
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : event.key === "ArrowRight"
                      ? (current + 1) % buttons.length
                      : event.key === "ArrowLeft"
                        ? (current + buttons.length - 1) % buttons.length
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              buttons[next].click();
              buttons[next].focus();
            }}
          >
            {choices.map((f) => (
              <button
                type="button"
                key={f.id}
                role="tab"
                aria-controls={panelId}
                aria-selected={f.id === (activeFolderId || "")}
                tabIndex={f.id === (activeFolderId || "") ? 0 : -1}
                title={f.name}
                onClick={() => selectFolder(f.id || null)}
                className={`flex min-h-9 max-w-40 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs ${f.id === (activeFolderId || "") ? "glass-btn font-semibold ring-1 ring-[var(--glass-border-subtle)]" : "text-[var(--color-text-secondary)]"}`}
              >
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 opacity-60">{f.count}</span>
              </button>
            ))}
          </div>
          {!readOnly && (
            <button
              type="button"
              className="glass-btn flex h-9 w-8 shrink-0 items-center justify-center rounded-lg"
              onClick={onManage}
              aria-label={zh ? "管理文件夹" : "Manage folders"}
            >
              <Settings2 size={15} />
            </button>
          )}
        </div>
      )}
      {sync.status === "error" && (
        <p role="alert" className="mt-1 break-words text-xs text-amber-700" title={sync.error}>
          {collapsed ? (
            "!"
          ) : (
            <>
              {zh ? "尚未同步。" : "Not synced."}{" "}
              <button type="button" className="underline" onClick={sync.retry}>
                {zh ? "重试" : "Retry"}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
