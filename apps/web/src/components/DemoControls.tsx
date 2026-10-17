"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const CUES = [
  "0:00 Show badges and the consent center.",
  "0:25 Alice texts the monitor line.",
  "0:50 Bob texts the monitor line.",
  "1:10 Two separate approval texts.",
  "1:25 Both reply YES to join.",
  "1:50 Both reply YES to the sandbox transfer.",
  "2:50 Alice texts the interview line.",
  "3:05 Alice replies YES to publish.",
  "3:20 Bob BACK 50, Alice FADE 50.",
  "3:40 Demo Resolver, outcome no offer, Alice CONFIRM.",
  "4:10 Open the eval tab.",
  "4:30 Toggle Alice purchase matching off.",
  "4:45 Close.",
];

export function DemoControls() {
  const [note, setNote] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <section className="panel">
      <h1>Demo controls</h1>
      <p>
        Rehearsal timer {clock}{" "}
        <button type="button" onClick={() => setRunning((value) => !value)}>
          {running ? "Pause timer" : "Start timer"}
        </button>
        <button type="button" onClick={() => setSeconds(0)}>
          Reset timer
        </button>
      </p>
      <ol>
        {CUES.map((cue) => (
          <li key={cue}>{cue}</li>
        ))}
      </ol>
      <div className="row">
        <button
          type="button"
          onClick={() =>
            void api("/api/demo/reset", { method: "POST" }).then((body) =>
              setNote(JSON.stringify(body)),
            )
          }
        >
          Reset demo
        </button>
        <button
          type="button"
          onClick={() =>
            void api("/api/demo/script/purchase_alice", { method: "POST" }).then((body) =>
              setNote(JSON.stringify(body)),
            )
          }
        >
          Script Alice purchase
        </button>
        <button
          type="button"
          onClick={() =>
            void api("/api/demo/script/purchase_bob", { method: "POST" }).then((body) =>
              setNote(JSON.stringify(body)),
            )
          }
        >
          Script Bob purchase
        </button>
        <button
          type="button"
          onClick={() =>
            void api("/api/demo/script/shortme_alice", { method: "POST" }).then((body) =>
              setNote(JSON.stringify(body)),
            )
          }
        >
          Script Alice ShortMe
        </button>
        <button
          type="button"
          onClick={() =>
            void api("/api/demo/replay/start", { method: "POST", body: { file: "purchase" } }).then(
              (body) => setNote(JSON.stringify(body)),
            )
          }
        >
          Replay
        </button>
      </div>
      {note ? <pre>{note}</pre> : null}
    </section>
  );
}
