import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "../src/services/coolify-client.js";

const mockServer = {
  registerTool: vi.fn((name: string, schema: any, handler: any) => {
    mockServer._handlers[name] = handler;
    mockServer._schemas[name] = schema;
  }),
  _handlers: {} as Record<string, Function>,
  _schemas: {} as Record<string, any>,
};

vi.mock("../src/services/coolify-client.js", () => ({
  coolifyGet: vi.fn(),
  coolifyPost: vi.fn(),
  coolifyPatch: vi.fn(),
  coolifyDelete: vi.fn(),
  handleCoolifyError: vi.fn((e) => `Error: ${e}`),
}));

import { registerGithubAppTools } from "../src/tools/github-apps.js";

describe("github app tools", () => {
  beforeEach(() => {
    mockServer._handlers = {};
    mockServer._schemas = {};
    vi.clearAllMocks();
    registerGithubAppTools(mockServer as any);
  });

  it("list returns a compact summary by default", async () => {
    vi.mocked(client.coolifyGet).mockResolvedValueOnce([
      { id: 1, uuid: "u", name: "gh", organization: "org", is_public: false, app_id: 9, secret_junk: "x" },
    ]);
    const res = await mockServer._handlers["coolify_list_github_apps"]({ summary: true, instance: "prod" });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed[0]).not.toHaveProperty("secret_junk");
    expect(parsed[0]).toMatchObject({ id: 1, name: "gh" });
  });

  it("get filters the list client-side by id", async () => {
    vi.mocked(client.coolifyGet).mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const res = await mockServer._handlers["coolify_get_github_app"]({ id: 2, instance: "prod" });
    expect(JSON.parse(res.content[0].text)).toMatchObject({ id: 2 });
  });

  it("get returns an error when id is absent", async () => {
    vi.mocked(client.coolifyGet).mockResolvedValueOnce([{ id: 1 }]);
    const res = await mockServer._handlers["coolify_get_github_app"]({ id: 99, instance: "prod" });
    expect(res.isError).toBe(true);
  });

  it("list_repos unwraps { repositories: [] }", async () => {
    vi.mocked(client.coolifyGet).mockResolvedValueOnce({ repositories: [{ name: "r" }] });
    const res = await mockServer._handlers["coolify_list_github_app_repos"]({ id: 1, instance: "prod" });
    expect(JSON.parse(res.content[0].text)).toEqual([{ name: "r" }]);
  });

  it("list_branches encodes owner/repo in the path", async () => {
    vi.mocked(client.coolifyGet).mockResolvedValueOnce([{ name: "main" }]);
    await mockServer._handlers["coolify_list_github_app_branches"]({
      id: 1, owner: "a/b", repo: "c d", instance: "prod",
    });
    expect(client.coolifyGet).toHaveBeenCalledWith(
      "/github-apps/1/repositories/a%2Fb/c%20d/branches", undefined, "prod"
    );
  });

  it("create requires an explicit instance", () => {
    expect(mockServer._schemas["coolify_create_github_app"].inputSchema.instance.safeParse(undefined).success).toBe(false);
  });
});
