import { it, expect, vi } from "vite-plus/test";
import { prepareRelayBatch, runRelayBatch } from "./relayBatch";
import type { LedgerEvent } from "../../types";
const events: LedgerEvent[] = [
  {
    id: "first",
    kind: "chat.message",
    by: "worker",
    data: { text: "  **Keep spacing**\n\n```text\nline\n```", message_mode: "mail" },
  },
  { id: "second", kind: "chat.message", by: "worker", data: { text: "Second message" } },
];
const targets = [
  { groupId: "one", to: ["reader-one"] },
  { groupId: "two", to: ["reader-two"] },
];
it("preserves source, Markdown and per-Group recipients across the message/destination product", () => {
  const plan = prepareRelayBatch("source", events, targets, "", "fixture");
  expect(plan).toHaveLength(4);
  expect(new Set(plan.map((op) => op.clientId)).size).toBe(4);
  expect(plan.map((op) => [op.eventId, op.groupId, op.to])).toEqual([
    ["first", "one", ["reader-one"]],
    ["first", "two", ["reader-two"]],
    ["second", "one", ["reader-one"]],
    ["second", "two", ["reader-two"]],
  ]);
  expect(plan[0].text).toContain("  **Keep spacing**");
  expect(plan[0].sourceGroupId).toBe("source");
});
it("retries uncertain outcomes under the same key while skipping accepted forwards", async () => {
  const plan = prepareRelayBatch("source", events, [targets[0]], "", "fixture");
  const send = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, result: {} })
    .mockResolvedValueOnce({ ok: false, error: { code: "NETWORK_ERROR", message: "Interrupted" } });
  const first = await runRelayBatch(plan, send, () => {});
  expect(first.map((op) => op.status)).toEqual(["accepted", "unknown"]);
  send.mockResolvedValue({ ok: true, result: {} });
  const second = await runRelayBatch(first, send, () => {});
  expect(send).toHaveBeenCalledTimes(3);
  expect(send.mock.calls[2][0].clientId).toBe(send.mock.calls[1][0].clientId);
  expect(second.every((op) => op.status === "accepted")).toBe(true);
});
it("can stop unsent work and resume without repeating the accepted prefix", async () => {
  let active = true;
  const send = vi.fn(async () => ({ ok: true as const, result: {} }));
  const first = await runRelayBatch(
    prepareRelayBatch("source", events, targets, "", "fixture"),
    send,
    () => {
      active = false;
    },
    () => active,
  );
  expect(send).toHaveBeenCalledOnce();
  expect(first.map((op) => op.status)).toEqual(["accepted", "pending", "pending", "pending"]);
  await runRelayBatch(first, send, () => {});
  expect(send).toHaveBeenCalledTimes(4);
});
it("excludes provisional/system events and retains attachment source references without copying files", () => {
  const plan = prepareRelayBatch(
    "source",
    [
      ...events,
      { id: "stream", kind: "chat.message", _streaming: true, data: { text: "partial" } },
      { id: "system", kind: "actor.start", data: {} },
      {
        id: "attachment",
        kind: "chat.message",
        data: { attachments: [{ kind: "file", path: "state/blobs/fixture.txt" }] },
      },
    ],
    [targets[0]],
    "",
    "fixture",
  );
  expect(plan.map((op) => op.eventId)).toEqual(["first", "second", "attachment"]);
  expect(plan[2].text).toContain("original message");
  expect(plan[2].text).not.toContain("state/blobs");
});
