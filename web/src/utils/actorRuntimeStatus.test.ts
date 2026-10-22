import { expect, it } from "vite-plus/test";
import type { Actor } from "../types";
import { actorRuntimeStatusKey } from "./actorRuntimeStatus";
it.each(["working", "waiting", "idle", "stuck", "disconnected", "stopped"])(
  "preserves runtime %s without task notes",
  (state) => {
    expect(
      actorRuntimeStatusKey({
        running: state !== "stopped",
        effective_working_state: state,
      } as Actor),
    ).toBe(state);
  },
);
it("does not invent activity or confuse missing notes with missing runtime", () => {
  expect(actorRuntimeStatusKey(null)).toBe("runtimeUnknown");
  expect(actorRuntimeStatusKey({ running: true } as Actor)).toBe("running");
  expect(actorRuntimeStatusKey({ running: false } as Actor)).toBe("stopped");
  expect(actorRuntimeStatusKey({ running: true, effective_working_state: "error" } as Actor)).toBe(
    "common:error",
  );
});
