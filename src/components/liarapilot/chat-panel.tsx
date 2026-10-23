'use client';

// Contextual chat panel (spec §11): optional channel, project-scoped,
// same permissions — never a separate agent with broader powers.
// Drag & drop: drop a log/text file anywhere on the panel to attach its
// contents to the message box (evidence-first, like the rest of the agent).
import { useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api, type ProjectSummary } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import { FileUp, Loader2, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'What did you discover about this project?',
  'Why is the service failing right now?',
  'What do you need my approval for, and why?',
  'What changed in the last deployment?',
];

const MAX_DROP_CHARS = 20_000; // keep the message box sane

export function ChatPanel({ projects, currentProjectId }: { projects: ProjectSummary[]; currentProjectId: string | null }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: msg }]);
    setBusy(true);
    try {
      const res = await api.chat(currentProjectId, msg);
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: t('Error: {msg}', { msg: e instanceof Error ? e.message : t('chat failed') }) }]);
    } finally {
      setBusy(false);
    }
  };

  const readDroppedFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '').slice(0, MAX_DROP_CHARS);
      if (!text.trim()) {
        toast.error(t('Could not read the file as text'));
        return;
      }
      setInput((prev) => `${prev ? `${prev}\n\n` : ''}--- ${file.name} ---\n${text}${String(reader.result ?? '').length > MAX_DROP_CHARS ? '\n… (truncated)' : ''}`);
      toast.success(t('File contents attached: {name}', { name: file.name }));
    };
    reader.onerror = () => toast.error(t('Could not read the file as text'));
    reader.readAsText(file);
  };

  const context = projects.find((p) => p.id === currentProjectId);

  return (
    <Card
      className="relative flex h-[560px] flex-col"
      onDragEnter={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) readDroppedFile(file);
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/70 bg-primary/10 backdrop-blur-sm">
          <span className="flex items-center gap-2 text-sm font-semibold text-primary">
            <FileUp className="h-4 w-4" />
            {t('Drop the file to attach its contents to your message')}
          </span>
        </div>
      )}
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="h-4 w-4 text-muted-foreground/80" /> {t('Contextual chat')}
          {context && <Badge variant="outline" className="text-[10px]">{context.name}</Badge>}
        </CardTitle>
        <p className="text-[11px] leading-relaxed text-muted-foreground/80">
          {t('Same context and permissions as the agent — it answers from evidence, never fabricates.')}
          {' '}{t('You can also drop a log or text file here — its contents are attached to your message.')}
        </p>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <ScrollArea className="min-h-0 flex-1 pe-3">
          {messages.length === 0 ? (
            <div className="space-y-2 pt-2">
              <p className="text-sm text-muted-foreground/80">{t('Try asking:')}</p>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="block w-full rounded-md border border-border px-3 py-2 text-start text-xs text-muted-foreground hover:border-primary/40 hover:bg-primary/10"
                >
                  {t(s)}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              {messages.map((m, i) => (
                <div key={i} dir="auto" className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'ms-auto bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
                  {m.content}
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground/80">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('thinking…')}
                </div>
              )}
            </div>
          )}
        </ScrollArea>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={context ? t('Ask about {name}…', { name: context.name }) : t('Ask about your workspace…')} disabled={busy} />
          <Button type="submit" size="icon" disabled={busy || !input.trim()} className="shrink-0 bg-primary hover:bg-primary/90" aria-label={t('send')}>
            <Send className="h-4 w-4 rtl:scale-x-[-1]" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
