export {
  BankingProviderError,
  createBankingProvider,
  NessieBankingProvider,
  seedBank,
  SimBankingProvider,
  type NessieBankingProviderOptions,
} from "./bank/index.js";
export {
  MockPurchaseDetector,
  PurchaseDetector,
  PurchaseExtraction,
  purchaseDetector,
  resolveTimeframe,
  roundBudgetBand,
  type PurchaseExtractionT,
} from "./detector/index.js";
export { purchasingModule } from "./module.js";
export {
  isCompatible,
  matchingRules,
  type MatchCheck,
  type MatchDecision,
  type MatchingRules,
} from "./matching/index.js";
export { DEMO_MONITOR_OFFER } from "./offers/demo.js";
