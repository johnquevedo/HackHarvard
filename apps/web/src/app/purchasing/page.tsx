"use client";

import { useEffect, useState } from "react";
import { PurchasingView, type PurchaseCard } from "@/components/PurchasingView";
import { api } from "@/lib/api";

const STATES = ["verified", "unverified", "failed", "simulated"] as const;

const people = [
  ["A", "#C26A4A", "Alex", "Approved, $160", "In", false],
  ["T", "#7A5BC2", "Taylor", "Approved, $160", "In", false],
  ["?", "#6B7A72", "Jamie", "Nudged by dennis", "Pending", true],
] as const;

const deals = [
  ["Standing desk", "3 friends interested", "Save $55 each"],
  ["Concert tickets", "Section 112, 4 people", "Save $18 each"],
  ["Groceries bundle", "Weekly roommates run", "Save $12 each"],
];

export default function PurchasingPage() {
  const [state, setState] = useState<(typeof STATES)[number]>("verified");
  const [card, setCard] = useState<PurchaseCard | null>(null);

  useEffect(() => {
    void api<PurchaseCard>(`/api/purchasing/groups?state=${state}`).then(setCard);
  }, [state]);

  return (
    <div className="screen">
      <div className="split-2">
        <section className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="kicker">Active group buy</div>
            <span className="tag">2 of 4 joined</span>
          </div>
          <div className="row" style={{ alignItems: "center" }}>
            <svg viewBox="0 0 160 120" width="200" height="150" role="img" aria-label="Monitor">
              <rect x="10" y="8" width="140" height="84" rx="8" fill="#2B2F55" />
              <path d="M10 74l50-36 36 26 54-22v50H10z" fill="#7B5BE0" opacity="0.7" />
              <rect x="72" y="92" width="16" height="14" fill="#9AA5A0" />
              <rect x="50" y="106" width="60" height="6" rx="3" fill="#9AA5A0" />
            </svg>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>27&quot; 4K Monitor (2-pack)</div>
              <div className="muted">Matched from &quot;new monitor&quot; in NYC Crew</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: "#1B7F55" }}>
                $80 off each <s className="muted" style={{ fontSize: 16, fontWeight: 400 }}>$400</s>
              </div>
            </div>
          </div>
          <div>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
              <span>$160 of $320 committed</span>
              <span className="muted">closes Sunday</span>
            </div>
            <div className="bar">
              <span />
            </div>
          </div>
          <div className="row">
            <span>Intent detected</span>
            <span>Friends matched</span>
            <span>Approvals</span>
            <span className="muted">Order placed</span>
          </div>
          <div className="pills">
            {STATES.map((item) => (
              <button key={item} type="button" className={state === item ? "pill on" : "pill"} onClick={() => setState(item)}>
                {item}
              </button>
            ))}
          </div>
        </section>
        <aside className="card">
          <h2>Who&apos;s in</h2>
          {people.map(([letter, color, name, detail, tag, waiting]) => (
            <div key={name} className="person">
              <span className="avatars">
                <span style={{ background: color }}>{letter}</span>
              </span>
              <div style={{ flex: 1 }}>
                <b>{name}</b>
                <div className="muted">{detail}</div>
              </div>
              <span className={waiting ? "tag wait" : "tag"}>{tag}</span>
            </div>
          ))}
        </aside>
      </div>
      <div>
        <h2 style={{ margin: "0 0 14px" }}>Other deals</h2>
        <div className="deal-grid">
          {deals.map(([title, detail, save]) => (
            <article key={title} className="card">
              <b>{title}</b>
              <span className="muted">{detail}</span>
              <span style={{ color: "#1B7F55", fontWeight: 700 }}>{save}</span>
            </article>
          ))}
        </div>
      </div>
      {card ? <PurchasingView card={card} /> : <p className="muted">Loading purchasing fixture.</p>}
    </div>
  );
}
