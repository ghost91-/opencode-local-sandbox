export type SandboxBackend = "nono" | "fence" | "srt";

const SUPPORTED_BACKENDS: ReadonlySet<string> = new Set<SandboxBackend>(["nono", "fence", "srt"]);

type SandboxConfig = {
  sandbox: SandboxBackend;
  profile: string | undefined;
};

const backendBinaries: Record<SandboxBackend, string> = {
  nono: "nono",
  fence: "fence",
  srt: "srt",
};

export function resolve(rawOptions: unknown): SandboxConfig {
  const envSandbox = process.env.OLS_SANDBOX;
  const envProfile = process.env.OLS_PROFILE;

  let sandbox: SandboxBackend | undefined;
  let profile: string | undefined;

  if (typeof rawOptions === "object" && rawOptions !== null) {
    if (
      "sandbox" in rawOptions &&
      typeof rawOptions.sandbox === "string" &&
      rawOptions.sandbox.length > 0 &&
      SUPPORTED_BACKENDS.has(rawOptions.sandbox)
    ) {
      sandbox = rawOptions.sandbox as SandboxBackend;
    }
    if (
      "profile" in rawOptions &&
      typeof rawOptions.profile === "string" &&
      rawOptions.profile.length > 0
    ) {
      profile = rawOptions.profile;
    }
  }

  if (
    typeof envSandbox === "string" &&
    envSandbox.length > 0 &&
    SUPPORTED_BACKENDS.has(envSandbox)
  ) {
    sandbox = envSandbox as SandboxBackend;
  }
  if (typeof envProfile === "string" && envProfile.length > 0) {
    profile = envProfile;
  }

  const resolvedSandbox = sandbox ?? "nono";
  const resolvedProfile = profile ?? (resolvedSandbox === "nono" ? "opencode" : undefined);

  return {
    sandbox: resolvedSandbox,
    profile: resolvedProfile,
  };
}

export async function detectBackend(): Promise<SandboxBackend | null> {
  const { isBinaryOnPath } = await import("./utils.ts");
  for (const [backend, binary] of Object.entries(backendBinaries)) {
    if (await isBinaryOnPath(binary)) {
      return backend as SandboxBackend;
    }
  }
  return null;
}
