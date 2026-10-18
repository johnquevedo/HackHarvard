import type { PlatformContext } from "./context.ts";

// Shows the typing bubble for config.typingMs before a send, then clears it. Typing is best effort:
// a provider without typing support, or a failed typing call, still sends after the pause.
export async function withTyping<T>(
  ctx: PlatformContext,
  spaceId: string | null | undefined,
  key: string,
  send: () => Promise<T>,
): Promise<T> {
  const ms = ctx.config.typingMs;
  if (ms <= 0) return send();
  const typing = async (on: boolean) => {
    if (!spaceId || !ctx.messaging.setTyping) return;
    try {
      await ctx.messaging.setTyping(spaceId, on, `${key}:typing:${on}`);
    } catch {
      ctx.log.warn("Typing indicator unavailable");
    }
  };
  await typing(true);
  await new Promise<void>((resolve) => setTimeout(resolve, ms).unref());
  try {
    return await send();
  } finally {
    await typing(false);
  }
}
