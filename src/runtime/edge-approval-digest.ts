import { createHash } from "node:crypto";
import { canonicalize } from "../assembler/content-hash.js";
import {
  DecidedCallGraphEdgeApprovalSchema,
  type DecidedCallGraphEdgeApproval,
} from "../schema/approval-artifact.js";
import {
  ApprovalDigestSchema,
  type ApprovalDigest,
} from "../schema/canonical-edge-authority.js";

export const CALL_GRAPH_EDGE_APPROVAL_DECISION_DIGEST_DOMAIN =
  "agent-builder/digest/call-graph-edge-approval/v1";

export function canonicalCallGraphEdgeApprovalDecisionJson(
  decision: DecidedCallGraphEdgeApproval,
): string {
  const parsedDecision = DecidedCallGraphEdgeApprovalSchema.parse(decision);
  return JSON.stringify(canonicalize(parsedDecision));
}

export function createCallGraphEdgeApprovalDecisionDigestPreimage(
  decision: DecidedCallGraphEdgeApproval,
): Buffer {
  const canonicalJson = canonicalCallGraphEdgeApprovalDecisionJson(decision);
  return Buffer.from(
    `${CALL_GRAPH_EDGE_APPROVAL_DECISION_DIGEST_DOMAIN}\n${canonicalJson}`,
    "utf8",
  );
}

export function computeCallGraphEdgeApprovalDecisionDigest(
  decision: DecidedCallGraphEdgeApproval,
): ApprovalDigest {
  return ApprovalDigestSchema.parse(
    createHash("sha256")
      .update(createCallGraphEdgeApprovalDecisionDigestPreimage(decision))
      .digest("hex"),
  );
}
