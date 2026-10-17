import { runLocalEval } from "./local-runner";

const report = await runLocalEval();
console.log(`wrote local eval report ${report.runId}`);
for (const suite of report.suites) {
  console.log(
    `${suite.suite} f1=${suite.f1} leaks=${suite.privacyLeaks} fp=${suite.falsePositives}`,
  );
}
