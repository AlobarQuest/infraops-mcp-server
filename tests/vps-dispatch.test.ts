/**
 * Unit tests for vps-dispatch — proves the instance routing actually switches
 * backends instead of always hitting Hetzner (the exact bug that prompted this module).
 *
 * Mocks both ssh-client and orb-client so the tests run hermetically — no real SSH,
 * no orb subprocess, no dependence on a reachable VPS.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/services/ssh-client.js", () => ({
  sshExec: vi.fn(async () => ({ stdout: "ssh-stdout", stderr: "", exitCode: 0 })),
  sshReadFile: vi.fn(async () => "ssh-file-contents"),
  sshWriteFile: vi.fn(async () => undefined),
  handleSSHError: vi.fn((e: unknown) => `ssh error: ${String(e)}`),
}));

vi.mock("../src/services/orb-client.ts", async () => {
  return import("../src/services/orb-client.js").then(() => ({}));
});

vi.mock("../src/services/orb-client.js", () => ({
  orbExec: vi.fn(
    async (
      _machine: string,
      _command: string,
      _opts: { timeout?: number; allowFailure?: boolean }
    ) => ({ stdout: "orb-stdout", stderr: "", exitCode: 0 })
  ),
  getOrbMachine: vi.fn(() => process.env.VPS_DEV_ORB_MACHINE || "ubuntu"),
  handleOrbError: vi.fn((e: unknown) => `orb error: ${String(e)}`),
  isOrbConfigured: vi.fn(() => true),
}));

import {
  vpsExec,
  vpsReadFile,
  vpsWriteFile,
  dockerCmdPrefix,
  describeInstance,
} from "../src/services/vps-dispatch.js";
import { sshExec, sshReadFile, sshWriteFile } from "../src/services/ssh-client.js";
import { orbExec, getOrbMachine } from "../src/services/orb-client.js";

const sshExecMock = vi.mocked(sshExec);
const sshReadFileMock = vi.mocked(sshReadFile);
const sshWriteFileMock = vi.mocked(sshWriteFile);
const orbExecMock = vi.mocked(orbExec);
const getOrbMachineMock = vi.mocked(getOrbMachine);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VPS_DEV_ORB_MACHINE;
});

afterEach(() => {
  delete process.env.VPS_DEV_ORB_MACHINE;
});

describe("vpsExec routing", () => {
  it('instance: "prod" → sshExec, never orbExec', async () => {
    const result = await vpsExec("prod", "hostname", { timeout: 5000 });

    expect(sshExecMock).toHaveBeenCalledTimes(1);
    expect(sshExecMock).toHaveBeenCalledWith("hostname", { timeout: 5000 });
    expect(orbExecMock).not.toHaveBeenCalled();
    expect(result.stdout).toBe("ssh-stdout");
    expect(result.exitCode).toBe(0);
  });

  it('instance: "dev" → orbExec with getOrbMachine(), never sshExec', async () => {
    const result = await vpsExec("dev", "hostname", {
      timeout: 5000,
      allowFailure: true,
    });

    expect(orbExecMock).toHaveBeenCalledTimes(1);
    expect(orbExecMock).toHaveBeenCalledWith("ubuntu", "hostname", {
      timeout: 5000,
      allowFailure: true,
    });
    expect(sshExecMock).not.toHaveBeenCalled();
    expect(result.stdout).toBe("orb-stdout");
  });

  it("VPS_DEV_ORB_MACHINE env override flows through to orbExec", async () => {
    process.env.VPS_DEV_ORB_MACHINE = "alt-machine";
    getOrbMachineMock.mockReturnValueOnce("alt-machine");

    await vpsExec("dev", "uname -a");

    expect(orbExecMock).toHaveBeenCalledWith("alt-machine", "uname -a", {});
  });

  it('prod path forwards options verbatim to sshExec (no "instance" leakage)', async () => {
    await vpsExec("prod", "ls /etc", { timeout: 1000, allowFailure: true });

    expect(sshExecMock).toHaveBeenCalledWith("ls /etc", {
      timeout: 1000,
      allowFailure: true,
    });
  });
});

describe("vpsReadFile routing", () => {
  it('instance: "prod" → sshReadFile (native SFTP-style path)', async () => {
    const content = await vpsReadFile("prod", "/etc/hostname");

    expect(sshReadFileMock).toHaveBeenCalledWith("/etc/hostname");
    expect(orbExecMock).not.toHaveBeenCalled();
    expect(content).toBe("ssh-file-contents");
  });

  it('instance: "dev" → orbExec with `cat <escaped>` and returns stdout', async () => {
    orbExecMock.mockResolvedValueOnce({
      stdout: "dev-file-contents",
      stderr: "",
      exitCode: 0,
    });

    const content = await vpsReadFile("dev", "/etc/os-release");

    expect(orbExecMock).toHaveBeenCalledTimes(1);
    const [machine, command] = orbExecMock.mock.calls[0]!;
    expect(machine).toBe("ubuntu");
    expect(command).toBe("cat '/etc/os-release'");
    expect(sshReadFileMock).not.toHaveBeenCalled();
    expect(content).toBe("dev-file-contents");
  });

  it("dev: non-zero exit from cat surfaces as a thrown Error with stderr context", async () => {
    orbExecMock.mockResolvedValueOnce({
      stdout: "",
      stderr: "cat: /nope: No such file or directory",
      exitCode: 1,
    });

    await expect(vpsReadFile("dev", "/nope")).rejects.toThrow(
      /Failed to read \/nope.*No such file/
    );
  });

  it("dev: single-quote in path is escaped safely", async () => {
    orbExecMock.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await vpsReadFile("dev", "/tmp/it's-fine.txt");

    const [, command] = orbExecMock.mock.calls[0]!;
    // Expect the POSIX-safe escape: '…'\''…'
    expect(command).toBe("cat '/tmp/it'\\''s-fine.txt'");
  });
});

describe("vpsWriteFile routing", () => {
  it('instance: "prod" → sshWriteFile (unchanged prod path)', async () => {
    await vpsWriteFile("prod", "/tmp/a.txt", "hello");

    expect(sshWriteFileMock).toHaveBeenCalledWith("/tmp/a.txt", "hello");
    expect(orbExecMock).not.toHaveBeenCalled();
  });

  it('instance: "dev" → orbExec with heredoc payload', async () => {
    orbExecMock.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await vpsWriteFile("dev", "/tmp/a.txt", "line1\nline2");

    const [machine, command] = orbExecMock.mock.calls[0]!;
    expect(machine).toBe("ubuntu");
    expect(command).toContain("cat > '/tmp/a.txt' << 'INFRAOPS_EOF'");
    expect(command).toContain("line1\nline2");
    expect(command).toContain("INFRAOPS_EOF");
  });

  it("dev: write failure raises with stderr context", async () => {
    orbExecMock.mockResolvedValueOnce({
      stdout: "",
      stderr: "permission denied",
      exitCode: 1,
    });

    await expect(
      vpsWriteFile("dev", "/root/locked.txt", "x")
    ).rejects.toThrow(/Failed to write \/root\/locked\.txt.*permission denied/);
  });
});

describe("dockerCmdPrefix", () => {
  it('"prod" → "docker" (root on Hetzner)', () => {
    expect(dockerCmdPrefix("prod")).toBe("docker");
  });

  it('"dev" → "sudo docker" (devon is not in docker group)', () => {
    expect(dockerCmdPrefix("dev")).toBe("sudo docker");
  });
});

describe("describeInstance", () => {
  it('prod describes the Hetzner SSH target', () => {
    const original = process.env.VPS_HOST;
    process.env.VPS_HOST = "1.2.3.4";
    try {
      expect(describeInstance("prod")).toContain("1.2.3.4");
      expect(describeInstance("prod")).toContain("prod");
    } finally {
      if (original === undefined) delete process.env.VPS_HOST;
      else process.env.VPS_HOST = original;
    }
  });

  it("dev describes the OrbStack machine", () => {
    getOrbMachineMock.mockReturnValueOnce("ubuntu");
    const out = describeInstance("dev");
    expect(out).toContain("OrbStack");
    expect(out).toContain("ubuntu");
    expect(out).toContain("dev");
  });
});
