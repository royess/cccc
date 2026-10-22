import { useEffect, useRef, useState } from "react";
import type { GroupMeta } from "../../types";
import { fetchActors } from "../../services/api/actors";
import { fetchLedgerTail } from "../../services/api/messaging";
import { apiJson } from "../../services/api/base";
import { actorAttention, userMessages, type AttentionItem, type Control } from "./model";
import {
  CHANGE,
  CONNECTED,
  METADATA,
  enabled,
  notify,
  permission,
  setEnabled,
} from "./notifications";
export function useBrowserNotifications(
  groups: GroupMeta[],
  onOpen: (item: AttentionItem) => void,
  zh: boolean,
  isSourceVisible: (item: AttentionItem) => boolean = () => false,
) {
  const [on, setOn] = useState(enabled);
  const [status, setStatus] = useState(permission);
  const [error, setError] = useState("");
  const visible = useRef(isSourceVisible);
  visible.current = isSourceVisible;
  const open = useRef(onOpen);
  open.current = onOpen;
  const refs = useRef({ groups, zh });
  refs.current = { groups, zh };
  const ids = groups
    .map((g) => g.group_id)
    .sort()
    .join("\n");
  useEffect(() => {
    const update = () => {
      setOn(enabled());
      setStatus(permission());
    };
    window.addEventListener(CHANGE, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(CHANGE, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  useEffect(() => {
    if (!on) return;
    const gids = ids ? ids.split("\n") : [];
    const initialized = new Set<string>();
    const observed = new Set<string>();
    let dirty = new Set(gids);
    let active = true;
    let busy = false;
    let last = 0;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function refresh() {
      if (!active || busy) return;
      busy = true;
      last = Date.now();
      const batch = [...dirty];
      dirty = new Set();
      let failed = false;
      for (const gid of batch) {
        if (!active) break;
        try {
          const [messages, actors] = await Promise.all([
            fetchLedgerTail(gid, 100, { signal: abort.signal }),
            fetchActors(gid, false, { signal: abort.signal }),
          ]);
          if (!messages.ok || !actors.ok) throw new Error("snapshot unavailable");
          const items = userMessages(gid, messages.result.events);
          for (const actor of actors.result.actors) {
            if (
              !actor.running ||
              !["codex", "claude", "pi", "opencode", "deepseek"].includes(actor.runtime || "")
            )
              continue;
            const control = await apiJson<{ state: Control | null }>(
              `/api/v1/groups/${encodeURIComponent(gid)}/actors/${encodeURIComponent(actor.id)}/headless/control`,
              { signal: abort.signal },
            );
            if (!control.ok) throw new Error("current runtime unavailable");
            items.push(...actorAttention(gid, actor, control.result.state));
          }
          if (!active) break;
          const known = initialized.has(gid);
          for (const item of items) {
            const pending = item.kind === "approval" || item.kind === "input";
            const shouldShow = (known || pending) && !observed.has(item.id);
            if (shouldShow && !visible.current(item)) {
              const title = refs.current.groups.find((g) => g.group_id === gid)?.title || gid;
              // Browsers may suppress OS banners independently. Never count
              // constructor success as human read, approval or business delivery.
              if (!notify(item, title, () => open.current(item), refs.current.zh)) failed = true;
            }
            observed.add(item.id);
          }
          initialized.add(gid);
        } catch {
          if (active) failed = true;
        }
      }
      if (active) setError(failed ? "unavailable" : "");
      busy = false;
      if (active && dirty.size)
        timer = setTimeout(() => void refresh(), Math.max(400, 5000 - (Date.now() - last)));
    }
    function schedule(gid?: string) {
      if (gid && gids.includes(gid)) dirty.add(gid);
      else if (!gid) for (const g of gids) dirty.add(g);
      if (!busy) {
        clearTimeout(timer);
        timer = setTimeout(() => void refresh(), Math.max(400, 5000 - (Date.now() - last)));
      }
    }
    const metadata = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (
        ["chat.message", "actor.activity", "actor.start", "actor.stop", "actor.remove"].includes(
          d?.kind,
        )
      )
        schedule(d.group_id);
    };
    const catchup = () => schedule();
    window.addEventListener(METADATA, metadata);
    window.addEventListener(CONNECTED, catchup);
    window.addEventListener("focus", catchup);
    const fallback = setInterval(catchup, 60000);
    void refresh();
    return () => {
      active = false;
      abort.abort();
      clearTimeout(timer);
      clearInterval(fallback);
      window.removeEventListener(METADATA, metadata);
      window.removeEventListener(CONNECTED, catchup);
      window.removeEventListener("focus", catchup);
    };
  }, [on, ids]);
  return {
    on,
    status,
    error,
    toggle: async () => {
      if (on) {
        setEnabled(false);
        return;
      }
      if (permission() === "unsupported") {
        setStatus("unsupported");
        return;
      }
      try {
        const result = await Notification.requestPermission();
        setStatus(result);
        setEnabled(result === "granted");
      } catch {
        setError("unavailable");
      }
    },
    test: () =>
      notify(
        {
          id: "cccc-browser-test",
          groupId: "",
          actorId: "",
          kind: "message",
          title: "",
          text: "",
          ts: "",
        },
        zh ? "测试" : "Test",
        () => {},
        zh,
        true,
      ),
  };
}
