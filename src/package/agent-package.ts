import { createHash } from "node:crypto";
import { AgentSpecApprovalSchema } from "../schema/approval-artifact.js";
import { AgentSpecContentSchema } from "../schema/agent-spec-content.js";
import { EvaluationOutcomeSchema } from "../schema/evaluation-outcome.js";

const encoder = new TextEncoder();
const requiredPaths = ["agent-spec.json", "approval.json", "evaluation.json"] as const;

export interface AgentPackageInput { readonly spec: unknown; readonly approval: unknown; readonly evaluation: unknown; }
export interface AgentPackage {
  readonly fileName: string; readonly bytes: Uint8Array; readonly sha256: string;
  readonly manifest: { readonly schemaVersion: "agent-package-manifest/1"; readonly specId: string; readonly version: string; readonly contentHash: string; readonly files: readonly { readonly path: string; readonly sha256: string }[]; };
}
function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function u16(value: number): Uint8Array { return Uint8Array.of(value & 255, value >>> 8 & 255); }
function u32(value: number): Uint8Array { return Uint8Array.of(value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255); }
function join(parts: readonly Uint8Array[]): Uint8Array { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }
function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function json(value: unknown): Uint8Array { return encoder.encode(JSON.stringify(value, null, 2) + "\n"); }
function zip(files: readonly { readonly path: string; readonly bytes: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const file of files) { const path = encoder.encode(file.path); const crc = crc32(file.bytes); const local = join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(file.bytes.length), u32(file.bytes.length), u16(path.length), u16(0), path, file.bytes]); locals.push(local); central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(file.bytes.length), u32(file.bytes.length), u16(path.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), path])); offset += local.length; }
  const directory = join(central); return join([...locals, directory, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(directory.length), u32(offset), u16(0)]);
}
function prohibited(value: unknown): boolean { return /(-----begin .*private key|akia[0-9a-z]{16}|password\s*[=:]|api[_-]?key\s*[=:]|customerconfiguration|serveraccess)/.test(JSON.stringify(value).toLowerCase()); }

/** Builds a deterministic ZIP in memory; no repository write or deployment occurs. */
export function buildAgentPackage(input: AgentPackageInput): AgentPackage {
  const spec = AgentSpecContentSchema.parse(input.spec); const approval = AgentSpecApprovalSchema.parse(input.approval); const evaluation = EvaluationOutcomeSchema.parse(input.evaluation);
  if (approval.decision !== "approved" || approval.specId !== spec.specId || approval.version !== spec.version || approval.contentHash !== spec.contentHash) throw new TypeError("approval does not bind this exact spec");
  if (evaluation.subject.specId !== spec.specId || evaluation.subject.version !== spec.version || evaluation.subject.contentHash !== spec.contentHash) throw new TypeError("evaluation does not bind this exact spec");
  if (prohibited({ spec, approval, evaluation })) throw new TypeError("package contains prohibited customer or credential material");
  const artifacts = [{ path: "agent-spec.json", bytes: json(spec) }, { path: "approval.json", bytes: json(approval) }, { path: "evaluation.json", bytes: json(evaluation) }];
  const manifest = { schemaVersion: "agent-package-manifest/1" as const, specId: spec.specId, version: spec.version, contentHash: spec.contentHash, files: artifacts.map((artifact) => ({ path: artifact.path, sha256: digest(artifact.bytes) })) };
  const bytes = zip([...artifacts, { path: "manifest.json", bytes: json(manifest) }]); return { fileName: `${spec.specId}-${spec.version}.zip`, bytes, sha256: digest(bytes), manifest };
}
export function requiredPackageArtifactsPresent(manifest: AgentPackage["manifest"]): boolean { return requiredPaths.every((path) => manifest.files.some((file) => file.path === path)); }
