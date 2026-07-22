import { BuilderIntentDraftSchema } from "../schema/builder-intent-draft.js";
import {
  AgentSpecContentSchema,
  type AgentSpecContent,
  type ResolvedAgentCall,
} from "../schema/agent-spec-content.js";
import type { AssemblyContext, AssemblyResult, RejectionReason, SchemaIssue } from "./assembly-types.js";
import { resolveCalleeRole } from "./role-resolution.js";
import { assignVersion } from "./version-assignment.js";
import { computeContentHash } from "./content-hash.js";

function toSchemaIssues(
  issues: ReadonlyArray<{ readonly path: readonly PropertyKey[]; readonly message: string }>,
): SchemaIssue[] {
  return issues.map(({ path, message }) => ({ path, message }));
}

/**
 * Resolves a `BuilderIntentDraft` into a hashed, immutable `AgentSpecContent`
 * — or rejects it with concrete reasons. Pure/injected (Step 3 scope): no
 * registry lookup, no persistence, no Deployment Gate, no runtime call.
 *
 * `draftCandidate` is `unknown`, not a pre-typed `BuilderIntentDraft` — it
 * crosses a trust boundary from the Builder Agent and is validated here,
 * consistent with validation-at-the-boundary everywhere else in this repo.
 */
export function assembleSpec(draftCandidate: unknown, context: AssemblyContext): AssemblyResult {
  const draftResult = BuilderIntentDraftSchema.safeParse(draftCandidate);
  if (!draftResult.success) {
    return {
      success: false,
      reasons: [{ type: "schema_validation_failed", issues: toSchemaIssues(draftResult.error.issues) }],
    };
  }
  const draft = draftResult.data;
  const reasons: RejectionReason[] = [];

  const trustDomainExists = context.trustDomains.some((domain) => domain.domainId === draft.trustDomainId);
  if (!trustDomainExists) {
    reasons.push({ type: "trust_domain_not_found", trustDomainId: draft.trustDomainId });
  }

  const resolvedCalls: ResolvedAgentCall[] = [];
  for (const requested of draft.requestedAgentCalls) {
    const resolution = resolveCalleeRole(requested.calleeRole, context.approvedSpecs);
    if (resolution.outcome === "unresolved") {
      reasons.push({ type: "unresolved_callee_role", calleeRole: requested.calleeRole });
      continue;
    }
    if (resolution.outcome === "ambiguous") {
      reasons.push({
        type: "ambiguous_callee_role",
        calleeRole: requested.calleeRole,
        matchingSpecIds: resolution.matchingSpecIds,
      });
      continue;
    }
    resolvedCalls.push({
      calleeSpecId: resolution.spec.specId,
      calleeVersionOrChannel: resolution.spec.version,
      allowedIntents: requested.allowedIntents,
      maxDepth: requested.maxDepth,
      maxCallsPerRun: requested.maxCallsPerRun,
    });
  }

  if (reasons.length > 0) {
    return { success: false, reasons };
  }

  const { version, parentVersion } = assignVersion(draft.specId, context.approvedSpecs);
  const contentWithoutHash: Omit<AgentSpecContent, "contentHash"> = {
    specId: draft.specId,
    version,
    parentVersion,
    name: draft.name,
    objective: draft.objective,
    promptTemplate: draft.promptTemplate,
    declaredTools: draft.declaredTools,
    declaredAgentCalls: resolvedCalls,
    resourceLimits: draft.resourceLimits,
    evalRequirements: draft.evalRequirements,
    memoryScope: draft.memoryScope,
    trustDomainId: draft.trustDomainId,
    declaredRoles: draft.declaredRoles,
  };

  const contentHash = computeContentHash(contentWithoutHash);
  const finalValidation = AgentSpecContentSchema.safeParse({ ...contentWithoutHash, contentHash });
  if (!finalValidation.success) {
    return {
      success: false,
      reasons: [{ type: "content_validation_failed", issues: toSchemaIssues(finalValidation.error.issues) }],
    };
  }
  return { success: true, content: finalValidation.data };
}
