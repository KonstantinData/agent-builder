import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson } from "./canonical-json.js";
import {
  HostWorkflowEventV1Schema,
  HostWorkflowSnapshotV1Schema,
  createHostWorkflowSnapshot,
  reduceHostWorkflow,
  verifyHostWorkflowSnapshotDigest,
  type HostWorkflowEventV1,
  type HostWorkflowSnapshotV1,
} from "./host-workflow-reducer.js";

export class HostWorkflowPersistenceError extends Error {
  public readonly reason = "corruption_detected" as const;

  public constructor(message: string) {
    super(message);
    this.name = "HostWorkflowPersistenceError";
  }
}

async function exists(path: string): Promise<boolean> {
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

export interface HostWorkflowStore {
  hasSnapshot(): Promise<boolean>;
  initialize(snapshot: HostWorkflowSnapshotV1): Promise<void>;
  load(): Promise<HostWorkflowSnapshotV1>;
  loadEvents(): Promise<readonly HostWorkflowEventV1[]>;
  append(snapshot: HostWorkflowSnapshotV1, event: HostWorkflowEventV1): Promise<HostWorkflowSnapshotV1>;
  acquireControllerLock(): Promise<(() => Promise<void>) | null>;
}

export class FileHostWorkflowStore implements HostWorkflowStore {
  readonly #directory: string;
  readonly #snapshotPath: string;
  readonly #eventsPath: string;
  readonly #lockPath: string;

  public constructor(directory: string) {
    this.#directory = directory;
    this.#snapshotPath = join(directory, "host-workflow-snapshot.json");
    this.#eventsPath = join(directory, "host-workflow-events.jsonl");
    this.#lockPath = join(directory, ".host-workflow-controller.lock");
  }

  public async hasSnapshot(): Promise<boolean> { return await exists(this.#snapshotPath); }

  public async acquireControllerLock(): Promise<(() => Promise<void>) | null> {
    await mkdir(this.#directory, { recursive: true });
    let handle;
    try {
      handle = await open(this.#lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await handle.close();
      await unlink(this.#lockPath);
    };
  }

  public async initialize(snapshotInput: HostWorkflowSnapshotV1): Promise<void> {
    const snapshot = HostWorkflowSnapshotV1Schema.parse(snapshotInput);
    await mkdir(this.#directory, { recursive: true });
    try {
      const handle = await open(this.#snapshotPath, "wx");
      try {
        await handle.writeFile(`${canonicalJson(snapshot)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await this.load();
      if (existing.runId !== snapshot.runId || existing.contract.contractDigest !== snapshot.contract.contractDigest) {
        throw new HostWorkflowPersistenceError("host workflow state already exists with different immutable bindings");
      }
    }
  }

  public async loadEvents(): Promise<readonly HostWorkflowEventV1[]> {
    if (!(await exists(this.#eventsPath))) return [];
    const body = await readFile(this.#eventsPath, "utf8");
    return body.split(/\r?\n/).filter(Boolean).map((line) => HostWorkflowEventV1Schema.parse(JSON.parse(line)));
  }

  public async load(): Promise<HostWorkflowSnapshotV1> {
    const recorded = HostWorkflowSnapshotV1Schema.parse(JSON.parse(await readFile(this.#snapshotPath, "utf8")));
    if (!verifyHostWorkflowSnapshotDigest(recorded)) {
      throw new HostWorkflowPersistenceError("recorded host workflow snapshot digest is invalid");
    }
    let replay = createHostWorkflowSnapshot({
      runId: recorded.runId,
      intent: recorded.intent,
      startEvidence: recorded.startEvidence,
      contract: recorded.contract,
      headSha: recorded.headSha,
    });
    const eventIds = new Map<string, string>();
    let atRecordedSequence: HostWorkflowSnapshotV1 | undefined = replay.lastSequence === recorded.lastSequence ? replay : undefined;
    for (const event of await this.loadEvents()) {
      const prior = eventIds.get(event.eventId);
      if (prior !== undefined) {
        if (prior === event.eventDigest) continue;
        throw new HostWorkflowPersistenceError("event identity was reused with different bytes");
      }
      eventIds.set(event.eventId, event.eventDigest);
      replay = reduceHostWorkflow(replay, event);
      if (replay.phase === "stopped" && replay.stopReason === "corruption_detected") {
        throw new HostWorkflowPersistenceError("host workflow history failed deterministic replay");
      }
      if (replay.lastSequence === recorded.lastSequence) atRecordedSequence = replay;
    }
    if (atRecordedSequence?.snapshotDigest !== recorded.snapshotDigest) {
      throw new HostWorkflowPersistenceError("snapshot does not match its durable event prefix");
    }
    if (replay.lastSequence > recorded.lastSequence) await atomicWrite(this.#snapshotPath, `${canonicalJson(replay)}\n`);
    return replay;
  }

  public async append(
    snapshotInput: HostWorkflowSnapshotV1,
    eventInput: HostWorkflowEventV1,
  ): Promise<HostWorkflowSnapshotV1> {
    const current = await this.load();
    const expected = HostWorkflowSnapshotV1Schema.parse(snapshotInput);
    const event = HostWorkflowEventV1Schema.parse(eventInput);
    for (const existing of await this.loadEvents()) {
      if (existing.eventId !== event.eventId) continue;
      if (existing.eventDigest !== event.eventDigest) throw new HostWorkflowPersistenceError("event identity collision");
      return current;
    }
    if (current.snapshotDigest !== expected.snapshotDigest) throw new HostWorkflowPersistenceError("caller snapshot is stale");
    const next = reduceHostWorkflow(current, event);
    const handle = await open(this.#eventsPath, "a");
    try {
      await handle.writeFile(`${canonicalJson(event)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await atomicWrite(this.#snapshotPath, `${canonicalJson(next)}\n`);
    return next;
  }
}

export class InMemoryHostWorkflowStore implements HostWorkflowStore {
  #snapshot: HostWorkflowSnapshotV1 | null = null;
  #events: HostWorkflowEventV1[] = [];
  #locked = false;

  public async hasSnapshot(): Promise<boolean> { return this.#snapshot !== null; }
  public async initialize(snapshot: HostWorkflowSnapshotV1): Promise<void> {
    if (this.#snapshot === null) this.#snapshot = HostWorkflowSnapshotV1Schema.parse(snapshot);
    else if (this.#snapshot.contract.contractDigest !== snapshot.contract.contractDigest) throw new HostWorkflowPersistenceError("conflicting initialization");
  }
  public async load(): Promise<HostWorkflowSnapshotV1> {
    if (this.#snapshot === null) throw new HostWorkflowPersistenceError("snapshot missing");
    return this.#snapshot;
  }
  public async loadEvents(): Promise<readonly HostWorkflowEventV1[]> { return [...this.#events]; }
  public async append(snapshot: HostWorkflowSnapshotV1, event: HostWorkflowEventV1): Promise<HostWorkflowSnapshotV1> {
    const current = await this.load();
    if (current.snapshotDigest !== snapshot.snapshotDigest) throw new HostWorkflowPersistenceError("caller snapshot is stale");
    const existing = this.#events.find((candidate) => candidate.eventId === event.eventId);
    if (existing !== undefined) {
      if (existing.eventDigest !== event.eventDigest) throw new HostWorkflowPersistenceError("event identity collision");
      return current;
    }
    const next = reduceHostWorkflow(current, event);
    this.#events.push(event);
    this.#snapshot = next;
    return next;
  }
  public async acquireControllerLock(): Promise<(() => Promise<void>) | null> {
    if (this.#locked) return null;
    this.#locked = true;
    return async () => { this.#locked = false; };
  }
}
