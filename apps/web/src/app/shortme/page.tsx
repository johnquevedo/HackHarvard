"use client";

import { useEffect, useState } from "react";
import { ShortMeView, type ShortMeCard } from "@/components/ShortMeView";
import { api } from "@/lib/api";
import { loadShortMeCard, loadShortMeCardById } from "@/lib/live-cards";

// 5 points is $50 sim at 1 point = $10.
const STAKE_POINTS = 5;
const TRADERS = [
  { userId: "usr_demo_alice", name: "Alice" },
  { userId: "usr_demo_bob", name: "Bob" },
] as const;

const FILTERS = [
  { label: "Live", status: "open" },
  { label: "My positions", status: "proposed" },
  { label: "Resolved", status: "resolved" },
  { label: "Create market", status: "disputed" },
] as const;

const others = [
  ["Will the Knicks make the playoffs?", "Sports", "YES 72%", "NO 28%", "1.2k pts", "#1B7F55"],
  ["Will Jamie get into Stanford MBA?", "Friends", "YES 38%", "NO 62%", "840 pts", "#B4413A"],
  ["Will Taylor accept the Amazon offer?", "Friends", "YES 54%", "NO 46%", "620 pts", "#1B7F55"],
];

export default function ShortMePage() {
  const [status, setStatus] = useState<(typeof FILTERS)[number]["status"]>("open");
  const [card, setCard] = useState<ShortMeCard | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [side, setSide] = useState<"back" | "fade">("back");
  const [trader, setTrader] = useState<string>(TRADERS[1].userId);
  const [note, setNote] = useState("");

  useEffect(() => {
    setLoaded(false);
    void loadShortMeCard(status)
      .then(setCard)
      .catch((error: unknown) => {
        setCard(null);
        setNote(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setLoaded(true));
  }, [status]);

  // Reload the market just acted on; its status may have moved out of the current filter.
  function refresh(marketId: string, message: string): void {
    void loadShortMeCardById(marketId)
      .then((next) => {
        setCard(next);
        setNote(
          next.status === "void"
            ? "Market voided: only one side had stakes, so everyone got their stake back."
            : message,
        );
      })
      .catch(fail);
  }

  function fail(error: unknown): void {
    setNote(error instanceof Error ? error.message : String(error));
  }

  return (
    <div className="screen">
      <div className="pills">
        {FILTERS.map((item) => (
          <button
            key={item.status}
            type="button"
            className={status === item.status ? "pill on" : "pill"}
            onClick={() => setStatus(item.status)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="split-2">
        <section className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="kicker">ShortMe, Live</div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>
                {card?.question ?? "Will Alex pass his Meta technical?"}
              </div>
            </div>
            <span className="tag">Closes in 2d</span>
          </div>
          <svg
            viewBox="0 0 600 200"
            width="100%"
            height="200"
            role="img"
            aria-label="YES probability over time, rising to 61 percent"
          >
            <line x1="0" y1="100" x2="600" y2="100" stroke="#E4E8E3" strokeDasharray="4 4" />
            <polygon
              points="0,200 0,130 80,120 160,140 240,100 320,110 400,70 480,80 600,60 600,200"
              fill="#E3F3EA"
            />
            <polyline
              points="0,130 80,120 160,140 240,100 320,110 400,70 480,80 600,60"
              fill="none"
              stroke="#1B7F55"
              strokeWidth="3"
              strokeLinejoin="round"
            />
          </svg>
          <div className="row muted">
            <span>500 pts pool</span>
            <span>14 traders</span>
            <span>Created by dennis 1h ago</span>
          </div>
        </section>
        <section className="card">
          <h2>Take a position</h2>
          <div className="split">
            <button
              type="button"
              className="yes"
              aria-pressed={side === "back"}
              style={{ outline: side === "back" ? "2px solid currentColor" : "none" }}
              onClick={() => setSide("back")}
            >
              YES 61%
            </button>
            <button
              type="button"
              className="no"
              aria-pressed={side === "fade"}
              style={{ outline: side === "fade" ? "2px solid currentColor" : "none" }}
              onClick={() => setSide("fade")}
            >
              NO 39%
            </button>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">Trade as</span>
            <select
              value={trader}
              onChange={(event) => setTrader(event.target.value)}
              aria-label="trade as"
            >
              {TRADERS.map((item) => (
                <option key={item.userId} value={item.userId}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              border: "1px solid #d5dbd6",
              borderRadius: 12,
              padding: "12px 14px",
            }}
          >
            <span className="muted">Stake</span>
            <b>$50 sim ({STAKE_POINTS} pts)</b>
          </div>
          <div className="row muted" style={{ justifyContent: "space-between" }}>
            <span>Avg price</span>
            <span>61 cents</span>
          </div>
          <div className="row muted" style={{ justifyContent: "space-between" }}>
            <span>If YES wins</span>
            <span>+32 pts</span>
          </div>
          <div className="row muted" style={{ justifyContent: "space-between" }}>
            <span>If NO wins</span>
            <span>-50 pts</span>
          </div>
          {card ? (
            <button
              className="btn"
              type="button"
              disabled={card.status !== "open"}
              onClick={() => {
                const marketId = card.marketId;
                void api(`/api/shortme/markets/${marketId}/positions`, {
                  method: "POST",
                  body: { userId: trader, side, points: STAKE_POINTS },
                })
                  .then(() => refresh(marketId, `${side.toUpperCase()} placed.`))
                  .catch(fail);
              }}
            >
              {card.status === "open" ? "Confirm position" : `Market is ${card.status}`}
            </button>
          ) : (
            <p className="muted">{loaded ? "No markets in this view yet." : "Loading markets."}</p>
          )}
          {note ? <p className="muted">{note}</p> : null}
        </section>
      </div>
      <div className="deal-grid">
        {others.map(([title, tag, yes, no, pool, stroke]) => (
          <article key={title} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{title}</b>
              <span className="tag">{tag}</span>
            </div>
            <svg viewBox="0 0 120 36" width="100%" height="40" aria-hidden="true">
              <polyline
                points="0,18 20,14 40,22 60,16 80,20 100,14 120,18"
                fill="none"
                stroke={stroke}
                strokeWidth="2.5"
              />
            </svg>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
              <span>
                <b className="yes-text">{yes}</b> <b className="no-text">{no}</b>
              </span>
              <span className="muted">{pool}</span>
            </div>
          </article>
        ))}
      </div>
      {card ? (
        <ShortMeView
          card={card}
          onResolve={(outcome) => {
            const marketId = card.marketId;
            void api(`/api/shortme/markets/${marketId}/demo-resolve`, {
              method: "POST",
              body: { outcome },
            })
              .then(() =>
                refresh(
                  marketId,
                  `Demo resolver proposed ${outcome.toUpperCase()}. The subject confirms next.`,
                ),
              )
              .catch(fail);
          }}
        />
      ) : null}
    </div>
  );
}
