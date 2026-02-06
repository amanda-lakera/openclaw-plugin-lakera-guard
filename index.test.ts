import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "./index.ts";

const LAKERA_GUARD_URL = "https://api.lakera.ai/v2/guard";

describe("lakera-guard plugin", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let capturedHandler: (event: { toolName: string; params: Record<string, unknown> }, ctx: unknown) => Promise<{ block?: boolean; blockReason?: string } | void>;
  let warnLog: string[];

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    warnLog = [];
    capturedHandler = undefined!;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createApi(pluginConfig: Record<string, unknown> = { apiKey: "test-key" }) {
    return {
      pluginConfig,
      on(_name: string, handler: typeof capturedHandler) {
        if (_name === "before_tool_call") capturedHandler = handler;
      },
      logger: { warn: (msg: string) => warnLog.push(msg) },
    };
  }

  it("registers no handler when apiKey is missing", () => {
    register(createApi({}));
    expect(capturedHandler).toBeUndefined();
    expect(warnLog).toContain("lakera-guard plugin: apiKey not configured; plugin no-op");
  });

  it("sends assistant message with tool_calls to Lakera and blocks when flagged", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ flagged: true }),
    });

    register(createApi());
    expect(capturedHandler).toBeDefined();

    const result = await capturedHandler(
      { toolName: "get_weather", params: { location: "London" } },
      { toolName: "get_weather", agentId: "main", sessionKey: "main" },
    );

    expect(result).toEqual({
      block: true,
      blockReason: "Tool call flagged by Lakera Guard",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      LAKERA_GUARD_URL,
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
      }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.messages).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [{ name: "get_weather", arguments: '{"location":"London"}' }],
      },
    ]);
  });

  it("does not block when Lakera returns flagged: false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ flagged: false }),
    });

    register(createApi());
    const result = await capturedHandler(
      { toolName: "read_file", params: { path: "/tmp/foo" } },
      {},
    );

    expect(result).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.messages[0].tool_calls[0]).toEqual({
      name: "read_file",
      arguments: '{"path":"/tmp/foo"}',
    });
  });

  it("sends project_id when configured", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ flagged: false }),
    });

    register(createApi({ apiKey: "key", projectId: "proj-123" }));
    await capturedHandler({ toolName: "run", params: {} }, {});

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.project_id).toBe("proj-123");
  });

  it("fails open on API error (does not block)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    register(createApi());
    const result = await capturedHandler(
      { toolName: "exec", params: { cmd: "ls" } },
      {},
    );

    expect(result).toBeUndefined();
    expect(warnLog.some((m) => m.includes("guard request failed"))).toBe(true);
  });
});
