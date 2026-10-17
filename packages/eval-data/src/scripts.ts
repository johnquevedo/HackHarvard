export const DEMO_SCRIPTS = {
  purchase_alice: {
    fromUserId: "usr_demo_alice",
    text: "I'm thinking about getting a new 27 inch 4K monitor for my setup, maybe $350 or under.",
  },
  purchase_bob: {
    fromUserId: "usr_demo_bob",
    text: "I need a 27 inch 4K monitor too, probably this weekend. Budget up to $350.",
  },
  shortme_alice: {
    fromUserId: "usr_demo_alice",
    text: "just finished my final round interview at a quant firm. i either get the offer or im cooked",
  },
} as const;

export type DemoScriptName = keyof typeof DEMO_SCRIPTS;
