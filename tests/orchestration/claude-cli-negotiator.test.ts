import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/orchestration/canonical-json.js";
import { ClaudeCliNegotiator, type ClaudeNegotiationRequestV1 } from "../../src/orchestration/claude-cli-negotiator.js";
import { terraRoute, testContract } from "./support.js";

const digest = "a".repeat(64);
const config = {
  executablePath: "C:/trusted/claude.exe",
  expectedExecutableSha256: digest,
  workingDirectory: "D:/repo",
  timeoutMs: 1_000,
  maxOutputBytes: 10_000,
  environment: { PATH: "C:/trusted" },
};
const request: ClaudeNegotiationRequestV1 = {
  schemaVersion: "claude-negotiation-request/1",
  runId: "run-001",
  stepId: "step-16",
  baseRevision: "b3244c73ca79c68dbba3b4a05234f93d3ed92752",
  changeClass: "runtime_hardening",
  allowedPaths: ["src/runtime/authorize-runtime-action.ts"],
  forbiddenSurfaces: [".github/"],
  successCriteria: ["pnpm typecheck", "pnpm test"],
  roundNumber: 1,
  priorRoundsSummary: "",
  routingDecision: terraRoute,
  baseReconciliation: null,
};

function negotiator(output: unknown) {
  return new ClaudeCliNegotiator(config, {
    digestFile: async () => digest,
    runProcess: async (_config, prompt) => {
      expect(prompt).toContain("no approval");
      expect(prompt).toContain("responseContract");
      return { kind: "ok", stdout: typeof output === "string" ? output : canonicalJson(output) };
    },
  });
}

describe("bounded Claude CLI negotiator", () => {
  it("accepts a strict lock that echoes step, base, scope, routing, and digest", async () => {
    const result = await negotiator({ kind: "locked", contract: testContract() }).negotiate(request);
    expect(result).toMatchObject({ kind: "response", response: { kind: "locked" } });
  });

  it("rejects malformed output, scope widening, digest mismatch, and timeout", async () => {
    await expect(negotiator("not-json").negotiate(request)).resolves.toEqual({ kind: "stopped", reason: "contract_malformed" });
    await expect(negotiator({
      kind: "proposal",
      successCriteria: ["ok"],
      allowedPaths: ["src/other.ts"],
      rationale: "wider",
    }).negotiate(request)).resolves.toEqual({ kind: "stopped", reason: "contract_malformed" });
    await expect(negotiator({
      kind: "locked",
      contract: { ...testContract(), contractDigest: "0".repeat(64) },
    }).negotiate(request)).resolves.toEqual({ kind: "stopped", reason: "contract_malformed" });

    const timedOut = new ClaudeCliNegotiator(config, {
      digestFile: async () => digest,
      runProcess: async () => ({ kind: "timeout", stdout: "" }),
    });
    await expect(timedOut.negotiate(request)).resolves.toEqual({ kind: "stopped", reason: "claude_timeout" });

    const oversized = new ClaudeCliNegotiator(config, {
      digestFile: async () => digest,
      runProcess: async () => ({ kind: "output_limit", stdout: "" }),
    });
    await expect(oversized.negotiate(request)).resolves.toEqual({ kind: "stopped", reason: "adapter_error" });
  });

  it("stops when the configured executable digest does not match", async () => {
    const result = await new ClaudeCliNegotiator(config, {
      digestFile: async () => "0".repeat(64),
      runProcess: async () => ({ kind: "ok", stdout: "{}" }),
    }).negotiate(request);
    expect(result).toEqual({ kind: "stopped", reason: "driver_untrusted" });
  });
});
