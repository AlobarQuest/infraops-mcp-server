import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "../src/services/coolify-client.js";

const mockServer = {
  registerTool: vi.fn((name, _schema, handler) => {
    mockServer._handlers[name] = handler;
  }),
  _handlers: {} as Record<string, Function>,
};

vi.mock("../src/services/coolify-client.js", () => ({
  coolifyGet: vi.fn(),
  coolifyPost: vi.fn(),
  coolifyPatch: vi.fn(),
  coolifyDelete: vi.fn(),
  handleCoolifyError: vi.fn((e) => `Error: ${e}`),
}));

import { registerEnvVarTools } from "../src/tools/env-vars.js";

describe("service env var tools", () => {
  beforeEach(() => {
    mockServer._handlers = {};
    registerEnvVarTools(mockServer as any);
  });

  it("coolify_list_service_envs calls /services/{uuid}/envs and masks values", async () => {
    vi.mocked(client.coolifyGet).mockResolvedValueOnce([
      { uuid: "env-1", key: "FOO", value: "bar", is_buildtime: false, is_runtime: true },
    ]);
    const result = await mockServer._handlers["coolify_list_service_envs"]({
      uuid: "svc-uuid-1",
      reveal: false,
      instance: "prod",
    });
    expect(client.coolifyGet).toHaveBeenCalledWith("/services/svc-uuid-1/envs", undefined, "prod");
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0].value).toBe("***"); // masked by default
  });

  it("coolify_create_service_env calls POST /services/{uuid}/envs", async () => {
    vi.mocked(client.coolifyPost).mockResolvedValueOnce({ uuid: "env-2" });
    await mockServer._handlers["coolify_create_service_env"]({
      uuid: "svc-uuid-1",
      key: "DATABASE_URL",
      value: "postgres://...",
      is_buildtime: false,
      is_runtime: true,
      is_preview: false,
      instance: "prod",
    });
    expect(client.coolifyPost).toHaveBeenCalledWith(
      "/services/svc-uuid-1/envs",
      expect.objectContaining({ key: "DATABASE_URL", is_buildtime: false, is_runtime: true }),
      "prod"
    );
  });

  it("coolify_update_service_env calls PATCH /services/{uuid}/envs", async () => {
    vi.mocked(client.coolifyPatch).mockResolvedValueOnce({ uuid: "env-2" });
    await mockServer._handlers["coolify_update_service_env"]({
      uuid: "svc-uuid-1",
      key: "DATABASE_URL",
      value: "postgres://new",
      instance: "prod",
    });
    expect(client.coolifyPatch).toHaveBeenCalledWith(
      "/services/svc-uuid-1/envs",
      expect.objectContaining({ key: "DATABASE_URL", value: "postgres://new" }),
      "prod"
    );
  });

  it("coolify_bulk_update_service_envs calls PATCH /services/{uuid}/envs/bulk", async () => {
    vi.mocked(client.coolifyPatch).mockResolvedValueOnce({});
    await mockServer._handlers["coolify_bulk_update_service_envs"]({
      uuid: "svc-uuid-1",
      variables: [
        { key: "A", value: "1", is_buildtime: false, is_runtime: true, is_preview: false },
      ],
      instance: "prod",
    });
    expect(client.coolifyPatch).toHaveBeenCalledWith(
      "/services/svc-uuid-1/envs/bulk",
      expect.objectContaining({ data: expect.any(Array) }),
      "prod"
    );
  });
});
