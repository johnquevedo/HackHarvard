export {
  isGroupTerminal,
  transitionGroup,
  type GroupStatus,
  type GroupTrigger,
} from "./state-machine.js";
export {
  createGroupFromCompatibleProbe,
  handleJoinDecision,
  handleProposal,
  handleProposalResult,
  handlePurchaseConsentRevoked,
} from "./service.js";
