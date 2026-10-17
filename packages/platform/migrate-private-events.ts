import { existsSync } from "node:fs";
import { createDb } from "../db/src/index.ts";
import { createClock } from "./src/foundation.ts";
import {
  planLegacyPrivacyMigration,
  applyLegacyPrivacyMigration,
} from "./src/privacy-migration.ts";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write(
    "Usage: DATABASE_URL=file:... pnpm exec tsx packages/platform/migrate-private-events.ts [--apply --allow-audit-payload-rewrite]\nDefault: read-only plan. Applying requires the explicit one-time audit rewrite policy exception. Stop the server and review a database backup first.\n",
  );
} else {
  const apply = args.includes("--apply");
  if (args.some((arg) => !["--apply", "--allow-audit-payload-rewrite"].includes(arg)))
    throw new Error("Unknown migration option");
  if (apply && !args.includes("--allow-audit-payload-rewrite"))
    throw new Error(
      "Review the policy exception and supply --allow-audit-payload-rewrite before applying",
    );
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL === ":memory:")
    throw new Error("Set DATABASE_URL to an existing database file");
  if (!existsSync(process.env.DATABASE_URL.replace(/^file:/, "")))
    throw new Error("DATABASE_URL must identify an existing database file");
  const db = createDb(process.env.DATABASE_URL, { readonly: !apply });
  try {
    process.stdout.write(
      JSON.stringify(
        apply
          ? applyLegacyPrivacyMigration(db, createClock(), { allowAuditPayloadRewrite: true })
          : planLegacyPrivacyMigration(db),
        null,
        2,
      ) + "\n",
    );
  } finally {
    db.$client.close();
  }
}
