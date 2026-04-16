export async function isBinaryOnPath(binary: string): Promise<boolean> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolvePromise) => {
    const child = spawn("which", [binary], { stdio: "ignore" });
    child.once("error", () => resolvePromise(false));
    child.once("close", (code) => resolvePromise(code === 0));
  });
}

const SHELL_BLACKLIST = new Set(["fish", "nu"]);

export function detectShell(): string {
  if (process.env.SHELL && !SHELL_BLACKLIST.has(shellName(process.env.SHELL)))
    return process.env.SHELL;
  if (process.platform === "darwin") return "/bin/zsh";
  return "/bin/sh";
}

export function shellName(path: string): string {
  return path.split("/").pop() ?? "";
}

export function commandPrefixes(command: string): string[] {
  const prefixes: string[] = [];
  for (const part of command.split(/&&|;|\|/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    if (tokens[0]) prefixes.push(tokens[0] + " *");
  }
  return prefixes;
}
