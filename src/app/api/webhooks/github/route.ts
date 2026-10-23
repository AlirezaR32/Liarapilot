// GitHub webhook receiver (spec §13): signature validation + replay
// protection. Push events trigger re-analysis; deploys stay approval-gated.
import { createHmac, timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { json, mapError } from '@/lib/api';
import { createRun } from '@/lib/workers/runner';
import { enqueue, processJobs } from '@/lib/workers/queue';
import { audit } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

function verifySignature(raw: string, signature256: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false; // refuse when not configured (fail closed)
  if (!signature256?.startsWith('sha256=')) return false;
  const mac = createHmac('sha256', secret).update(raw).digest('hex');
  const expected = Buffer.from(mac, 'hex');
  const got = Buffer.from(signature256.slice(7), 'hex');
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const sig = req.headers.get('x-hub-signature-256');
    const delivery = req.headers.get('x-github-delivery') ?? `unknown-${Date.now()}`;
    const event = req.headers.get('x-github-event') ?? 'push';

    if (!verifySignature(raw, sig)) {
      await audit('webhook.rejected', { actor: 'system', detail: { reason: 'invalid or missing signature', delivery } });
      return json({ error: 'invalid signature' }, 401);
    }

    // replay protection: dedupe on delivery id via audit events
    const existing = await db.auditEvent.findFirst({
      where: { kind: 'webhook.received', detailJson: { contains: delivery } },
    });
    if (existing) {
      return json({ ok: true, deduped: true });
    }
    await audit('webhook.received', { actor: 'system', detail: { delivery, event } });

    if (event !== 'push') {
      return json({ ok: true, ignored: event });
    }

    const payload = JSON.parse(raw) as { repository?: { full_name?: string }; after?: string };
    const fullName = payload.repository?.full_name;
    if (!fullName) return json({ error: 'missing repository.full_name' }, 400);
    const [owner, name] = fullName.split('/');

    const project = await db.project.findFirst({
      where: { repoOwner: owner, repoName: name, archived: false },
    });
    if (!project) return json({ ok: true, note: 'no connected project for this repo' });

    // push → automatic re-analysis (never automatic deployment — spec §7)
    const { runId } = await createRun({ projectId: project.id, userId: project.userId, kind: 'deploy_pipeline', trigger: 'push_event' });
    await enqueue('run_workflow', { runId }, { priority: 4, dedupeKey: `push:${project.id}:${payload.after ?? ''}` });
    void processJobs(1);
    return json({ ok: true, runId }, 202);
  } catch (e) {
    return mapError(e);
  }
}
