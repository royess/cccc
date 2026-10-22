import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { X, RefreshCw } from "lucide-react";
import { useModalA11y } from "../../hooks/useModalA11y";
import type { GroupMeta } from "../../types";
import { attentionColumn, type AttentionItem } from "./model";
import type { useBrowserNotifications } from "./useBrowserNotifications";

type State = ReturnType<typeof useBrowserNotifications>;
export function AttentionBoard({
  state,
  groups,
  zh,
  onClose,
  onVisit,
}: {
  state: State;
  groups: GroupMeta[];
  zh: boolean;
  onClose: () => void;
  onVisit: (item: AttentionItem) => void;
}) {
  const { modalRef } = useModalA11y(true, onClose);
  const [groupId, setGroupId] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const title = zh ? "待我处理" : "My attention";
  const columns = [
    { id: "approval", title: zh ? "待审批与输入" : "Approvals & input" },
    { id: "reply", title: zh ? "待回复" : "Awaiting reply" },
    { id: "other", title: zh ? "其他待处理" : "Other actions" },
  ];
  const kinds = zh
    ? {
        approval: "审批",
        input: "待输入",
        reply: "待回复",
        message: "未读消息",
        task: "任务等待你处理",
      }
    : {
        approval: "Approval",
        input: "Input",
        reply: "Reply requested",
        message: "Unread message",
        task: "Task waiting for you",
      };
  const selectedGroup = groups.some((g) => g.group_id === groupId) ? groupId : "";
  const items = state.items.filter((i) => !selectedGroup || i.groupId === selectedGroup);
  function age(ts: string) {
    const parsed = Date.parse(ts);
    if (!Number.isFinite(parsed)) return zh ? "时间未知" : "Time unknown";
    const minutes = Math.max(0, Math.floor((now - parsed) / 60000));
    return minutes < 1
      ? zh
        ? "刚刚"
        : "Just now"
      : zh
        ? `已等待 ${minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`}`
        : `Waiting ${minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`}`;
  }
  return createPortal(
    <div
      className="bg-black/40"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "grid",
        placeItems: "center",
        padding: 12,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="glass-modal flex flex-col rounded-2xl border border-[var(--glass-border-subtle)] p-4 shadow-2xl text-[var(--color-text-primary)]"
        style={{ width: "min(1120px, 100%)", maxHeight: "calc(100dvh - 24px)", minHeight: 0 }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">
            {title}{" "}
            <span className="text-[var(--color-text-secondary)]">· {state.items.length}</span>
          </h2>
          <label className="ml-auto text-sm">
            <span className="sr-only">{zh ? "工作组筛选" : "Filter Groups"}</span>
            <select
              aria-label={zh ? "工作组筛选" : "Filter Groups"}
              className="glass-input max-w-48 rounded-lg p-2"
              value={selectedGroup}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">{zh ? "所有工作组" : "All Groups"}</option>
              {groups.map((g) => (
                <option key={g.group_id} value={g.group_id}>
                  {g.title || g.group_id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="glass-btn rounded-lg p-2"
            aria-label={zh ? "刷新待办" : "Refresh attention"}
            disabled={state.loading}
            onClick={state.refresh}
          >
            <RefreshCw size={17} className={state.loading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            className="glass-btn rounded-lg p-2"
            aria-label={zh ? "关闭待办看板" : "Close attention board"}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <p className="my-2 text-xs text-[var(--color-text-secondary)]">
          {zh
            ? "查看不等于处理完成。审批、回复和任务状态由原会话决定。"
            : "Viewing is not completion. Approvals, replies and tasks resolve in their original interface."}
        </p>
        {state.staleGroups.length > 0 && (
          <p role="alert" className="mb-2 text-sm text-amber-700 dark:text-amber-300">
            {zh
              ? "部分状态读取失败，保留的卡片可能已过时："
              : "Some reads failed; retained cards may be stale: "}
            {state.staleGroups
              .map((id) => groups.find((g) => g.group_id === id)?.title || id)
              .join(", ")}
          </p>
        )}
        {state.loading && (
          <p role="status" className="mb-2 text-xs">
            {zh ? "正在更新…" : "Refreshing…"}
          </p>
        )}
        <div
          className="grid min-h-0 grid-cols-1 gap-3 overflow-y-auto md:grid-cols-3"
          data-attention-columns
        >
          {columns.map((column) => {
            const cards = items.filter((item) => attentionColumn(item) === column.id);
            return (
              <section
                key={column.id}
                aria-label={column.title}
                className="min-w-0 rounded-xl bg-black/5 p-3 dark:bg-white/5"
              >
                <h3 className="mb-3 font-semibold">
                  {column.title} · {cards.length}
                </h3>
                {cards.length === 0 && (
                  <p className="py-3 text-sm text-[var(--color-text-muted)]">
                    {zh ? "暂无待处理项" : "Nothing pending"}
                  </p>
                )}
                <div className="space-y-3">
                  {cards.map((item) => (
                    <article
                      key={item.id}
                      data-attention-id={item.id}
                      className="min-w-0 rounded-lg border border-[var(--glass-border-subtle)] bg-[var(--color-bg-secondary)] p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <strong>{kinds[item.kind]}</strong>
                        {state.staleGroups.includes(item.groupId) && (
                          <span className="text-amber-700 dark:text-amber-300">
                            {zh ? "可能过时" : "May be stale"}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 break-words text-xs text-[var(--color-text-secondary)]">
                        {groups.find((g) => g.group_id === item.groupId)?.title || item.groupId}
                        {item.title ? ` · ${item.title}` : ""}
                      </p>
                      <p className="my-3 line-clamp-3 whitespace-pre-wrap break-words">
                        {item.text}
                      </p>
                      {item.text.length > 180 && (
                        <details className="mb-3">
                          <summary className="cursor-pointer text-xs">
                            {zh ? "展开内容" : "Expand content"}
                          </summary>
                          <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
                            {item.text}
                          </p>
                        </details>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <time
                          dateTime={item.ts || undefined}
                          title={
                            Number.isFinite(Date.parse(item.ts))
                              ? new Date(item.ts).toLocaleString()
                              : ""
                          }
                          className="text-xs text-[var(--color-text-secondary)]"
                        >
                          {age(item.ts)}
                        </time>
                        <button
                          type="button"
                          className="glass-btn rounded-lg px-2 py-1"
                          onClick={() => onVisit(item)}
                        >
                          {zh ? "前往处理" : "Open source"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <div className="mt-3 border-t border-[var(--glass-border-subtle)] pt-2 text-xs text-[var(--color-text-secondary)]">
          {zh
            ? "汇总每组最近 100 条消息，以及待人类处理的计划中/进行中任务（各最多 100 项）。更早的消息请查看原会话。"
            : "Includes each Group's latest 100 messages and human-waiting planned/active tasks (up to 100 each). Check original conversations for older messages."}
          {state.limitedGroups.length > 0 && (
            <p className="mt-1">
              {zh ? "部分工作组还有更多历史记录。" : "Some Groups have additional history."}
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer">
              {zh ? "浏览器通知设置" : "Browser notification settings"}
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="glass-btn rounded px-2 py-1"
                onClick={() => void state.toggle()}
              >
                {state.on
                  ? zh
                    ? "关闭系统通知"
                    : "Turn off system alerts"
                  : zh
                    ? "启用系统通知"
                    : "Enable system alerts"}
              </button>
              {state.status === "granted" && (
                <button type="button" className="glass-btn rounded px-2 py-1" onClick={state.test}>
                  {zh ? "测试通知" : "Test notification"}
                </button>
              )}
              {state.status !== "granted" && (
                <span>
                  {state.status === "denied"
                    ? zh
                      ? "请在站点权限中允许通知；看板仍可使用。"
                      : "Allow notifications in site permissions; the board remains available."
                    : zh
                      ? "系统通知需要受支持的浏览器及 HTTPS 或 localhost。"
                      : "System alerts require a supported browser and HTTPS or localhost."}
                </span>
              )}
              {state.error && (
                <span role="status">
                  {zh ? "系统通知暂不可用。" : "System alerts are temporarily unavailable."}
                </span>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>,
    document.body,
  );
}
