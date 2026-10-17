export {
  isGroupTerminal,
  transitionGroup,
  type GroupStatus,
  type GroupTrigger,
} from "./state-machine.js";
export {
  createGroupFromCompatibleProbe,
  emitGroupUpdated,
  handleJoinDecision,
  handleProposal,
  handleProposalResult,
  handlePurchaseConsentRevoked,
  setGroupStatus,
} from "./service.js";
