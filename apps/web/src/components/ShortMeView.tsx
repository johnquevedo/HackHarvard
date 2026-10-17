export interface ShortMeCard {
  marketId: string;
  status: string;
  question: string;
  subject: string;
  pools: { back: number; fade: number };
  positions: { name: string; side: string; points: number; selfShort: boolean }[];
  resolution: string;
  invariantOk: boolean;
  leaderboard: { firstName: string; balance: number; delta: number }[];
  ledger: { name: string; kind: string; delta: number; balanceAfter: number }[];
}

export function ShortMeView({
  card,
  onResolve,
}: {
  card: ShortMeCard;
  onResolve?: (outcome: "yes" | "no") => void;
}) {
  const sum = card.ledger.reduce((total, entry) => total + entry.delta, 0);
  return (
    <div className="grid-2">
      <section className="panel">
        <h1>ShortMe</h1>
        <p>{card.question}</p>
        <p>
          Status {card.status}. Subject {card.subject}.
        </p>
        <p>
          Pools back {card.pools.back} / fade {card.pools.fade}. Resolution {card.resolution}.
        </p>
        <ul>
          {card.positions.map((position) => (
            <li key={`${position.name}-${position.side}`}>
              {position.name} {position.side} {position.points}
              {position.selfShort ? " shorted herself" : ""}
            </li>
          ))}
        </ul>
        <div className="row">
          <button type="button" onClick={() => onResolve?.("no")}>
            Demo Resolver: No offer. STAND-IN FOR OFFICIAL SOURCE
          </button>
          <button type="button" onClick={() => onResolve?.("yes")}>
            Demo Resolver: Offer. STAND-IN FOR OFFICIAL SOURCE
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>Ledger</h2>
        <p className={card.invariantOk && sum === 0 ? "ok" : "bad"}>
          Zero-sum {card.invariantOk && sum === 0 ? "ok" : "broken"}
        </p>
        <table>
          <tbody>
            {card.ledger.map((entry, index) => (
              <tr key={`${entry.name}-${index}`}>
                <td>{entry.name}</td>
                <td>{entry.kind}</td>
                <td>{entry.delta}</td>
                <td>{entry.balanceAfter}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Leaderboard</h2>
        <ul>
          {card.leaderboard.map((row) => (
            <li key={row.firstName}>
              {row.firstName} {row.balance} ({row.delta >= 0 ? "+" : ""}
              {row.delta})
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
