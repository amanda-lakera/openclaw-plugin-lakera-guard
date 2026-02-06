# Lakera Guard OpenClaw Plugin

Screens every tool call with [Lakera Guard](https://www.lakera.ai/) and blocks execution when content is flagged.

## Install

From this repo (link or copy into OpenClaw's extensions):

```bash
openclaw plugins install -l /path/to/lakera-openclaw-plugin
```

Or from npm (when published):

```bash
openclaw plugins install @lakera/openclaw-plugin
```

## Configure

Set your Lakera API key and optional project ID under the plugin config:

```json
{
  "plugins": {
    "entries": {
      "lakera-guard": {
        "enabled": true,
        "config": {
          "apiKey": "your-lakera-api-key",
          "projectId": "your-project-id",
          "timeoutMs": 5000
        }
      }
    }
  }
}
```

- **apiKey** (required): From [Lakera Dashboard](https://platform.lakera.ai/).
- **projectId** (optional): Lakera project for policy; omit to use default policy.
- **timeoutMs** (optional): Request timeout; default 5000.

Restart the OpenClaw gateway after enabling or changing config.

## Behavior

- Before each tool runs, the plugin sends the tool name and parameters to `https://api.lakera.ai/v2/guard` in OpenAI chat completions format.
- If the response has `flagged: true`, the tool call is blocked and the user sees a block reason.
- If the Guard request fails (network/API error), the tool is **not** blocked (fail-open). Edit the plugin to block on error for fail-closed.

## Testing

### Unit tests (no API key needed)

From the plugin directory:

```bash
pnpm install
pnpm test
```

Tests mock the Lakera API and assert that the plugin sends the correct assistant `tool_calls` payload and blocks (or allows) based on the `flagged` response.

### Manual test with OpenClaw

1. Install and enable the plugin in OpenClaw (see Install and Configure above), then restart the gateway.
2. Trigger a tool call, e.g. run the agent and ask for something that uses a tool:
   ```bash
   openclaw agent --message "What's the weather in London?"
   ```
3. In the [Lakera Dashboard](https://platform.lakera.ai/) you can inspect requests and flagging. To verify blocking: use a test policy that flags a specific tool or argument pattern, or call the Guard API directly with a known-bad payload and confirm the same call is blocked when triggered via OpenClaw.
