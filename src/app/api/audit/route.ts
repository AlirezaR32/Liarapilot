import { db } from '@/lib/db';
import { resolveUser, json, mapError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await resolveUser();
    const url = new URL(req.url);
    const take = Math.min(Number(url.searchParams.get('take') ?? 50), 200);
    const events = await db.auditEvent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return json({ events: events.map((e) => ({ id: e.id.toString(), kind: e.kind, actor: e.actor, projectId: e.projectId, detail: e.detailJson ? JSON.parse(e.detailJson) : null, at: e.createdAt })) });
  } catch (e) {
    return mapError(e);
  }
}
