import { formatCents } from "@/lib/types";

export interface PurchaseCard {
  offerLabel: string;
  merchant: string;
  individualCents: number;
  groupCents: number;
  savingsCents: number;
  members: { name: string; join: string; pay: string }[];
  bankMode: "simulated" | "live";
  accounts: {
    label: string;
    last4: string;
    before: number;
    after: number;
    providerTransferId: string | null;
    status: string;
  }[];
}

export function PurchasingView({ card }: { card: PurchaseCard }) {
  return (
    <div className="grid-2">
      <section className="panel">
        <h1>Group purchase</h1>
        <p className="warn">{card.offerLabel}</p>
        <p>{card.merchant}</p>
        <p>
          Together {formatCents(card.groupCents)} instead of {formatCents(card.individualCents)}.
          Save {formatCents(card.savingsCents)}.
        </p>
        <div className="row">
          {card.members.map((member) => (
            <span key={member.name} className="chip">
              {member.name} join {member.join} / pay {member.pay}
            </span>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Bank</h2>
        {card.bankMode === "simulated" ? <p className="banner">SIMULATED BANK</p> : null}
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Before</th>
              <th>After</th>
              <th>Provider id</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {card.accounts.map((account) => (
              <tr key={account.label}>
                <td>
                  {account.label} {account.last4}
                </td>
                <td>{formatCents(account.before)}</td>
                <td>{formatCents(account.after)}</td>
                <td>{account.providerTransferId ?? "none"}</td>
                <td
                  className={
                    account.status === "verified"
                      ? "ok"
                      : account.status === "failed"
                        ? "bad"
                        : "warn"
                  }
                >
                  {account.status === "verified"
                    ? "VERIFIED"
                    : account.status === "unverified"
                      ? "UNVERIFIED"
                      : account.status.toUpperCase()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
