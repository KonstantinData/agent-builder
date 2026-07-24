import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/orchestration/canonical-json.js";
import { FileOrchestrationStore, OrchestrationPersistenceError } from "../../src/orchestration/persistence.js";
import { createOrchestrationEvent, createVerifiedRunSnapshot } from "../../src/orchestration/reducer.js";
import { testIntent } from "./support.js";
import { BASE_SHA } from "./support.js";

const directories: string[] = [];
const inspectionPayload = {
  evidenceDigest: "a".repeat(64),
  originMainSha: BASE_SHA,
  attendedLocal: true,
  deploysOnMain: false,
  defaultBranchProtected: true,
  roadmapHistoryVerified: true,
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryStore() {
  const directory = await mkdtemp(join(tmpdir(), "agent-builder-orchestration-"));
  directories.push(directory);
  return { directory, store: new FileOrchestrationStore(directory) };
}

describe("file orchestration persistence", () => {
  it("durably appends events, resumes deterministically, and treats exact replay as a no-op", async () => {
    const { store } = await temporaryStore();
    const initial = createVerifiedRunSnapshot("run-001", testIntent());
    await store.initialize(initial);
    const event = createOrchestrationEvent({
      eventId: "event-001",
      runId: initial.runId,
      sequence: 1,
      observedAt: "2026-07-24T10:00:00Z",
      kind: "RepositoryInspected",
      payload: inspectionPayload,
      previousEventDigest: null,
    });
    const appended = await store.append(initial, event);
    expect((await store.load()).snapshotDigest).toBe(appended.snapshotDigest);
    expect((await store.append(initial, event)).snapshotDigest).toBe(appended.snapshotDigest);
    await expect(store.initialize(initial)).resolves.toBeUndefined();
  });

  it("recovers an event flushed before the snapshot replacement", async () => {
    const { directory, store } = await temporaryStore();
    const initial = createVerifiedRunSnapshot("run-001", testIntent());
    await store.initialize(initial);
    const event = createOrchestrationEvent({
      eventId: "event-001",
      runId: initial.runId,
      sequence: 1,
      observedAt: "2026-07-24T10:00:00Z",
      kind: "RepositoryInspected",
      payload: inspectionPayload,
      previousEventDigest: null,
    });
    await writeFile(join(directory, "events.jsonl"), `${canonicalJson(event)}\n`, "utf8");
    const recovered = await store.load();
    expect(recovered).toMatchObject({ phase: "repository_inspected", lastSequence: 1 });
    expect(JSON.parse(await readFile(join(directory, "snapshot.json"), "utf8"))).toMatchObject({ lastSequence: 1 });
  });

  it("rejects reuse of an event identity with conflicting bytes", async () => {
    const { directory, store } = await temporaryStore();
    const initial = createVerifiedRunSnapshot("run-001", testIntent());
    await store.initialize(initial);
    const event = createOrchestrationEvent({
      eventId: "event-001",
      runId: initial.runId,
      sequence: 1,
      observedAt: "2026-07-24T10:00:00Z",
      kind: "RepositoryInspected",
      payload: inspectionPayload,
      previousEventDigest: null,
    });
    await store.append(initial, event);
    const conflicting = createOrchestrationEvent({ ...event, observedAt: "2026-07-24T10:01:00Z" });
    await writeFile(join(directory, "events.jsonl"), `${canonicalJson(event)}\n${canonicalJson(conflicting)}\n`, "utf8");
    await expect(store.load()).rejects.toBeInstanceOf(OrchestrationPersistenceError);
  });
});
