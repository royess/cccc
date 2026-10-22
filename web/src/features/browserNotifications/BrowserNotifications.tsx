import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGroupStore } from "../../stores/useGroupStore";
import { useUIStore } from "../../stores/useUIStore";
import { requestWorkspaceNavigation } from "../../stores/workspaceNavigation";
import { useBrowserNotifications } from "./useBrowserNotifications";
import type { AttentionItem } from "./model";
export function BrowserNotifications() {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const groups = useGroupStore((s) => s.groups);
  const selected = useGroupStore((s) => s.selectedGroupId);
  const actors = useGroupStore((s) => s.actors);
  const hydrating = useGroupStore((s) => s.selectedGroupActorsHydrating);
  const [pending, setPending] = useState<AttentionItem | null>(null);
  const state = useBrowserNotifications(
    groups,
    (item) =>
      requestWorkspaceNavigation(() => {
        useGroupStore.getState().setSelectedGroupId(item.groupId);
        setPending(item);
      }),
    zh,
    (item) =>
      !document.hidden &&
      document.hasFocus() &&
      useGroupStore.getState().selectedGroupId === item.groupId &&
      useUIStore.getState().activeTab === (item.eventId ? "chat" : item.actorId),
  );
  useEffect(() => {
    if (
      !pending ||
      pending.groupId !== selected ||
      hydrating ||
      (!pending.eventId && !actors.some((a) => a.id === pending.actorId))
    )
      return;
    const timer = setTimeout(() => {
      useUIStore.getState().setActiveTab(pending.eventId ? "chat" : pending.actorId);
      if (pending.eventId)
        void useGroupStore.getState().openChatWindow(pending.groupId, pending.eventId);
      setPending(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [pending, selected, actors, hydrating]);
  const label = zh ? "浏览器通知" : "Browser notifications";
  return (
    <details className="relative shrink-0">
      <summary
        className="glass-btn cursor-pointer list-none rounded-lg p-2"
        aria-label={label}
        title={label}
      >
        {state.on ? <Bell size={18} /> : <BellOff size={18} />}
      </summary>
      <div
        style={{ position: "fixed", right: 8, top: 64, zIndex: 1100 }}
        className="glass-modal w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-[var(--glass-border-subtle)] p-3 text-sm shadow-xl"
      >
        <strong>{label}</strong>
        <p className="my-2">
          {zh
            ? "审批、待输入或发给你的新消息会弹出系统通知，点击直达原会话。页面需保持打开。"
            : "System alerts for approvals, input and new messages to you. Click to open the source. Keep this page open."}
        </p>
        <button
          type="button"
          className="glass-btn rounded px-2 py-1"
          onClick={() => void state.toggle()}
        >
          {state.on ? (zh ? "关闭通知" : "Turn off") : zh ? "启用通知" : "Enable notifications"}
        </button>
        {state.status === "granted" && (
          <button
            type="button"
            className="glass-btn ml-2 rounded px-2 py-1"
            onClick={() => state.test()}
          >
            {zh ? "测试通知" : "Test notification"}
          </button>
        )}
        {state.status === "denied" && (
          <p role="status" className="mt-2">
            {zh
              ? "已被浏览器阻止，请在地址栏的站点权限中允许通知。"
              : "Blocked by the browser. Allow notifications in this site's permissions."}
          </p>
        )}
        {state.status === "unsupported" && (
          <p role="status" className="mt-2">
            {zh
              ? "当前浏览器不支持；请使用支持桌面通知的浏览器，通过 HTTPS 或 localhost 访问。"
              : "Unsupported here. Use a browser with desktop notifications over HTTPS or localhost."}
          </p>
        )}
        {state.error && (
          <p role="status" className="mt-2">
            {zh
              ? "通知或状态读取暂不可用；请查看原工作组。"
              : "Notifications or state refresh are unavailable; check the source Group."}
          </p>
        )}
      </div>
    </details>
  );
}
