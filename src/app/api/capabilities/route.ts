import { json } from '@/lib/api';
import { CAPABILITIES, MONITORING_CLAIMS } from '@/lib/integrations/liara/capabilities';

export const dynamic = 'force-dynamic';

/** Public capability registry view (spec §3: transparent about what works). */
export async function GET() {
  return json({
    capabilities: CAPABILITIES,
    monitoringClaims: MONITORING_CLAIMS,
  });
}
