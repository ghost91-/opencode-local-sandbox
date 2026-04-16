const env: Record<string, string | undefined> = {};

export function stubEnv(name: string, value: string) {
  if (!(name in env)) {
    env[name] = process.env[name];
  }

  process.env[name] = value;
}

export function unstubAllEnvs() {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    delete env[name];
  }
}
