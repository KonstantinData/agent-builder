import { z } from "zod";
import { domainSeparatedDigest } from "./canonical-json.js";
import {
  CiObservationV1Schema,
  ExternalImplementationSettledV1Schema,
  FeatureRefSettledV1Schema,
  MergeGateObservationV1Schema,
  MergeSettledV1Schema,
  PullRequestSettledV1Schema,
  VerificationSettledV1Schema,
  canonicalFeatureRef,
  computeExternalImplementationVerifierDescriptorDigest,
  createOrphanRefReportV1,
  verifyWorkflowEvidenceEnvelopeV1,
  verifyWorkflowSafetyManifest,
  type EffectBindingV1,
  type RunIntentV2,
  type RunStartEvidenceV2,
  type LockedStepContractV2,
  type WorkflowSafetyManifestV1,
  type WorkflowReadbackResultV1,
  type WorkflowEvidenceEnvelopeV1,
} from "./host-workflow-contracts.js";
import {
  createHostWorkflowEvent,
  createHostWorkflowIdempotencyKey,
  createHostWorkflowSnapshot,
  type HostWorkflowEffectKind,
  type HostWorkflowEventKind,
  type HostWorkflowSnapshotV1,
  type HostWorkflowStopReason,
  type PendingHostWorkflowEffectV1,
} from "./host-workflow-reducer.js";
import type { HostWorkflowStore } from "./host-workflow-persistence.js";
import {
  evaluateCiObservation,
  evaluateMergeGate,
  validateHostWorkflowAdapters,
  workflowAdapterRegistryDigest,
  workflowEffectBindingDigest,
  type HostWorkflowAdapters,
} from "./workflow-adapters.js";

export interface HostWorkflowControllerRequest {
  readonly runId: string;
  readonly intent: RunIntentV2;
  readonly startEvidence: RunStartEvidenceV2;
  readonly contract: LockedStepContractV2;
  readonly implementationHeadSha: string;
  readonly workflowManifest: WorkflowSafetyManifestV1;
  readonly adapters: HostWorkflowAdapters;
  readonly store: HostWorkflowStore;
  readonly instantSource: { next(): string };
  readonly remoteName?: string;
  readonly baseRef?: string;
  readonly pullRequestTitle: string;
  readonly pullRequestBody: string;
  readonly maxTransitions?: number;
}

export type HostWorkflowControllerResult =
  | { readonly kind: "complete"; readonly snapshot: HostWorkflowSnapshotV1 }
  | { readonly kind: "stopped"; readonly snapshot: HostWorkflowSnapshotV1; readonly reason: HostWorkflowStopReason }
  | { readonly kind: "boundary"; readonly snapshot: HostWorkflowSnapshotV1; readonly reason:
      | "adapter_unavailable"
      | "pending_reconciliation_required"
      | "readback_inconclusive"
      | "ci_pending"
      | "controller_lock_unavailable"
      | "transition_budget_exhausted" };

function externalIdempotencyKey(snapshot: HostWorkflowSnapshotV1): string {
  return domainSeparatedDigest("agent-builder/orchestration/external-implementation-readback/v1", {
    runId: snapshot.runId,
    stepId: snapshot.stepId,
    contractDigest: snapshot.contract.contractDigest,
    lockedBaseSha: snapshot.contract.baseRevision,
    headSha: snapshot.headSha,
  });
}

function effectBinding(snapshot: HostWorkflowSnapshotV1, kind: HostWorkflowEffectKind): EffectBindingV1 {
  return {
    idempotencyKey: createHostWorkflowIdempotencyKey(snapshot, kind),
    runId: snapshot.runId,
    stepId: snapshot.stepId,
    contractDigest: snapshot.contract.contractDigest,
    lockedBaseSha: snapshot.contract.baseRevision,
    headSha: snapshot.headSha,
  };
}

function pendingEffect(kind: HostWorkflowEffectKind, binding: Readonly<Record<string, unknown>>): PendingHostWorkflowEffectV1 {
  const idempotencyKey = String(binding["idempotencyKey"]);
  return {
    kind,
    idempotencyKey,
    binding: { ...binding },
    bindingDigest: workflowEffectBindingDigest(binding),
  };
}

export class HostWorkflowController {
  public async run(request: HostWorkflowControllerRequest): Promise<HostWorkflowControllerResult> {
    // Registration errors are programming/configuration errors and must be raised before any store access.
    validateHostWorkflowAdapters(request.adapters);
    const registryDigest = workflowAdapterRegistryDigest(request.adapters);
    if (!verifyWorkflowSafetyManifest(request.workflowManifest)) throw new TypeError("workflow manifest is malformed or untrustworthy");
    if (registryDigest !== request.startEvidence.workflowAdapterRegistryDigest) throw new TypeError("adapter registry differs from immutable start evidence");
    if (request.workflowManifest.manifestDigest !== request.startEvidence.workflowSafetyManifestDigest) throw new TypeError("workflow manifest differs from immutable start evidence");
    const external = request.adapters.externalImplementation;
    if (external !== undefined) {
      const descriptorDigest = computeExternalImplementationVerifierDescriptorDigest({
        verifierId: external.descriptor.adapterId,
        verifierConfigDigest: external.descriptor.adapterConfigDigest,
        kind: "external_attended_readback_only",
      });
      if (descriptorDigest !== request.startEvidence.externalImplementationVerifierDescriptorDigest) {
        throw new TypeError("external verifier descriptor differs from immutable start evidence");
      }
    }

    if (!(await request.store.hasSnapshot())) {
      await request.store.initialize(createHostWorkflowSnapshot({
        runId: request.runId,
        intent: request.intent,
        startEvidence: request.startEvidence,
        contract: request.contract,
        headSha: request.implementationHeadSha,
      }));
    }
    const release = await request.store.acquireControllerLock();
    if (release === null) {
      return { kind: "boundary", snapshot: await request.store.load(), reason: "controller_lock_unavailable" };
    }
    try {
      return await this.runLocked(request);
    } finally {
      await release();
    }
  }

  private async runLocked(request: HostWorkflowControllerRequest): Promise<HostWorkflowControllerResult> {
    let snapshot = await request.store.load();
    if (
      snapshot.runId !== request.runId ||
      snapshot.intent.intentDigest !== request.intent.intentDigest ||
      snapshot.contract.contractDigest !== request.contract.contractDigest ||
      snapshot.headSha !== request.implementationHeadSha
    ) throw new TypeError("resume request differs from immutable host workflow state");
    const maxTransitions = request.maxTransitions ?? snapshot.contract.controllerAddendum.maxTransitionsPerInvocation;
    let transitions = 0;
    let ciReadPerformed = false;
    const pendingAtInvocationStart = snapshot.pendingEffect?.bindingDigest ?? null;

    const apply = async (kind: HostWorkflowEventKind, payload: Readonly<Record<string, unknown>> = {}): Promise<boolean> => {
      if (transitions >= maxTransitions) return false;
      const event = createHostWorkflowEvent({
        eventId: `host:${snapshot.runId}:${snapshot.lastSequence + 1}:${kind}`,
        runId: snapshot.runId,
        sequence: snapshot.lastSequence + 1,
        observedAt: request.instantSource.next(),
        kind,
        payload,
        previousEventDigest: snapshot.lastEventDigest,
      });
      snapshot = await request.store.append(snapshot, event);
      transitions += 1;
      return true;
    };

    const boundary = (reason: Extract<HostWorkflowControllerResult, { kind: "boundary" }>["reason"]): HostWorkflowControllerResult => ({
      kind: "boundary", snapshot, reason,
    });

    const stop = async (reason: HostWorkflowStopReason): Promise<HostWorkflowControllerResult> => {
      if (snapshot.featureRef !== null && snapshot.orphanReports.every((report) => report.failureReason !== reason)) {
        const report = createOrphanRefReportV1({
          runId: snapshot.runId,
          stepId: snapshot.stepId,
          contractDigest: snapshot.contract.contractDigest,
          ref: snapshot.featureRef,
          headSha: snapshot.headSha,
          pullRequestNumber: snapshot.pullRequestNumber,
          pullRequestState: snapshot.pullRequestNumber === null
            ? "not_created"
            : snapshot.phase === "merged" ? "merged" : "open",
          failureReason: reason,
          observedAt: request.instantSource.next(),
        });
        if (!(await apply("OrphanRefReported", { report }))) return boundary("transition_budget_exhausted");
      }
      if (!(await apply("StoppedForCause", { reason }))) return boundary("transition_budget_exhausted");
      return { kind: "stopped", snapshot, reason };
    };

    const validateSettled = <T>(
      result: WorkflowReadbackResultV1<T, string>,
      schema: z.ZodType<T>,
      bindingDigest: string,
    ): result is Extract<typeof result, { kind: "settled" }> =>
      result.kind === "settled" &&
      schema.safeParse(result.evidence.value).success &&
      verifyWorkflowEvidenceEnvelopeV1(result.evidence, schema, bindingDigest);

    for (;;) {
      if (snapshot.phase === "step_complete") return { kind: "complete", snapshot };
      if (snapshot.phase === "stopped") return { kind: "stopped", snapshot, reason: snapshot.stopReason ?? "corruption_detected" };
      if (transitions >= maxTransitions) return boundary("transition_budget_exhausted");
      if (Date.parse(request.instantSource.next()) > Date.parse(snapshot.intent.expiresAt)) return await stop("intent_expired");

      if (snapshot.phase === "contract_locked") {
        if (request.adapters.externalImplementation === undefined) return boundary("adapter_unavailable");
        const binding = {
          idempotencyKey: externalIdempotencyKey(snapshot),
          runId: snapshot.runId,
          stepId: snapshot.stepId,
          contractDigest: snapshot.contract.contractDigest,
          lockedBaseSha: snapshot.contract.baseRevision,
          headSha: snapshot.headSha,
          expectedAllowedPaths: snapshot.contract.allowedPaths,
        };
        const bindingDigest = workflowEffectBindingDigest(binding);
        let result;
        try { result = await request.adapters.externalImplementation.readback(binding); }
        catch { return boundary("readback_inconclusive"); }
        if (result.kind === "inconclusive") return boundary("readback_inconclusive");
        if (result.kind === "failed") return await stop(result.failure as HostWorkflowStopReason);
        if (!validateSettled(result, ExternalImplementationSettledV1Schema, bindingDigest)) return await stop("evidence_untrustworthy");
        const value = result.evidence.value;
        if (
          value.idempotencyKey !== binding.idempotencyKey || value.runId !== snapshot.runId || value.stepId !== snapshot.stepId ||
          value.contractDigest !== snapshot.contract.contractDigest || value.lockedBaseSha !== snapshot.contract.baseRevision || value.headSha !== snapshot.headSha ||
          value.changedPaths.some((path) => !snapshot.contract.allowedPaths.includes(path))
        ) return await stop("binding_mismatch");
        if (!(await apply("ExternalImplementationVerified", { evidenceDigest: result.evidence.evidenceDigest }))) return boundary("transition_budget_exhausted");
        continue;
      }

      if (snapshot.phase === "implementation_complete" || snapshot.phase === "verification_pending") {
        const adapter = request.adapters.verification;
        if (adapter === undefined) return boundary("adapter_unavailable");
        let binding = effectBinding(snapshot, "verification");
        let newlyPending = false;
        if (snapshot.phase === "implementation_complete") {
          const pending = pendingEffect("verification", binding);
          if (!(await apply("VerificationPending", { pendingEffect: pending }))) return boundary("transition_budget_exhausted");
          if ((snapshot as HostWorkflowSnapshotV1).phase === "stopped") {
            return { kind: "stopped", snapshot, reason: snapshot.stopReason ?? "corruption_detected" };
          }
          newlyPending = true;
        } else {
          binding = snapshot.pendingEffect?.binding as unknown as EffectBindingV1;
        }
        if (newlyPending && snapshot.pendingEffect?.bindingDigest !== pendingAtInvocationStart) {
          try { await adapter.invoke(binding); } catch { return boundary("pending_reconciliation_required"); }
        }
        let result;
        try { result = await adapter.readback(binding); }
        catch { return boundary("pending_reconciliation_required"); }
        if (result.kind === "inconclusive") return boundary("readback_inconclusive");
        if (result.kind === "failed") return await stop(result.failure as HostWorkflowStopReason);
        const digest = workflowEffectBindingDigest(binding);
        if (!validateSettled(result, VerificationSettledV1Schema, digest)) return await stop("evidence_untrustworthy");
        if (
          result.evidence.value.idempotencyKey !== binding.idempotencyKey ||
          result.evidence.value.runId !== binding.runId ||
          result.evidence.value.stepId !== binding.stepId ||
          result.evidence.value.contractDigest !== binding.contractDigest ||
          result.evidence.value.headSha !== binding.headSha
        ) return await stop("binding_mismatch");
        if (!(await apply("VerificationSettled", { evidenceDigest: result.evidence.evidenceDigest }))) return boundary("transition_budget_exhausted");
        continue;
      }

      if (snapshot.phase === "verified" || snapshot.phase === "branch_push_pending") {
        if (!snapshot.intent.allowFeatureBranchPush) return await stop("intent_scope_violation");
        const adapter = request.adapters.featureRef;
        if (adapter === undefined) return boundary("adapter_unavailable");
        const expectedRef = canonicalFeatureRef(snapshot.runId, snapshot.stepId);
        let binding = { ...effectBinding(snapshot, "feature_ref"), remoteName: request.remoteName ?? "origin", ref: expectedRef };
        let newlyPending = false;
        if (snapshot.phase === "verified") {
          if (!(await apply("FeatureRefPending", { pendingEffect: pendingEffect("feature_ref", binding) }))) return boundary("transition_budget_exhausted");
          if ((snapshot as HostWorkflowSnapshotV1).phase === "stopped") {
            return { kind: "stopped", snapshot, reason: snapshot.stopReason ?? "corruption_detected" };
          }
          newlyPending = true;
        } else binding = snapshot.pendingEffect?.binding as typeof binding;
        if (newlyPending) {
          try { await adapter.invoke(binding); } catch { return boundary("pending_reconciliation_required"); }
        }
        let result;
        try { result = await adapter.readback(binding); }
        catch { return boundary("pending_reconciliation_required"); }
        if (result.kind === "inconclusive") return boundary("readback_inconclusive");
        if (result.kind === "failed") return await stop(result.failure as HostWorkflowStopReason);
        if (!validateSettled(result, FeatureRefSettledV1Schema, workflowEffectBindingDigest(binding))) return await stop("evidence_untrustworthy");
        if (
          result.evidence.value.idempotencyKey !== binding.idempotencyKey ||
          result.evidence.value.lockedBaseSha !== binding.lockedBaseSha ||
          result.evidence.value.remoteName !== binding.remoteName ||
          result.evidence.value.ref !== expectedRef ||
          result.evidence.value.headSha !== snapshot.headSha
        ) return await stop("head_mismatch");
        if (!(await apply("FeatureRefSettled", { evidenceDigest: result.evidence.evidenceDigest, ref: expectedRef, headSha: snapshot.headSha }))) return boundary("transition_budget_exhausted");
        continue;
      }

      if (snapshot.phase === "branch_pushed" || snapshot.phase === "pr_create_pending") {
        if (!snapshot.intent.allowPullRequestCreate) return await stop("intent_scope_violation");
        const adapter = request.adapters.pullRequest;
        if (adapter === undefined) return boundary("adapter_unavailable");
        const titleDigest = domainSeparatedDigest("agent-builder/orchestration/pr-title/v1", request.pullRequestTitle);
        const bodyDigest = domainSeparatedDigest("agent-builder/orchestration/pr-body/v1", request.pullRequestBody);
        const machineBlockDigest = domainSeparatedDigest("agent-builder/orchestration/pr-machine-block/v1", {
          runId: snapshot.runId, stepId: snapshot.stepId, contractDigest: snapshot.contract.contractDigest,
          baseSha: snapshot.contract.baseRevision, headSha: snapshot.headSha,
        });
        let binding = {
          ...effectBinding(snapshot, "pull_request"),
          headRef: snapshot.featureRef!, baseRef: request.baseRef ?? "main", titleDigest, bodyDigest, machineBlockDigest,
        };
        let newlyPending = false;
        if (snapshot.phase === "branch_pushed") {
          if (!(await apply("PullRequestPending", { pendingEffect: pendingEffect("pull_request", binding) }))) return boundary("transition_budget_exhausted");
          if ((snapshot as HostWorkflowSnapshotV1).phase === "stopped") {
            return { kind: "stopped", snapshot, reason: snapshot.stopReason ?? "corruption_detected" };
          }
          newlyPending = true;
        } else binding = snapshot.pendingEffect?.binding as typeof binding;
        if (newlyPending) {
          try { await adapter.invoke(binding); } catch { return boundary("pending_reconciliation_required"); }
        }
        let result;
        try { result = await adapter.readback(binding); }
        catch { return boundary("pending_reconciliation_required"); }
        if (result.kind === "inconclusive") return boundary("readback_inconclusive");
        if (result.kind === "failed") return await stop(result.failure as HostWorkflowStopReason);
        if (!validateSettled(result, PullRequestSettledV1Schema, workflowEffectBindingDigest(binding))) return await stop("evidence_untrustworthy");
        const value = result.evidence.value;
        if (
          value.idempotencyKey !== binding.idempotencyKey || value.headRef !== binding.headRef ||
          value.headSha !== snapshot.headSha || value.baseRef !== binding.baseRef ||
          value.baseSha !== snapshot.contract.baseRevision || value.machineBlockDigest !== machineBlockDigest
        ) return await stop("binding_mismatch");
        if (!(await apply("PullRequestSettled", { evidenceDigest: result.evidence.evidenceDigest, pullRequestNumber: value.number, machineBlockDigest }))) return boundary("transition_budget_exhausted");
        continue;
      }

      if (snapshot.phase === "pr_open" || snapshot.phase === "ci_pending") {
        if (ciReadPerformed) return boundary("ci_pending");
        const adapter = request.adapters.ci;
        if (adapter === undefined) return boundary("adapter_unavailable");
        if (!(await apply("CiReadCharged"))) return boundary("transition_budget_exhausted");
        if ((snapshot as HostWorkflowSnapshotV1).phase === "stopped") {
          return { kind: "stopped", snapshot, reason: snapshot.stopReason ?? "corruption_detected" };
        }
        ciReadPerformed = true;
        const binding = { pullRequestNumber: snapshot.pullRequestNumber!, headSha: snapshot.headSha };
        let evidence;
        try { evidence = await adapter.read(binding); }
        catch { return boundary("readback_inconclusive"); }
        const bindingDigest = workflowEffectBindingDigest(binding);
        if (!verifyWorkflowEvidenceEnvelopeV1(evidence, CiObservationV1Schema, bindingDigest)) return await stop("ci_response_untrustworthy");
        if (evidence.value.pullRequestNumber !== binding.pullRequestNumber || evidence.value.headSha !== binding.headSha) {
          return await stop("ci_response_untrustworthy");
        }
        const evaluation = evaluateCiObservation(evidence.value);
        if (evaluation.kind === "failed") return await stop(evaluation.reason);
        if (evaluation.kind === "pending") {
          if (!(await apply("CiObservedPending", { evidenceDigest: evidence.evidenceDigest }))) return boundary("transition_budget_exhausted");
          return boundary("ci_pending");
        }
        if (!(await apply("CiObservedPassed", { evidenceDigest: evidence.evidenceDigest }))) return boundary("transition_budget_exhausted");
        continue;
      }

      if (snapshot.phase === "ci_passed") {
        if (!snapshot.intent.allowPullRequestMerge) return await stop("merge_authority_missing");
        const adapter = request.adapters.mergeGate;
        if (adapter === undefined) return boundary("adapter_unavailable");
        const binding = {
          ...effectBinding(snapshot, "merge"),
          pullRequestNumber: snapshot.pullRequestNumber!, machineBlockDigest: snapshot.machineBlockDigest!,
          workflowManifest: request.workflowManifest,
        };
        let evidence;
        try { evidence = await adapter.read(binding); }
        catch { return boundary("readback_inconclusive"); }
        const bindingDigest = workflowEffectBindingDigest(binding);
        if (!verifyWorkflowEvidenceEnvelopeV1(evidence, MergeGateObservationV1Schema, bindingDigest)) return await stop("evidence_untrustworthy");
        if (
          evidence.value.pullRequestNumber !== snapshot.pullRequestNumber ||
          evidence.value.expectedHeadSha !== snapshot.headSha || evidence.value.headSha !== snapshot.headSha ||
          evidence.value.lockedBaseSha !== snapshot.contract.baseRevision || evidence.value.baseSha !== snapshot.contract.baseRevision
        ) return await stop("evidence_untrustworthy");
        const decision = evaluateMergeGate(evidence.value);
        if (decision.kind === "blocked") return await stop(decision.reason);
        if (!(await apply("MergeGatePassed", { evidenceDigest: evidence.evidenceDigest }))) return boundary("transition_budget_exhausted");
        continue;
      }

      if (snapshot.phase === "merge_ready" || snapshot.phase === "merge_pending") {
        const adapter = request.adapters.merge;
        if (adapter === undefined) return boundary("adapter_unavailable");
        let binding = { ...effectBinding(snapshot, "merge"), pullRequestNumber: snapshot.pullRequestNumber! };
        let newlyPending = false;
        if (snapshot.phase === "merge_ready") {
          if (!(await apply("MergePending", { pendingEffect: pendingEffect("merge", binding) }))) return boundary("transition_budget_exhausted");
          if ((snapshot as HostWorkflowSnapshotV1).phase === "stopped") {
            return { kind: "stopped", snapshot, reason: snapshot.stopReason ?? "corruption_detected" };
          }
          newlyPending = true;
        } else binding = snapshot.pendingEffect?.binding as typeof binding;
        if (newlyPending) {
          try { await adapter.invoke(binding); } catch { return boundary("pending_reconciliation_required"); }
        }
        let result;
        try { result = await adapter.readback(binding); }
        catch { return boundary("pending_reconciliation_required"); }
        if (result.kind === "inconclusive") return boundary("readback_inconclusive");
        if (result.kind === "failed") return await stop(result.failure as HostWorkflowStopReason);
        if (!validateSettled(result, MergeSettledV1Schema, workflowEffectBindingDigest(binding))) return await stop("evidence_untrustworthy");
        if (
          result.evidence.value.idempotencyKey !== binding.idempotencyKey ||
          result.evidence.value.pullRequestNumber !== binding.pullRequestNumber ||
          result.evidence.value.expectedHeadSha !== binding.headSha ||
          result.evidence.value.lockedBaseSha !== binding.lockedBaseSha ||
          !result.evidence.value.mergeCommitReachableFromOriginMain
        ) return await stop("merge_readback_unreachable");
        if (!(await apply("MergeSettled", { evidenceDigest: result.evidence.evidenceDigest }))) return boundary("transition_budget_exhausted");
        continue;
      }

      if (snapshot.phase === "merged") {
        const adapter = request.adapters.cleanup;
        if (adapter === undefined) return boundary("adapter_unavailable");
        const binding = { runId: snapshot.runId, stepId: snapshot.stepId, contractDigest: snapshot.contract.contractDigest, pullRequestNumber: snapshot.pullRequestNumber!, headSha: snapshot.headSha };
        let evidence;
        try { evidence = await adapter.read(binding); }
        catch { return boundary("readback_inconclusive"); }
        const schema = CleanupValueSchema;
        if (!verifyWorkflowEvidenceEnvelopeV1(evidence, schema, workflowEffectBindingDigest(binding))) return await stop("evidence_untrustworthy");
        if (!(await apply("CleanupVerified", { evidenceDigest: evidence.evidenceDigest }))) return boundary("transition_budget_exhausted");
        continue;
      }
    }
  }
}

const CleanupValueSchema = z.object({
  localWorktreeClean: z.literal(true),
  branchDeletionPerformed: z.literal(false),
}).strict();
