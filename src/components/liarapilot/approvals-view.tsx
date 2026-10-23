'use client';

// Approval queue (spec §10): full decision context, exact target, risks,
// reversibility, expiry. Buttons represent real actions only.
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { api, type Approval } from '@/lib/client';
import { fmtClock, useI18n } from '@/lib/i18n';
import { StatusBadge, timeAgo } from './status-bits';
import { CheckCircle2, ChevronDown, Clock, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export function ApprovalsView({ approvals, onChanged }: { approvals: Approval[]; onChanged: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const decide = async (a: Approval, decision: 'approve' | 'reject') => {
    setBusy(a.id);
    try {
      await api.decideApproval(a.id, decision, note[a.id] || undefined);
      toast.success(decision === 'approve' ? t('Approved — workflow resumes from the approval gate') : t('Rejected — no action will be taken'));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('decision failed'));
    } finally {
      setBusy(null);
    }
  };

  if (approvals.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <ShieldCheck className="h-8 w-8 text-primary" />
          <p className="font-medium text-foreground">{t('Approval queue is empty')}</p>
          <p className="text-sm text-muted-foreground">{t('Consequential operations (deploys, restarts, env changes) pause here for your decision.')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('These requests are policy-bound: the approval is tied to the exact plan hash and expires. Changing the plan invalidates the approval.')}
      </p>
      {approvals.map((a) => {
        const expiresSoon = new Date(a.expiresAt).getTime() - Date.now() < 5 * 60_000;
        const ms = new Date(a.expiresAt).getTime() - Date.now();
        const m = Math.max(0, Math.floor(ms / 60000));
        const remaining = m >= 60 ? t('{h}h {m}m', { h: Math.floor(m / 60), m: m % 60 }) : t('{m}m', { m });
        return (
          <Card key={a.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-sm font-semibold">{a.title}</CardTitle>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground" dir="ltr">{a.targetRef}</p>
                </div>
                <div className="flex items-center gap-2">
                  {a.projectName && <Badge variant="outline" className="text-[10px]">{a.projectName}</Badge>}
                  <Badge variant="outline" className="text-[10px]" dir="ltr">{a.actionType}</Badge>
                  <StatusBadge status={a.status} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-foreground/90">{a.rationale}</p>

              <div className="grid gap-3 rounded-md border border-border bg-background p-3 text-xs sm:grid-cols-2">
                <div>
                  <p className="font-medium text-foreground/90">{t('Why approval is required')}</p>
                  <ul className="mt-1 list-disc space-y-0.5 ps-4 text-muted-foreground">
                    {(a.risks.reasons ?? []).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 font-medium text-foreground/90">
                    {t('Reversibility:')}{' '}
                    {a.risks.reversible ? <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">{t('reversible')}</Badge> : <Badge variant="outline" className="border-red-400/40 bg-red-500/10 text-red-300">{t('hard to reverse')}</Badge>}
                  </p>
                  <p className="flex items-center gap-1 text-muted-foreground">
                    <Clock className={`h-3.5 w-3.5 ${expiresSoon ? 'text-red-500' : 'text-muted-foreground/80'}`} />
                    {t('Expires in {t} ({time})', { t: remaining, time: fmtClock(a.expiresAt) })}
                  </p>
                  <p className="text-muted-foreground">{t('If it fails: {x}', { x: a.risks.failureEffects ?? t('see plan') })}</p>
                </div>
              </div>

              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary">
                  <ChevronDown className="h-3.5 w-3.5" /> {t('Inspect exact payload & evidence')}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <pre dir="ltr" className="max-h-56 overflow-auto rounded-md bg-zinc-950 p-3 text-left text-[11px] leading-relaxed text-zinc-100">
                    {JSON.stringify({ payload: a.payload, evidence: a.evidence, planHash: a.planHash }, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>

              {a.status === 'pending' && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder={t('Optional note for the audit trail…')}
                    value={note[a.id] ?? ''}
                    onChange={(e) => setNote((m) => ({ ...m, [a.id]: e.target.value }))}
                    className="sm:flex-1"
                  />
                  <Button onClick={() => decide(a, 'approve')} disabled={busy === a.id} className="bg-primary hover:bg-primary/90">
                    <CheckCircle2 className="me-1.5 h-4 w-4" /> {t('Approve & execute')}
                  </Button>
                  <Button variant="destructive" onClick={() => decide(a, 'reject')} disabled={busy === a.id}>
                    <XCircle className="me-1.5 h-4 w-4" /> {t('Reject')}
                  </Button>
                </div>
              )}
              {a.status !== 'pending' && (
                <p className="text-xs text-muted-foreground">{t('Decision recorded {t} — audit trail updated.', { t: timeAgo(a.createdAt) })}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
