// SSE progress streaming (spec §4, §11): real workflow events only.
import { db } from '@/lib/db';
import { resolveUser } from '@/lib/api';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/security/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // auth via cookie (EventSource cannot set headers)
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return new Response('unauthorized', { status: 401 });
  const session = await db.session.findUnique({ where: { token } });
  if (!session) return new Response('unauthorized', { status: 401 });

  const run = await db.workflowRun.findUnique({ where: { id } });
  if (!run) return new Response('not found', { status: 404 });

  const encoder = new TextEncoder();
  let lastId = 0;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send('open', { runId: id, status: run.status });

      const started = Date.now();
      const tick = async (): Promise<void> => {
        if (closed) return;
        try {
          const events = await db.workflowEvent.findMany({
            where: { runId: id, id: { gt: lastId } },
            orderBy: { id: 'asc' },
            take: 50,
          });
          for (const e of events) {
            lastId = e.id;
            send('event', {
              id: e.id.toString(),
              node: e.node,
              level: e.level,
              message: e.message,
              data: e.dataJson ? JSON.parse(e.dataJson) : null,
              at: e.createdAt,
            });
          }
          const fresh = await db.workflowRun.findUnique({ where: { id } });
          if (fresh) {
            send('status', { status: fresh.status, stage: fresh.stage, finishedAt: fresh.finishedAt });
            const terminal = ['succeeded', 'failed', 'cancelled'].includes(fresh.status);
            // keep streaming while awaiting_approval so UI can show pause state
            if (terminal) {
              send('done', { status: fresh.status });
              closed = true;
              controller.close();
              return;
            }
          }
        } catch {
          // transient DB error — keep the stream alive
        }
        if (Date.now() - started > 5 * 60_000) {
          send('done', { status: 'timeout' });
          closed = true;
          controller.close();
          return;
        }
        if (!closed) setTimeout(() => void tick(), 1500);
      };
      void tick();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
