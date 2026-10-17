import { describe, expect, it } from "vitest";
import { prefixProblems } from "./check-env";

describe("demo check", () => {
  it("checks prefixes without echoing the secret", () => {
    const problems = prefixProblems({ PHOTON_API_KEY: "not-a-photon-key" });
    expect(problems[0]).toContain("PHOTON_API_KEY");
    expect(problems[0]).not.toContain("not-a-photon-key");
    expect(prefixProblems({ PHOTON_API_KEY: "pho_sk_example" })).toEqual([]);
  });
});
