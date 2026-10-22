// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vite-plus/test";
import { useBrowserNotifications } from "./useBrowserNotifications";
import { CONNECTED, METADATA, PREFERENCE } from "./notifications";
const mock = vi.hoisted(() => ({
  ledger: vi.fn(),
  actors: vi.fn(),
  api: vi.fn(),
  notify: vi.fn(),
  open: vi.fn(),
}));
vi.mock("../../services/api/actors", () => ({
  fetchActors: (...a: unknown[]) => mock.actors(...a),
}));
vi.mock("../../services/api/messaging", () => ({
  fetchLedgerTail: (...a: unknown[]) => mock.ledger(...a),
}));
vi.mock("../../services/api/base", () => ({ apiJson: (...a: unknown[]) => mock.api(...a) }));
const groups = [
  { group_id: "g1", title: "Group One" },
  { group_id: "g2", title: "Group Two" },
];
let current: ReturnType<typeof useBrowserNotifications>;
let sourceVisible = false;
function Harness() {
  current = useBrowserNotifications(groups, mock.open, false, () => sourceVisible);
  return null;
}
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
const message = (id: string) => ({
  id,
  kind: "chat.message",
  by: "agent",
  ts: "2000-01-01T00:00:00Z",
  data: { to: ["user"], text: "private business detail" },
});
beforeEach(() => {
  sourceVisible = false;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
  localStorage.setItem(PREFERENCE, "true");
  vi.stubGlobal("isSecureContext", true);
  mock.ledger.mockResolvedValue({
    ok: true,
    result: { events: [message("old")], has_more: false },
  });
  mock.actors.mockResolvedValue({
    ok: true,
    result: { actors: [{ id: "a", runtime: "codex", running: true }] },
  });
  mock.api.mockResolvedValue({
    ok: true,
    result: { state: { generation: "one", permissions: [], working: false } },
  });
  class Notice {
    static permission = "granted";
    static requestPermission = vi.fn(async () => "granted");
    close() {}
    constructor(...args: unknown[]) {
      mock.notify(...args);
    }
  }
  vi.stubGlobal("Notification", Notice);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const mount = () => act(async () => root.render(<Harness />));
const emit = () =>
  window.dispatchEvent(
    new CustomEvent(METADATA, { detail: { kind: "chat.message", group_id: "g2" } }),
  );
it("loads all groups using read APIs without notifying historical messages", async () => {
  await mount();
  expect(mock.ledger.mock.calls.map((c) => c[0])).toEqual(["g1", "g2"]);
  expect(mock.notify).not.toHaveBeenCalled();
  expect(mock.api.mock.calls.every((c) => c[1].method === undefined)).toBe(true);
});
it("updates only the changed group and deduplicates popup receipts across remounts", async () => {
  await mount();
  mock.ledger.mockResolvedValue({
    ok: true,
    result: { events: [message("new"), message("old")], has_more: false },
  });
  await act(async () => {
    emit();
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(mock.ledger).toHaveBeenCalledTimes(3);
  expect(mock.notify).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(mock.notify.mock.calls)).not.toContain("private business detail");
  await act(async () => {
    emit();
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(mock.notify).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  expect(mock.notify).toHaveBeenCalledTimes(1);
});
it("notifies current approvals on startup once and never relabels stale history as pending", async () => {
  mock.api.mockResolvedValue({
    ok: true,
    result: {
      state: {
        generation: "one",
        permissions: [{ request_id: "r", kind: "permission", title: "Approve" }],
        working: true,
      },
    },
  });
  await mount();
  expect(mock.notify).toHaveBeenCalledTimes(2);
  mock.api.mockResolvedValue({
    ok: true,
    result: { state: { generation: "one", permissions: [], working: false } },
  });
  await act(async () => {
    window.dispatchEvent(new Event(CONNECTED));
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(mock.notify).toHaveBeenCalledTimes(2);
  mock.actors.mockResolvedValue({ ok: false, error: { code: "temporary" } });
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(current!.error).toBe("unavailable");
});
it("disabling unsubscribes notification observation and needs no model or inbox writes", async () => {
  localStorage.setItem(PREFERENCE, "false");
  await mount();
  expect(mock.ledger).not.toHaveBeenCalled();
  await act(async () => current!.toggle());
  expect(current!.on).toBe(true);
  expect(mock.ledger).toHaveBeenCalledTimes(2);
  await act(async () => current!.toggle());
  expect(current!.on).toBe(false);
  const n = mock.ledger.mock.calls.length;
  await act(async () => {
    emit();
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(mock.ledger).toHaveBeenCalledTimes(n);
});

it("suppresses popups for the focused source without treating it as approval", async () => {
  sourceVisible = true;
  mock.api.mockResolvedValue({ ok: true, result: { state: { generation: "one", permissions: [{request_id:"r",kind:"permission",title:"Approve"}], working:true } } });
  await mount();
  expect(mock.notify).not.toHaveBeenCalled();
  expect(mock.api.mock.calls.every(c=>c[1].method===undefined)).toBe(true);
});
