'use client';

// Activity view: audit trail + usage accounting + capability registry.
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { api, type AuditEventDTO } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import { timeAgo } from './status-bits';
import { ChevronDown, ScrollText } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Usage {
  llmInvestigations: number;
  healthChecks: number;
  windowHours: number;
  byKind: Array<{ kind: string; quantity: number; tokensIn: number; tokensOut: number }>;
}

interface Capabilities {
  capabilities: Array<{ id: string; name: string; verification: string; notes: string }>;
}

const VERIF_STYLE: Record<string, string> = {
  verified: 'border-primary/40 bg-primary/10 text-primary',
  documented_unverified: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  cli_only: 'border-border bg-background text-muted-foreground',
  unsupported: 'border-red-400/40 bg-red-500/10 text-red-300',
};

const VERIF_LABEL: Record<string, string> = {
  verified: 'verified',
  documented_unverified: 'documented unverified',
  cli_only: 'CLI only',
  unsupported: 'unsupported',
};

export function ActivityView({ events }: { events: AuditEventDTO[] }) {
  const { t } = useI18n();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);

  useEffect(() => {
    void api.usage().then(setUsage).catch(() => undefined);
    void api.capabilities().then(setCaps).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t('Cost controls (last {n}h)', { n: usage?.windowHours ?? 24 })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('LLM investigations')}</span>
              <span className="font-medium">{usage?.llmInvestigations ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('Health checks')}</span>
              <span className="font-medium">{usage?.healthChecks ?? 0}</span>
            </div>
            {(usage?.byKind ?? [])
              .filter((k) => k.tokensIn + k.tokensOut > 0)
              .map((k) => (
                <div key={k.kind} className="flex justify-between text-xs text-muted-foreground">
                  <span dir="ltr">{t('{kind} tokens', { kind: k.kind })}</span>
                  <span>~{(k.tokensIn + k.tokensOut).toLocaleString()}</span>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t('Liara capability registry (honest boundaries)')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-44 space-y-1.5 overflow-y-auto pe-2">
              {(caps?.capabilities ?? []).map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground/90">{c.name}</p>
                    <p className="truncate text-muted-foreground/80">{c.notes}</p>
                  </div>
                  <Badge variant="outline" className={`shrink-0 text-[10px] ${VERIF_STYLE[c.verification] ?? ''}`}>
                    {t(VERIF_LABEL[c.verification] ?? c.verification.replace(/_/g, ' '))}
                  </Badge>
                </div>
              ))}
              {!caps && <p className="text-xs text-muted-foreground/80">{t('loading registry…')}</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <ScrollText className="h-4 w-4 text-muted-foreground/80" /> {t('Audit trail (every important operation is traceable)')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('No audit events yet.')}</p>
          ) : (
            <div className="space-y-1">
              {events.map((e) => (
                <Collapsible key={e.id}>
                  <div className="flex items-center justify-between gap-3 rounded border border-border px-2.5 py-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        <span dir="ltr">{e.kind}</span>
                      </Badge>
                      <span className="truncate text-xs text-muted-foreground" dir="ltr">{e.actor}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[11px] text-muted-foreground/80">{timeAgo(e.at)}</span>
                      {e.detail && (
                        <CollapsibleTrigger asChild>
                          <button className="text-muted-foreground/80 underline decoration-dotted hover:text-muted-foreground">
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </CollapsibleTrigger>
                      )}
                    </div>
                  </div>
                  {e.detail && (
                    <CollapsibleContent>
                      <pre dir="ltr" className="my-1 max-h-40 overflow-auto rounded-md bg-zinc-950 p-2.5 text-left text-[10px] text-zinc-100">{JSON.stringify(e.detail, null, 2)}</pre>
                    </CollapsibleContent>
                  )}
                </Collapsible>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
