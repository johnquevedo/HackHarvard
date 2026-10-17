"use client";

import { useEffect, useState } from "react";
import { EvalPanel, type EvalReportView } from "@/components/EvalPanel";
import { api } from "@/lib/api";

export default function EvalPage() {
  const [report, setReport] = useState<EvalReportView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<EvalReportView>("/api/eval/report?provider=local")
      .then(setReport)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "eval report unavailable"),
      );
  }, []);

  if (error) return <p className="banner">{error}</p>;
  if (!report) return <p>Loading eval report.</p>;
  return (
    <div>
      <button type="button" onClick={() => void api("/api/eval/local/run", { method: "POST" })}>
        Run local eval
      </button>
      <EvalPanel report={report} />
    </div>
  );
}
