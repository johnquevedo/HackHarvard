import type { PlatformContext } from "@dennis/platform";

// Exact statements drizzle-kit generates for `marketInvites` in packages/db/src/schema/shortme.ts,
// made idempotent. The platform bootstrap snapshot predates this table, so ShortMe ensures it exists;
// db:push and db:reset produce the identical definition, so there is no schema drift.
const DDL = [
  "CREATE TABLE IF NOT EXISTS `market_invites` (\n\t`market_id` text NOT NULL,\n\t`user_id` text NOT NULL,\n\t`code` text NOT NULL,\n\t`expires_at` text NOT NULL,\n\t`created_at` text NOT NULL,\n\tPRIMARY KEY(`market_id`, `user_id`),\n\tFOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
  "CREATE INDEX IF NOT EXISTS `market_invites_user_code` ON `market_invites` (`user_id`,`code`);",
];

export function ensureShortmeSchema(ctx: PlatformContext): void {
  for (const statement of DDL) ctx.db.$client.exec(statement);
}
