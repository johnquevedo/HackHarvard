import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_HOSTS = ["https://prod-api.nessieisreal.com", "http://api.nessieisreal.com"];
const TIMEOUT_MS = 8_000;

interface RecordedCall {
  name: string;
  request: { method: string; path: string; body?: unknown };
  response: { status: number; body: unknown } | { error: string };
}

interface CreatedObject {
  _id?: string;
  id?: string;
  [key: string]: unknown;
}

interface CreationResponse {
  objectCreated?: CreatedObject;
  _id?: string;
  id?: string;
  [key: string]: unknown;
}

const calls: RecordedCall[] = [];

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /key|token|secret|authorization/i.test(key) ? "[REDACTED]" : redact(item),
    ]),
  );
}

function createdId(body: unknown): string {
  if (body === null || typeof body !== "object") {
    throw new Error("Creation response was not an object");
  }
  const response = body as CreationResponse;
  const id =
    response.objectCreated?._id ?? response.objectCreated?.id ?? response._id ?? response.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Creation response did not include an object ID");
  }
  return id;
}

function balanceOf(body: unknown): number {
  if (body === null || typeof body !== "object")
    throw new Error("Account response was not an object");
  const balance = (body as { balance?: unknown }).balance;
  if (typeof balance !== "number")
    throw new Error("Account response did not include a numeric balance");
  return balance;
}

async function request(
  baseUrl: string,
  apiKey: string,
  name: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const url = new URL(path, `${baseUrl}/`);
  url.searchParams.set("key", apiKey);
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  const recorded: RecordedCall = {
    name,
    request: {
      method: init.method ?? "GET",
      path,
      ...(body === undefined ? {} : { body: redact(body) }),
    },
    response: { error: "not_sent" },
  };
  calls.push(recorded);

  try {
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    recorded.response = { status: response.status, body: redact(parsed) };
    if (!response.ok) {
      throw new Error(`${name} returned HTTP ${response.status}`);
    }
    return parsed;
  } catch (error) {
    if (!("status" in recorded.response)) {
      recorded.response = { error: error instanceof Error ? error.message : String(error) };
    }
    throw error;
  }
}

async function pickHost(apiKey: string): Promise<string> {
  const configured = process.env.NESSIE_BASE_URL;
  const hosts = configured ? [configured] : DEFAULT_HOSTS;
  const failures: string[] = [];
  for (const host of hosts) {
    try {
      await request(host, apiKey, `probe ${host}`, "/customers");
      console.log(`PASS host ${host}`);
      return host;
    } catch (error) {
      failures.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`DOCUMENTED host failure ${host}`);
    }
  }
  throw new Error(`No Nessie host answered successfully. ${failures.join(" | ")}`);
}

async function run(): Promise<void> {
  const apiKey = process.env.NESSIE_API_KEY;
  if (!apiKey) {
    console.log("DOCUMENTED FALLBACK: NESSIE_API_KEY is missing. Use NESSIE_MODE=sim.");
    console.log(
      "BLOCKED: a credential is required to refresh the recorded live contract evidence.",
    );
    process.exitCode = 2;
    return;
  }

  const runTag = process.env.NESSIE_RUN_TAG ?? `spike-${Date.now()}`;
  const baseUrl = await pickHost(apiKey);
  const customer = await request(baseUrl, apiKey, "create customer", "/customers", {
    method: "POST",
    body: JSON.stringify({
      first_name: "Dennis",
      last_name: `Spike ${runTag}`,
      address: {
        street_number: "1",
        street_name: "Harvard Yard",
        city: "Cambridge",
        state: "MA",
        zip: "02138",
      },
    }),
  });
  const customerId = createdId(customer);
  console.log("PASS customer creation");

  const accountIds: string[] = [];
  for (const [nickname, balance] of [
    [`dennis-${runTag}-payer`, 100],
    [`dennis-${runTag}-pool`, 0],
  ] as const) {
    const result = await request(
      baseUrl,
      apiKey,
      `create account ${nickname}`,
      `/customers/${customerId}/accounts`,
      {
        method: "POST",
        body: JSON.stringify({ type: "Checking", nickname, rewards: 0, balance }),
      },
    );
    accountIds.push(createdId(result));
  }
  console.log("PASS account creation");

  const [payerId, poolId] = accountIds;
  if (!payerId || !poolId) throw new Error("Two accounts were not created");
  const payerBefore = await request(
    baseUrl,
    apiKey,
    "payer balance before",
    `/accounts/${payerId}`,
  );
  const poolBefore = await request(baseUrl, apiKey, "pool balance before", `/accounts/${poolId}`);
  const memo = `dennis:${runTag}:one-dollar-spike`;
  const transfer = await request(
    baseUrl,
    apiKey,
    "create transfer",
    `/accounts/${payerId}/transfers`,
    {
      method: "POST",
      body: JSON.stringify({
        amount: 1,
        transaction_date: new Date().toISOString().slice(0, 10),
        status: "completed",
        description: `${memo}:pool=${poolId}`,
      }),
    },
  );
  const transferId = createdId(transfer);
  console.log("PASS one dollar transfer creation");

  const transferReadBack = await request(
    baseUrl,
    apiKey,
    "get transfer",
    `/transfers/${transferId}`,
  );
  const payerAfter = await request(baseUrl, apiKey, "payer balance after", `/accounts/${payerId}`);
  const poolAfter = await request(baseUrl, apiKey, "pool balance after", `/accounts/${poolId}`);
  await request(baseUrl, apiKey, "list payer transfers", `/accounts/${payerId}/transfers`);
  let visibleFromPool = true;
  try {
    await request(baseUrl, apiKey, "list pool transfers", `/accounts/${poolId}/transfers`);
  } catch {
    visibleFromPool = false;
    console.log("DOCUMENTED transfer is not visible from the pool account");
  }

  const payerDelta = balanceOf(payerBefore) - balanceOf(payerAfter);
  const poolDelta = balanceOf(poolAfter) - balanceOf(poolBefore);
  const memoRoundTrips = JSON.stringify(transferReadBack).includes(memo);
  const balancesMoveBothSides = payerDelta === 1 && poolDelta === 1;
  console.log(`PASS transfer read-back ${transferId}`);
  console.log(
    `${balancesMoveBothSides ? "PASS" : "DOCUMENTED"} balance semantics payer=${payerDelta} pool=${poolDelta}`,
  );
  console.log(`${memoRoundTrips ? "PASS" : "DOCUMENTED"} memo round-trip`);

  const fixtureDir = join(process.cwd(), "fixtures", "nessie");
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(
    join(fixtureDir, `spike-${runTag.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`),
    `${JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        baseUrl,
        transferId,
        findings: { payerDelta, poolDelta, balancesMoveBothSides, memoRoundTrips, visibleFromPool },
        calls,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log("PASS redacted fixture written");
}

run().catch(async (error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  const fixtureDir = join(process.cwd(), "fixtures", "nessie");
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(
    join(fixtureDir, "spike-failure.json"),
    `${JSON.stringify({ recordedAt: new Date().toISOString(), calls }, null, 2)}\n`,
    "utf8",
  );
  process.exitCode = 1;
});
