// Durable LangGraph checkpointing over Prisma/SQLite (spec §4, §7).
// Storage model is a faithful port of MemorySaver (whole-checkpoint blobs +
// per-(checkpoint, task, idx) writes) so resume semantics are identical.
// Interrupted workflows (e.g. waiting for approval) survive process restarts.

import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import {
  WRITES_IDX_MAP,
  compareWritesSortKeys,
  writesSortKey,
} from '@langchain/langgraph-checkpoint';
import type {
  Checkpoint,
  CheckpointListOptions,
  CheckpointMetadata,
  CheckpointPendingWrite,
  CheckpointTuple,
  ChannelVersions,
  PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { LangGraphRunnableConfig as RunnableConfig } from '@langchain/langgraph';
import { db } from '@/lib/db';

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
function unb64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

interface Row {
  id: string;
  threadId: string;
  checkpointNs: string;
  checkpointId: string;
  ts: string;
  parentCheckpointId: string | null;
  blob: string;
  metadata: string;
  createdAt: Date;
}

interface WriteRow {
  taskId: string;
  taskPath: string;
  idx: number;
  channel: string;
  type: string;
  blob: string;
}

export class PrismaCheckpointSaver extends BaseCheckpointSaver {
  private ckId(config: RunnableConfig): { threadId: string; ns: string } {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) throw new Error('checkpointer: missing thread_id');
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    return { threadId, ns };
  }

  private async latestRow(threadId: string, ns: string): Promise<Row | undefined> {
    const rows = await db.$queryRaw<Array<Row>>`
      SELECT "id", "threadId", "checkpointNs", "checkpointId", "ts", "parentCheckpointId", "blob", "metadata", "createdAt"
      FROM "AgentCheckpoint" WHERE "threadId" = ${threadId} AND "checkpointNs" = ${ns}
      ORDER BY rowid DESC LIMIT 1`;
    return rows[0];
  }

  private async writesFor(threadId: string, ns: string, checkpointId: string): Promise<CheckpointPendingWrite[]> {
    const rows = (await db.$queryRaw<Array<WriteRow & { createdAt: Date }>>`
      SELECT "taskId", "taskPath", "idx", "channel", "type", "blob", "createdAt"
      FROM "AgentCheckpointWrite"
      WHERE "threadId" = ${threadId} AND "checkpointNs" = ${ns} AND "checkpointId" = ${checkpointId}
      ORDER BY rowid ASC`) as Array<WriteRow & { createdAt: Date }>;

    // MemorySaver-compatible ordering & dedupe (first write per (taskId, idx) wins)
    const seen = new Set<string>();
    const entries = rows
      .map((w) => ({ w, key: writesSortKey(w.taskPath, w.taskId, w.idx) }))
      .filter(({ w }) => {
        const k = `${w.taskId}:${w.idx}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      // keep insertion order but respect writesSortKey ordering for same-task groups
      .sort((a, b2) => compareWritesSortKeys(a.key, b2.key));

    return Promise.all(
      entries.map(async ({ w }) => [w.taskId, w.channel, await this.serde.loadsTyped(w.type, unb64(w.blob))]),
    );
  }

  override async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { threadId, ns } = this.ckId(config);
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;

    const row = checkpointId
      ? await db.agentCheckpoint.findUnique({
          where: { threadId_checkpointNs_checkpointId: { threadId, checkpointNs: ns, checkpointId } },
        })
      : await this.latestRow(threadId, ns);
    if (!row) return undefined;

    const pendingWrites = await this.writesFor(threadId, ns, row.checkpointId);
    const checkpoint = (await this.serde.loadsTyped('json', unb64(row.blob))) as Checkpoint;

    return {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: ns,
          checkpoint_id: row.checkpointId,
        },
      },
      checkpoint,
      metadata: (await this.serde.loadsTyped('json', unb64(row.metadata))) as CheckpointMetadata,
      parentConfig: row.parentCheckpointId
        ? { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: row.parentCheckpointId } }
        : undefined,
      pendingWrites,
    };
  }

  override async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const { threadId, ns } = this.ckId(config);
    if (!threadId) return;
    const rows = await db.$queryRaw<Array<Row>>`
      SELECT "id", "threadId", "checkpointNs", "checkpointId", "ts", "parentCheckpointId", "blob", "metadata", "createdAt"
      FROM "AgentCheckpoint" WHERE "threadId" = ${threadId} AND "checkpointNs" = ${ns}
      ORDER BY rowid DESC LIMIT ${options?.limit ?? 100}`;
    for (const row of rows) {
      if (options?.filter) {
        const meta = (await this.serde.loadsTyped('json', unb64(row.metadata))) as Record<string, unknown>;
        const ok = Object.entries(options.filter).every(([k, v]) => meta[k] === v);
        if (!ok) continue;
      }
      const checkpoint = (await this.serde.loadsTyped('json', unb64(row.blob))) as Checkpoint;
      yield {
        config: { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: row.checkpointId } },
        checkpoint,
        metadata: (await this.serde.loadsTyped('json', unb64(row.metadata))) as CheckpointMetadata,
        parentConfig: row.parentCheckpointId
          ? { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: row.parentCheckpointId } }
          : undefined,
      };
    }
  }

  override async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const { threadId, ns } = this.ckId(config);
    const parentCheckpointId = (config.configurable?.checkpoint_id as string | undefined) ?? null;
    const [, checkpointBlob] = await this.serde.dumpsTyped(checkpoint);
    const [, metadataBlob] = await this.serde.dumpsTyped(metadata);

    await db.agentCheckpoint.upsert({
      where: {
        threadId_checkpointNs_checkpointId: { threadId, checkpointNs: ns, checkpointId: checkpoint.id },
      },
      create: {
        id: `${threadId}:${ns}:${checkpoint.id}`,
        threadId,
        checkpointNs: ns,
        checkpointId: checkpoint.id,
        ts: typeof checkpoint.ts === 'string' ? checkpoint.ts : new Date().toISOString(),
        parentCheckpointId,
        blob: b64(checkpointBlob),
        metadata: b64(metadataBlob),
      },
      update: {
        ts: typeof checkpoint.ts === 'string' ? checkpoint.ts : new Date().toISOString(),
        parentCheckpointId,
        blob: b64(checkpointBlob),
        metadata: b64(metadataBlob),
      },
    });

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: ns,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  override async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
    taskPath?: string,
  ): Promise<void> {
    const { threadId, ns } = this.ckId(config);
    const checkpointId = (config.configurable?.checkpoint_id as string | undefined) ?? '';
    const taskPathStr = taskPath ?? '';
    const existing = await db.agentCheckpointWrite.findMany({
      where: { threadId, checkpointNs: ns, checkpointId, taskId },
      select: { idx: true },
    });
    const existingIdx = new Set(existing.map((e) => e.idx));

    for (let i = 0; i < writes.length; i++) {
      const [channel, value] = writes[i];
      const idx = WRITES_IDX_MAP[channel] || i; // mirror MemorySaver keying
      if (idx >= 0 && existingIdx.has(idx)) continue; // first write wins
      const [type, bytes] = await this.serde.dumpsTyped(value);
      await db.agentCheckpointWrite.upsert({
        where: {
          threadId_checkpointNs_checkpointId_taskId_idx: { threadId, checkpointNs: ns, checkpointId, taskId, idx },
        },
        create: { threadId, checkpointNs: ns, checkpointId, taskId, taskPath: taskPathStr, idx, channel, type, blob: b64(bytes) },
        update: {},
      });
      existingIdx.add(idx);
    }
  }

  override async deleteThread(threadId: string): Promise<void> {
    await db.agentCheckpoint.deleteMany({ where: { threadId } });
    await db.agentCheckpointWrite.deleteMany({ where: { threadId } });
  }
}

let saverSingleton: PrismaCheckpointSaver | null = null;
export function checkpointSaver(): PrismaCheckpointSaver {
  if (!saverSingleton) saverSingleton = new PrismaCheckpointSaver();
  return saverSingleton;
}
