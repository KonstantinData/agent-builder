import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/orchestration/canonical-json.js";
import { ClaudeHostWorkflowNegotiator } from "../../src/orchestration/host-workflow-claude-negotiator.js";
import { createLockedStepContractV2, createWorkflowSafetyManifestV1 } from "../../src/orchestration/host-workflow-contracts.js";
import { terraRoute } from "./support.js";

const digest = "a".repeat(64);
const config = {
  executablePath: "C:/trusted/claude.exe",
  expectedExecutableSha256: digest,
  workingDirectory: "D:/repo",
  timeoutMs: 1_000,
  maxOutputBytes: 10_000,
  environment: { PATH: "C:/trusted" },
};
const manifest = createWorkflowSafetyManifestV1({
  schemaVersion: "workflow-safety-manifest/1",
  workflows: [{ path: ".github/workflows/ci.yml", blobSha256: "b".repeat(64), classification: "verification_only", requiredChecks: ["verify"] }],
});
const contract = createLockedStepContractV2({
  schemaVersion: "locked-step-contract/2",
  runId: "run-001",
  stepId: "step-18",
  baseRevision: "c".repeat(40),
  changeClass: "governance_meta",
  capabilityEffect: "reduce_or_preserve",
  deploymentEffect: "none",
  allowedPaths: ["src/orchestration/host-workflow-controller.ts"],
  forbiddenSurfaces: [".github/"],
  successCriteria: ["pnpm typecheck", "pnpm test"],
  maxClaudeRounds: 4,
  routingDecision: terraRoute,
  requiredChecks: ["verify"],
  workflowSafetyManifestDigest: manifest.manifestDigest,
  controllerAddendum: {
    schemaVersion: "host-workflow-controller/1",
    maxTransitionsPerInvocation: 32,
    lockMode: "exclusive_no_wait_no_eviction",
    automatedThroughPhase: "step_complete",
    externalImplementationMode: "external_attended_readback_only",
    branchDeletionAllowed: false,
  },
});
const request = {
  schemaVersion: "claude-host-workflow-negotiation-request/1" as const,
  roundNumber: 1,
  priorRoundSummary: "",
  candidateContract: contract,
};

function negotiator(output: unknown) {
  return new ClaudeHostWorkflowNegotiator(config, {
    digestFile: async () => digest,
    runProcess: async (_config, prompt) => {
      expect(prompt).toContain("independent contract counterparty");
      expect(prompt).toContain("Do not widen");
      return {
        kind: "ok",
        stdout: typeof output === "string"
          ? output
          : canonicalJson({ type: "result", subtype: "success", is_error: false, structured_output: output }),
      };
    },
  });
}

describe("real Claude host-workflow adapter boundary", () => {
  it("locks only a byte-equivalent canonical v2 contract", async () => {
    await expect(negotiator({
      kind: "locked",
      candidateContractDigest: contract.contractDigest,
      reason: "none",
      details: "The exact digest-bound contract is accepted without widening.",
    }).negotiate(request)).resolves.toEqual({ kind: "locked", contract });
  });

  it("fails closed for mutation, malformed output, timeout, or untrusted executable", async () => {
    await expect(negotiator({
      kind: "locked",
      candidateContractDigest: "0".repeat(64),
      reason: "none",
      details: "wrong digest",
    }).negotiate(request))
      .resolves.toEqual({ kind: "stopped", reason: "contract_malformed" });
    await expect(negotiator("not-json").negotiate(request)).resolves.toEqual({ kind: "stopped", reason: "contract_malformed" });
    await expect(new ClaudeHostWorkflowNegotiator(config, {
      digestFile: async () => digest,
      runProcess: async () => ({ kind: "timeout", stdout: "" }),
    }).negotiate(request)).resolves.toEqual({ kind: "stopped", reason: "claude_timeout" });
    await expect(new ClaudeHostWorkflowNegotiator(config, {
      digestFile: async () => "0".repeat(64),
    }).negotiate(request)).resolves.toEqual({ kind: "stopped", reason: "driver_untrusted" });
  });
});
