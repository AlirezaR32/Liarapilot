'use client';

// Live workflow progress card — real events from the SSE stream, no fake %.
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRunStream } from '@/lib/runStream';
import { useI18n } from '@/lib/i18n';
import { StageLabel, StatusBadge, timeAgo } from './status-bits';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const LEVEL_ICON: Record<string, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: AlertCircle,
};

const LEVEL_COLOR: Record<string, string> = {
  info: 'text-muted-foreground',
  success: 'text-primary',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

export function RunProgressCard({
  runId,
  title,
  onComplete,
}: {
  runId: string | null;
  title: string;
  onComplete?: (status: string) => void;
}) {
  const { t } = useI18n();
  const stream = useRunStream(runId);
  const lastStatus = stream.status;
  if (lastStatus && ['succeeded', 'failed'].includes(lastStatus) && onComplete) {
    // fire once — parent decides what to do
    setTimeout(() => onComplete(lastStatus), 0);
  }

  const isTerminal = ['succeeded', 'failed', 'cancelled'].includes(stream.status);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <div className="flex items-center gap-2">
            {stream.connected && !isTerminal && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/80" />}
            <StageLabel stage={stream.stage ?? (stream.status === 'awaiting_approval' ? 'awaiting_approval' : null)} />
            <StatusBadge status={stream.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-72 pe-3">
          {stream.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('Waiting for workflow events…')}</p>
          ) : (
            <ol className="space-y-2.5">
              {stream.events.map((e) => {
                const Icon = LEVEL_ICON[e.level] ?? Info;
                return (
                  <li key={e.id} className="flex items-start gap-2.5">
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', LEVEL_COLOR[e.level] ?? 'text-muted-foreground/80')} />
                    <div className="min-w-0">
                      <p className="text-sm leading-snug text-foreground">{e.message}</p>
                      <p className="text-[11px] text-muted-foreground/80">
                        <code className="rounded bg-muted px-1" dir="ltr">{e.node}</code> · {timeAgo(e.at)}
                        {e.data && Object.keys(e.data).length > 0 ? (
                          <button
                            className="ms-2 text-muted-foreground/80 underline decoration-dotted hover:text-muted-foreground"
                            onClick={() => alert(JSON.stringify(e.data, null, 2))}
                          >
                            {t('details')}
                          </button>
                        ) : null}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </ScrollArea>
        {stream.status === 'awaiting_approval' && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-400/25 bg-amber-400/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-xs text-amber-300">
              {t('The workflow is paused durably and will resume from the approval gate — even if the server restarts. Go to Approvals to decide.')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RunProgressInline({ runId, onDone }: { runId: string | null; onDone?: () => void }) {
  const { t } = useI18n();
  const stream = useRunStream(runId);
  if (runId && onDone && ['succeeded', 'failed'].includes(stream.status)) {
    setTimeout(onDone, 0);
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {stream.status === 'awaiting_approval' ? (
        <>
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> {t('waiting for your approval')}
        </>
      ) : (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/80" /> <StageLabel stage={stream.stage} />
        </>
      )}
    </div>
  );
}
