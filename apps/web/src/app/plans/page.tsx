import Link from "next/link";

const days = [
  {
    title: "Fri Apr 11",
    items: [
      ["8:05 AM", "Flight BOS to JFK"],
      ["1:00 PM", "Check in, Midtown hotel"],
      ["7:30 PM", "Group dinner"],
    ],
  },
  {
    title: "Sat Apr 12",
    items: [
      ["11:00 AM", "Brunch"],
      ["2:00 PM", "Museum"],
      ["9:00 PM", "Rooftop bar"],
    ],
  },
  {
    title: "Sun Apr 13",
    items: [
      ["10:00 AM", "Walk the High Line"],
      ["4:30 PM", "Flight JFK to BOS"],
    ],
  },
];

export default function PlansPage() {
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <div className="kicker">Trip / Plan</div>
          <h1>NYC weekend, Apr 11-14</h1>
          <p className="muted">4 people. dennis found the best flights and stay, 12% cheaper</p>
        </div>
        <Link className="btn" href="/trust">
          Approve my share
        </Link>
      </div>
      <div className="split-2">
        <div className="day-grid">
          {days.map((day) => (
            <article key={day.title} className="card">
              <b>{day.title}</b>
              {day.items.map(([time, label]) => (
                <div key={time} className="row" style={{ flexWrap: "nowrap" }}>
                  <span className="muted" style={{ width: 72 }}>
                    {time}
                  </span>
                  <span>{label}</span>
                </div>
              ))}
            </article>
          ))}
        </div>
        <aside className="card">
          <h2>Cost split</h2>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Flights</span>
            <span>$520 total</span>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Stay (3 nights)</span>
            <span>$740 total</span>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Shared activities</span>
            <span>$190 total</span>
          </div>
          <div className="row" style={{ justifyContent: "space-between", fontWeight: 700 }}>
            <span>Per person</span>
            <span>$362</span>
          </div>
          <div className="row">
            <s className="muted">$412</s>
            <span className="tag">Save $86</span>
          </div>
          <div>
            <div>Alex, approved</div>
            <div>Taylor, approved</div>
            <div className="muted">Jamie, waiting</div>
            <div className="muted">You, payment prepared ($312)</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
