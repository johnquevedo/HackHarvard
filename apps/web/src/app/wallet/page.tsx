const activity = [
  ["ShortMe: Alex Meta technical", "Position YES", "-50 pts"],
  ["Group buy: 27 inch monitor", "Approved, held", "-$160.00"],
  ["NYC weekend share", "Payment prepared", "$312.00"],
  ["Knicks playoffs", "Won", "+22 pts"],
];

export default function WalletPage() {
  return (
    <div className="screen">
      <div className="stat-row">
        <article className="card stat-green">
          <div className="kicker">Points balance</div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>1,240 pts</div>
          <div>240 in open positions</div>
        </article>
        <article className="card">
          <div className="kicker">Held for group buys</div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>$160.00</div>
          <div className="muted">Released if the buy falls through</div>
        </article>
        <article className="card">
          <div className="kicker">Awaiting your approval</div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>2</div>
          <div className="muted">NYC weekend and monitor</div>
        </article>
      </div>
      <div className="split-2">
        <section className="card">
          <h2>Activity</h2>
          {activity.map(([title, detail, amount]) => (
            <div
              key={title}
              className="row"
              style={{ justifyContent: "space-between", borderTop: "1px solid #edefec", paddingTop: 12 }}
            >
              <div>
                <b>{title}</b>
                <div className="muted">{detail}</div>
              </div>
              <b>{amount}</b>
            </div>
          ))}
        </section>
        <section className="card">
          <h2>Payment methods</h2>
          <div className="row" style={{ justifyContent: "space-between", border: "1px solid #e4e8e3", borderRadius: 14, padding: 14 }}>
            <b>Visa ending 4417</b>
            <span className="tag">Default</span>
          </div>
          <div style={{ border: "1px dashed #c5cec7", borderRadius: 14, padding: 14, textAlign: "center" }} className="muted">
            Add method (simulated)
          </div>
        </section>
      </div>
    </div>
  );
}
