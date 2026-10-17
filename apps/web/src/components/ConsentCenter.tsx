"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const SCOPES = [
  "messaging_context",
  "purchase_matching",
  "shortme_free_play",
  "sandbox_payments",
] as const;

interface ConsentRow {
  scope: string;
  granted: boolean;
}

export function ConsentCenter() {
  const [userId, setUserId] = useState("usr_demo_alice");
  const [rows, setRows] = useState<ConsentRow[]>([]);
  const [note, setNote] = useState("");

  async function load(next = userId) {
    setRows(await api<ConsentRow[]>(`/api/consents?userId=${next}`));
  }

  useEffect(() => {
    void load();
  }, [userId]);

  return (
    <section className="panel">
      <h1>Consent center</h1>
      <select
        value={userId}
        onChange={(event) => setUserId(event.target.value)}
        aria-label="consent user"
      >
        <option value="usr_demo_alice">Alice</option>
        <option value="usr_demo_bob">Bob</option>
      </select>
      {rows.map((row) => (
        <label key={row.scope} className="row">
          <input
            type="checkbox"
            checked={row.granted}
            onChange={(event) => {
              void api("/api/consents", {
                method: "POST",
                body: { userId, scope: row.scope, granted: event.target.checked },
              }).then(() => load());
            }}
          />
          {row.scope}
        </label>
      ))}
      <div className="row">
        <button
          type="button"
          onClick={() => {
            const agentId = userId === "usr_demo_alice" ? "agt_demo_alice" : "agt_demo_bob";
            void api(`/api/agents/${agentId}/pause`, {
              method: "POST",
              body: { paused: true },
            }).then(() => setNote("paused"));
          }}
        >
          Pause
        </button>
        <button
          type="button"
          onClick={() => {
            void api("/api/privacy/forget", { method: "POST", body: { userId } }).then(() =>
              setNote("forget requested"),
            );
          }}
        >
          Forget
        </button>
        <button
          type="button"
          onClick={() => {
            const intentId = userId === "usr_demo_alice" ? "int_alice_monitor" : "int_bob_monitor";
            void api(`/api/intents/${intentId}/revoke`, { method: "POST", body: { userId } }).then(
              () => setNote("intent revoked"),
            );
          }}
        >
          Revoke intent
        </button>
      </div>
      {note ? <p>{note}</p> : null}
      <p className="muted">Scopes: {SCOPES.join(", ")}</p>
    </section>
  );
}
