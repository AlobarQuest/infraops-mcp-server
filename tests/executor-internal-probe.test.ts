import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the VPS dispatch so the DEFAULT internal probe never touches real SSH/orb.
// dockerCmdPrefix is kept faithful (pure) so we can assert the prod/dev sudo split.
vi.mock("../src/services/vps-dispatch.js", () => ({
  vpsExec: vi.fn(),
  dockerCmdPrefix: (instance: string) => (instance === "dev" ? "sudo docker" : "docker"),
}));

import { verifySafe, probeHealthPathInternal, pickAppContainer } from "../src/standards/executor.js";
import { vpsExec } from "../src/services/vps-dispatch.js";

/** Build an enable_healthcheck proposal + an injectable `get` returning the given app object. */
function hc(
  app: Record<string, unknown>,
  args: Record<string, unknown> = { uuid: "u1", health_check_enabled: true, health_check_path: "/api/health" },
) {
  const proposal = {
    id: "coolify.enable_healthcheck:u1",
    target: { provider: "coolify", resource_type: "application", uuid: "u1", name: "watchtower" },
    planned_action: { tool: "coolify_update_application", args },
  } as any;
  return { proposal, get: vi.fn().mockResolvedValue(app) as any };
}

describe("verifySafe — internal-probe fallback for internal-only apps", () => {
  it("external 2xx → enable; the internal probe is NOT attempted", async () => {
    const { proposal, get } = hc({ uuid: "u1", fqdn: "https://app.devonwatkins.com", ports_exposes: "8000" });
    const internalProbe = vi.fn();
    const r = await verifySafe(proposal, "prod", {
      get,
      probe: async () => ({ status: 200, reason: "HTTP 200" }),
      internalProbe,
    });
    expect(r.ok).toBe(true);
    expect(internalProbe).not.toHaveBeenCalled();
  });

  it("external definitive 404 → escalate; internal NOT attempted (reachable, wrong path)", async () => {
    const { proposal, get } = hc({ uuid: "u1", fqdn: "https://app.devonwatkins.com", ports_exposes: "8000" });
    const internalProbe = vi.fn();
    const r = await verifySafe(proposal, "prod", {
      get,
      probe: async () => ({ status: 404, reason: "HTTP 404" }),
      internalProbe,
    });
    expect(r.ok).toBe(false);
    expect(internalProbe).not.toHaveBeenCalled();
  });

  it("external definitive redirect (302) → escalate; internal NOT attempted (SSO)", async () => {
    const { proposal, get } = hc({ uuid: "u1", fqdn: "https://sso.devonwatkins.com", ports_exposes: "8000" });
    const internalProbe = vi.fn();
    const r = await verifySafe(proposal, "prod", {
      get,
      probe: async () => ({ status: 302, reason: "redirect" }),
      internalProbe,
    });
    expect(r.ok).toBe(false);
    expect(internalProbe).not.toHaveBeenCalled();
  });

  it("external UNREACHABLE + internal 2xx → enable (the internal-only Watchtower case)", async () => {
    const { proposal, get } = hc({ uuid: "u1", fqdn: "https://watchtower.local", ports_exposes: "3000" });
    const internalProbe = vi.fn().mockResolvedValue({ status: 200, reason: "internal HTTP 200" });
    const r = await verifySafe(proposal, "dev", {
      get,
      probe: async () => ({ status: null, reason: "getaddrinfo ENOTFOUND watchtower.local" }),
      internalProbe,
    });
    expect(r.ok).toBe(true);
    expect(internalProbe).toHaveBeenCalledTimes(1);
  });

  it("external UNREACHABLE + internal non-2xx → escalate", async () => {
    const { proposal, get } = hc({ uuid: "u1", fqdn: "https://watchtower.local", ports_exposes: "3000" });
    const internalProbe = vi.fn().mockResolvedValue({ status: 503, reason: "internal HTTP 503" });
    const r = await verifySafe(proposal, "dev", {
      get,
      probe: async () => ({ status: null, reason: "ENOTFOUND" }),
      internalProbe,
    });
    expect(r.ok).toBe(false);
  });

  it("external UNREACHABLE + container-not-found (internal status null) → escalate", async () => {
    const { proposal, get } = hc({ uuid: "u1", fqdn: "https://watchtower.local", ports_exposes: "3000" });
    const internalProbe = vi
      .fn()
      .mockResolvedValue({ status: null, reason: "no running container with label coolify.applicationId=u1" });
    const r = await verifySafe(proposal, "dev", {
      get,
      probe: async () => ({ status: null, reason: "ENOTFOUND" }),
      internalProbe,
    });
    expect(r.ok).toBe(false);
  });

  it("passes instance, uuid, health_check_port and path to the internal probe", async () => {
    const { proposal, get } = hc(
      { uuid: "u1", fqdn: "https://watchtower.local", ports_exposes: "8080", health_check_port: "3000" },
      { uuid: "u1", health_check_enabled: true, health_check_path: "/api/health" },
    );
    const internalProbe = vi.fn().mockResolvedValue({ status: 200, reason: "ok" });
    await verifySafe(proposal, "dev", {
      get,
      probe: async () => ({ status: null, reason: "ENOTFOUND" }),
      internalProbe,
    });
    expect(internalProbe).toHaveBeenCalledWith(
      expect.objectContaining({ instance: "dev", uuid: "u1", port: "3000", path: "/api/health" }),
      expect.any(Number),
    );
  });

  it("falls back to the first exposed port when health_check_port is unset", async () => {
    const { proposal, get } = hc({ uuid: "u1", fqdn: "https://watchtower.local", ports_exposes: "3000,8080" });
    const internalProbe = vi.fn().mockResolvedValue({ status: 200, reason: "ok" });
    await verifySafe(proposal, "dev", {
      get,
      probe: async () => ({ status: null, reason: "ENOTFOUND" }),
      internalProbe,
    });
    expect(internalProbe).toHaveBeenCalledWith(expect.objectContaining({ port: "3000" }), expect.any(Number));
  });

  it("external UNREACHABLE but no port resolvable → escalate, no internal probe attempted", async () => {
    const { proposal, get } = hc({ uuid: "u1", fqdn: "https://watchtower.local" }); // no ports_exposes / health_check_port
    const internalProbe = vi.fn();
    const r = await verifySafe(proposal, "dev", {
      get,
      probe: async () => ({ status: null, reason: "ENOTFOUND" }),
      internalProbe,
    });
    expect(r.ok).toBe(false);
    expect(internalProbe).not.toHaveBeenCalled();
  });
});

describe("pickAppContainer — choose the primary app container among label matches", () => {
  it("prefers the app container over sidecars (worker/scheduler/task)", () => {
    // Observed live on dev: `docker ps --filter label=coolify.applicationId=5` lists worker first.
    expect(pickAppContainer(["worker-ejmq-1", "app-ejmq-2"])).toBe("app-ejmq-2");
    expect(pickAppContainer(["scheduler-x", "task-runners-y", "app-z"])).toBe("app-z");
  });
  it("returns the only container when there is a single match", () => {
    expect(pickAppContainer(["watchtower-abc123"])).toBe("watchtower-abc123");
  });
  it("falls back to the first when every match looks like a sidecar", () => {
    expect(pickAppContainer(["worker-a", "scheduler-b"])).toBe("worker-a");
  });
  it("returns empty string when there are no matches", () => {
    expect(pickAppContainer([])).toBe("");
  });
});

describe("probeHealthPathInternal — default container-internal probe via the VPS dispatch", () => {
  beforeEach(() => (vpsExec as any).mockReset());

  it("resolves the live container by Coolify label, execs curl, returns the HTTP status", async () => {
    (vpsExec as any)
      .mockResolvedValueOnce({ stdout: "watchtower-abc123\n", stderr: "", exitCode: 0 }) // docker ps
      .mockResolvedValueOnce({ stdout: "200", stderr: "", exitCode: 0 }); // docker exec curl
    const r = await probeHealthPathInternal({ instance: "dev", uuid: "u1", port: "3000", path: "/api/health" }, 5000);
    expect(r.status).toBe(200);

    const psCall = (vpsExec as any).mock.calls[0];
    expect(psCall[0]).toBe("dev");
    expect(psCall[1]).toContain("label=coolify.applicationId=u1");

    const execCall = (vpsExec as any).mock.calls[1];
    expect(execCall[1]).toContain("watchtower-abc123");
    expect(execCall[1]).toContain("http://127.0.0.1:3000/api/health");
    expect(execCall[1]).toContain("sudo docker"); // dev → sudo docker
  });

  it("execs curl against the app container, not a co-located worker sidecar", async () => {
    (vpsExec as any)
      .mockResolvedValueOnce({ stdout: "worker-ejmq-1\napp-ejmq-2\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "200", stderr: "", exitCode: 0 });
    const r = await probeHealthPathInternal({ instance: "dev", uuid: "5", port: "3000", path: "/api/health" }, 5000);
    expect(r.status).toBe(200);
    expect((vpsExec as any).mock.calls[1][1]).toContain("app-ejmq-2");
    expect((vpsExec as any).mock.calls[1][1]).not.toContain("worker-ejmq-1");
  });

  it("returns status null when no container carries the label (never execs curl)", async () => {
    (vpsExec as any).mockResolvedValueOnce({ stdout: "\n", stderr: "", exitCode: 0 });
    const r = await probeHealthPathInternal({ instance: "prod", uuid: "u1", port: "8000", path: "/api/health" }, 5000);
    expect(r.status).toBeNull();
    expect((vpsExec as any).mock.calls.length).toBe(1);
  });

  it("returns status null when curl cannot connect (http_code 000)", async () => {
    (vpsExec as any)
      .mockResolvedValueOnce({ stdout: "app-xyz\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "000", stderr: "", exitCode: 7 });
    const r = await probeHealthPathInternal({ instance: "prod", uuid: "u1", port: "8000", path: "/api/health" }, 5000);
    expect(r.status).toBeNull();
  });

  it("uses plain `docker` (no sudo) on prod", async () => {
    (vpsExec as any)
      .mockResolvedValueOnce({ stdout: "c1\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "204", stderr: "", exitCode: 0 });
    const r = await probeHealthPathInternal({ instance: "prod", uuid: "u1", port: "8000", path: "/health/ready" }, 5000);
    expect(r.status).toBe(204);
    expect((vpsExec as any).mock.calls[1][1]).not.toContain("sudo");
  });
});
