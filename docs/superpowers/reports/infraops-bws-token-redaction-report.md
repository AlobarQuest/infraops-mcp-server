Outcome: done

# Report: infraops redaction masks the BWS access-token shape

PR: https://github.com/AlobarQuest/infraops-mcp-server/pull/178 (branch `hq/infraops-bws-token-redaction`, open, not merged).

## What I built

- `src/utils/redaction.ts`: added the BWS access-token shape to `VALUE_SHAPES`. The pattern is character-for-character identical to `BWS_TOKEN_REGEX` in `~/Projects/security-standards/src/security_scan/token_shapes.py` line 15. A comment names that file as the source to change along with this one. Like the other shapes, the whole match is replaced with `***`. Because `deepRedact` applies `redactText` to every string, a token is masked under any field name, including `docker_compose`.
- `tests/redaction.test.ts`: added four tests (the file went from 15 to 19). The fixtures (`UUID`, `BWS_TOKEN`) are assembled from parts at runtime with `join`, so no tracked file holds the full token shape.
  - `redactText` masks a whole token.
  - In a rendered compose (`BWS_SECRET_FOR_LANE: <token>` plus six other lines), only the token is masked and every other line is unchanged.
  - A bare UUID, `0.` plus a UUID with no secret part, and `0.` plus a UUID plus a 19-character secret all come through unmasked.
  - `deepRedact` masks a token under `docker_compose` and `note`, two fields whose names aren't secret-shaped.
- `CLAUDE.md` (the central-redaction bullet in "Patterns") and `docs/superpowers/specs/2026-06-18-secret-redaction-chokepoint-design.md` (the value-shape list): added BWS access tokens. I changed nothing else in either file.
- `dist/utils/redaction.{js,js.map,d.ts.map}`: rebuilt.

## Tests and checks run

- `npx vitest run tests/redaction.test.ts`: 19 tests passed.
- Negative control: I removed the new pattern line, and 3 tests failed: "masks a whole BWS access token", "masks a BWS token in a rendered compose…", and "value-shape masks a BWS token under a non-secret-named field". 16 passed. The UUID-passthrough test passes either way, as it is meant to. After I restored the line, all 19 passed again.
- `npm test`: 60 test files, **698 tests passed**.
- `npm run build`: succeeded. `git diff --stat dist/` shows only the three `dist/utils/redaction.*` files.
- `make check`: exit 0, which covers lint, type-check, shell tests, and vitest.
- `code-standards risk --repo .`: verdict `normal`, so no vendor review was needed.
- `/code-review` (medium): three nits, all about the canonical pattern itself. See "Concerns".

## Files changed

- `src/utils/redaction.ts`
- `tests/redaction.test.ts`
- `dist/utils/redaction.js`, `dist/utils/redaction.js.map`, `dist/utils/redaction.d.ts.map`
- `CLAUDE.md`
- `docs/superpowers/specs/2026-06-18-secret-redaction-chokepoint-design.md`

## Self-review

- Truncation and output shape are unaffected. `src/utils/register-sanitized.ts` line 49-50 redacts first and then calls `truncateToLimit`, and the regex only replaces a matched substring with `***`, the same as the other shapes. Neither a tool's output structure nor the truncation logic changed, so the handoff's stop point didn't apply.
- Build hygiene: the worktree started with nearly no `node_modules`, so my first `npm run build` resolved packages from the main checkout. That rewrote the whole `dist/bundle/change-mgr-cli.js` with `../../node_modules` paths. I discarded that output, ran `npm ci` in the worktree, and rebuilt. The final `dist/` diff is only the redaction files. I didn't touch the main checkout.
- I didn't call any infraops tool against a live resource. The verification used fixtures only.

## Concerns

The review raised three nits. I left all of them unfixed, because the handoff asked for the canonical pattern and the two copies are meant to stay identical. Any change belongs in security-standards first, and then in `bws-write-guard.sh` and this file.

1. The pattern has no left boundary. In a string like `10.<uuid>.<secret>`, it masks from the `0.` and leaves the `1`. The token is still fully masked.
2. The UUID part is lowercase hex only. A token whose UUID was uppercased somewhere along the way would not be masked. The canonical pattern matches lowercase only. I didn't verify whether that covers every token BWS issues, so security-standards needs to decide whether its shape needs `[0-9a-fA-F-]`.
3. The secret class includes `/`, `=`, and `:`, so a token followed by `/path` masks the path too. That over-masks, which is the safe direction.

The infraops copy is kept in sync with security-standards only by a comment, and no test pins the two together, because CI can't read the other repo. A shared source of truth, or a portfolio lint, would close that gap.

This change doesn't rotate or close D-48's exposure. The lane token that leaked is still a `cred.exposure-rotate` matter.

The live MCP picks this up only after the PR is merged, `git sync` runs, and `/mcp reconnect infraops` runs. Lanes pinned to an older infraops don't get it until their pin moves. I did none of these steps, per the stop points.

## Standards followed

- **Never write a token-shaped literal (Infra Brain BLOCK 591, 592):** the test fixtures are built at runtime from parts (`['0', UUID, 'Ab1+/=:_-'.repeat(4)].join('.')`). The source, docs, commit message, PR body, and this report describe the shape or hold only the regex, never a literal token. The write-guard hook didn't block any write.
- **Infra Brain BLOCK 593 (no inline bootstrap token):** I didn't touch any config that holds `BWS_ACCESS_TOKEN`.
- **Infra Brain BLOCK 1032 (`cred.exposure-rotate`):** treated as context only. I didn't rotate anything or close the D-48 exposure.
- **Code Brain BLOCK 5 (never log secrets or tokens):** the change extends central redaction, so tool responses holding a BWS token are masked.
- **Code Brain BLOCK 4 (no silently swallowed exception):** the change adds no `try` or `catch`.
- **Code Brain BLOCK 3 (structured JSON logs):** doesn't apply, because the change adds no logging.
- **Code Brain `secrets` road:** none exists, and no other rule applies.
- **`STANDARDS.md`, `/code-review`, and the risk check:** I ran `/code-review` at medium on the diff (three nits, listed under "Concerns"). The risk verdict was `normal`. `make check` is green.
- **Repo invariant (`dist/` is tracked):** I rebuilt `dist/` with the worktree's own dependencies and committed it with the `src/` change.
