// @vitest-environment happy-dom
import { beforeEach, afterEach, it, expect, vi } from "vite-plus/test";
import { enabled, notify, permission, PREFERENCE } from "./notifications";
const item = {
  id: "g:a:generation:r",
  groupId: "g",
  actorId: "a",
  kind: "approval" as const,
  title: "Agent",
  text: "secret",
  ts: "",
};
let create: ReturnType<typeof vi.fn>;
let instance: { onclick: () => void; close: ReturnType<typeof vi.fn> };
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
  vi.stubGlobal("isSecureContext", true);
  create = vi.fn();
  instance = { onclick: () => {}, close: vi.fn() };
  class Notice {
    static permission = "granted";
    constructor(...args: unknown[]) {
      create(...args);
      return instance;
    }
  }
  vi.stubGlobal("Notification", Notice);
  localStorage.setItem(PREFERENCE, "true");
});
afterEach(() => vi.unstubAllGlobals());
it("uses native browser permission and deduplicates the same request across tabs", () => {
  expect(enabled()).toBe(true);
  const open = vi.fn();
  vi.spyOn(window, "focus").mockImplementation(() => {});
  expect(notify(item, "Group One", open, false)).toBe(true);
  expect(notify(item, "Group One", open, false)).toBe(true);
  expect(create).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(create.mock.calls)).not.toContain("secret");
  instance.onclick();
  expect(open).toHaveBeenCalledOnce();
  expect(instance.close).toHaveBeenCalledOnce();
});
it("never constructs notifications on denied or insecure origins", () => {
  vi.stubGlobal("isSecureContext", false);
  expect(permission()).toBe("unsupported");
  expect(notify(item, "Group One", () => {}, false)).toBe(false);
  expect(create).not.toHaveBeenCalled();
  vi.stubGlobal("isSecureContext", true);
  Object.assign(Notification, { permission: "denied" });
  expect(notify(item, "Group One", () => {}, false)).toBe(false);
});
it("allows an explicit test without enabling background observation", () => {
  localStorage.setItem(PREFERENCE, "false");
  expect(notify(item, "Test", () => {}, false, true)).toBe(true);
  expect(enabled()).toBe(false);
});
