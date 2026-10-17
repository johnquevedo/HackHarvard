"use client";

import { useEffect, useState } from "react";
import { ShortMeView, type ShortMeCard } from "@/components/ShortMeView";
import { api } from "@/lib/api";

const STATUSES = ["proposed", "open", "resolved", "disputed"] as const;

export default function ShortMePage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("open");
  const [card, setCard] = useState<ShortMeCard | null>(null);

  useEffect(() => {
    void api<ShortMeCard>(`/api/shortme/markets?status=${status}`).then(setCard);
  }, [status]);

  return (
    <div>
      <div className="row">
        {STATUSES.map((item) => (
          <button key={item} type="button" onClick={() => setStatus(item)}>
            {item}
          </button>
        ))}
      </div>
      {card ? (
        <ShortMeView
          card={card}
          onResolve={(outcome) => {
            void api(`/api/shortme/markets/${card.marketId}/demo-resolve`, {
              method: "POST",
              body: { outcome },
            }).then(() => setStatus("resolved"));
          }}
        />
      ) : (
        <p>Loading ShortMe fixture.</p>
      )}
    </div>
  );
}
