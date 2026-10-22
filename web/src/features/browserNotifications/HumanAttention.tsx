import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGroupStore } from "../../stores/useGroupStore";
import { useUIStore } from "../../stores/useUIStore";
import { useModalStore } from "../../stores/useModalStore";
import { requestWorkspaceNavigation } from "../../stores/workspaceNavigation";
import { useBrowserNotifications } from "./useBrowserNotifications";
import { AttentionBoard } from "./AttentionBoard";
import type { AttentionItem } from "./model";

export function HumanAttention() {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const groups = useGroupStore((s) => s.groups);
  const selected = useGroupStore((s) => s.selectedGroupId);
  const actors = useGroupStore((s) => s.actors);
  const hydrating = useGroupStore((s) => s.selectedGroupActorsHydrating);
  const [pending, setPending] = useState<AttentionItem | null>(null);
  const [open, setOpen] = useState(false);
  const visit = (item: AttentionItem) =>
    requestWorkspaceNavigation(() => {
      useGroupStore.getState().setSelectedGroupId(item.groupId);
      setPending(item);
      setOpen(false);
    });
  const state = useBrowserNotifications(
    groups,
    visit,
    zh,
    (item) =>
      !document.hidden &&
      document.hasFocus() &&
      useGroupStore.getState().selectedGroupId === item.groupId &&
      (item.taskId
        ? useModalStore.getState().modals.context &&
          useModalStore.getState().contextTaskId === item.taskId
        : useUIStore.getState().activeTab === (item.eventId ? "chat" : item.actorId)),
  );
  useEffect(() => {
    if (!pending) return;
    if (pending.groupId !== selected) {
      setPending(null);
      return;
    }
    if (
      hydrating ||
      (!pending.eventId && !pending.taskId && !actors.some((a) => a.id === pending.actorId))
    )
      return;
    const timer = setTimeout(() => {
      if (useGroupStore.getState().selectedGroupId !== pending.groupId) return;
      if (pending.taskId) useModalStore.getState().openContextTask(pending.taskId);
      else {
        useUIStore.getState().setActiveTab(pending.eventId ? "chat" : pending.actorId);
        if (pending.eventId)
          void useGroupStore.getState().openChatWindow(pending.groupId, pending.eventId);
      }
      setPending(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [pending, selected, actors, hydrating]);
  useEffect(() => {
    const previous = document.title;
    const base = previous.replace(/^\(\d+\) /, "");
    const title = state.items.length ? `(${state.items.length}) ${base}` : base;
    document.title = title;
    return () => {
      if (document.title === title) document.title = previous;
    };
  }, [state.items.length]);
  const title = zh ? "待我处理" : "My attention";
  return (
    <>
      <button
        type="button"
        data-attention-trigger
        className={`glass-btn flex shrink-0 items-center gap-1 rounded-lg p-2 text-sm ${state.items.length ? "text-amber-700 ring-2 ring-amber-400 dark:text-amber-300" : ""}`}
        aria-label={`${title}: ${state.items.length}`}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Bell size={18} />
        <span className="tabular-nums">
          {state.items.length > 99 ? "99+" : state.items.length || ""}
        </span>
        {state.staleGroups.length > 0 && (
          <span aria-label={zh ? "部分状态可能过时" : "Some state may be stale"}>!</span>
        )}
      </button>
      {open && (
        <AttentionBoard
          state={state}
          groups={groups}
          zh={zh}
          onClose={() => setOpen(false)}
          onVisit={visit}
        />
      )}
    </>
  );
}
