import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { z } from "zod";
import { canonicalJson } from "./canonical-json.js";
import { IdentifierSchema } from "./contracts.js";
import {
  LockedStepContractV2Schema,
  verifyLockedStepContractV2Digest,
  type LockedStepContractV2,
} from "./host-workflow-contracts.js";
import type {
  ClaudeCliNegotiatorConfig,
  ClaudeCliProcessResult,
} from "./claude-cli-negotiator.js";

export const ClaudeHostWorkflowNegotiationRequestV1Schema = z.object({
  schemaVersion: z.literal("claude-host-workflow-negotiation-request/1"),
  roundNumber: z.number().int().min(1).max(4),
  priorRoundSummary: z.string().max(8_000),
  candidateContract: LockedStepContractV2Schema,
}).strict();
export type ClaudeHostWorkflowNegotiationRequestV1 = z.infer<typeof ClaudeHostWorkflowNegotiationRequestV1Schema>;

export const ClaudeHostWorkflowNegotiationResponseV1Schema = z.object({
  kind: z.enum(["locked", "conflict"]),
  candidateContractDigest: z.string().regex(/^[0-9a-f]{64}$/),
  reason: IdentifierSchema,
  details: z.string().min(1).max(4_000),
}).strict().superRefine((value, context) => {
  if (value.kind === "locked" && value.reason !== "none") {
    context.addIssue({ code: "custom", path: ["reason"], message: "locked response reason must be none" });
  }
  if (value.kind === "conflict" && value.reason === "none") {
    context.addIssue({ code: "custom", path: ["reason"], message: "conflict response requires a reason" });
  }
});
export type ClaudeHostWorkflowNegotiationResponseV1 = z.infer<typeof ClaudeHostWorkflowNegotiationResponseV1Schema>;

export interface ClaudeHostWorkflowNegotiatorDependencies {
  readonly digestFile?: (path: string) => Promise<string>;
  readonly runProcess?: (config: ClaudeCliNegotiatorConfig, prompt: string) => Promise<ClaudeCliProcessResult>;
}

export type ClaudeHostWorkflowNegotiationResult =
  | { readonly kind: "locked"; readonly contract: LockedStepContractV2 }
  | { readonly kind: "conflict"; readonly reason: string; readonly details: string }
  | { readonly kind: "stopped"; readonly reason: "driver_untrusted" | "claude_timeout" | "contract_malformed" | "adapter_error" };

const ClaudeCliJsonResultSchema = z.object({
  type: z.literal("result"),
  subtype: z.literal("success"),
  is_error: z.literal(false),
  structured_output: z.unknown(),
}).passthrough();

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

export class ClaudeHostWorkflowNegotiator {
  public constructor(
    private readonly config: ClaudeCliNegotiatorConfig,
    private readonly dependencies: ClaudeHostWorkflowNegotiatorDependencies = {},
  ) {}

  public async negotiate(requestInput: ClaudeHostWorkflowNegotiationRequestV1): Promise<ClaudeHostWorkflowNegotiationResult> {
    const request = ClaudeHostWorkflowNegotiationRequestV1Schema.parse(requestInput);
    try {
      if (await (this.dependencies.digestFile ?? sha256File)(this.config.executablePath) !== this.config.expectedExecutableSha256) {
        return { kind: "stopped", reason: "driver_untrusted" };
      }
    } catch {
      return { kind: "stopped", reason: "driver_untrusted" };
    }
    const prompt = canonicalJson({
      instruction: [
        "Review the complete strict candidate contract as an independent contract counterparty.",
        "Return exactly one digest-bound decision: lock the unchanged candidate digest, or report a bounded conflict.",
        "Do not use tools. Do not claim implementation, PR, CI, merge, credential, or deployment authority.",
        "Do not widen paths, checks, budgets, adapter capabilities, cleanup capabilities, or merge authority.",
      ],
      responseContract: {
        fields: ["kind", "candidateContractDigest", "reason", "details"],
        locked: "kind=locked, candidateContractDigest exactly equals candidateContract.contractDigest, reason=none",
        conflict: "kind=conflict, same candidateContractDigest, non-none identifier reason, bounded details",
      },
      request,
    });
    const responseJsonSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["locked", "conflict"] },
        candidateContractDigest: { type: "string", enum: [request.candidateContract.contractDigest] },
        reason: { type: "string", pattern: "^[a-zA-Z0-9._:-]+$", minLength: 1, maxLength: 160 },
        details: { type: "string", minLength: 1, maxLength: 4000 },
      },
      required: ["kind", "candidateContractDigest", "reason", "details"],
    };
    const processResult = this.dependencies.runProcess === undefined
      ? await this.run(prompt, responseJsonSchema)
      : await this.dependencies.runProcess(this.config, prompt);
    if (processResult.kind !== "ok") {
      return { kind: "stopped", reason: processResult.kind === "timeout" ? "claude_timeout" : "adapter_error" };
    }
    let json: unknown;
    try {
      const cliResult = ClaudeCliJsonResultSchema.parse(JSON.parse(processResult.stdout));
      json = cliResult.structured_output;
    } catch { return { kind: "stopped", reason: "contract_malformed" }; }
    const response = ClaudeHostWorkflowNegotiationResponseV1Schema.safeParse(json);
    if (!response.success) return { kind: "stopped", reason: "contract_malformed" };
    if (response.data.candidateContractDigest !== request.candidateContract.contractDigest) {
      return { kind: "stopped", reason: "contract_malformed" };
    }
    if (response.data.kind === "conflict") {
      return { kind: "conflict", reason: response.data.reason, details: response.data.details };
    }
    if (!verifyLockedStepContractV2Digest(request.candidateContract)) {
      return { kind: "stopped", reason: "contract_malformed" };
    }
    return { kind: "locked", contract: request.candidateContract };
  }

  private async run(prompt: string, responseJsonSchema: Readonly<Record<string, unknown>>): Promise<ClaudeCliProcessResult> {
    return await new Promise((resolve) => {
      const child = spawn(
        this.config.executablePath,
        [
          "-p",
          "--max-turns", "2",
          "--tools", "",
          "--output-format", "json",
          "--json-schema", JSON.stringify(responseJsonSchema),
          "--system-prompt", "You are a strict JSON contract counterparty. Return only structured output matching the supplied JSON Schema. Never call tools.",
          "--disable-slash-commands",
          "--no-session-persistence",
          "--strict-mcp-config",
          "--mcp-config", "{\"mcpServers\":{}}",
          "--setting-sources", "",
          "--exclude-dynamic-system-prompt-sections",
        ],
        {
          cwd: this.config.workingDirectory,
          env: { ...this.config.environment },
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const stdout: Buffer[] = [];
      let bytes = 0;
      let settled = false;
      const finish = (value: ClaudeCliProcessResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > this.config.maxOutputBytes) {
          child.kill();
          finish({ kind: "output_limit", stdout: "" });
        } else stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > this.config.maxOutputBytes) {
          child.kill();
          finish({ kind: "output_limit", stdout: "" });
        }
      });
      child.on("error", () => finish({ kind: "error", stdout: "" }));
      child.on("close", (code) => finish(code === 0
        ? { kind: "ok", stdout: Buffer.concat(stdout).toString("utf8") }
        : { kind: "error", stdout: "" }));
      const timer = setTimeout(() => {
        child.kill();
        finish({ kind: "timeout", stdout: "" });
      }, this.config.timeoutMs);
      child.stdin.end(prompt, "utf8");
    });
  }
}
