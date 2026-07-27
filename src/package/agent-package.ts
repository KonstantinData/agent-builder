import { createHash } from "node:crypto";
import { AgentSpecApprovalSchema } from "../schema/approval-artifact.js";
import { AgentSpecContentSchema } from "../schema/agent-spec-content.js";
import { EvaluationOutcomeSchema } from "../schema/evaluation-outcome.js";

const encoder = new TextEncoder();
const requiredPaths = ["agent-spec.json", "approval.json", "evaluation.json"] as const;
const packagePaths = [...requiredPaths, "manifest.json"] as const;

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
function readU16(bytes: Uint8Array, offset: number): number { return bytes[offset]! | bytes[offset + 1]! << 8; }
function readU32(bytes: Uint8Array, offset: number): number { return (bytes[offset]! | bytes[offset + 1]! << 8 | bytes[offset + 2]! << 16 | bytes[offset + 3]! << 24) >>> 0; }
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

export type PackageByteVerification =
  | { readonly success: true; readonly manifest: AgentPackage["manifest"]; readonly artifacts: Readonly<Record<(typeof requiredPaths)[number], Uint8Array>> }
  | { readonly success: false; readonly reason: string };

/**
 * Reads the actual, uncompressed ZIP bytes produced by this Builder and checks
 * its complete embedded evidence chain. This intentionally trusts neither
 * caller-supplied manifest metadata nor filenames outside the archive.
 */
export function verifyAgentPackageBytes(bytes: Uint8Array): PackageByteVerification {
  try {
    const files = new Map<string, Uint8Array>();
    const localEntries = new Map<string, { readonly offset: number; readonly crc: number; readonly size: number }>();
    let offset = 0;
    while (offset + 4 <= bytes.length && readU32(bytes, offset) === 0x04034b50) {
      if (offset + 30 > bytes.length) return { success: false, reason: "truncated_local_header" };
      const flags = readU16(bytes, offset + 6); const method = readU16(bytes, offset + 8);
      const expectedCrc = readU32(bytes, offset + 14); const size = readU32(bytes, offset + 18);
      const nameSize = readU16(bytes, offset + 26); const extraSize = readU16(bytes, offset + 28);
      if (flags !== 0 || method !== 0) return { success: false, reason: "unsupported_zip_encoding" };
      const contentStart = offset + 30 + nameSize + extraSize; const contentEnd = contentStart + size;
      if (contentEnd > bytes.length) return { success: false, reason: "truncated_zip_entry" };
      const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameSize));
      if (!packagePaths.includes(name as (typeof packagePaths)[number]) || files.has(name)) return { success: false, reason: "unexpected_or_duplicate_entry" };
      const content = bytes.slice(contentStart, contentEnd);
      if (crc32(content) !== expectedCrc) return { success: false, reason: "zip_crc_mismatch" };
      files.set(name, content); localEntries.set(name, { offset, crc: expectedCrc, size }); offset = contentEnd;
    }
    if (files.size !== packagePaths.length || packagePaths.some((path) => !files.has(path))) return { success: false, reason: "required_entry_missing" };
    const trailer = bytes.length - 22;
    if (trailer < offset || readU32(bytes, trailer) !== 0x06054b50 || readU16(bytes, trailer + 20) !== 0 || readU16(bytes, trailer + 8) !== files.size || readU16(bytes, trailer + 10) !== files.size || readU32(bytes, trailer + 12) !== trailer - offset || readU32(bytes, trailer + 16) !== offset) return { success: false, reason: "invalid_zip_trailer" };
    let centralOffset = offset;
    const centralNames = new Set<string>();
    while (centralOffset < trailer) {
      if (centralOffset + 46 > trailer || readU32(bytes, centralOffset) !== 0x02014b50) return { success: false, reason: "invalid_central_directory" };
      const flags = readU16(bytes, centralOffset + 8); const method = readU16(bytes, centralOffset + 10); const crc = readU32(bytes, centralOffset + 16); const compressedSize = readU32(bytes, centralOffset + 20); const size = readU32(bytes, centralOffset + 24); const nameSize = readU16(bytes, centralOffset + 28); const extraSize = readU16(bytes, centralOffset + 30); const commentSize = readU16(bytes, centralOffset + 32); const localOffset = readU32(bytes, centralOffset + 42);
      const end = centralOffset + 46 + nameSize + extraSize + commentSize;
      if (end > trailer || flags !== 0 || method !== 0) return { success: false, reason: "invalid_central_directory" };
      const name = new TextDecoder().decode(bytes.slice(centralOffset + 46, centralOffset + 46 + nameSize)); const local = localEntries.get(name);
      if (centralNames.has(name) || local === undefined || local.offset !== localOffset || local.crc !== crc || local.size !== size || compressedSize !== size) return { success: false, reason: "central_directory_mismatch" };
      centralNames.add(name);
      centralOffset = end;
    }
    if (centralOffset !== trailer || centralNames.size !== packagePaths.length || packagePaths.some((path) => !centralNames.has(path))) return { success: false, reason: "invalid_central_directory" };
    const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json")!)) as AgentPackage["manifest"];
    if (manifest.schemaVersion !== "agent-package-manifest/1" || typeof manifest.specId !== "string" || typeof manifest.version !== "string" || typeof manifest.contentHash !== "string" || !Array.isArray(manifest.files) || manifest.files.length !== requiredPaths.length) return { success: false, reason: "invalid_embedded_manifest" };
    const listed = new Map(manifest.files.map((file) => [file.path, file.sha256]));
    if (listed.size !== requiredPaths.length || requiredPaths.some((path) => listed.get(path) !== digest(files.get(path)!))) return { success: false, reason: "artifact_digest_mismatch" };
    return { success: true, manifest, artifacts: Object.fromEntries(requiredPaths.map((path) => [path, files.get(path)!])) as Record<(typeof requiredPaths)[number], Uint8Array> };
  } catch { return { success: false, reason: "invalid_zip_or_manifest" }; }
}
