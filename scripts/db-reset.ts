import { pathToFileURL } from "node:url";
import path from "node:path";

const href = pathToFileURL(path.resolve("packages/db/src/reset.ts")).href;
const importer = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<{ resetDb: (url: string) => Promise<void> }>;
const db = await importer(href);
const databaseUrl = process.env.DATABASE_URL ?? "file:./data/dennis.db";
await db.resetDb(databaseUrl);
