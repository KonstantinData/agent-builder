import { canonicalJson } from "./canonical-json.js";
import {
  HumanContractApprovalV1Schema,
  LockedStepContractV1Schema,
  computeHumanContractCandidateDigest,
  computeLockedContractDigest,
  verifyHumanContractApprovalV1Digest,
  type HumanContractApprovalV1,
  type LockedStepContractV1,
} from "./contracts.js";
import {
  ClaudeNegotiationRequestV1Schema,
  type ClaudeNegotiationRequestV1,
  type ClaudeNegotiationResult,
} from "./claude-cli-negotiator.js";

/**
 * An attended lock adapter. It never contacts a model and only accepts an approval
 * supplied by a separately trusted host verifier.
 */
export class HumanAttestedContractNegotiator {
  public constructor(
    private readonly approval: HumanContractApprovalV1,
    private readonly maxContractRounds: number,
  ) {}

  public async negotiate(requestInput: ClaudeNegotiationRequestV1): Promise<ClaudeNegotiationResult> {
    const request = ClaudeNegotiationRequestV1Schema.parse(requestInput);
    const candidate = {
      schemaVersion: "locked-step-contract/1" as const,
      runId: request.runId,
      stepId: request.stepId,
      baseRevision: request.baseRevision,
      changeClass: request.changeClass,
      capabilityEffect: "reduce_or_preserve" as const,
      deploymentEffect: "none" as const,
      allowedPaths: request.allowedPaths,
      forbiddenSurfaces: request.forbiddenSurfaces,
      successCriteria: request.successCriteria,
      // Kept for v1 replay compatibility. Human-attested locks always consume one.
      maxClaudeRounds: this.maxContractRounds,
      routingDecision: request.routingDecision,
      baseReconciliation: request.baseReconciliation,
      contractLockMode: "human_attested" as const,
    };
    const approval = HumanContractApprovalV1Schema.safeParse(this.approval);
    if (!approval.success || !verifyHumanContractApprovalV1Digest(approval.data)) {
      return { kind: "stopped", reason: "contract_malformed" };
    }
    if (
      approval.data.decision !== "approved" ||
      Date.parse(approval.data.expiresAt) < Date.now() ||
      approval.data.runId !== candidate.runId ||
      approval.data.stepId !== candidate.stepId ||
      approval.data.baseRevision !== candidate.baseRevision ||
      canonicalJson(approval.data.baseReconciliation) !== canonicalJson(candidate.baseReconciliation) ||
      approval.data.candidateContractDigest !== computeHumanContractCandidateDigest(candidate)
    ) {
      return { kind: "stopped", reason: "contract_malformed" };
    }
    const unsigned = { ...candidate, humanApproval: approval.data };
    const contract: LockedStepContractV1 = LockedStepContractV1Schema.parse({
      ...unsigned,
      contractDigest: computeLockedContractDigest(unsigned),
    });
    return { kind: "response", response: { kind: "locked", contract } };
  }
}
