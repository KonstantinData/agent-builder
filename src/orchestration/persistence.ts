import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson } from "./canonical-json.js";
import {
  OrchestrationEventV1Schema,
  OrchestrationSnapshotV1Schema,
  createVerifiedRunSnapshot,
  reduceOrchestration,
  type OrchestrationEventV1,
  type OrchestrationSnapshotV1,
} from "./reducer.js";

export class OrchestrationPersistenceError extends Error {
  public readonly reason = "corruption_detected" as const;

  public constructor(message: string) {
    super(message);
    this.name = "OrchestrationPersistenceError";
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWrite(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  const handle = await open(temporaryPath, "w");
  try {
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
}

async function appendDurably(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  try {
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class FileOrchestrationStore {
  readonly #snapshotPath: string;
  readonly #eventsPath: string;

  public constructor(directory: string) {
    this.#snapshotPath = join(directory, "snapshot.json");
    this.#eventsPath = join(directory, "events.jsonl");
  }

  public async initialize(snapshotInput: OrchestrationSnapshotV1): Promise<void> {
    const snapshot = OrchestrationSnapshotV1Schema.parse(snapshotInput);
    if (await pathExists(this.#snapshotPath)) {
      const existing = await this.load();
      if (existing.runId !== snapshot.runId || existing.intent.intentDigest !== snapshot.intent.intentDigest) {
        throw new OrchestrationPersistenceError("run state already exists for a different run or intent");
      }
      return;
    }
    await atomicWrite(this.#snapshotPath, `${canonicalJson(snapshot)}\n`);
  }

  public async load(): Promise<OrchestrationSnapshotV1> {
    const snapshot = OrchestrationSnapshotV1Schema.parse(
      JSON.parse(await readFile(this.#snapshotPath, "utf8")),
    );
    let events: OrchestrationEventV1[] = [];
    if (await pathExists(this.#eventsPath)) {
      const text = await readFile(this.#eventsPath, "utf8");
      events = text
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line) => OrchestrationEventV1Schema.parse(JSON.parse(line)));
    }
    const eventIds = new Map<string, string>();
    let replay = createVerifiedRunSnapshot(snapshot.runId, snapshot.intent);
    let snapshotAtRecordedSequence: OrchestrationSnapshotV1 | undefined = replay.lastSequence === snapshot.lastSequence ? replay : undefined;
    for (const event of events) {
      const priorDigest = eventIds.get(event.eventId);
      if (priorDigest !== undefined) {
        if (priorDigest === event.eventDigest) continue;
        throw new OrchestrationPersistenceError("event identity was reused with different bytes");
      }
      eventIds.set(event.eventId, event.eventDigest);
      replay = reduceOrchestration(replay, event);
      if (replay.phase === "stopped" && replay.stopReason === "corruption_detected") {
        throw new OrchestrationPersistenceError("event history failed deterministic replay");
      }
      if (replay.lastSequence === snapshot.lastSequence) snapshotAtRecordedSequence = replay;
    }
    if (snapshotAtRecordedSequence?.snapshotDigest !== snapshot.snapshotDigest) {
      throw new OrchestrationPersistenceError("snapshot does not match its event prefix");
    }
    if (replay.lastSequence > snapshot.lastSequence) {
      await atomicWrite(this.#snapshotPath, `${canonicalJson(replay)}\n`);
    }
    return replay;
  }

  public async append(
    snapshotInput: OrchestrationSnapshotV1,
    eventInput: OrchestrationEventV1,
  ): Promise<OrchestrationSnapshotV1> {
    const current = await this.load();
    const expected = OrchestrationSnapshotV1Schema.parse(snapshotInput);
    const event = OrchestrationEventV1Schema.parse(eventInput);

    if (await pathExists(this.#eventsPath)) {
      const lines = (await readFile(this.#eventsPath, "utf8")).split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const existing = OrchestrationEventV1Schema.parse(JSON.parse(line));
        if (existing.eventId === event.eventId) {
          if (existing.eventDigest !== event.eventDigest) {
            throw new OrchestrationPersistenceError("event identity was reused with different bytes");
          }
          return current;
        }
      }
    }
    if (current.snapshotDigest !== expected.snapshotDigest) {
      throw new OrchestrationPersistenceError("caller snapshot is stale or conflicting");
    }

    const next = reduceOrchestration(current, event);
    await appendDurably(this.#eventsPath, `${canonicalJson(event)}\n`);
    await atomicWrite(this.#snapshotPath, `${canonicalJson(next)}\n`);
    return next;
  }
}
