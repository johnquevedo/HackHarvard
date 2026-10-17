import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as core from "./schema/core.ts";
import * as purchasing from "./schema/purchasing.ts";
import * as shortme from "./schema/shortme.ts";
import { pathToFileURL } from "node:url";
function normalize(sql: string): string {
  return sql
    .replace(/IF NOT EXISTS/gi, "")
    .replace(/[`"\[\]]/g, "")
    .replace(/\s+/g, "")
    .replace(/;$/g, "")
    .toLowerCase();
}
export async function pushDbSchema(url?: string): Promise<void> {
  const target = resolve(
    process.env.INIT_CWD ?? process.cwd(),
    (url ?? process.env.DATABASE_URL ?? "file:./data/dennis.db").replace(
      /^file:/,
      "",
    ),
  );
  mkdirSync(dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  try {
    const empty = await generateSQLiteDrizzleJson({});
    const current = await generateSQLiteDrizzleJson({
      ...core,
      ...purchasing,
      ...shortme,
    });
    const statements = await generateSQLiteMigration(empty, current);
    const missing: string[] = [];
    for (const statement of statements) {
      const match = statement.match(
        /^CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+[`"]([^`"]+)[`"]/i,
      );
      if (!match) throw new Error("Unsupported schema statement");
      const stored = db
        .prepare("SELECT sql FROM sqlite_master WHERE type=? AND name=?")
        .get(match[1]!.toLowerCase(), match[2]!) as { sql: string } | undefined;
      if (!stored) missing.push(statement);
      else if (normalize(stored.sql) !== normalize(statement))
        throw new Error(
          `Schema drift in ${match[2]}. This demo uses disposable state; run db:reset to rebuild. No existing rows were changed.`,
        );
    }
    db.transaction(() => {
      for (const statement of missing) db.exec(statement);
    })();
    process.stdout.write(
      `Schema ready; ${missing.length} definitions applied.\n`,
    );
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await pushDbSchema();
