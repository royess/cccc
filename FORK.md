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
