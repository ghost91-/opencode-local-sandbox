import type { ToolResult } from "@opencode-ai/plugin";

import { stubEnv, unstubAllEnvs } from "#test/env";
import { Effect } from "effect";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { createBashSandboxedTool, buildCommand } from "./bash_sandboxed.ts";
import { detectBackend, type SandboxBackend } from "./config.ts";

function resultOutput(r: ToolResult): string {
  return typeof r === "string" ? r : r.output;
}

afterEach(() => {
  unstubAllEnvs();
});

function tmpdir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-test-"));
}

describe("createBashSandboxedTool", () => {
  it("returns a tool definition with the expected shape", () => {
    const t = createBashSandboxedTool("nono", "test-profile");
    assert.strictEqual(typeof t.description, "string");
    assert.ok(t.description.includes("nono"));
    assert.ok(t.args.command);
    assert.ok(t.args.timeout);
    assert.ok(t.args.workdir);
    assert.ok(t.args.description);
    assert.strictEqual(typeof t.execute, "function");
  });

  it("includes backend name in description", () => {
    const t = createBashSandboxedTool("fence", "test-profile");
    assert.ok(t.description.includes("fence"));
  });

  it("shows detected shell name in description", () => {
    const t = createBashSandboxedTool("nono", "test-profile");
    assert.match(t.description, /Shell: \w+/);
  });

  it("uses SHELL env var for shell detection", () => {
    stubEnv("SHELL", "/bin/zsh");
    const t = createBashSandboxedTool("nono", "test-profile");
    assert.ok(t.description.includes("Shell: zsh"));
  });

  it("falls back for blacklisted shells", () => {
    stubEnv("SHELL", "/usr/bin/fish");
    const t = createBashSandboxedTool("nono", "test-profile");
    assert.match(t.description, /Shell: (sh|zsh)/);
    assert.ok(!t.description.includes("Shell: fish"));
  });
});

describe("detectBackend", () => {
  it("returns a backend or null", async () => {
    const result = await detectBackend();
    assert.ok(result === null || ["nono", "fence", "srt"].includes(result));
  });
});

describe("execute", () => {
  it("runs a command through sandbox and returns output", async () => {
    const backend = await detectBackend();
    if (!backend) return;

    const dir = await tmpdir();
    try {
      const t = createBashSandboxedTool(backend, "opencode");
      const result = await t.execute(
        {
          command: "echo hello",
          description: "Print hello",
        },
        {
          sessionID: "test",
          messageID: "test",
          agent: "test",
          directory: dir,
          worktree: dir,
          abort: new AbortController().signal,
          metadata: () => {},
          ask: () => Effect.void,
        } as any,
      );
      assert.ok(resultOutput(result).includes("hello"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("respects workdir parameter", async () => {
    const backend = await detectBackend();
    if (!backend) return;

    const dir = await tmpdir();
    const subdir = path.join(dir, "sub");
    await fs.mkdir(subdir);
    try {
      const t = createBashSandboxedTool(backend, "opencode");
      const result = await t.execute(
        {
          command: "pwd",
          workdir: subdir,
          description: "Print working directory",
        },
        {
          sessionID: "test",
          messageID: "test",
          agent: "test",
          directory: dir,
          worktree: dir,
          abort: new AbortController().signal,
          metadata: () => {},
          ask: () => Effect.void,
        } as any,
      );
      assert.ok(resultOutput(result).includes("sub"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("appends bash_metadata on timeout", async () => {
    const backend = await detectBackend();
    if (!backend) return;

    const dir = await tmpdir();
    try {
      const t = createBashSandboxedTool(backend, "opencode");
      const result = await t.execute(
        {
          command: "sleep 10",
          timeout: 100,
          description: "Sleep with short timeout",
        },
        {
          sessionID: "test",
          messageID: "test",
          agent: "test",
          directory: dir,
          worktree: dir,
          abort: new AbortController().signal,
          metadata: () => {},
          ask: () => Effect.void,
        } as any,
      );
      assert.ok(resultOutput(result).includes("<bash_metadata>"));
      assert.ok(resultOutput(result).includes("timeout"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("appends bash_metadata on abort", async () => {
    const backend = await detectBackend();
    if (!backend) return;

    const dir = await tmpdir();
    const ac = new AbortController();
    try {
      const t = createBashSandboxedTool(backend, "opencode");
      const promise = t.execute(
        {
          command: "sleep 10",
          description: "Sleep then abort",
        },
        {
          sessionID: "test",
          messageID: "test",
          agent: "test",
          directory: dir,
          worktree: dir,
          abort: ac.signal,
          metadata: () => {},
          ask: () => Effect.void,
        } as any,
      );
      setTimeout(() => ac.abort(), 100);
      const result = await promise;
      assert.ok(resultOutput(result).includes("<bash_metadata>"));
      assert.ok(resultOutput(result).includes("aborted"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildCommand", () => {
  it("builds nono command with shell wrapper", () => {
    const args = buildCommand("nono" as SandboxBackend, "my-profile", "echo hello");
    assert.deepStrictEqual(args.slice(0, 4), ["run", "-s", "-p", "my-profile"]);
    assert.ok(args[args.length - 1] === "echo hello");
  });

  it("builds fence command without -s flag when profile is undefined", () => {
    const args = buildCommand("fence" as SandboxBackend, undefined, "echo hello");
    assert.deepStrictEqual(args, ["-c", "echo hello"]);
  });

  it("builds fence command with -s flag when profile is set", () => {
    const args = buildCommand("fence" as SandboxBackend, "my-profile", "echo hello");
    assert.deepStrictEqual(args, ["-s", "my-profile", "-c", "echo hello"]);
  });

  it("builds srt command without -s flag when profile is undefined", () => {
    const args = buildCommand("srt" as SandboxBackend, undefined, "echo hello");
    assert.deepStrictEqual(args, ["-c", "echo hello"]);
  });

  it("builds srt command with -s flag when profile is set", () => {
    const args = buildCommand("srt" as SandboxBackend, "my-profile", "echo hello");
    assert.deepStrictEqual(args, ["-s", "my-profile", "-c", "echo hello"]);
  });
});
