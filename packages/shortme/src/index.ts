export { shortmeModule } from "./module";
export {
  milestoneDetector,
  createMilestoneDetector,
  applyMilestoneGates,
  sanitizeQuestion,
  MilestoneExtraction,
  QuipOutput,
  MILESTONE_TASK,
} from "./detector/index";
export type {
  MilestoneGates,
  GateResult,
  MilestoneExtractionT,
} from "./detector/index";
export {
  placePosition,
  type PlacePositionInput,
  type PositionRow,
} from "./markets/positions";
export {
  passInvite,
  lockMarket,
  handleMilestoneDetection,
  sweep,
} from "./markets/service";
export {
  proposeResolution,
  resolveMarket,
  disputeResolution,
  adminResolve,
} from "./resolution/service";
export {
  computePayouts,
  type PayoutPosition,
  type PayoutResult,
} from "./ledger/payouts";
export {
  postLedger,
  checkLedgerInvariants,
  getBalance,
  type LedgerPosting,
  type InvariantCheck,
} from "./ledger/ledger";
export { validateQuip, renderResultMessage, QUIP_FALLBACK } from "./copy/quip";
export {
  canTransition,
  TRANSITIONS,
  MARKET_STATUSES,
  type MarketStatus,
} from "./markets/state";
export { GATES, STAND_IN_LABEL } from "./rules";
export * as templates from "./templates";
