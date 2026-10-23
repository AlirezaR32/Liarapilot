// GET /api/settings/llm — which "brain" is answering for THIS workspace
// (the user's own AI connection) and whether the bundled fallback exists.
import { json, mapError, resolveUser } from '@/lib/api';
import { llmStatus } from '@/lib/integrations/llm/adapter';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await resolveUser();
    return json(await llmStatus(user.id));
  } catch (e) {
    return mapError(e);
  }
}
