import { stubEnv, unstubAllEnvs } from "#test/env";
import assert from "node:assert";
import { afterEach, describe, it } from "node:test";

import { resolve } from "./config.ts";

afterEach(() => {
  unstubAllEnvs();
});

describe("resolve", () => {
  it("returns default config when no options or env", () => {
    assert.deepStrictEqual(resolve(undefined), {
      sandbox: "nono",
      profile: "opencode",
    });
  });

  it("returns default config when options is empty object", () => {
    assert.deepStrictEqual(resolve({}), {
      sandbox: "nono",
      profile: "opencode",
    });
  });

  it("reads sandbox from options", () => {
    assert.deepStrictEqual(resolve({ sandbox: "fence" }), {
      sandbox: "fence",
      profile: undefined,
    });
  });

  it("reads profile from options", () => {
    assert.deepStrictEqual(resolve({ profile: "custom" }), {
      sandbox: "nono",
      profile: "custom",
    });
  });

  it("reads both sandbox and profile from options", () => {
    assert.deepStrictEqual(resolve({ sandbox: "srt", profile: "custom" }), {
      sandbox: "srt",
      profile: "custom",
    });
  });

  it("ignores non-string sandbox in options", () => {
    assert.deepStrictEqual(resolve({ sandbox: 42 as any }), {
      sandbox: "nono",
      profile: "opencode",
    });
  });

  it("ignores empty string sandbox in options", () => {
    assert.deepStrictEqual(resolve({ sandbox: "" }), {
      sandbox: "nono",
      profile: "opencode",
    });
  });

  it("ignores non-string profile in options", () => {
    assert.deepStrictEqual(resolve({ profile: 42 }), {
      sandbox: "nono",
      profile: "opencode",
    });
  });

  it("ignores empty string profile in options", () => {
    assert.deepStrictEqual(resolve({ profile: "" }), {
      sandbox: "nono",
      profile: "opencode",
    });
  });

  it("env variable OLS_SANDBOX overrides options", () => {
    stubEnv("OLS_SANDBOX", "srt");
    assert.deepStrictEqual(resolve({ sandbox: "fence" }), {
      sandbox: "srt",
      profile: undefined,
    });
  });

  it("env variable OLS_PROFILE overrides options", () => {
    stubEnv("OLS_PROFILE", "from-env");
    assert.deepStrictEqual(resolve({ profile: "from-options" }), {
      sandbox: "nono",
      profile: "from-env",
    });
  });

  it("both env variables work together", () => {
    stubEnv("OLS_SANDBOX", "fence");
    stubEnv("OLS_PROFILE", "env-profile");
    assert.deepStrictEqual(resolve({ sandbox: "nono", profile: "opt-profile" }), {
      sandbox: "fence",
      profile: "env-profile",
    });
  });

  it("ignores empty env variables", () => {
    stubEnv("OLS_SANDBOX", "");
    stubEnv("OLS_PROFILE", "");
    assert.deepStrictEqual(resolve({ sandbox: "fence", profile: "from-options" }), {
      sandbox: "fence",
      profile: "from-options",
    });
  });

  it("returns undefined profile when sandbox is fence and no profile set", () => {
    assert.deepStrictEqual(resolve({ sandbox: "fence" }), {
      sandbox: "fence",
      profile: undefined,
    });
  });

  it("returns undefined profile when sandbox is srt and no profile set", () => {
    assert.deepStrictEqual(resolve({ sandbox: "srt" }), {
      sandbox: "srt",
      profile: undefined,
    });
  });
});
