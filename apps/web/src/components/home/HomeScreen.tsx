function Sparkline({ tone }: { tone: "up" | "down" | "flat" }) {
  const stroke = tone === "down" ? "#e11d48" : "#1f8a4c";
  const d =
    tone === "down"
      ? "M2 8 C 18 10, 28 14, 40 12 S 62 22, 78 20 S 100 30, 118 28"
      : tone === "flat"
        ? "M2 18 C 16 16, 28 20, 42 17 S 70 14, 90 18 S 108 16, 118 15"
        : "M2 26 C 16 24, 28 20, 42 22 S 70 12, 90 10 S 108 8, 118 6";
  return (
    <svg className="spark" viewBox="0 0 120 36" aria-hidden="true">
      <path d={d} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function Mascot() {
  return (
    <svg
      className="mascot"
      viewBox="0 0 200 240"
      width="220"
      height="264"
      role="img"
      aria-label="dennis mascot, a glossy green bean character with a white face panel, a cap, sunglasses on the cap, a waving hand and a drink"
    >
      <defs>
        <radialGradient id="bean" cx="32%" cy="22%" r="95%">
          <stop offset="0" stopColor="#7BE3A8" />
          <stop offset="0.5" stopColor="#2FBF7A" />
          <stop offset="1" stopColor="#157A4A" />
        </radialGradient>
        <radialGradient id="face" cx="40%" cy="30%" r="80%">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E7EEF0" />
        </radialGradient>
        <radialGradient id="capg" cx="35%" cy="25%" r="90%">
          <stop offset="0" stopColor="#2E9A62" />
          <stop offset="1" stopColor="#0E4D2B" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="226" rx="66" ry="9" fill="#14201A" opacity="0.14" />
      <ellipse cx="74" cy="214" rx="24" ry="11" fill="#157A4A" />
      <ellipse cx="126" cy="214" rx="24" ry="11" fill="#157A4A" />
      <path
        d="M100 20C140 20 158 56 160 100C162 150 170 190 170 208C150 216 50 216 30 208C30 190 38 150 40 100C42 56 60 20 100 20Z"
        fill="url(#bean)"
      />
      <line x1="150" y1="146" x2="170" y2="84" stroke="#27B070" strokeWidth="26" strokeLinecap="round" />
      <rect x="156" y="42" width="30" height="40" rx="12" fill="#3BCB85" transform="rotate(12 171 62)" />
      <rect x="156" y="26" width="9" height="22" rx="4.5" fill="#3BCB85" transform="rotate(4 160 37)" />
      <rect x="167" y="20" width="9" height="24" rx="4.5" fill="#3BCB85" transform="rotate(12 171 32)" />
      <rect x="178" y="26" width="9" height="22" rx="4.5" fill="#3BCB85" transform="rotate(22 182 37)" />
      <ellipse cx="164" cy="104" rx="5" ry="22" fill="#fff" opacity="0.35" transform="rotate(20 164 104)" />
      <ellipse cx="100" cy="92" rx="46" ry="38" fill="url(#face)" stroke="#1B9A60" strokeWidth="5" />
      <rect x="74" y="74" width="12" height="26" rx="6" fill="#14201A" transform="rotate(8 80 87)" />
      <rect x="114" y="74" width="12" height="26" rx="6" fill="#14201A" transform="rotate(-8 120 87)" />
      <ellipse cx="78" cy="80" rx="2.5" ry="5" fill="#fff" opacity="0.7" />
      <ellipse cx="118" cy="80" rx="2.5" ry="5" fill="#fff" opacity="0.7" />
      <path d="M88 112Q100 122 112 112" fill="none" stroke="#14201A" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M62 50C62 20 82 8 100 8C118 8 138 20 138 50Z" fill="url(#capg)" />
      <path d="M98 50C122 42 156 46 164 58C148 66 114 64 98 58Z" fill="#0A3B20" />
      <circle cx="100" cy="8" r="5.5" fill="#0A3B20" />
      <rect x="72" y="24" width="26" height="16" rx="8" fill="#111" stroke="#fff" strokeWidth="1.5" />
      <rect x="102" y="24" width="26" height="16" rx="8" fill="#111" stroke="#fff" strokeWidth="1.5" />
      <rect x="96" y="29" width="8" height="4" fill="#111" />
      <ellipse cx="82" cy="12" rx="12" ry="4" fill="#fff" opacity="0.3" transform="rotate(-20 82 12)" />
      <ellipse cx="62" cy="150" rx="7" ry="30" fill="#fff" opacity="0.3" transform="rotate(8 62 150)" />
      <text x="100" y="170" textAnchor="middle" fontFamily="DM Sans, sans-serif" fontWeight="700" fontSize="34" fill="#fff" opacity="0.9">
        d
      </text>
      <line x1="50" y1="146" x2="36" y2="170" stroke="#27B070" strokeWidth="24" strokeLinecap="round" />
      <rect x="10" y="150" width="32" height="48" rx="8" fill="#fff" stroke="#D5E3DA" strokeWidth="2" />
      <rect x="8" y="143" width="36" height="12" rx="6" fill="#0E4D2B" />
      <line x1="22" y1="143" x2="27" y2="124" stroke="#0E4D2B" strokeWidth="4" strokeLinecap="round" />
      <text x="26" y="183" textAnchor="middle" fontFamily="DM Sans, sans-serif" fontWeight="700" fontSize="20" fill="#14201A">
        d
      </text>
      <circle cx="40" cy="172" r="12" fill="#3BCB85" />
      <path d="M30 62l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#fff" />
      <path d="M188 120l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#fff" />
      <circle cx="14" cy="104" r="3" fill="#fff" />
      <circle cx="190" cy="170" r="3" fill="#F6C65B" />
    </svg>
  );
}

const friends = [
  { letter: "A", color: "#C26A4A" },
  { letter: "J", color: "#4A7FC2" },
  { letter: "T", color: "#7A5BC2" },
  { letter: "M", color: "#2E9E6B" },
  { letter: "S", color: "#C2A04A" },
];

export function HomeScreen() {
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <h1>Your group chat is now a financial market.</h1>
          <p>
            dennis lives in your conversations, coordinates with your friends, and helps you spend,
            plan and play smarter.
          </p>
          <div className="hero-meta">
            <div className="avatars" aria-hidden="true">
              {friends.map((friend) => (
                <span key={friend.letter} style={{ background: friend.color }}>
                  {friend.letter}
                </span>
              ))}
              <span className="avatar-more">+3</span>
            </div>
            <p>
              <i className="live-dot" /> Your friends&apos; agents are on 24/7
            </p>
          </div>
        </div>
        <Mascot />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Live opportunities</h2>
          <a href="/shortme">See all</a>
        </div>
        <div className="card-row">
          <article className="opp">
            <div className="opp-kicker">
              <span>SHORTME</span>
              <span className="live-label">
                <i className="live-dot" /> Live
              </span>
            </div>
            <h3>Will Alex pass his Meta technical?</h3>
            <p className="meta">500 pts pool · closes in 2d</p>
            <Sparkline tone="up" />
            <div className="split">
              <span className="yes">YES 61%</span>
              <span className="no">NO 39%</span>
            </div>
            <a className="btn" href="/shortme">
              Take position
            </a>
          </article>

          <article className="opp">
            <div className="opp-kicker">
              <span>GROUP BUY</span>
            </div>
            <h3>2 friends need monitors</h3>
            <p className="meta">27&quot; 4K Monitor, 2-pack · 4 people</p>
            <div className="offer">
              <div>
                <p className="strike">
                $320 together <s>$400</s>
              </p>
                <p className="save-line">$80 off each</p>
              </div>
              <span className="monitor" aria-hidden="true" />
            </div>
            <a className="btn" href="/purchasing">
              Join group buy
            </a>
          </article>

          <article className="opp">
            <div className="opp-kicker">
              <span>TRIP / PLAN</span>
            </div>
            <h3>NYC weekend</h3>
            <p className="meta">Apr 11-14 · 4 people · best flights and stay found, 12% cheaper, costs split</p>
            <p className="price">
              <s>$412</s> <strong>$362</strong> <span>/person</span> <em>Save $86</em>
            </p>
            <a className="btn" href="/plans">
              View plan
            </a>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Agent activity</h2>
          <a href="/activity">See all</a>
        </div>
        <div className="activity-row">
          <article>
            <i className="pip green" />
            <h3>Detected purchase intent</h3>
            <p>You mentioned &quot;new monitor&quot; in your group chat</p>
            <time>2m ago</time>
          </article>
          <article>
            <i className="pip blue" />
            <h3>Matched with a friend</h3>
            <p>Alex also wants a monitor</p>
            <time>12m ago</time>
          </article>
          <article>
            <i className="pip pink" />
            <h3>Created market</h3>
            <p>Will Alex pass his Meta technical?</p>
            <time>1h ago</time>
          </article>
          <article>
            <i className="pip purple" />
            <h3>Prepared payment</h3>
            <p>Drafted your share for NYC weekend ($312)</p>
            <time>3h ago</time>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Recent markets</h2>
          <a href="/shortme">See all</a>
        </div>
        <div className="card-row markets">
          <article>
            <h3>Will the Knicks make the playoffs?</h3>
            <Sparkline tone="up" />
            <p>
              <b className="yes-text">YES 72%</b> <b className="no-text">NO 28%</b>
              <span>1.2k pts</span>
            </p>
          </article>
          <article>
            <h3>Will Jamie get into Stanford MBA?</h3>
            <Sparkline tone="down" />
            <p>
              <b className="yes-text">YES 38%</b> <b className="no-text">NO 62%</b>
              <span>840 pts</span>
            </p>
          </article>
          <article>
            <h3>Will Taylor accept the Amazon offer?</h3>
            <Sparkline tone="flat" />
            <p>
              <b className="yes-text">YES 54%</b> <b className="no-text">NO 46%</b>
              <span>620 pts</span>
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
