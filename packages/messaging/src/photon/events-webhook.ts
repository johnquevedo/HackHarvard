import { Webhook } from "standardwebhooks";
import { DennisError } from "@dennis/contracts";
export function verifyPhotonWebhook(
  raw: string,
  headers: Record<string, string>,
  secret: string,
): unknown {
  try {
    new Webhook(secret).verify(raw, headers, { jsonParse: false });
  } catch {
    throw new DennisError("unauthorized", "Invalid or stale webhook signature", 401);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new DennisError("validation_error", "Malformed webhook JSON", 400);
  }
}
