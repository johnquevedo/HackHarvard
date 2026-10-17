export interface EvalReportView {
  provider: "chalk" | "local";
  runId: string;
  suites: {
    suite: string;
    total: number;
    precision: number;
    recall: number;
    f1: number;
    falsePositives: number;
    privacyLeaks: number;
  }[];
  successes: { caseId: string; expected: string; actual: string; note: string }[];
  failures: { caseId: string; expected: string; actual: string; note: string }[];
}

export function EvalPanel({ report }: { report: EvalReportView }) {
  const chalk = report.provider === "chalk";
  return (
    <section className="panel">
      <h1>Evaluation</h1>
      <p className={`badge ${chalk ? "mode-live" : "mode-fallback"}`}>
        {chalk ? "CHALK EVAL" : "LOCAL RUN (NOT CHALK)"}
      </p>
      <p>Run {report.runId}</p>
      <table>
        <thead>
          <tr>
            <th>Suite</th>
            <th>Total</th>
            <th>Precision</th>
            <th>Recall</th>
            <th>F1</th>
            <th>False positives</th>
            <th>Privacy leaks</th>
          </tr>
        </thead>
        <tbody>
          {report.suites.map((suite) => (
            <tr key={suite.suite}>
              <td>{suite.suite}</td>
              <td>{suite.total}</td>
              <td>{suite.precision}</td>
              <td>{suite.recall}</td>
              <td>{suite.f1}</td>
              <td>{suite.falsePositives}</td>
              <td>{suite.privacyLeaks}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Representative cases</h2>
      {report.successes.map((item) => (
        <p key={item.caseId} className="ok">
          success {item.caseId}: expected {item.expected}, actual {item.actual}
        </p>
      ))}
      {report.failures.map((item) => (
        <p key={item.caseId} className="bad">
          failure {item.caseId}: expected {item.expected}, actual {item.actual}. {item.note}
        </p>
      ))}
    </section>
  );
}
