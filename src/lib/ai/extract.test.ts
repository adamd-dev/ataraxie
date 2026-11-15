import { afterEach, describe, expect, it, vi } from "vitest";
import { activeProvider } from "./extract";

describe("activeProvider", () => {
  afterEach(() => vi.unstubAllEnvs());

  const env = (vars: Record<string, string>) => {
    for (const k of ["AI_PROVIDER", "META_API_KEY", "ANTHROPIC_API_KEY"]) vi.stubEnv(k, vars[k] ?? "");
  };

  it("is disabled without keys", () => {
    env({});
    expect(activeProvider()).toBeNull();
  });

  it("prefers Meta when both keys are set and AI_PROVIDER is empty", () => {
    env({ META_API_KEY: "m", ANTHROPIC_API_KEY: "a" });
    expect(activeProvider()).toBe("meta");
  });

  it("follows AI_PROVIDER", () => {
    env({ AI_PROVIDER: "claude", META_API_KEY: "m", ANTHROPIC_API_KEY: "a" });
    expect(activeProvider()).toBe("claude");
  });

  it("is disabled when AI_PROVIDER names a provider without a key", () => {
    env({ AI_PROVIDER: "claude", META_API_KEY: "m" });
    expect(activeProvider()).toBeNull();
  });
});
