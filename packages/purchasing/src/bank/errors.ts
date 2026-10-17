import { DennisError } from "@dennis/contracts";

export class BankingProviderError extends DennisError {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly providerStatus?: number,
  ) {
    super("upstream_error", message, 502, { retryable, providerStatus });
  }
}
