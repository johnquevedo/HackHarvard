import gatesJson from "../rules/milestone-gates.json" with { type: "json" };
import type { MilestoneGates } from "./detector/gates";

export const GATES: MilestoneGates = gatesJson as unknown as MilestoneGates;

export const TEMPLATE_KEY = "recruiting_v1";
export const RESOLUTION_CRITERIA =
  "Resolved by the demo resolver, a STAND-IN FOR OFFICIAL SOURCE, and only after the subject confirms. Any dispute freezes points.";
export const DEMO_RESOLVER = "demo_resolver";
export const STAND_IN_LABEL = "STAND-IN FOR OFFICIAL SOURCE";
export const PRIVATE_DRAFT_HEADLINE = "ShortMe draft (private to its subject)";

export function approvalTtlMinutes(isDemo: boolean): number {
  return isDemo ? GATES.approvalTtlMinutes : GATES.approvalTtlMinutesNonDemo;
}

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

// 4-character invite code, unique among the codes passed in (the user's open invitations).
export function newInviteCode(
  taken: Set<string>,
  random: () => number = Math.random,
): string {
  for (let i = 0; i < 200; i++) {
    let code = "";
    for (let j = 0; j < 4; j++)
      code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
    if (!taken.has(code)) return code;
  }
  throw new Error("could not allocate an invite code");
}
