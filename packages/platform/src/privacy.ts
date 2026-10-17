import type { PlatformContext } from "./context.ts";
type Cleanup = (userId: string) => void;
const cleanups = new WeakMap<PlatformContext, Cleanup[]>();
export function registerPrivacyCleanup(ctx: PlatformContext, cleanup: Cleanup): void {
  cleanups.set(ctx, [...(cleanups.get(ctx) ?? []), cleanup]);
}
export function cleanPrivateReferences(ctx: PlatformContext, userId: string): void {
  for (const cleanup of cleanups.get(ctx) ?? []) cleanup(userId);
}
