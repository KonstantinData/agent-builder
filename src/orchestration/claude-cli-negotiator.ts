import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { z } from "zod";
import { canonicalJson } from "./canonical-json.js";
import {
  ChangeClassSchema,
  GitShaSchema,
  IdentifierSchema,
  LockedStepContractV1Schema,
  ModelRoutingDecisionV1Schema,
  RoadmapBaseReconciliationBindingV1Schema,
  computeLockedContractDigest,
  type LockedStepContractV1,
  type ModelRoutingDecisionV1,
} from "./contracts.js";

export const ClaudeNegotiationRequestV1Schema = z
  .object({
    schemaVersion: z.literal("claude-negotiation-request/1"),
    runId: IdentifierSchema,
    stepId: IdentifierSchema,
    baseRevision: GitShaSchema,
    changeClass: ChangeClassSchema,
    allowedPaths: z.array(z.string().min(1)).min(1),
    forbiddenSurfaces: z.array(z.string().min(1)),
    successCriteria: z.array(z.string().min(1)).min(1),
    roundNumber: z.number().int().min(1).max(4),
    priorRoundsSummary: z.string().max(8_000),
    routingDecision: ModelRoutingDecisionV1Schema,
    baseReconciliation: RoadmapBaseReconciliationBindingV1Schema.nullable(),
  })
  .strict();
export type ClaudeNegotiationRequestV1 = z.infer<typeof ClaudeNegotiationRequestV1Schema>;

const ProposalSchema = z
  .object({
    kind: z.literal("proposal"),
    successCriteria: z.array(z.string().min(1)).min(1),
    allowedPaths: z.array(z.string().min(1)).min(1),
    rationale: z.string().min(1).max(4_000),
  })
  .strict();
const ConflictSchema = z
  .object({
    kind: z.literal("conflict"),
    reason: IdentifierSchema,
    details: z.string().min(1).max(4_000),
  })
  .strict();
const LockedSchema = z
  .object({
    kind: z.literal("locked"),
    contract: LockedStepContractV1Schema,
  })
  .strict();
export const ClaudeNegotiationResponseV1Schema = z.discriminatedUnion("kind", [
  ProposalSchema,
  ConflictSchema,
  LockedSchema,
]);
export type ClaudeNegotiationResponseV1 = z.infer<typeof ClaudeNegotiationResponseV1Schema>;

export interface ClaudeCliNegotiatorConfig {
  readonly executablePath: string;
  readonly expectedExecutableSha256: string;
  readonly workingDirectory: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly environment: Readonly<Record<string, string>>;
}

export interface ClaudeCliProcessResult {
  readonly kind: "ok" | "timeout" | "error" | "output_limit";
  readonly stdout: string;
}

export interface ClaudeCliNegotiatorDependencies {
  readonly digestFile?: (path: string) => Promise<string>;
  readonly runProcess?: (
    config: ClaudeCliNegotiatorConfig,
    prompt: string,
  ) => Promise<ClaudeCliProcessResult>;
}

export type ClaudeNegotiationResult =
  | { readonly kind: "response"; readonly response: ClaudeNegotiationResponseV1 }
  | { readonly kind: "stopped"; readonly reason: "driver_untrusted" | "claude_timeout" | "contract_malformed" | "adapter_error" };

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function scopeIsSubset(candidate: readonly string[], permitted: readonly string[]): boolean {
  return candidate.every((path) => permitted.includes(path));
}

export class ClaudeCliNegotiator {
  public constructor(
    private readonly config: ClaudeCliNegotiatorConfig,
    private readonly dependencies: ClaudeCliNegotiatorDependencies = {},
  ) {}

  public async negotiate(requestInput: ClaudeNegotiationRequestV1): Promise<ClaudeNegotiationResult> {
    const request = ClaudeNegotiationRequestV1Schema.parse(requestInput);
    try {
      const digestFile = this.dependencies.digestFile ?? sha256File;
      if (await digestFile(this.config.executablePath) !== this.config.expectedExecutableSha256) {
        return { kind: "stopped", reason: "driver_untrusted" };
      }
    } catch {
      return { kind: "stopped", reason: "driver_untrusted" };
    }

    const prompt = canonicalJson({
      instruction: "Return exactly one strict JSON response matching proposal, conflict, or locked. Do not use tools. You have no approval, capability, deployment, PR, or merge authority.",
      responseContract: {
        proposal: {
          kind: "proposal",
          successCriteria: "non-empty string array",
          allowedPaths: "non-empty subset of request.allowedPaths",
          rationale: "bounded non-empty string",
        },
        conflict: {
          kind: "conflict",
          reason: "identifier string",
          details: "bounded non-empty string",
        },
        locked: {
          kind: "locked",
          contract: "strict LockedStepContractV1 echoing run, step, base, scope, routing, and canonical contract digest",
        },
      },
      request,
    });
    const processResult = this.dependencies.runProcess === undefined
      ? await this.run(prompt)
      : await this.dependencies.runProcess(this.config, prompt);
    const run = processResult.kind === "ok"
      ? { kind: "ok" as const, stdout: processResult.stdout }
      : {
          kind: "stopped" as const,
          reason: processResult.kind === "timeout"
            ? "claude_timeout" as const
            : "adapter_error" as const,
        };
    if (run.kind === "stopped") return run;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(run.stdout);
    } catch {
      return { kind: "stopped", reason: "contract_malformed" };
    }
    const parsed = ClaudeNegotiationResponseV1Schema.safeParse(parsedJson);
    if (!parsed.success) return { kind: "stopped", reason: "contract_malformed" };
    if (parsed.data.kind === "proposal" && !scopeIsSubset(parsed.data.allowedPaths, request.allowedPaths)) {
      return { kind: "stopped", reason: "contract_malformed" };
    }
    if (parsed.data.kind === "locked") {
      const contract: LockedStepContractV1 = parsed.data.contract;
      const route: ModelRoutingDecisionV1 = request.routingDecision;
      if (
        contract.runId !== request.runId ||
        contract.stepId !== request.stepId ||
        contract.baseRevision !== request.baseRevision ||
        canonicalJson(contract.baseReconciliation ?? null) !== canonicalJson(request.baseReconciliation) ||
        !scopeIsSubset(contract.allowedPaths, request.allowedPaths) ||
        canonicalJson(contract.routingDecision) !== canonicalJson(route) ||
        contract.contractDigest !== computeLockedContractDigest((({ contractDigest: _ignored, ...value }) => value)(contract))
      ) {
        return { kind: "stopped", reason: "contract_malformed" };
      }
    }
    return { kind: "response", response: parsed.data };
  }

  private async run(prompt: string): Promise<{ readonly kind: "ok"; readonly stdout: string } | { readonly kind: "stopped"; readonly reason: "claude_timeout" | "contract_malformed" | "adapter_error" }> {
    return await new Promise((resolve) => {
      const child = spawn(
        this.config.executablePath,
        ["-p", "--max-turns", "1", "--tools", "", "--output-format", "text"],
        {
          cwd: this.config.workingDirectory,
          env: { ...this.config.environment },
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const finish = (value: Parameters<typeof resolve>[0]): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const collect = (target: Buffer[], chunk: Buffer): void => {
        outputBytes += chunk.length;
        if (outputBytes > this.config.maxOutputBytes) {
          child.kill();
          finish({ kind: "stopped", reason: "contract_malformed" });
          return;
        }
        target.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.on("error", () => finish({ kind: "stopped", reason: "adapter_error" }));
      child.on("close", (code) => {
        if (code !== 0) {
          finish({ kind: "stopped", reason: "adapter_error" });
          return;
        }
        finish({ kind: "ok", stdout: Buffer.concat(stdout).toString("utf8") });
      });
      const timer = setTimeout(() => {
        child.kill();
        finish({ kind: "stopped", reason: "claude_timeout" });
      }, this.config.timeoutMs);
      child.stdin.end(prompt, "utf8");
    });
  }
}
