// Markets whose publish_market approval is being approved together with the subject's stake
// ("run it. i'll put $500"). The publish hook skips its own "Market created" line for these, so
// Dennis posts a single line that includes the stake.
export const stakingOnPublish = new Set<string>();
