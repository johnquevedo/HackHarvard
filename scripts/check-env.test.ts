import { describe, expect, it } from "vitest";
import { prefixProblems } from "./check-env";

describe("demo check", () => {
  it("checks prefixes without echoing the secret", () => {
    const problems = prefixProblems({ PHOTON_API_KEY: "not-a-photon-key" });
    expect(problems[0]).toContain("PHOTON_API_KEY");
    expect(problems[0]).not.toContain("not-a-photon-key");
    expect(prefixProblems({ PHOTON_API_KEY: "pho_sk_example" })).toEqual([]);
  });

  it("accepts Spectrum project credentials without legacy Beta fields", () => {
    expect(
      prefixProblems({
        PHOTON_PROJECT_ID: "313967b8-9f3b-4b02-ba58-aff4bf9a9044",
        PHOTON_PROJECT_SECRET: "secret-is-never-echoed",
      }),
    ).toEqual([]);
  });
});
