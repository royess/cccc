import type { ChatMessageData, LedgerEvent } from "../../types";
import type { ApiResponse } from "../../services/api/base";
import { appendQuotedOriginalPerspective, getMessageInsight } from "../../utils/messagePerspective";

export type RelayDestination = { groupId: string; to: string[] };
export type RelayOperation = {
  clientId: string;
  groupId: string;
  sourceGroupId: string;
  eventId: string;
  text: string;
  quote: string;
  to: string[];
  status: "pending" | "accepted" | "failed" | "unknown";
  error?: string;
};

export function prepareRelayBatch(
  sourceGroupId: string,
  events: LedgerEvent[],
  destinations: RelayDestination[],
  note: string,
  batchId = crypto.randomUUID(),
): RelayOperation[] {
  const source = sourceGroupId.trim();
  const uniqueEvents = [
    ...new Map(
      events
        .filter(
          (e) =>
            e.id &&
            e.kind === "chat.message" &&
            !e._streaming &&
            !(e.data as Record<string, unknown>)?._optimistic,
        )
        .map((e) => [e.id, e]),
    ).values(),
  ];
  const uniqueDestinations = [...new Map(destinations.map((d) => [d.groupId.trim(), d])).values()];
  if (
    !source ||
    !uniqueEvents.length ||
    !uniqueDestinations.length ||
    uniqueDestinations.some((d) => !d.groupId.trim() || d.groupId.trim() === source)
  )
    throw new Error("Choose source messages and a different destination Group.");
  return uniqueEvents.flatMap((event, index) =>
    uniqueDestinations.map((destination, target) => {
      const data = (event.data || {}) as ChatMessageData;
      const original = typeof data.text === "string" ? data.text : "";
      const body =
        [note.trim(), original].filter((v) => v.trim()).join("\n\n") ||
        "View the original message.";
      const attachmentNote = data.attachments?.length
        ? "\n\nAttachments remain in the original message; use its source link."
        : "";
      return {
        clientId: `web-relay:${batchId}:${index}:${target}`,
        groupId: destination.groupId.trim(),
        sourceGroupId: source,
        eventId: String(event.id),
        text: [
          body + attachmentNote,
          appendQuotedOriginalPerspective("", getMessageInsight(data), event.by || "sender"),
        ]
          .filter(Boolean)
          .join("\n\n"),
        quote: typeof data.quote_text === "string" ? data.quote_text : "",
        to: destination.to.length ? [...destination.to] : ["@foreman"],
        status: "pending",
      };
    }),
  );
}

export async function runRelayBatch(
  plan: RelayOperation[],
  send: (operation: RelayOperation) => Promise<ApiResponse<unknown>>,
  update: (next: RelayOperation[]) => void,
  shouldContinue: () => boolean = () => true,
): Promise<RelayOperation[]> {
  const result = plan.map((op) => ({ ...op }));
  for (const op of result) {
    if (op.status === "accepted") continue;
    if (!shouldContinue()) break;
    try {
      const response = await send(op);
      if (response.ok) {
        op.status = "accepted";
        delete op.error;
      } else {
        op.status = [
          "invalid_args",
          "invalid_request",
          "permission_denied",
          "unauthorized",
          "not_found",
          "invalid_to",
          "invalid_recipients",
        ].includes(response.error.code.toLowerCase())
          ? "failed"
          : "unknown";
        op.error = `${response.error.code}: ${response.error.message}`;
      }
    } catch {
      op.status = "unknown";
      op.error = "Response unavailable; the destination may have accepted this message.";
    }
    update(result.map((item) => ({ ...item })));
  }
  return result;
}
