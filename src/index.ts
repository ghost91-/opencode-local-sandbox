import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin";
import type { Part, ToolPart } from "@opencode-ai/sdk";

import { createBashSandboxedTool } from "./bash_sandboxed.ts";
import { detectBackend, resolve } from "./config.ts";
import { isBinaryOnPath } from "./utils.ts";

const PLUGIN_NAME = "opencode-local-sandbox";

function isToolPart(p: Part): p is ToolPart {
  return p.type === "tool";
}

function bashSandboxedAttempted(parts: Part[], command: string): boolean {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (!p || !isToolPart(p) || p.tool !== "bash_sandboxed") continue;
    const cmd = p.state.input["command"];
    if (cmd === command) return true;
  }
  return false;
}

const server: Plugin = async ({ client }, rawOptions) => {
  const cfg = resolve(rawOptions);
  const detected = await detectBackend();

  if (cfg.sandbox) {
    const available = await isBinaryOnPath(cfg.sandbox);
    if (!available) {
      await client.app.log({
        body: {
          service: PLUGIN_NAME,
          level: "warn",
          message: `Configured sandbox backend '${cfg.sandbox}' not found on PATH. bash_sandboxed tool will not be registered.`,
        },
      });
      return {};
    }
  } else if (!detected) {
    await client.app.log({
      body: {
        service: PLUGIN_NAME,
        level: "warn",
        message: `No sandbox backend found on PATH (tried: nono, fence, srt). bash_sandboxed tool will not be registered.`,
      },
    });
    return {};
  }

  const backend = cfg.sandbox ?? detected!;

  return {
    tool: {
      bash_sandboxed: createBashSandboxedTool(backend, cfg.profile),
    },
    "tool.definition": async (input, output) => {
      if (input.toolID === "bash") {
        const warning = `STOP: You MUST use \`bash_sandboxed\` instead of this tool for ALL commands. \`bash_sandboxed\` runs commands inside a ${backend} sandbox with filesystem and network isolation. You must try the command in \`bash_sandboxed\` first; \`bash\` will only allow the call through if a prior \`bash_sandboxed\` attempt for the same command exists in the session (typically because \`bash_sandboxed\` failed due to sandbox restrictions).`;
        output.description = warning + "\n\n" + output.description;
      }
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return;
      const command = (output.args as { command?: string })?.command;
      if (!command) return;
      const res = await client.session.messages({
        path: { id: input.sessionID },
      });
      const msgs = res.data ?? [];
      const allParts = msgs.flatMap((m) => m.parts);
      if (!bashSandboxedAttempted(allParts, command)) {
        throw new Error(
          `First try your command with \`bash_sandboxed\`. If \`bash_sandboxed\` fails due to sandbox restrictions, retry with \`bash\`. No prior \`bash_sandboxed\` attempt found for: ${command}`,
        );
      }
    },
  } satisfies Hooks;
};

export default { id: PLUGIN_NAME, server } satisfies PluginModule;
