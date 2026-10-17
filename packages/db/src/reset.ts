import { rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { pushDbSchema } from "./push.ts";
export async function resetDb(url: string): Promise<void> {
  const path = url.replace(/^file:/, "");
  if (path === ":memory:")
    throw new Error("Use createTestPlatform for in-memory databases");
  for (const suffix of ["", "-wal", "-shm"])
    rmSync(path + suffix, { force: true });
  await pushDbSchema(path);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const path = resolve(
    process.env.INIT_CWD ?? process.cwd(),
    (process.env.DATABASE_URL ?? "file:./data/dennis.db").replace(/^file:/, ""),
  );
  await resetDb(path);
}
