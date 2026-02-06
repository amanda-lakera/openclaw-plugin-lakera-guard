/**
 * Lakera Guard OpenClaw plugin.
 * Screens each tool call with Lakera /v2/guard (OpenAI completions format) and blocks if flagged.
 */

const LAKERA_GUARD_URL = "https://api.lakera.ai/v2/guard";

type Config = {
  apiKey: string;
  projectId?: string;
  timeoutMs?: number;
};

type GuardResponse = {
  flagged?: boolean;
  metadata?: { request_uuid?: string };
};

/** OpenAI-style assistant message with tool_calls for Lakera. */
type GuardMessage =
  | { role: string; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls: Array<{ name: string; arguments: string }>;
    };

async function callLakeraGuard(params: {
  apiKey: string;
  projectId?: string;
  timeoutMs: number;
  messages: GuardMessage[];
}): Promise<GuardResponse> {
  const body: Record<string, unknown> = {
    messages: params.messages,
  };
  if (params.projectId?.trim()) {
    body.project_id = params.projectId.trim();
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(LAKERA_GUARD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: params.apiKey.startsWith("Bearer ") ? params.apiKey : `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Lakera Guard ${res.status}: ${text}`);
    }
    return (await res.json()) as GuardResponse;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

function getConfig(api: { pluginConfig?: Record<string, unknown> }): Config | null {
  const c = api.pluginConfig as Record<string, unknown> | undefined;
  const key = c?.apiKey;
  if (typeof key !== "string" || !key.trim()) {
    return null;
  }
  const timeoutMs =
    typeof c?.timeoutMs === "number" && c.timeoutMs > 0 ? c.timeoutMs : 5000;
  return {
    apiKey: key.trim(),
    projectId: typeof c?.projectId === "string" ? c.projectId : undefined,
    timeoutMs,
  };
}

export default function register(api: {
  pluginConfig?: Record<string, unknown>;
  on: (
    name: string,
    handler: (
      event: { toolName: string; params: Record<string, unknown> },
      ctx: { toolName: string; agentId?: string; sessionKey?: string },
    ) => Promise<{ block?: boolean; blockReason?: string } | void>,
  ) => void;
  logger: { warn: (msg: string) => void };
}) {
  const config = getConfig(api);
  if (!config) {
    api.logger.warn("openclaw-plugin-lakera-guard plugin: apiKey not configured; plugin no-op");
    return;
  }

  api.on("before_tool_call", async (event) => {
    // Lakera expects OpenAI completions format with assistant tool_calls.
    const messages: GuardMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            name: event.toolName,
            arguments: JSON.stringify(event.params),
          },
        ],
      },
    ];

    try {
      const result = await callLakeraGuard({
        apiKey: config.apiKey,
        projectId: config.projectId,
        timeoutMs: config.timeoutMs,
        messages,
      });

      if (result.flagged) {
        return {
          block: true,
          blockReason: "Tool call flagged by Lakera Guard",
        };
      }
    } catch (err) {
      api.logger.warn(`openclaw-plugin-lakera-guard: guard request failed: ${String(err)}`);
      // On API failure, do not block the tool (fail open). Change to block for fail-closed.
    }
  });
}
