import { db } from '@/lib/db';
import { resolveUser, json, mapError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await resolveUser();
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get('status');
    const incidents = await db.incident.findMany({
      where: {
        project: { userId: user.id },
        ...(statusFilter && statusFilter !== 'all' ? { status: statusFilter } : {}),
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 50,
      include: { project: { select: { name: true, id: true } } },
    });
    return json({
      incidents: incidents.map((i) => ({
        id: i.id,
        projectId: i.projectId,
        projectName: i.project.name,
        kind: i.kind,
        status: i.status,
        title: i.title,
        summary: i.summary,
        firstSeenAt: i.firstSeenAt,
        lastSeenAt: i.lastSeenAt,
        resolvedAt: i.resolvedAt,
        runId: i.runId,
        hasDiagnosis: Boolean(i.diagnosisJson),
        hasRemediation: Boolean(i.remediationJson),
      })),
    });
  } catch (e) {
    return mapError(e);
  }
}
