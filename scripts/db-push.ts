import { pathToFileURL } from "node:url";
import path from "node:path";

const href = pathToFileURL(path.resolve("packages/db/src/push.ts")).href;
const importer = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<{ pushDbSchema: (url?: string) => Promise<void> }>;
const db = await importer(href);
await db.pushDbSchema();
