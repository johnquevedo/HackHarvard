import { afterEach, expect, it, vi } from "vitest";
import { voiceLine } from "./voice.ts";

afterEach(() => vi.unstubAllEnvs());

it("returns the canonical first line under test", () => {
  expect(voiceLine("t.canonical", ["first", "second", "third"])).toBe("first");
});

it("live runs skip the canonical line and never repeat back to back", () => {
  vi.stubEnv("VITEST", "");
  vi.stubEnv("NODE_ENV", "production");
  const variants = ["canonical", "a", "b", "c"];
  let previous = "";
  for (let i = 0; i < 50; i++) {
    const line = voiceLine("t.live", variants);
    expect(line).not.toBe("canonical");
    expect(line).not.toBe(previous);
    previous = line;
  }
});
