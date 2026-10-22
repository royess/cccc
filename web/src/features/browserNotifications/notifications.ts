import type { AttentionItem } from "./model";
export const PREFERENCE = "cccc.browserNotifications.enabled.v1";
export const CHANGE = "cccc:browser-notifications-changed";
export const METADATA = "cccc:global-ledger-event";
export const CONNECTED = "cccc:global-ledger-connected";
const SENT = "cccc.browserNotifications.sent.v1";
export function permission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" || !window.isSecureContext
    ? "unsupported"
    : Notification.permission;
}
export function enabled(): boolean {
  try {
    return permission() === "granted" && localStorage.getItem(PREFERENCE) === "true";
  } catch {
    return false;
  }
}
export function setEnabled(value: boolean) {
  try {
    localStorage.setItem(PREFERENCE, String(value));
  } catch {
    /* No persistence available. */
  }
  window.dispatchEvent(new Event(CHANGE));
}
function sent(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(SENT) || "[]");
    return Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string") : [];
  } catch {
    return [];
  }
}
/** Small notification receipts only; never persist business text or consume Mail. */
export function notify(
  item: AttentionItem,
  group: string,
  onOpen: () => void,
  zh: boolean,
  test = false,
): boolean {
  if (permission() !== "granted" || (!test && !enabled())) return false;
  const ids = sent();
  if (!test && ids.includes(item.id)) return true;
  try {
    const body = test
      ? zh
        ? "浏览器通知已正常工作。"
        : "Browser notifications are working."
      : `${item.title} · ${item.kind === "message" ? (zh ? "发来消息" : "New message") : item.kind === "reply" ? (zh ? "等待你回复" : "Reply requested") : zh ? "需要审批或输入" : "Approval or input required"}`;
    const n = new Notification(`CCCC · ${group}`, { body, tag: item.id });
    n.onclick = () => {
      window.focus();
      onOpen();
      n.close();
    };
    if (!test) {
      try {
        localStorage.setItem(SENT, JSON.stringify([...ids, item.id].slice(-2000)));
      } catch {
        /* Per-session dedup remains in the observer. */
      }
    }
    return true;
  } catch {
    return false;
  }
}
