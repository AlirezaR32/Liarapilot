// Contextual chat (spec §11): optional channel. Reuses the SAME project
// context and permission model; gains no capabilities beyond the agent's own
// read-only evidence. Backend-only LLM usage (OpenAI/ChatGPT or z-ai fallback).
import { db } from '@/lib/db';
import { resolveUser, json, mapError, readJson, requireProject } from '@/lib/api';
import { chat, llmStatus } from '@/lib/integrations/llm/adapter';
import { recordUsage } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ChatBody {
  projectId?: string;
  message: string;
}

export async function POST(req: Request) {
  try {
    const user = await resolveUser();
    const body = await readJson<ChatBody>(req);
    const message = (body.message ?? '').slice(0, 2000).trim();
    if (!message) return json({ error: 'message required' }, 400);

    let projectContext = '';
    if (body.projectId) {
      const project = await requireProject(body.projectId, user.id);
      const snapshot = project.lastProfileSha
        ? await db.analysisSnapshot.findUnique({ where: { projectId_commitSha: { projectId: project.id, commitSha: project.lastProfileSha } } })
        : null;
      const openIncidents = await db.incident.findMany({
        where: { projectId: project.id, status: { notIn: ['resolved', 'muted'] } },
        take: 5,
      });
      const lastRun = await db.workflowRun.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' } });
      projectContext = JSON.stringify({
        project: { name: project.name, repo: `${project.repoOwner}/${project.repoName}`, provider: project.repoProvider, deployedSha: project.deployedSha, liaraAppName: project.liaraAppName },
        profile: snapshot ? { language: JSON.parse(snapshot.profileJson).language, framework: JSON.parse(snapshot.profileJson).framework, startCommand: JSON.parse(snapshot.profileJson).startCommand, blockers: JSON.parse(snapshot.profileJson).blockers } : null,
        openIncidents: openIncidents.map((i) => ({ kind: i.kind, status: i.status, title: i.title })),
        lastWorkflow: lastRun ? { kind: lastRun.kind, status: lastRun.status, stage: lastRun.stage } : null,
      });
    }

    const history = await db.chatMessage.findMany({
      where: { userId: user.id, projectId: body.projectId ?? null },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const system =
      'You are LiaraPilot, a DevOps assistant for applications deployed on Liara cloud. Answer from the provided project context only; never invent deployment results, metrics, or API capabilities. Be concise and actionable.';

    const result = await chat({
      userId: user.id,
      system,
      label: 'chat',
      history: [
        ...(projectContext ? [{ role: 'user' as const, content: `[PROJECT CONTEXT] ${projectContext}` }] : []),
        ...history
          .slice()
          .reverse()
          .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content })),
      ],
      user: message,
    });

    const status = await llmStatus(user.id);
    const reply = result?.content
      ?? (status.provider === 'none'
        ? 'مدل زبانی هنوز متصل نیست — از «تنظیمات ← هوش مصنوعی» کلید API خود را وارد کنید تا پاسخ‌گویی فعال شود.'
        : 'الان نتوانستم پردازش کنم — لطفاً دوباره تلاش کنید. (پاسخ ساختگی داده نمی‌شود.)');
    await recordUsage('llm_call', { userId: user.id, projectId: body.projectId ?? null, tokensIn: result?.tokensIn ?? 0, tokensOut: result?.tokensOut ?? 0, note: `chat:${result?.model ?? 'n/a'}` });
    await db.chatMessage.createMany({
      data: [
        { userId: user.id, projectId: body.projectId ?? null, role: 'user', content: message },
        { userId: user.id, projectId: body.projectId ?? null, role: 'assistant', content: reply },
      ],
    });
    return json({ reply, model: result?.model ?? null, provider: status.provider });
  } catch (e) {
    return mapError(e);
  }
}
