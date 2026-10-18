"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface ThreadMessage {
  direction: "in" | "out";
  text: string;
  ts: string;
  status: string;
}

export function PhoneSim() {
  const [userId, setUserId] = useState("usr_demo_alice");
  const [text, setText] = useState(
    "I'm thinking about getting a new 27 inch 4K monitor for my setup, maybe $350 or under.",
  );
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [note, setNote] = useState("");

  async function refresh(nextUser = userId) {
    const thread = await api<{ messages: ThreadMessage[] }>(`/api/sim/thread?userId=${nextUser}`);
    setMessages(thread.messages);
  }

  return (
    <div className="phone">
      <div className="row">
        <label>
          Send as{" "}
          <select
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              void refresh(event.target.value);
            }}
          >
            <option value="usr_demo_alice">Alice</option>
            <option value="usr_demo_bob">Bob</option>
          </select>
        </label>
        <button type="button" onClick={() => void refresh()}>
          Load thread
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 ? <p className="muted">Thread is empty until you load it.</p> : null}
        {messages.map((message, index) => (
          <div key={`${message.ts}-${index}`} className={`bubble ${message.direction}`}>
            <div>{message.text}</div>
            <div className="muted">{message.status}</div>
          </div>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        style={{ width: "100%" }}
      />
      <button
        className="btn"
        type="button"
        onClick={() => {
          void api("/api/sim/inbound", { method: "POST", body: { fromUserId: userId, text } }).then(
            () => {
              setNote("SIMULATED INBOUND");
              return refresh();
            },
          );
        }}
      >
        Send. SIMULATED INBOUND
      </button>
      {note ? <p className="warn">{note}</p> : null}
    </div>
  );
}

export function ApprovalFallback() {
  const [result, setResult] = useState("");
  return (
    <section className="card">
      <h2>Approvals</h2>
      <p className="fallback">DASHBOARD FALLBACK. These buttons are not iMessage.</p>
      <div className="row">
        <button
          className="btn"
          type="button"
          onClick={() => {
            void api("/api/approvals/apr_join_alice/decision", {
              method: "POST",
              body: { userId: "usr_demo_alice", decision: "approved" },
            }).then(() => setResult("Alice DASHBOARD FALLBACK"));
          }}
        >
          Approve as Alice. DASHBOARD FALLBACK
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => {
            void api("/api/approvals/apr_join_bob/decision", {
              method: "POST",
              body: { userId: "usr_demo_bob", decision: "approved" },
            }).then(() => setResult("Bob DASHBOARD FALLBACK"));
          }}
        >
          Approve as Bob. DASHBOARD FALLBACK
        </button>
      </div>
      {result ? <p>{result}</p> : null}
    </section>
  );
}
