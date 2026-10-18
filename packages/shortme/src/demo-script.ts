// The demo group chat, line for line. Agent 1 (group chats, grammar) and Agent 4 (demo scripts) drive
// it from here; ShortMe tests replay its ShortMe part. Dennis's lines are what code produces for these
// inputs with the scripted mock LLM (LLM_PROVIDER=mock, labeled SIMULATED LLM). Every action behind
// them (markets, stakes, ledger, agent-to-agent messages) runs for real; amounts are sim dollars.
//
// `owner` says which module produces a Dennis line.

export interface ScriptLine {
  from: "john" | "steven" | "isaac" | "dennis" | "system";
  text: string;
  owner?: "shortme" | "purchasing" | "platform";
}

export const DEMO_CAST = ["john", "steven", "isaac"] as const;

export const DEMO_GROUP_CHAT: ScriptLine[] = [
  { from: "john", text: "i’m so cooked im failing my meta technical tmr" },
  {
    from: "dennis",
    owner: "shortme",
    text: "Yo john why don't you short yourself, i'll set up a market. Anyone wanna get in on this?",
  },
  { from: "john", text: "LMAO run it. I’ll put $500" },
  {
    from: "dennis",
    owner: "shortme",
    text: 'Market created: "Will john pass his Meta final round?" $500 insurance for sale',
  },
  {
    from: "steven",
    text: "nah you got that. I’ll put $200. bro ima ask this girl out tn am i chopped?",
  },
  {
    from: "dennis",
    owner: "shortme",
    text: "ur chopped, thats a high risk asset. wanna open a market on whether or not she ghosts you?",
  },
  { from: "steven", text: "💀💀lowk sure. $20 tho. i think she likes me." },
  { from: "isaac", text: "also anyone tryna buy a monitor? mine's cooked" },
  {
    from: "dennis",
    owner: "purchasing",
    text: "wait. found a match. another friend's agent has been tracking the same monitor.",
  },
  {
    from: "system",
    owner: "platform",
    text: "dennis <-> friend's dennis: agents compare purchase intents and bundle offers without sharing private messages.",
  },
  {
    from: "dennis",
    owner: "purchasing",
    text: "found a group deal that saves you both $40 each. want me to coordinate?",
  },
  { from: "isaac", text: "yeah do it" },
  {
    from: "dennis",
    owner: "purchasing",
    text: "both approved. group purchase organized. simulated Nessie payment ready for confirmation.",
  },
];

// Commands the platform grammar must produce for the human lines above (CR-A3-007).
export const DEMO_EXPECTED_COMMANDS: Record<string, unknown> = {
  "LMAO run it. I’ll put $500": { kind: "put", dollars: 500, approve: true, code: null },
  "nah you got that. I’ll put $200. bro ima ask this girl out tn am i chopped?": {
    kind: "put",
    dollars: 200,
    approve: false,
    code: null,
    alsoDetect: true,
  },
  "💀💀lowk sure. $20 tho. i think she likes me.": {
    kind: "put",
    dollars: 20,
    approve: true,
    code: null,
  },
  "yeah do it": { kind: "approve", code: null },
};
