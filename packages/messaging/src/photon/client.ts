import { Photon, ApiError } from "@photon-ai/api";
import { DennisError } from "@dennis/contracts";
import type { AppConfig } from "@dennis/contracts";
export function createPhotonClient(
  config: AppConfig,
  fetchImpl?: typeof fetch,
): Photon {
  if (!config.photonApiKey || !config.photonProjectId)
    throw new DennisError(
      "integration_unavailable",
      "Photon credentials are missing",
      503,
    );
  return new Photon({
    baseUrl: config.photonApiBaseUrl,
    headers: { Authorization: `Bearer ${config.photonApiKey}` },
    timeoutMs: 10000,
    retry: { maxAttempts: 3 },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}
export function photonError(error: unknown): DennisError {
  if (error instanceof ApiError) {
    const status = error.status;
    return new DennisError(
      status === 429 ? "rate_limited" : "upstream_error",
      `Photon request failed (${status})`,
      status === 429 ? 429 : 502,
      { retryable: status === 429 || status >= 500, providerStatus: status },
    );
  }
  return new DennisError("upstream_error", "Photon request failed", 502, {
    retryable: true,
  });
}
