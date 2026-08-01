---
name: infraops-escalation
description: Use when you are doing infrastructure work through the infraops MCP and hit a capability it does NOT expose — a missing tool, a tool lacking a needed parameter, or an unsupported provider/operation — and you want the infraops provider agent to extend the server to cover it. The MCP being available IS the integration; this is the escalation lane for when that isn't enough. Triggers on "infraops has no tool for…", "the infraops MCP is missing…", "escalate to infraops", "ask infraops to add…", "need a coolify/hetzner/cloudflare/etc. tool that doesn't exist". Do NOT use for routine infra work the MCP already covers (just call the tool) or for infra changes that need Devon's approval.
---

# Escalate to the InfraOps provider agent

The infraops MCP exposes ~195 infrastructure tools. When you need something it
**doesn't** expose — no tool for an operation, a tool missing a parameter, an
unsupported provider endpoint — you don't have to give up or hand it to Devon.
You can escalate to the **infraops provider agent**: a gated agent running inside
`~/Projects/infraops-mcp-server` that can reason about the server and **add or
extend a tool** to close the gap.

This is an _escalation lane_, not basic usage. If the MCP already has a tool for
what you need, just call it.

## When to escalate

- The capability you need has no infraops tool at all.
- An existing tool is close but missing a parameter / option you need.
- A provider endpoint isn't covered and adding it is in scope for infraops.

## When NOT to escalate

- Routine work an existing tool covers → just call the tool.
- The fix is an infrastructure mutation (deploy, restart, destructive op) → that's
  Devon's call; the provider agent will refuse it and emit it as a PROPOSAL anyway.

## How to escalate

```bash
~/Projects/infraops-mcp-server/bin/provider-agent --session <short-issue-name> \
  "Doing <infra task> for <app>. I need <capability> but the infraops MCP has no
   tool for it / tool <name> lacks <param>. Here's what I tried and the exact error: …"
```

Give it full context: the operation you need, the closest existing tool (if any),
what you tried, and exact errors. **Reuse one `--session` name per issue** so the
thread keeps context across turns.

## Read the `STATUS:` block in the reply

- **`resolved`** — the provider agent added/extended the tool. Its edits are on a
  `provider-agent/<session>` **review branch** in `~/Projects/infraops-mcp-server`
  (the reply's `[provider-agent] … committed to <branch> @ <sha>` line names it).
  The new tool is **not live yet**: Devon reviews/merges the branch, then the MCP
  is rebuilt (`npm run build`) and reloaded before the tool can be called. Surface
  this to Devon; don't assume the tool is immediately callable.
- **`needs-info`** — it needs more from you. Answer precisely and call again with
  the **same** `--session` name.
- **`needs-devon`** — closing the gap needs an infra mutation or a build/publish
  only Devon should authorize. Stop and surface the `PROPOSALS` block to Devon.

## Important

The provider agent extends the infraops **source**; it does not run infra. So a
`resolved` means "the tool now exists in code on a review branch," not "the tool
ran." Plan for the review → merge → rebuild step before relying on the new
capability.
