# Personal CCCC framework fork

Upstream: [ChesterRa/cccc](https://github.com/ChesterRa/cccc), Apache-2.0.
Initial base: `3d3d10cb3906dc353a7d421541b6c6ec98a6d04d` (0.4.44).
Downstream branch: `framework-enhancements`. Preserve upstream history and license.
Upstream installation and release links distribute upstream builds.

## Scope

Only reusable CCCC framework improvements belong here:

- Opt-in preservation of configured Codex approval/sandbox policy and scoped MCP.
- Authenticated native WebSocket transport, explicit owned-pipe stdio fallback,
  checked original-thread adoption and generation-bound native approval controls.
- Native terminal details and runtime status independent of optional task notes.
- Opt-in browser/system notifications for messages addressed to the human and
  current approvals/input, with deduplication and source navigation. Reuse the
  existing global event subscription; no model calls or approval-on-click.

Do not commit business data, project instructions, private integration details,
local deployment records, runtime homes, credentials, conversations, screenshots,
actual session identifiers or host configuration. Use synthetic names and data
in tests. This restriction applies to documentation, commit messages and every
new commit reachable from a published branch, not only the final file tree.

## Human attention board

The header bell opens **My attention**, a read-only cross-Group view with
Approvals & input, Awaiting reply, and Other actions columns. Filter by Group,
expand long text, inspect waiting time and follow a card to its original source.
Tasks explicitly waiting on `user` open in CCCC's existing native task board;
this view does not add a task database, editable workflow or approval policy.
The native per-Group board is available through the header clipboard icon,
**Context Panel** > **Tasks** (narrow layouts: the **Context** menu item).

Current runtime permissions and native waiting flags supply input cards. Only
messages addressed to the human and current human-waiting tasks are included;
peer Mail and ordinary blocked/external tasks stay out. Reading a reply request
does not resolve it; a reply or cancellation does. Viewing the board does not
approve, reply or write a read receipt. Complete actions in their original UI.
Failed reads retain clearly stale cards; revoked or removed Group data is cleared.

The board and optional system notifications share one snapshot reader and the
existing global event subscription. The board works without notification
permission. Turning off system alerts does not hide the board. Refreshes coalesce
around metadata events, with a quiet 60-second browser catch-up; no Agent prompts,
model calls or backend timers are added. Only bounded notification IDs and the
existing system-alert preference persist locally; card text stays in memory.

Scope is deliberately bounded: each Group's latest 100 messages, plus up to 100
human-waiting planned and 100 active tasks. This is not a complete historical
obligation inventory. The view discloses its limits and points to original
conversations for earlier history. The page must stay open for system alerts.

## Build and verification

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for pinned toolchains and quality gates.
Build the frontend before the release executable, which embeds the Web assets:

```sh
npm ci --prefix web
npm -C web run build
cargo build --locked --release -p cccc --bin cccc
```

Targeted frontend checks:

```sh
npm -C web run typecheck
npm -C web test -- src/features/browserNotifications src/utils/actorRuntimeStatus.test.ts src/hooks/useGlobalEvents.test.ts src/hooks/useGlobalEvents.capabilityCatchup.test.tsx src/hooks/globalEventFallback.test.ts src/components/layout/AppHeader.connection.test.tsx src/components/layout/AppHeader.settings.test.tsx
```

Native protocol tests use isolated fixtures. The optional real Codex test uses
`CCCC_CODEX_TEST_BINARY` and a temporary runtime home; it does not attach to an
existing session. Keep development runtime homes separate from live ones.
Browser notifications require permission, HTTPS or localhost, and an open page;
closed-browser Web Push is not implemented.

Host opt-ins are generic configuration, with no deployment values stored here:

| Variable | Behavior |
| --- | --- |
| `CCCC_CODEX_PRESERVE_POLICY=1` | Preserve and verify explicit restrictive approval/sandbox configuration. |
| `CCCC_CODEX_SCOPED_MCP=1` | Preserve host-configured MCP scope when policy preservation is enabled. |
| `CCCC_CODEX_STDIO=1` | Explicit owned-pipe fallback with preserved policy; otherwise use the native viewer. |
| `CCCC_CODEX_WS_TOKEN_FILE` | Host-supplied transport credential file; never commit its contents. |
| `CCCC_CODEX_INITIAL_THREAD` | Explicit checked first adoption of an existing provider thread. |

## Maintenance

Use separate `origin` and `upstream` remotes. Select an explicit upstream revision
and merge it on a review branch; do not force-push published downstream history.
Review policy, MCP scope, transport, approvals, original-thread resume and browser
notification behavior, then run the affected checks before advancing the branch.
Prefer upstream equivalents once the same behavior is verified. Consumers should
pin an exact downstream commit. Source synchronization and builds do not deploy
or restart services. Audit all new commits for private material before pushing;
push only the reviewed branch, never all local refs or private draft history.

## Messaging and layout refinements

Completed Mail in chat uses the existing Markdown renderer without heuristic
format detection, matching the native Inbox. Inline emphasis, tables and fenced
code render normally; upstream raw-HTML and link restrictions remain unchanged.

Use **Select messages** in chat or Inbox, select individual messages or all shown,
then **Forward selected**. The existing single-message Relay action also supports
multiple destinations. The forwarding dialog previews the selected messages,
shows the message/Group product and keeps recipients separate for each Group.
Each forward retains its original source reference and preserves Markdown text.
Attachments remain in the original message, reachable through its source link;
this feature does not add attachment-copy or file-export endpoints.

Forwarding uses existing human send authorization and native `client_id`
deduplication. Each message/destination pair has one frozen key and payload.
Partial results are visible; explicit retries skip accepted items and reuse keys
for remaining items. A stop control leaves unsent items pending. These receipts
mean CCCC accepted the message, not that its recipient executed a task. Progress
and keys live in the open dialog; browser reload is not durable batch recovery.

Header resource controls reserve their intrinsic width, so the attention bell
cannot extend into the native clipboard shortcut. The runtime dock and activity
ticker occupy normal layout rows below messages instead of overlaying Reply.
Long Actor rows scroll horizontally, including on desktop.
