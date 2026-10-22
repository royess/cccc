import { useEffect, useRef, useState } from "react";
import type { GroupMeta } from "../../types";
import { fetchActors } from "../../services/api/actors";
import { fetchLedgerTail } from "../../services/api/messaging";
import { fetchTaskPages } from "../../services/api/tasks";
import { apiJson } from "../../services/api/base";
import {
  actorAttention,
  userMessages,
  taskAttention,
  sortAttention,
  type AttentionItem,
  type Control,
} from "./model";
import {
  CHANGE,
  CONNECTED,
  METADATA,
  enabled,
  notify,
  observeAttention,
  permission,
  setEnabled,
} from "./notifications";

type Snapshot = { items: AttentionItem[]; stale: boolean; limited: boolean };
const denied = (code: string) =>
  [
    "unauthorized",
    "auth_required",
    "permission_denied",
    "forbidden",
    "not_found",
    "group_not_found",
  ].includes(code);

/** One read-only observation shared by the board and optional desktop alerts. */
export function useBrowserNotifications(
  groups: GroupMeta[],
  onOpen: (item: AttentionItem) => void,
  zh: boolean,
  isSourceVisible: (item: AttentionItem) => boolean = () => false,
) {
  const [on, setOn] = useState(enabled);
  const [status, setStatus] = useState(permission);
  const [error, setError] = useState("");
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [staleGroups, setStaleGroups] = useState<string[]>([]);
  const [limitedGroups, setLimitedGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const snapshots = useRef(new Map<string, Snapshot>());
  const requestRefresh = useRef<() => void>(() => {});
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
    const release = observeAttention();
    const gids = ids ? ids.split("\n") : [];
    const initialized = new Set<string>();
    const observed = new Set<string>();
    for (const gid of snapshots.current.keys())
      if (!gids.includes(gid)) snapshots.current.delete(gid);
    let dirty = new Set(gids);
    let active = true;
    let busy = false;
    let last = 0;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    function publish() {
      if (!active) return;
      const entries = [...snapshots.current.entries()].filter(([gid]) => gids.includes(gid));
      setItems(sortAttention(entries.flatMap(([, s]) => s.items)));
      setStaleGroups(entries.filter(([, s]) => s.stale).map(([gid]) => gid));
      setLimitedGroups(entries.filter(([, s]) => s.limited).map(([gid]) => gid));
    }
    publish();
    async function refresh() {
      if (!active || busy) return;
      busy = true;
      setLoading(true);
      last = Date.now();
      const batch = [...dirty];
      dirty = new Set();
      let notificationFailed = false;
      for (const gid of batch) {
        if (!active) break;
        const previous = snapshots.current.get(gid);
        try {
          const [messages, actors, tasks] = await Promise.all([
            fetchLedgerTail(gid, 100, { signal: abort.signal }),
            fetchActors(gid, false, { signal: abort.signal }),
            fetchTaskPages(gid, {
              statuses: ["planned", "active"],
              attention: "waiting_user",
              limit: 100,
              signal: abort.signal,
            }),
          ]);
          if (!active) break;
          const forbidden = [messages, actors, tasks].some((r) => !r.ok && denied(r.error.code));
          if (forbidden) {
            snapshots.current.delete(gid);
            publish();
            continue;
          }
          let stale = false;
          const next: AttentionItem[] = [];
          if (messages.ok) next.push(...userMessages(gid, messages.result.events));
          else {
            stale = true;
            next.push(...(previous?.items.filter((i) => !!i.eventId) || []));
          }
          if (tasks.ok)
            next.push(
              ...taskAttention(
                gid,
                Object.values(tasks.result.pages).flatMap((p) => p?.tasks || []),
              ),
            );
          else {
            stale = true;
            next.push(...(previous?.items.filter((i) => !!i.taskId) || []));
          }
          if (actors.ok) {
            await Promise.all(
              actors.result.actors
                .filter(
                  (actor) =>
                    actor.running &&
                    ["codex", "claude", "pi", "opencode", "deepseek"].includes(actor.runtime || ""),
                )
                .map(async (actor) => {
                  try {
                    const control = await apiJson<{ state: Control | null }>(
                      `/api/v1/groups/${encodeURIComponent(gid)}/actors/${encodeURIComponent(actor.id)}/headless/control`,
                      { signal: abort.signal },
                    );
                    if (control.ok) next.push(...actorAttention(gid, actor, control.result.state));
                    else if (!denied(control.error.code)) throw new Error("runtime unavailable");
                  } catch {
                    stale = true;
                    next.push(
                      ...(previous?.items.filter(
                        (i) => !i.eventId && !i.taskId && i.actorId === actor.id,
                      ) || []),
                    );
                  }
                }),
            );
          } else {
            stale = true;
            next.push(...(previous?.items.filter((i) => !i.eventId && !i.taskId) || []));
          }
          if (!active) break;
          const currentIds = new Set(next.map((i) => i.id));
          const fresh = next.filter(
            (i) => !stale || !previous?.items.some((old) => old.id === i.id),
          );
          for (const item of fresh) {
            const pending =
              item.kind === "approval" || item.kind === "input" || item.kind === "task";
            if (
              on &&
              (initialized.has(gid) || pending) &&
              !observed.has(item.id) &&
              !visible.current(item)
            ) {
              const title = refs.current.groups.find((g) => g.group_id === gid)?.title || gid;
              if (!notify(item, title, () => open.current(item), refs.current.zh))
                notificationFailed = true;
            }
            observed.add(item.id);
          }
          // Keep receipt memory bounded; persisted popup dedup is independent.
          if (observed.size > 4000)
            for (const id of observed) {
              if (!currentIds.has(id)) observed.delete(id);
              if (observed.size <= 2000) break;
            }
          const limited =
            (messages.ok && messages.result.has_more) ||
            (tasks.ok && Object.values(tasks.result.pages).some((p) => p?.hasMore));
          snapshots.current.set(gid, {
            items: [...new Map(next.map((i) => [i.id, i])).values()],
            stale,
            limited: !!limited,
          });
          if (messages.ok) initialized.add(gid);
          publish();
        } catch {
          if (active) {
            snapshots.current.set(gid, {
              items: previous?.items || [],
              stale: true,
              limited: previous?.limited || false,
            });
            publish();
          }
        }
      }
      if (active) {
        setError(notificationFailed ? "unavailable" : "");
        setLoading(false);
      }
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
    requestRefresh.current = () => schedule();
    const metadata = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (
        typeof d?.kind === "string" &&
        (d.kind.startsWith("chat.") ||
          ["context.sync", "actor.activity", "actor.start", "actor.stop", "actor.remove"].includes(
            d.kind,
          ))
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
      release();
      window.removeEventListener(METADATA, metadata);
      window.removeEventListener(CONNECTED, catchup);
      window.removeEventListener("focus", catchup);
    };
  }, [ids, on]);
  return {
    on,
    status,
    error,
    items: items.filter((i) => groups.some((g) => g.group_id === i.groupId)),
    staleGroups,
    limitedGroups,
    loading,
    refresh: () => requestRefresh.current(),
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
