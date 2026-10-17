"use client";

import { PhoneSim, ApprovalFallback } from "@/components/PhoneSim";

export default function SimPage() {
  return (
    <div className="grid-2">
      <PhoneSim />
      <ApprovalFallback />
    </div>
  );
}
