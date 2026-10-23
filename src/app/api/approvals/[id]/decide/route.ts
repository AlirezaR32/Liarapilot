import { resolveUser, json, mapError, readJson } from '@/lib/api';
import { decideApproval } from '@/lib/services/approvals';
import { db } from '@/lib/db';
import { enqueue, processJobs } from '@/lib/workers/queue';
import { emitEvent } from '@/lib/agent/state';

export const dynamic = 'force-dynamic';

interface DecideBody {
  decision: 'approve' | 'reject';
  note?: string;
}

/** Approve or reject. Re-drives the paused workflow through its approval gate. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveUser();
    const { id } = await params;
    const body = await readJson<DecideBody>(req);
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      return json({ error: 'decision must be approve|reject' }, 400);
    }

    const approval = await decideApproval(id, user.id, body.decision === 'approve' ? 'approved' : 'rejected', body.note);

    if (approval.runId) {
      await emitEvent(approval.runId, 'approvals_api', `User ${body.decision === 'approve' ? 'approved' : 'rejected'} the request${body.note ? `: ${body.note}` : ''}`, 'info');
      await enqueue(
        'resume_workflow',
        {
          runId: approval.runId,
          decision: { approved: body.decision === 'approve', decidedBy: user.email, note: body.note },
        },
        { priority: 1 },
      );
      void processJobs(1);
    }

    return json({ ok: true, status: approval.status });
  } catch (e) {
    if (e instanceof Error && /expired|already/.test(e.message)) return json({ error: e.message }, 409);
    return mapError(e);
  }
}
