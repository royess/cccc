import type { Actor } from "../types";

// Runtime evidence is independent of optional Agent-authored task notes.
export function actorRuntimeStatusKey(actor: Actor | null | undefined): string {
  if (!actor) return "runtimeUnknown";
  const state = String(actor.effective_working_state || "");
  if (state === "error" || state === "failed") return "common:error";
  if (state === "disconnected") return "disconnected";
  if (actor.running === false || state === "stopped") return "stopped";
  if (["working", "waiting", "stuck", "idle"].includes(state)) return state;
  return actor.running === true ? "running" : "runtimeUnknown";
}
