"use client";

import { PhoneSim, ApprovalFallback } from "@/components/PhoneSim";

const threads = [
  { name: "NYC Crew", preview: "dennis: I found a group buy...", time: "9:16", badge: "3", active: true },
  { name: "Roommates", preview: "Taylor: need a 2nd monitor", time: "8:40" },
  { name: "Fam trip", preview: "dennis: flights drafted", time: "Tue" },
  { name: "Alex", preview: "same lol", time: "Mon" },
];

export default function SimPage() {
  return (
    <div className="chat-grid">
      <aside className="card">
        <div className="kicker">Threads</div>
        {threads.map((thread) => (
          <div key={thread.name} className={thread.active ? "thread active" : "thread"}>
            <span className="thread-dot" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{thread.name}</div>
              <div className="muted" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {thread.preview}
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12, textAlign: "right" }}>
              {thread.time}
              {thread.badge ? (
                <>
                  <br />
                  <b className="nav-badge">{thread.badge}</b>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </aside>
      <section className="card">
        <div>
          <b style={{ fontSize: 18 }}>NYC Crew</b>
          <div className="muted">5 members. dennis is active</div>
        </div>
        <PhoneSim />
      </section>
      <ApprovalFallback />
    </div>
  );
}
