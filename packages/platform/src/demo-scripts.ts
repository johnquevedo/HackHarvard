// The demo group-chat scripts, line for line. With DEMO_SCRIPT=hybrid, when the group sends these
// human lines (in order, from any phone), Dennis replies with the scripted lines that follow them.
// Narration and "[System: ...]" lines are not sent. Edit the text here to change what Dennis says.

const RAW_SCRIPTS: Record<string, string> = {
  minute: `
michael: i’m so cooked im failing my meta technical tmr
dennis: Yo michael why don’t you short yourself, i’ll set up a market. Anyone wanna get in on this?
michael: LMAO run it. I’ll put $500
dennis: Market created: "Will michael pass his Meta final round?" $500 insurance for sale
steven: nah you got that. I’ll put $200 on it. bro ima ask this girl out tn am i chopped?
dennis: ur chopped, thats a high risk asset. wanna open a market on whether or not she ghosts you?
steven: 💀💀lowk sure. $20 tho. i think she likes me.
isaac: also anyone tryna buy a monitor? mine's cooked
dennis: wait. found a match. another friend's agent has been tracking the same monitor.
dennis: found a group deal that saves you both $40 each. want me to coordinate?
isaac: yeah do it
dennis: both approved. group purchase organized. simulated Nessie payment ready for confirmation.
`,
  proposal: `
michael: boys i think im gonna propose to my gf next month
steven: BROOOOO NO WAY
isaac: u better not propose with that temu ring 😭
dennis: michael ur about to make the biggest investment of ur life with zero due diligence
michael: LMFAOO shut up
dennis: wait so are we long or short on this marriage? 💀
steven: IM ALL IN
dennis: michael wanna open a private market on whether u actually propose before december?
michael: LMAO sure put me down for $500
dennis: market approved. the boys are officially invested in ur future
isaac: wait he doesn't even have a ring yet
dennis: already found 3 rings in his budget and a photographer option. michael check ur dms before u lose ur entire portfolio
michael: bro is my wedding planner AND my financial advisor
dennis: somebody has to protect the assets
`,
  layoffs: `
steven: bro my company just announced layoffs next week
michael: nahhh ur cooked
isaac: time to start practicing leetcode again 💀
dennis: yo lets set up a short market, who thinks stevens getting cut?
steven: nah fr im actually stressed. don't do it
dennis: based on the expenses u shared, u have about 3 months of runway if income stops. wanna see a backup plan?
steven: wait actually yes
dennis: also found 2 people in ur opt-in network who mentioned open SWE roles. want me to ask their agents about referrals?
steven: YES PLEASE
dennis: one connection is down to intro u. sent u the details privately
michael: how does dennis have better networking skills than all of us
dennis: bro's linkedin has been collecting dust since 2023. somebody had to step in
`,
  marathon: `
isaac: guys i signed up for the boston marathon
steven: u literally get winded walking up stairs
michael: what's ur goal time
isaac: sub 4 hours easy
dennis: easy??? brother ur last recorded 10k pace says otherwise
isaac: trust the process
dennis: the process is currently forecasting 4:18. u want me to open an over/under at 4 hours?
isaac: LMAOO do it
dennis: market approved: "Will Isaac finish the marathon in under 4:00:00?"
steven: 500 points OVER. free money
michael: 200 UNDER i believe in bro
dennis: beautiful. nothing motivates athletic excellence like ur friends financially doubting u
isaac: wait can u actually help me train tho
dennis: already drafted a training schedule. time to make ur friends regret fading u
`,
  moving: `
michael: just got my offer in nyc but rent is actually insane
steven: welcome to adulthood brother
michael: and moving all my stuff from boston costs like $600 😭
dennis: hold on. found something interesting
michael: ?
dennis: another person in ur network is also moving from boston to nyc around the same week
michael: WHO
dennis: can't spill the tea without permission bro. want me to ask if they're down to coordinate?
michael: yes
dennis: both approved. steven's friend alex is moving the same weekend. found a sample shared-truck option that saves u both $180
michael: wait that's actually insane
steven: dennis is literally the goat
dennis: first month of nyc rent survived. 11 more to go
`,
  cancun: `
steven: boys we HAVE to do cancun for spring break
michael: im so down
isaac: same
john: down
dennis: its been 72 hours and not one of u has opened google flights. remarkable
michael: LMAOOO
dennis: anyway i found 3 flight options, 2 places to stay, and a sample budget breakdown for everyone
steven: wait send
dennis: option A is cheaper. option B is closer to nightlife. option C is staying home and fixing ur GPA
isaac: B OBVIOUSLY
dennis: before u bankrupt yourselves, everyone confirm ur budgets and dates privately. i'll find the best overlap
dennis: found a weekend that works for all four. estimated $420 each before food. want me to send the plan?
john: BRO FINALLY A TRIP THATS ACTUALLY HAPPENING
dennis: 4 years of friendship and it took a robot to book a vacation
`,
  exam: `
john: im actually failing my physics midterm tmr
michael: bro didn't u say u were gonna lock in last week
john: i did NOT lock in
dennis: john u have spent more time announcing ur academic comeback than actually studying
john: chill 😭
dennis: wanna open a ShortMe market on whether u get above 85?
john: yeah put 300 points on NO
dennis: subject approved. market live: "Will John score above 85 on his midterm?"
michael: 500 YES bro is secretly cracked
steven: 200 NO i've seen his homework
dennis: btw isaac's agent says he's been looking for a study partner for the same class. want me to connect u two?
john: WAIT YES
dennis: connecting u both. ur market just became a group-funded academic intervention
michael: bro is manipulating the underlying asset 💀
dennis: that's called investing in education
`,
  concert: `
michael: KEN CARSON TICKETS DROP TOMORROW
steven: we NEED to go
isaac: im broke bro
michael: same but im still going
dennis: three financially irresponsible decisions detected in 4 seconds
steven: shut up and get us tickets
dennis: found a sample four-ticket offer that's cheaper per person than the separate listings u were looking at
isaac: wait how much
dennis: estimated $35 less per person before fees. also found another friend in ur network who wants to go
dennis: all four interested. want me to coordinate the ticket group?
michael: LOCK IT
dennis: need everyone's confirmation first. i am ur financial advisor not ur credit card thief
isaac: dennis is lowkey the only responsible person here
dennis: and that's a terrifying sentence
`,
  dating: `
steven: boys im gonna ask this girl out tonight
michael: bro has been saying that for 3 weeks
isaac: i'll believe it when i see it
dennis: ur romantic portfolio is severely underperforming
steven: BRO 😭
dennis: want me to open a market on whether u actually ask her out by midnight?
steven: lowk yes
dennis: market approved: "Will Steven finally make a move tonight?"
michael: 500 NO
isaac: 200 YES i trust him
dennis: steven ur friends currently have more confidence in bitcoin than ur dating life
steven: stop bro. where should i take her if she says yes
dennis: found three date spots within ur budget. one has a reservation option, one is cheaper, and one is a nice walk so u can recover financially
michael: WAIT DENNIS IS ACTUALLY WINGMANNING
dennis: gotta improve the fundamentals before the next earnings call
`,
  gift: `
isaac: wait isn't michael's birthday next week
steven: oh shi ur right
john: we should get him something nice
isaac: he's been wanting those headphones forever
dennis: finally a group chat that remembers someone's birthday before instagram tells them
steven: find us a deal
dennis: michael's shared wishlist includes those headphones. i found two price options and a sample group split
john: how much each
dennis: $42 each if all four of u contribute
steven: wait that's actually fine
dennis: want me to organize it and request contributions?
isaac: yeah
dennis: 3 of 4 approved. waiting on john
john: WHY AM I ALWAYS THE ONE WHO HASN'T PAID
dennis: because ur payment history has established a statistically significant pattern
`,
  startup: `
michael: boys i have a billion dollar startup idea
steven: not this again
michael: we should sell custom hoodies for college students
isaac: LOWKEY THAT COULD WORK
dennis: ur last startup lasted 11 days and made negative revenue
michael: THE MARKET WASNT READY
dennis: before u order 200 hoodies, can we establish that at least 10 people want one
steven: valid 😭
dennis: interesting. another friend's agent has been tracking demand for custom club merch
michael: WAIT FR?
dennis: found a potential shared printing order. sample supplier pricing drops from $28 to $19 per hoodie if the combined quantity qualifies
isaac: bro we have a business
dennis: we have a spreadsheet and 6 interested customers. let's not call ourselves founders yet
michael: BRO LET US DREAM
dennis: dream all u want. im here to protect the cap table
`,
};

export interface ScriptStep {
  speaker: string; // the script character who sends this line ("michael")
  text: string; // the human line that triggers this step
  replies: string[]; // Dennis's scripted lines that follow it (possibly none)
}

export interface DemoScript {
  name: string;
  steps: ScriptStep[];
  topic: RegExp; // a message on this topic can start the script even when worded differently
}

// Script characters. Dennis's lines name them; at runtime each is replaced by a real person.
export const SCRIPT_CAST = ["michael", "steven", "isaac", "john"] as const;

const TOPICS: Record<string, RegExp> = {
  minute: /\b(meta|technical|final round|interview|onsite|superday|recruiter|oa|coding round)\b/i,
  proposal: /\b(propos\w*|engaged|engagement ring|marry|put a ring)\b/i,
  layoffs: /\b(lay ?offs?|laid off|getting cut|fired|let go|downsizing|restructuring)\b/i,
  marathon: /\b(marathon|half marathon|10k|5k|race day|triathlon)\b/i,
  moving: /\b(nyc|new york|moving to|move to|relocat\w*)\b/i,
  cancun: /\b(cancun|spring break|vacation|beach trip|trip to|miami|vegas)\b/i,
  exam: /\b(midterm|midterms|final exam|finals|exam|quiz|orgo|physics test|mcat|lsat)\b/i,
  concert: /\b(tickets?|concert|tour|festival|presale|ticketmaster)\b/i,
  dating:
    /\b(ask(ing)? (this|a|her|him|them)?\s?(girl |guy )?out|first date|date tonight|my crush|rizz)\b/i,
  gift: /\b(birthday|bday|b day)\b/i,
  startup: /\b(startup|start up|business idea|side hustle|start a company|billion dollar idea)\b/i,
};

function parse(name: string, raw: string): DemoScript {
  const steps: ScriptStep[] = [];
  for (const line of raw.split("\n")) {
    const match = /^([a-z]+): (.+)$/.exec(line.trim());
    if (!match) continue; // narration, blank lines, and [System: ...] notes
    const [, speaker, text] = match;
    if (speaker === "dennis") {
      if (steps.length) steps[steps.length - 1]!.replies.push(text!.trim());
    } else steps.push({ speaker: speaker!, text: text!.trim(), replies: [] });
  }
  return { name, steps, topic: TOPICS[name] ?? /$^/ };
}

export const DEMO_SCRIPTS: DemoScript[] = Object.entries(RAW_SCRIPTS).map(([name, raw]) =>
  parse(name, raw),
);
