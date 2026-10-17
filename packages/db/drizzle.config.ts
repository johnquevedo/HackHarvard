import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";
const root = process.env.INIT_CWD ?? process.cwd();
export default defineConfig({
  schema: "./src/schema/*.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: resolve(
      root,
      (process.env.DATABASE_URL ?? "file:./data/dennis.db").replace(
        /^file:/,
        "",
      ),
    ),
  },
});
