# InfraOps MCP Server — Backlog

Deferred work that has been investigated but not implemented. Each entry
should include the problem, the threat/impact model, a menu of options with
tradeoffs, and (where possible) a preferred path so a future session can
resume without re-discovering context.

---

## 1. Harden `sshWriteFile` / `vpsWriteFile` heredoc delimiter

**Filed:** 2026-04-12
**Severity:** Low probability, high blast radius (RCE on prod VPS as root)
**Component:** `src/services/ssh-client.ts` (`sshWriteFile`), `src/services/vps-dispatch.ts` (`vpsWriteFile` dev path)

### Problem

Both write paths transport file content to the target VPS by inlining it
into a single-quoted heredoc:

```ts
`cat > ${escapeShell(path)} << 'INFRAOPS_EOF'\n${content}\nINFRAOPS_EOF`
```

The single-quoted delimiter (`'INFRAOPS_EOF'`) disables shell expansion, so
`$VAR`, `$(cmd)`, backticks, quotes, and backslashes all pass through safely.
The code is correct for every case except one: if `content` contains a line
that is literally `INFRAOPS_EOF`, the heredoc terminates early and every
byte after that line is reinterpreted as shell commands — running as root on
prod Hetzner or as `devon` (with sudo docker access) on dev OrbStack.

### Threat Model

The attacker needs to convince the MCP caller (an LLM like Claude) to write
a file whose content contains the literal string `INFRAOPS_EOF` on its own
line. Specific vectors:

- A user paste that happens to contain the string
- A documentation file that quotes the write protocol (e.g., this backlog
  entry — if you ever `vps_write_file` this very file, you will trip it)
- A config/template file harvested from a third-party source
- A deliberately crafted prompt-injection payload in any content the LLM
  decides to transfer to the VPS

The probability is low but the blast radius is "arbitrary shell execution
as root." This is a classic delimiter-collision vulnerability — the same
class of bug that breaks naive SQL quoting.

### Constraints

- Must stay binary-safe or at least UTF-8-safe for config files, scripts,
  docker-compose.yml, Dockerfiles, and similar textual content.
- Dev path already goes through `orb run -m <machine> bash -c <cmd>`, so
  any fix must work in that pipeline too, not just raw SSH.
- Should not require additional VPS-side dependencies beyond what is
  already assumed (bash, coreutils). Base64 is universally present.
- Existing callers of `sshWriteFile` / `vpsWriteFile` must continue to
  work without modification.

### Options

#### A. Reject writes containing the literal delimiter (cheapest)

```ts
if (/^INFRAOPS_EOF\s*$/m.test(content)) {
  throw new Error(
    "vps_write_file: content contains the reserved heredoc delimiter 'INFRAOPS_EOF' on a line by itself. Refusing to write."
  );
}
```

- **Pros:** one line, zero runtime overhead, fails loudly at the boundary.
- **Cons:** surprising to callers who happen to trip it ("why can't I write
  this file?"), doesn't solve the class of bug — just this specific
  manifestation. Still requires care if the delimiter is ever renamed.

#### B. Randomize the delimiter per call

```ts
const delim = `INFRAOPS_EOF_${crypto.randomUUID().replace(/-/g, "")}`;
```

- **Pros:** trivially cheap, makes collision astronomically unlikely, no
  caller-visible surprise.
- **Cons:** still technically collision-able; leaks a UUID into the
  command line (not a meaningful information disclosure); non-deterministic
  commands are slightly harder to debug from logs. Does not solve
  binary safety.

#### C. Base64-encode content, decode on the VPS (preferred)

```ts
const b64 = Buffer.from(content, "utf8").toString("base64");
await sshExec(
  `echo ${b64} | base64 -d > ${escapeShell(path)}`
);
```

- **Pros:** bulletproof against delimiter collisions by construction —
  the base64 alphabet never contains newlines, quotes, or shell metacharacters.
  Works identically through `sshExec` and `orbExec`. Adds binary safety
  as a bonus. Base64 is universally available on Linux.
- **Cons:** ~33% wire-size overhead; the full encoded payload sits on a
  single command line, so writes larger than ~1MB may hit shell ARG_MAX
  limits on some systems (`getconf ARG_MAX` on modern Linux is typically
  2MB+, but worth being aware of).
- **Mitigation for large files:** chunk the base64 payload across multiple
  `echo >> file` calls, or fall back to option D.

#### D. Switch to the ssh2 SFTP subsystem

```ts
conn.sftp((err, sftp) => {
  sftp.writeFile(path, content, (err) => { ... });
});
```

- **Pros:** the right tool for the job — a real file-transfer protocol
  designed for exactly this use case. Bulletproof. Binary-safe. Handles
  arbitrarily large content via the SFTP streaming API.
- **Cons:** biggest refactor. Only works on the prod (SSH) path — the dev
  path via `orb run` has no SFTP equivalent, so we would still need
  option C (base64) for dev, producing an asymmetric backend. Also adds
  another code path to maintain and test.

### Recommendation

**Option C (base64) for both backends**, with a content-size guard that
rejects writes larger than ~512KB and points the caller at a future
streaming path if one is ever needed. Base64 keeps the two backends
symmetrical (same strategy for SSH and for `orb run`), eliminates the
delimiter collision entirely rather than just making it unlikely, and
delivers binary safety for free.

If base64's command-line-length limitation ever becomes a real problem,
upgrade the prod path to SFTP (option D) while keeping dev on base64 —
asymmetric but targeted.

### Non-goals

- Reworking the read path (`sshReadFile` / `vpsReadFile`). It uses
  `cat $path` which has no delimiter to collide with; only the content
  payload is at risk, and the read path doesn't inline content into a
  command at all.
- Reworking heredoc usage elsewhere. A project-wide audit showed the
  heredoc pattern is only used in `sshWriteFile`.

### Acceptance criteria (when this gets picked up)

- [ ] `vps_write_file` with content containing `INFRAOPS_EOF` on its own
      line writes correctly and round-trips byte-for-byte.
- [ ] `vps_write_file` with content containing null bytes or high-bit
      UTF-8 round-trips correctly.
- [ ] Both prod (SSH) and dev (orb) paths use the same strategy so there
      is no correctness divergence between backends.
- [ ] Size guard trips with a clear error above some sane limit
      (suggest 512KB initial) rather than producing an obscure
      "Argument list too long" shell error.
- [ ] `tests/vps-dispatch.test.ts` gains coverage for the delimiter
      collision case via mocked backends.
