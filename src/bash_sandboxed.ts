import { tool, type ToolContext } from "@opencode-ai/plugin";
import { Effect } from "effect";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import type { SandboxBackend } from "./config.ts";

import { commandPrefixes, detectShell, shellName } from "./utils.ts";

const DEFAULT_TIMEOUT = 120_000;
const MAX_METADATA_LENGTH = 30_000;
const TERMINATION_GRACE_PERIOD = 3_000;

type Args = {
  command: string;
  timeout?: number;
  workdir?: string;
  description: string;
};

function preview(text: string): string {
  if (text.length <= MAX_METADATA_LENGTH) return text;
  return text.slice(0, MAX_METADATA_LENGTH) + "\n\n...";
}

export function createBashSandboxedTool(backend: SandboxBackend, profile: string | undefined) {
  return tool({
    description: [
      `Executes a given bash command inside a ${backend} sandbox with OS-level filesystem and network isolation.`,
      "",
      `Be aware: OS: ${process.platform}, Shell: ${shellName(detectShell())}`,
      "",
      "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID using `cd <directory> && <command>` patterns - use `workdir` instead.",
      "",
      "IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.",
      "",
      "Before executing the command, please follow these steps:",
      "",
      "1. Directory Verification:",
      "   - If the command will create new directories or files, first use `ls` to verify the parent directory exists and is the correct location",
      '   - For example, before running "mkdir foo/bar", first use `ls foo` to check that "foo" exists and is the intended parent directory',
      "",
      "2. Command Execution:",
      '   - Always quote file paths that contain spaces with double quotes (e.g., rm "path with spaces/file.txt")',
      "   - Examples of proper quoting:",
      '     - mkdir "/Users/name/My Documents" (correct)',
      "     - mkdir /Users/name/My Documents (incorrect - will fail)",
      '     - python "/path/with spaces/script.py" (correct)',
      "     - python /path/with spaces/script.py (incorrect - will fail)",
      "   - After ensuring proper quoting, execute the command.",
      "   - Capture the output of the command.",
      "",
      "Usage notes:",
      "  - The command argument is required.",
      `  - You can specify an optional timeout in milliseconds. If not specified, commands will time out after ${DEFAULT_TIMEOUT}ms.`,
      "  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.",
      "  - Commands run non-interactively (no stdin).",
      "  - The sandbox enforces filesystem and network restrictions via the sandbox profile.",
      "",
      "  - Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:",
      "    - File search: Use Glob (NOT find or ls)",
      "    - Content search: Use Grep (NOT grep or rg)",
      "    - Read files: Use Read (NOT cat/head/tail)",
      "    - Edit files: Use Edit (NOT sed/awk)",
      "    - Write files: Use Write (NOT echo >/cat <<EOF)",
      "    - Communication: Output text directly (NOT echo/printf)",
      "  - When issuing multiple commands:",
      '    - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two Bash tool calls in parallel.',
      "    - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.",
      "    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail",
      "    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)",
      "  - AVOID using `cd <directory> && <command>`. Use the `workdir` parameter to change directories instead.",
      "    <good-example>",
      '    Use workdir="/foo/bar" with command: pytest tests',
      "    </good-example>",
      "    <bad-example>",
      "    cd /foo/bar && pytest tests",
      "    </bad-example>",
    ].join("\n"),
    args: {
      command: tool.schema.string().describe("The command to execute"),
      timeout: tool.schema.number().min(0).describe("Optional timeout in milliseconds").optional(),
      workdir: tool.schema
        .string()
        .describe(
          "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.",
        )
        .optional(),
      description: tool.schema
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    },
    async execute(args: Args, ctx: ToolContext): Promise<string> {
      const timeout = args.timeout ?? DEFAULT_TIMEOUT;
      const cwd = args.workdir ? resolve(ctx.directory, args.workdir) : ctx.directory;

      await Effect.runPromise(
        ctx.ask({
          permission: "bash_sandboxed",
          patterns: [args.command],
          always: commandPrefixes(args.command),
          metadata: { command: args.command, description: args.description },
        }),
      );

      const sandboxArgs = buildCommand(backend, profile, args.command);

      ctx.metadata({
        title: args.description,
        metadata: { output: "", exit: null, description: args.description },
      });

      const {
        promise,
        resolve: resolvePromise,
        reject: rejectPromise,
      } = Promise.withResolvers<{ buf: string; code: number | null }>();

      let buf = "";
      let expired = false;
      let aborted = false;
      let settled = false;
      let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

      const child = spawn(backend, sandboxArgs, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env as Record<string, string>,
      });

      const clearForceKillTimer = () => {
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
          forceKillTimer = undefined;
        }
      };

      const onData = (chunk: Buffer) => {
        buf += chunk.toString();
        ctx.metadata({
          metadata: {
            output: preview(buf),
            exit: null,
            description: args.description,
          },
        });
      };

      const terminateChild = () => {
        if (forceKillTimer) return;
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, TERMINATION_GRACE_PERIOD);
      };

      const onAbort = () => {
        aborted = true;
        terminateChild();
      };

      const timer = setTimeout(() => {
        expired = true;
        terminateChild();
      }, timeout);

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearForceKillTimer();
        ctx.abort.removeEventListener("abort", onAbort);
        callback();
      };

      child.stdout.on("data", onData);
      child.stderr.on("data", onData);

      if (ctx.abort.aborted) {
        onAbort();
      } else {
        ctx.abort.addEventListener("abort", onAbort, { once: true });
      }

      child.once("error", (error: Error) => {
        finish(() => rejectPromise(error));
      });

      child.once("close", (code: number | null) => {
        finish(() => {
          const meta: string[] = [];
          if (expired) {
            meta.push(
              `bash tool terminated command after exceeding timeout ${timeout} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
            );
          }
          if (aborted) meta.push("User aborted the command");
          if (meta.length > 0) {
            buf += "\n\n<bash_metadata>\n" + meta.join("\n") + "\n</bash_metadata>";
          }

          resolvePromise({ buf, code });
        });
      });

      const result = await promise;

      ctx.metadata({
        title: args.description,
        metadata: {
          output: preview(result.buf),
          exit: result.code,
          description: args.description,
        },
      });

      return result.buf;
    },
  });
}

export function buildCommand(
  backend: SandboxBackend,
  profile: string | undefined,
  command: string,
): string[] {
  const shell = detectShell();

  switch (backend) {
    case "nono":
      return ["run", "-s", "-p", profile!, "--", shell, "-c", command];
    case "fence":
      return profile ? ["-s", profile, "-c", command] : ["-c", command];
    case "srt":
      return profile ? ["-s", profile, "-c", command] : ["-c", command];
  }
}
