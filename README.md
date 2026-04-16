# opencode-local-sandbox

[OpenCode](https://opencode.ai) plugin that runs bash commands inside a local OS-level sandbox. Adds a `bash_sandboxed` tool with filesystem and network isolation, while keeping the built-in `bash` tool as an escape hatch.

Supports multiple sandbox backends with automatic detection:

- [nono](https://nono.sh/)
- [fence](https://fencesandbox.com/)
- [srt](https://github.com/anthropics/sandbox-runtime) (Anthropic Sandbox Runtime)

Not affiliated with OpenCode or any sandbox backend.

## Installation

```bash
opencode plugin --global opencode-local-sandbox@latest
```

At least one sandbox backend must be on your PATH. The plugin auto-detects available backends (tries `nono`, then `fence`, then `srt`) and warns if none are found.

## Configuration

Configure via plugin options:

```jsonc
{
  "plugin": [
    ["opencode-local-sandbox@latest", { "sandbox": "fence", "profile": "/path/to/settings.json" }],
  ],
}
```

Options:

- `sandbox`: Which backend to use (`"nono"`, `"fence"`, or `"srt"`). Auto-detects if not specified.
- `profile`: For nono, a profile name (default: `opencode`). For fence and srt, a path to a settings file. Use absolute paths, especially in global configs; relative paths resolve against the sandbox CLI's working directory at runtime, which varies per project.

Environment variables override options:

- `OLS_SANDBOX` - Backend to use
- `OLS_PROFILE` - Profile name or path

## How It Works

`bash_sandboxed` spawns the configured sandbox CLI with your command. Invocation differs by backend:

- **nono**: `nono run -s -p <profile> -- <shell> -c <command>` (banner suppressed with `-s`; profile is a name)
- **fence**: `fence -s <settings-path> -c <command>` (`-s` is the path to a settings JSON file; omitted when no profile is set; use absolute paths)
- **srt**: `srt -s <settings-path> -c <command>` (same as fence; omitted when no profile is set)

A `tool.definition` hook modifies the built-in `bash` tool description to steer the LLM toward `bash_sandboxed`. A `tool.execute.before` hook blocks the built-in `bash` tool unless the same command was already attempted with `bash_sandboxed` in the current session. The LLM always tries the sandboxed path first and falls back to `bash` only when sandbox restrictions block the command.

## Permissions

`bash_sandboxed` uses its own permission name. Since opencode does not restrict this tool by default, commands run without prompting unless you override the setting.

### Recommended setup

For a workflow where sandboxed commands run freely and you are prompted only when the agent escapes the sandbox, set `bash_sandboxed` to `allow` and `bash` to `ask`:

```jsonc
{
  "permission": {
    "bash_sandboxed": "allow",
    "bash": "ask",
  },
}
```

The sandbox profile enforces all restrictions. The agent runs commands through `bash_sandboxed` without prompting; you are asked for permission only when it falls back to the unsandboxed `bash` tool.

### What is and isn't sandboxed

Only `bash_sandboxed` is sandboxed. All other OpenCode tools (`read`, `write`, `edit`, `glob`, `grep`, `webfetch`, `task`, etc.) use OpenCode's regular permission system.

## Disclaimer

This plugin wraps third-party sandboxing tools. It does not guarantee security. Isolation effectiveness depends entirely on the sandbox backend and its configuration. Misconfigured sandboxes may allow escape. Review your sandbox backend's documentation and security model before relying on it.

## Development

```bash
pnpm install
pnpm run check
pnpm run build
```
