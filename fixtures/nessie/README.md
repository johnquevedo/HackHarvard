# Nessie fixtures

Run `scripts/spike-nessie.ts` with a live sandbox key to record redacted request and response fixtures here.

Never commit an API key. Review generated fixtures before committing them.

`spike-failure.json` records the 2026-10-17 live contract probe. The transaction record was created and read back, but neither balance changed and the probe ended when the pool account transfer listing returned 404. It is evidence of an incompatible live transfer contract, not a successful payment.
