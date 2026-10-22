import type { Actor, ChatMessageData, LedgerEvent, Task } from "../../types";
import type { AcpPermission } from "../../services/api/codexVoice";

export type AttentionItem = {
  id: string;
  groupId: string;
  actorId: string;
  eventId?: string;
  taskId?: string;
  kind: "approval" | "message" | "reply" | "input" | "task";
  title: string;
  text: string;
  ts: string;
};
export type Control = { generation: string; permissions: AcpPermission[]; working: boolean };

export function userMessages(groupId: string, events: LedgerEvent[]): AttentionItem[] {
  return events.flatMap((event) => {
    const data = (event.data || {}) as ChatMessageData;
    if (
      event.kind !== "chat.message" ||
      !event.id ||
      !event.by ||
      event.by === "user" ||
      event.by === "system" ||
      event.by?.endsWith("::user") ||
      data.dst_group_id ||
      !data.to?.includes("user") ||
      data.message_mode === "mail"
    )
      return [];
    if (data.pending_placeholder) return [];
    const obligation = event._obligation_status?.user;
    const reply = data.message_mode === "request_reply";
    if (reply ? obligation?.replied || obligation?.cancelled : event._read_status?.user) return [];
    return [
      {
        id: `${groupId}:message:${event.id}`,
        groupId,
        actorId: event.by,
        eventId: event.id,
        kind: reply ? "reply" : "message",
        title: data.sender_title || event.by,
        text: data.text || (data.attachments?.length ? "Attachment" : "Message"),
        ts: event.ts || "",
      },
    ];
  });
}

export function actorAttention(
  groupId: string,
  actor: Actor,
  control: Control | null,
): AttentionItem[] {
  if (!actor.running) return [];
  if (control?.permissions.length)
    return control.permissions.map((p) => ({
      id: `${groupId}:${actor.id}:${control.generation}:${p.request_id}`,
      groupId,
      actorId: actor.id,
      kind: p.kind === "permission" ? "approval" : "input",
      title: actor.title || actor.id,
      text: [
        p.title || "Input / approval required",
        p.message,
        p.overview,
        ...(p.details && typeof p.details === "object"
          ? [
              (p.details as Record<string, unknown>).command,
              (p.details as Record<string, unknown>).reason,
            ]
          : []),
      ]
        .filter((part): part is string => typeof part === "string" && !!part)
        .join("\n"),
      ts: actor.effective_working_updated_at || "",
    }));
  // Native TUI owns some interactions, so its authoritative waiting flag can
  // exist without a permission exposed to the observer's control API.
  if (
    actor.effective_working_state === "waiting" &&
    actor.effective_active_task_id &&
    actor.effective_working_reason === "managed_agent_session"
  )
    return [
      {
        id: `${groupId}:${actor.id}:${actor.generation}:${actor.effective_active_task_id}:waiting`,
        groupId,
        actorId: actor.id,
        kind: "input",
        title: actor.title || actor.id,
        text: "Input / approval required in the native session",
        ts: actor.effective_working_updated_at || "",
      },
    ];
  return [];
}

export function taskAttention(groupId: string, tasks: Task[]): AttentionItem[] {
  return tasks
    .filter(
      (task) =>
        task.waiting_on === "user" && ["planned", "active"].includes(task.status || "planned"),
    )
    .map((task) => ({
      id: `${groupId}:task:${task.id}:${task.updated_at || task.created_at || ""}`,
      groupId,
      actorId: task.assignee || "",
      taskId: task.id,
      kind: "task",
      title: task.assignee || "",
      text: [task.title || task.id, task.outcome].filter(Boolean).join("\n"),
      ts: task.updated_at || task.created_at || "",
    }));
}

export const attentionColumn = (item: AttentionItem): "approval" | "reply" | "other" =>
  item.kind === "approval" || item.kind === "input"
    ? "approval"
    : item.kind === "reply"
      ? "reply"
      : "other";

export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort(
    (a, b) => (Date.parse(a.ts) || 0) - (Date.parse(b.ts) || 0) || a.id.localeCompare(b.id),
  );
}
