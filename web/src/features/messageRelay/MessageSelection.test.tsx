// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vite-plus/test";
import { MessageSelection, MessageSelectionCheckbox } from "./MessageSelection";
import { useModalStore } from "../../stores/useModalStore";
import type { LedgerEvent } from "../../types";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
const events: LedgerEvent[] = [
  { id: "one", kind: "chat.message", data: { text: "One" } },
  { id: "two", kind: "chat.message", data: { text: "Two" } },
];
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let previous: ReturnType<typeof useModalStore.getState>;
const forward = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  previous = useModalStore.getState();
  useModalStore.setState({ setRelayBatch: forward });
  forward.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useModalStore.setState(previous, true);
});
function view(groupId = "source", readOnly = false) {
  return (
    <MessageSelection key={groupId} groupId={groupId} readOnly={readOnly} messages={events}>
      {events.map((event) => (
        <MessageSelectionCheckbox key={event.id} event={event} />
      ))}
    </MessageSelection>
  );
}
async function button(text: string) {
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === text)!
      .click(),
  );
}
it("selects multiple complete messages in display order and resets on Group change", async () => {
  await act(async () => root.render(view()));
  await button("Select messages");
  await button("Select all shown");
  expect(
    Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).every(
      (el) => el.checked,
    ),
  ).toBe(true);
  await button("Forward selected");
  expect(forward).toHaveBeenCalledWith("source", events, expect.any(Function));
  await act(async () => root.render(view("other")));
  expect(host.querySelectorAll("input")).toHaveLength(0);
});
it("does not offer forwarding in read-only views", async () => {
  await act(async () => root.render(view("source", true)));
  expect(host.querySelectorAll("button,input")).toHaveLength(0);
});
