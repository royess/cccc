import { describe, it, expect } from "vite-plus/test";
import { actorAttention, userMessages, taskAttention } from "./model";
import type { Actor, LedgerEvent } from "../../types";
const event = (patch: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: "one",
  kind: "chat.message",
  by: "a",
  ts: "2000-01-01T00:00:00Z",
  data: { to: ["user"], text: "For you", message_mode: "send" },
  ...patch,
});
describe("human attention routing", () => {
  it("includes only messages addressed to the human, not peer Mail or self messages", () => {
    expect(
      userMessages("g", [
        event(),
        event({ by: "user" }),
        event({ data: { to: ["b"], text: "peer" } }),
        event({ data: { to: ["user"], message_mode: "mail" } }),
      ]),
    ).toHaveLength(1);
  });
  it("separates reply requests and honors authoritative read status", () => {
    expect(
      userMessages("g", [event({ data: { to: ["user"], message_mode: "request_reply" } })])[0].kind,
    ).toBe("reply");
    expect(userMessages("g", [event({ _read_status: { user: true } })])).toEqual([]);
  });
  it("uses current generation and clears resolved approvals", () => {
    const actor: Actor = { id: "a", running: true };
    const items = actorAttention("g", actor, {
      generation: "new",
      permissions: [{ request_id: "r", kind: "permission", title: "Approval" }],
      working: false,
    });
    expect(items[0].id).toContain(":new:");
    expect(
      actorAttention("g", actor, { generation: "new", permissions: [], working: false }),
    ).toEqual([]);
  });
  it("does not treat unknown terminal state or external waiting as approval", () => {
    expect(
      actorAttention(
        "g",
        {
          id: "a",
          running: true,
          effective_working_state: "waiting",
          effective_working_reason: "pty_running_state_unknown",
        },
        null,
      ),
    ).toEqual([]);
    expect(
      actorAttention(
        "g",
        {
          id: "a",
          running: true,
          effective_working_state: "waiting",
          effective_active_task_id: "turn",
          effective_working_reason: "managed_agent_session",
        },
        null,
      )[0].kind,
    ).toBe("input");
  });
});

it("keeps a read reply request until replied or cancelled", () => {
  const request = event({
    data: { to: ["user"], message_mode: "request_reply" },
    _read_status: { user: true },
  });
  expect(userMessages("g", [request])[0].kind).toBe("reply");
  for (const decision of [
    { replied: true, cancelled: false },
    { replied: false, cancelled: true },
  ]) {
    expect(
      userMessages("g", [
        {
          ...request,
          _obligation_status: { user: { ...decision, reply_requested: true, delivery_state: "" } },
        },
      ]),
    ).toEqual([]);
  }
});
it("does not turn ordinary blocked or external tasks into human actions", () => {
  expect(
    taskAttention("g", [
      { id: "one", waiting_on: "external", status: "active" },
      { id: "two", waiting_on: "user", status: "done" },
      { id: "three", waiting_on: "user", status: "active", assignee: "a" },
    ]).map((i) => i.taskId),
  ).toEqual(["three"]);
});
