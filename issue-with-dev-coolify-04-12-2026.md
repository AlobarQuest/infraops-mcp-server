# Issue: `vps_*` tools ignore `instance` and always hit Hetzner prod

**Filed:** 2026-04-12
**Severity:** High — causes silent misrouting of all dev-environment debugging
**Component:** `src/services/ssh-client.ts`, `src/tools/vps.ts`

---

## Summary

The `coolify_*` family of tools correctly supports multi-instance routing via an `instance: "prod" | "dev"` parameter (see `src/services/coolify-client.ts`). The `vps_*` family of tools does **not**. `vps_exec`, `vps_health`, `vps_read_file`, `vps_write_file`, `vps_docker_ps`, `vps_docker_logs`, and `vps_docker_stats` all unconditionally SSH into the single host defined by the `VPS_HOST` env var (default `178.156.247.239` = Hetzner prod).

As a result, anyone trying to debug a dev-Coolify issue by combining `coolify_list_services({instance: "dev"})` with a follow-up `vps_exec(...)` call lands on the **wrong machine**, sees the **wrong set of containers**, and draws the **wrong conclusions**.

---

## Reproducer

```text
1. coolify_list_applications({instance: "dev"})
     → returns FacelessTT app with UUID ejmq4csh9ho71k72l8fgzf86
        and container_name app-ejmq4csh9ho71k72l8fgzf86-*

2. vps_exec({ command: "docker ps --format '{{.Names}}' | grep ejmq" })
     → returns empty (exit code 1, no match)

3. Investigator concludes the container is missing and spends an hour
   chasing a ghost.

4. Reality: the container is running fine on the OrbStack `ubuntu` VM
   at 192.168.139.217. Step 2 ran on Hetzner prod at 178.156.247.239,
   which never had a FacelessTT container.
```

I tried passing `target: "dev"` on the `vps_exec` call thinking the parameter existed. It was silently dropped by the MCP input-schema validator (see `src/tools/vps.ts:27-39` — the `inputSchema` only declares `command` and `timeout`), and the call proceeded to Hetzner as usual. No error, no warning, no clue that the intent didn't match the action.

---

## Root Cause

### `src/services/ssh-client.ts` — single hardcoded host

```ts
function getSSHConfig(): SSHConfig {
  const host = process.env.VPS_HOST || "178.156.247.239";
  const port = parseInt(process.env.VPS_PORT || "22", 10);
  const username = process.env.VPS_USER || "root";
  const keyPath = process.env.VPS_SSH_KEY_PATH || ...;
  const passphrase = process.env.VPS_SSH_PASSPHRASE || undefined;
  ...
}
```

`getSSHConfig()` takes no argument and reads a single set of env vars. `sshExec(command, opts)` likewise has no instance parameter. Multi-host routing was never wired in.

### `src/tools/vps.ts` — no instance in any tool's `inputSchema`

```ts
server.registerTool("vps_exec", {
  inputSchema: {
    command: z.string().min(1)...,
    timeout: z.number().int()....default(30000)...,
  },
  ...
}, async ({ command, timeout }) => {
  const result = await sshExec(command, { timeout, allowFailure: true });
  ...
});
```

Seven tools (`vps_exec`, `vps_health`, `vps_read_file`, `vps_write_file`, `vps_docker_ps`, `vps_docker_logs`, `vps_docker_stats`) all follow this same shape. None accept or forward an instance.

### Contrast: `src/services/coolify-client.ts` — properly multi-instance

```ts
function getInstanceConfig(instance: CoolifyInstance): InstanceConfig {
  const upper = instance.toUpperCase(); // "PROD" | "DEV"
  const baseUrl =
    process.env[`COOLIFY_${upper}_BASE_URL`] ??
    (instance === "prod" ? process.env.COOLIFY_BASE_URL : undefined);
  const token =
    process.env[`COOLIFY_${upper}_API_TOKEN`] ??
    (instance === "prod" ? process.env.COOLIFY_API_TOKEN : undefined);
  ...
}
```

The Coolify client already has exactly the pattern the SSH client needs: `COOLIFY_PROD_*` / `COOLIFY_DEV_*` with a legacy fallback for `prod`. It even caches one client per instance via a `Map<CoolifyInstance, AxiosInstance>`. This is the model to mirror.

---

## Environment Context (for the fixer)

- **prod** = Hetzner VPS, `ubuntu-2gb-ash-1`, 178.156.247.239, reached via SSH with an `ed25519` key in `~/.ssh/hetzner_ed25519`.
- **dev** = an OrbStack Linux machine called `ubuntu`, IP `192.168.139.217`, running Ubuntu 24.04 on aarch64 kernel `6.17.8-orbstack-*`. Runs Coolify 4.0.0-beta.470 and all the dev Coolify-managed containers (FacelessTT admin, n8n, etc.).
- OrbStack exposes each machine at a routable IP and provides native exec via `orb run -m <machine-name> <shell>`. Default user on the ubuntu machine is `devon` (NOT `root`), and `docker` requires `sudo` (devon is not in the `docker` group).
- SSH into the OrbStack ubuntu machine is possible but not currently set up. The user has not created an authorized_keys entry or enabled sshd on that VM.

---

## Recommended Fix

### Option B (preferred): route `instance: "dev"` through `orb run` instead of SSH

Cleanest because it requires **zero user-side setup** — OrbStack is already installed and managing the `ubuntu` machine; the `orb` CLI is available on macOS. Keeps `instance: "prod"` on the existing SSH path unchanged.

1. **Add a new low-level exec backend** `src/services/orb-client.ts`:
    ```ts
    import { execFile } from "node:child_process";
    import { promisify } from "node:util";

    const execFileAsync = promisify(execFile);

    export async function orbExec(
      machine: string,
      command: string,
      opts: { timeout: number; allowFailure?: boolean }
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      // Use `orb run -m <machine> bash -c '<command>'`
      try {
        const { stdout, stderr } = await execFileAsync(
          "orb",
          ["run", "-m", machine, "bash", "-c", command],
          { timeout: opts.timeout, maxBuffer: 10 * 1024 * 1024 }
        );
        return { stdout, stderr, exitCode: 0 };
      } catch (err: any) {
        if (opts.allowFailure) {
          return {
            stdout: err.stdout ?? "",
            stderr: err.stderr ?? String(err),
            exitCode: typeof err.code === "number" ? err.code : 1,
          };
        }
        throw err;
      }
    }
    ```

2. **Introduce a dispatcher** `src/services/vps-dispatch.ts`:
    ```ts
    export type VpsInstance = "prod" | "dev";

    export async function vpsExec(
      instance: VpsInstance,
      command: string,
      opts: { timeout: number; allowFailure?: boolean }
    ) {
      if (instance === "dev") {
        const machine = process.env.VPS_DEV_ORB_MACHINE ?? "ubuntu";
        return orbExec(machine, command, opts);
      }
      return sshExec(command, opts); // existing prod path, unchanged
    }
    ```
    Add sibling helpers for read/write/docker operations (they can all be expressed in terms of `vpsExec`, e.g. `vpsReadFile` = `vpsExec(instance, "cat $path", …)`).

3. **Update every tool in `src/tools/vps.ts`** to accept and forward `instance`:
    ```ts
    inputSchema: {
      instance: z
        .enum(["prod", "dev"])
        .default("prod")
        .describe("Which VPS to target: 'prod' (Hetzner) or 'dev' (OrbStack ubuntu machine). Default: prod."),
      command: z.string().min(1)...,
      timeout: z.number().int()....default(30000)...,
    },
    ...
    async ({ instance, command, timeout }) => {
      const result = await vpsExec(instance, command, { timeout, allowFailure: true });
      ...
    }
    ```

4. **Document the new env vars** in `CLAUDE.md` / `RUNBOOK.md`:
    - `VPS_DEV_ORB_MACHINE` (default `ubuntu`) — OrbStack machine name for dev
    - `VPS_PROD_HOST` / `VPS_HOST` — unchanged for prod (Hetzner)

### Option A (fallback): extend SSH client to multi-host

If `orb run` is not acceptable for any reason (e.g., wanting remote-user SSH parity), add SSH-based dev support:

1. In `src/services/ssh-client.ts`, rename `getSSHConfig()` to take an `instance: "prod" | "dev"` argument and read from `VPS_${INSTANCE}_HOST`, `VPS_${INSTANCE}_USER`, `VPS_${INSTANCE}_SSH_KEY_PATH`, `VPS_${INSTANCE}_SSH_PASSPHRASE`, falling back to the legacy `VPS_HOST` etc. for `prod`.
2. Expose `sshExec(command, opts)` → `sshExec(instance, command, opts)` and update all call sites.
3. Cache one `Client` per instance (same pattern as `coolify-client.ts`'s `_clients` Map).
4. Add the same `instance` parameter to every tool in `src/tools/vps.ts`.
5. User must then:
    - Enable sshd on the OrbStack `ubuntu` machine (`sudo systemctl enable --now ssh`)
    - Add the Mac's pubkey to `/home/devon/.ssh/authorized_keys`
    - Set `VPS_DEV_HOST=192.168.139.217`, `VPS_DEV_USER=devon`, `VPS_DEV_SSH_KEY_PATH=~/.ssh/...`
    - Grant sudo or add `devon` to the `docker` group so commands don't need `sudo docker`

Option A works but forces setup on every user of the MCP. Option B works out of the box.

---

## Secondary Issues Found During Investigation

1. **`coolify_update_service` rejects every `docker_compose_raw` payload** with `"Validation failed. Validation failed."`, even when resubmitting the existing content byte-for-byte. Reproduced against the dev Coolify n8n service (`f3m30sqyjjj574m8053c836w`) on 2026-04-12. Worked around by updating Coolify's Postgres directly. Worth investigating whether the MCP is missing a required field, whether it's passing the value unencoded, or whether Coolify itself rejects the upstream request — and surfacing the real error message instead of the generic "Validation failed."

2. **Silent drop of unknown params**. When I passed `target: "dev"` to `vps_exec` (the parameter doesn't exist), the MCP dropped it without warning and executed the call against prod. Consider having the tool-call layer warn or error on unrecognized input fields so mistaken parameters fail loudly.

3. **Tool descriptions lie by omission**. The Coolify tools' descriptions mention `"'prod' (Hetzner VPS) or 'dev' (local OrbStack VM)"`. The VPS tools' descriptions say only "Run a shell command on the VPS" — no hint that "the VPS" is always Hetzner. After this fix, the descriptions should explicitly name both targets and call out the default.

---

## Acceptance Criteria

- [ ] `vps_exec({instance: "dev", command: "hostname"})` returns `ubuntu-2gb-ash-1`... wait, no — returns whatever the OrbStack `ubuntu` machine's hostname is (NOT `ubuntu-2gb-ash-1`, which is Hetzner).
- [ ] `vps_exec({instance: "prod", command: "hostname"})` still returns `ubuntu-2gb-ash-1` (unchanged from today).
- [ ] `vps_exec({instance: "dev", command: "sudo docker ps --format '{{.Names}}' | grep ejmq"})` returns the FacelessTT admin container name.
- [ ] `vps_exec({command: "hostname"})` with no instance defaults to `"prod"` — existing callers keep working without modification.
- [ ] `vps_health`, `vps_read_file`, `vps_write_file`, `vps_docker_ps`, `vps_docker_logs`, `vps_docker_stats` all accept `instance` and route correctly.
- [ ] `CLAUDE.md` / `RUNBOOK.md` updated with the new routing and env vars.
- [ ] Unit or integration test added that exercises `instance: "dev"` on at least `vps_exec`.

---

## How I Discovered This

While troubleshooting a DNS-resolution failure in n8n on the dev Coolify instance, I ran `coolify_list_applications({instance: "dev"})` and got back FacelessTT admin with container name `app-ejmq4csh9ho71k72l8fgzf86-*`. Follow-up `vps_exec({command: "docker ps | grep ejmq"})` returned nothing. I spent ~15 minutes "investigating" missing containers before noticing that a `hostname` check returned `ubuntu-2gb-ash-1` and an `ip addr` showed public IP `178.156.247.239` — definitely not my local OrbStack VM. Once I realized the MCP was routing to Hetzner regardless of the Coolify instance I'd queried, the real investigation on OrbStack (`orb run -m ubuntu sudo docker ps`) took under a minute and found the containers exactly where they belonged.
