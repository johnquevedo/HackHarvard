import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ChangeStatus = "A" | "M" | "D";

export interface OwnershipMap {
  agents: Record<string, string[]>;
  reviewBranches?: Record<string, { agents: string[]; reason: string }>;
}

const FIXTURE_AREA: Record<string, string> = {
  a1: "fixtures/photon/",
  a2: "fixtures/nessie/",
  a3: "fixtures/llm/",
  a4: "fixtures/replay/",
};

export function loadOwnership(file = "ownership.json"): OwnershipMap {
  return JSON.parse(readFileSync(file, "utf8")) as OwnershipMap;
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function globMatch(glob: string, filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const pattern = glob.replace(/\\/g, "/");
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  const body = pattern
    .split("*")
    .map((part) => escapeRegex(part))
    .join("[^/]*");
  return new RegExp(`^${body}$`).test(normalized);
}

export function isPathAllowed(
  agent: string,
  filePath: string,
  status: ChangeStatus,
  ownership: OwnershipMap,
): boolean {
  const file = filePath.replace(/\\/g, "/");
  const globs = ownership.agents[agent] ?? [];
  if (globs.some((glob) => globMatch(glob, file))) return true;
  if (file === "docs/CONTRACT_REQUESTS.md" && status !== "D") return true;
  if (file.startsWith("tests/cross/") && status === "A") return true;
  if (file.startsWith(`tests/cross/${agent}-`) && status !== "D") return true;
  const fixture = FIXTURE_AREA[agent];
  if (fixture && file.startsWith(fixture) && status === "A") return true;
  return false;
}

export function agentFromBranch(branch: string): string | null {
  const match = /^(a[1-4])\//.exec(branch);
  return match?.[1] ?? null;
}

export function parseNameStatus(text: string): { status: ChangeStatus; file: string }[] {
  const changes: { status: ChangeStatus; file: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [rawStatus, file] = line.split(/\s+/, 2);
    if (!rawStatus || !file) continue;
    const status = rawStatus[0];
    if (status === "A" || status === "M" || status === "D") {
      changes.push({ status, file });
    } else if (status === "R" || status === "C") {
      const parts = line.split(/\s+/);
      const next = parts[parts.length - 1];
      if (next) changes.push({ status: "A", file: next });
    }
  }
  return changes;
}

function git(args: string): string {
  return execSync(`git ${args}`, { encoding: "utf8" }).trim();
}

export function changedFilesAgainstMain(): { status: ChangeStatus; file: string }[] {
  let base = "origin/main";
  try {
    git("rev-parse --verify origin/main");
  } catch {
    base = "main";
  }
  const committed = parseNameStatus(git(`diff --name-status ${base}...HEAD`));
  const staged = parseNameStatus(git("diff --name-status --cached"));
  const unstaged = parseNameStatus(git("diff --name-status"));
  const untracked = git("ls-files --others --exclude-standard")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => ({ status: "A" as const, file }));
  const merged = new Map<string, ChangeStatus>();
  for (const change of [...committed, ...staged, ...unstaged, ...untracked]) {
    merged.set(change.file, change.status);
  }
  return [...merged.entries()].map(([file, status]) => ({ file, status }));
}

export function findViolations(
  agent: string,
  changes: { status: ChangeStatus; file: string }[],
  ownership: OwnershipMap,
): string[] {
  return changes
    .filter((change) => !isPathAllowed(agent, change.file, change.status, ownership))
    .map((change) => `${change.status} ${change.file}`);
}

export function findBranchViolations(
  branch: string,
  changes: { status: ChangeStatus; file: string }[],
  ownership: OwnershipMap,
): string[] {
  const agent = agentFromBranch(branch);
  const agents = ownership.reviewBranches?.[branch]?.agents ?? (agent ? [agent] : []);
  return changes
    .filter(
      (change) =>
        !agents.some((owner) => isPathAllowed(owner, change.file, change.status, ownership)),
    )
    .map((change) => `${change.status} ${change.file}`);
}

function main(): void {
  const branch = process.env.OWNERSHIP_BRANCH ?? git("rev-parse --abbrev-ref HEAD");
  const agent = agentFromBranch(branch);
  if (!agent) {
    console.log(`ownership check skipped on branch ${branch}`);
    return;
  }
  const ownership = loadOwnership(path.resolve("ownership.json"));
  const violations = findBranchViolations(branch, changedFilesAgainstMain(), ownership);
  if (violations.length > 0) {
    console.error(`ownership check failed for ${agent}:`);
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
  }
  const review = ownership.reviewBranches?.[branch];
  console.log(
    review
      ? `ownership check passed for review branch (${review.agents.join(", ")}): ${review.reason}`
      : `ownership check passed for ${agent}`,
  );
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry && fileURLToPath(import.meta.url) === entry) {
  main();
}
