import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LedgerEvent } from "../../types";
import { useModalStore } from "../../stores/useModalStore";

const Selection = createContext<{
  selected: Set<string>;
  active: boolean;
  toggle: (event: LedgerEvent) => void;
} | null>(null);
export function MessageSelection({
  groupId,
  readOnly,
  messages,
  children,
  onForward,
}: {
  groupId: string;
  readOnly?: boolean;
  messages: LedgerEvent[];
  children: ReactNode;
  onForward?: () => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  function toggle(event: LedgerEvent) {
    if (!event.id) return;
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(event.id!)) next.delete(event.id!);
      else next.add(event.id!);
      return next;
    });
  }
  const selectedMessages = messages.filter(
    (message) => message.id && selected.has(message.id) && !message._streaming,
  );
  const cancel = () => {
    setActive(false);
    setSelected(new Set());
  };
  return (
    <Selection.Provider value={readOnly ? null : { selected, active, toggle }}>
      <div className="relative flex min-h-0 flex-1 flex-col" data-message-selection>
        {!readOnly && (
          <div
            className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-[var(--glass-border-subtle)] px-3 py-1 text-xs"
            data-message-selection-toolbar
          >
            {active ? (
              <>
                <span className="mr-auto">
                  {zh
                    ? `已选择 ${selectedMessages.length} 条消息`
                    : `${selectedMessages.length} messages selected`}
                </span>
                <button
                  type="button"
                  className="glass-btn rounded px-2 py-1"
                  onClick={() =>
                    setSelected(
                      new Set(
                        messages
                          .filter(
                            (event) =>
                              event.id &&
                              event.kind === "chat.message" &&
                              !event._streaming &&
                              !(event.data as Record<string, unknown>)?._optimistic,
                          )
                          .map((event) => event.id!),
                      ),
                    )
                  }
                >
                  {zh ? "选择当前列表全部消息" : "Select all shown"}
                </button>
                <button
                  type="button"
                  className="glass-btn rounded px-2 py-1"
                  disabled={!selectedMessages.length}
                  onClick={() => {
                    onForward?.();
                    useModalStore
                      .getState()
                      .setRelayBatch(groupId, selectedMessages, onForward ? undefined : cancel);
                  }}
                >
                  {zh ? "批量转发" : "Forward selected"}
                </button>
                <button type="button" className="glass-btn rounded px-2 py-1" onClick={cancel}>
                  {zh ? "取消选择" : "Cancel selection"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="glass-btn rounded px-2 py-1"
                onClick={() => setActive(true)}
              >
                {zh ? "选择消息" : "Select messages"}
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </Selection.Provider>
  );
}
export function MessageSelectionCheckbox({ event }: { event: LedgerEvent }) {
  const selection = useContext(Selection);
  const { i18n } = useTranslation();
  if (
    !selection?.active ||
    !event.id ||
    event.kind !== "chat.message" ||
    event._streaming ||
    (event.data as Record<string, unknown>)?._optimistic
  )
    return null;
  return (
    <label
      className="inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1.5 px-1"
      data-message-selection-control
    >
      <input
        type="checkbox"
        checked={selection.selected.has(event.id)}
        onChange={() => selection.toggle(event)}
        aria-label={`${i18n.language.startsWith("zh") ? "选择消息" : "Select message"}: ${event.id}`}
      />
      <span>{i18n.language.startsWith("zh") ? "选择" : "Select"}</span>
    </label>
  );
}
