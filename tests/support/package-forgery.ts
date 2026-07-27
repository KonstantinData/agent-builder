import { createHash } from "node:crypto";
import type { AgentPackage } from "../../src/package/agent-package.js";
import type { AgentSpecContent } from "../../src/schema/agent-spec-content.js";

const encoder = new TextEncoder();
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const u16 = (value: number) => Uint8Array.of(value & 255, value >>> 8 & 255);
const u32 = (value: number) => Uint8Array.of(value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255);
const join = (parts: readonly Uint8Array[]) => { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; };
function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function zip(files: readonly { readonly path: string; readonly bytes: Uint8Array }[]): Uint8Array { const locals: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0; for (const file of files) { const path = encoder.encode(file.path); const crc = crc32(file.bytes); const local = join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(file.bytes.length), u32(file.bytes.length), u16(path.length), u16(0), path, file.bytes]); locals.push(local); central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(file.bytes.length), u32(file.bytes.length), u16(path.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), path])); offset += local.length; } const directory = join(central); return join([...locals, directory, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(directory.length), u32(offset), u16(0)]); }

/** Creates a structurally valid ZIP whose manifest and CRCs are consistent, but whose Spec retains a stale contentHash. */
export function forgePackageWithStaleSpecHash(input: { readonly spec: AgentSpecContent; readonly approval: unknown; readonly evaluation: unknown }): AgentPackage {
  const forgedSpec = { ...input.spec, objective: "Modified objective while retaining the declared content hash." };
  const artifacts = [
    { path: "agent-spec.json", bytes: encoder.encode(JSON.stringify(forgedSpec, null, 2) + "\n") },
    { path: "approval.json", bytes: encoder.encode(JSON.stringify(input.approval, null, 2) + "\n") },
    { path: "evaluation.json", bytes: encoder.encode(JSON.stringify(input.evaluation, null, 2) + "\n") },
  ] as const;
  const manifest = { schemaVersion: "agent-package-manifest/1" as const, specId: input.spec.specId, version: input.spec.version, contentHash: input.spec.contentHash, files: artifacts.map((artifact) => ({ path: artifact.path, sha256: sha256(artifact.bytes) })) };
  const bytes = zip([...artifacts, { path: "manifest.json", bytes: encoder.encode(JSON.stringify(manifest, null, 2) + "\n") }]);
  return { fileName: `${input.spec.specId}-${input.spec.version}.zip`, bytes, sha256: sha256(bytes), manifest };
}
