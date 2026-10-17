"use client";

import { useEffect, useState } from "react";
import { PurchasingView, type PurchaseCard } from "@/components/PurchasingView";
import { api } from "@/lib/api";

const STATES = ["verified", "unverified", "failed", "simulated"] as const;

export default function PurchasingPage() {
  const [state, setState] = useState<(typeof STATES)[number]>("verified");
  const [card, setCard] = useState<PurchaseCard | null>(null);

  useEffect(() => {
    void api<PurchaseCard>(`/api/purchasing/groups?state=${state}`).then(setCard);
  }, [state]);

  return (
    <div>
      <div className="row">
        {STATES.map((item) => (
          <button key={item} type="button" onClick={() => setState(item)}>
            {item}
          </button>
        ))}
      </div>
      {card ? <PurchasingView card={card} /> : <p>Loading purchasing fixture.</p>}
    </div>
  );
}
