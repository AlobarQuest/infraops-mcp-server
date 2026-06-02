import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "../src/services/coolify-client.js";

// Minimal McpServer stub
const mockServer = {
  registerTool: vi.fn((name, _schema, handler) => {
    mockServer._handlers[name] = handler;
  }),
  _handlers: {} as Record<string, Function>,
};

vi.mock("../src/services/coolify-client.js", () => ({
  coolifyGet: vi.fn(),
  coolifyPost: vi.fn(),
  handleCoolifyError: vi.fn((e) => `Error: ${e}`),
}));

import { registerDeploymentTools } from "../src/tools/deployments.js";

describe("coolify_list_deployments", () => {
  beforeEach(() => {
    mockServer._handlers = {};
    registerDeploymentTools(mockServer as any);
  });

  it("calls the correct Coolify endpoint", async () => {
    vi.mocked(client.coolifyGet).mockResolvedValueOnce({
      count: 2,
      deployments: [
        { id: 1, uuid: "dep-1", status: "finished" },
        { id: 2, uuid: "dep-2", status: "failed" },
      ],
    });

    const result = await mockServer._handlers["coolify_list_deployments"]({
      uuid: "app-uuid-123",
      instance: "prod",
    });

    expect(client.coolifyGet).toHaveBeenCalledWith(
      "/deployments/applications/app-uuid-123",
      undefined,
      "prod"
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
    expect(parsed.deployments).toHaveLength(2);
  });
});
