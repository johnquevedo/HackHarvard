import { photonDoctor } from "./photon-doctor.ts";
try {
  await photonDoctor();
  process.stdout.write(
    "Event catalog and redacted live fixture capture remain manual spike steps; see docs/spikes/photon.md.\n",
  );
} catch (error) {
  process.stderr.write(
    (error instanceof Error ? error.message : "Photon spike failed") + "\n",
  );
  process.exitCode = 1;
}
