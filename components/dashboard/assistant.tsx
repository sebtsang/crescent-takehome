'use client';

import { useAction, useMutation, useQuery } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { InlineMarkdown } from '@/components/ui/inline-markdown';
import { Card, EmptyState, Skeleton } from '@/components/ui/primitives';

const SUGGESTIONS = [
  'How much did we raise last month?',
  'Which campaign is doing best?',
  'Who are our top 10 donors?',
  'How many people gave more than once?',
  'Did the meal drive do better than the legal fund in March?',
];

export function Assistant() {
  const [threadId, setThreadId] = useState<Id<'chatThreads'> | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const threads = useQuery(api.chat.listThreads, {});
  const messages = useQuery(api.chat.listMessages, threadId ? { threadId } : {});
  const createThread = useMutation(api.chat.createThread);
  const addUserMessage = useMutation(api.chat.addUserMessage);
  const ask = useAction(api.agent.chat.ask);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages?.length]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setInput('');
    try {
      let id = threadId;
      if (!id) {
        id = await createThread({ title: trimmed });
        setThreadId(id);
      }
      await addUserMessage({ threadId: id, content: trimmed });
      // Tool messages are persisted as they run, so the transcript fills in
      // while this is still in flight.
      await ask({ threadId: id });
    } finally {
      setBusy(false);
    }
  }

  const loadingThread = threadId !== null && messages === undefined;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.375rem] font-medium leading-[1.15] tracking-tighter">
            Assistant
          </h1>
          <p className="mt-1 text-xs leading-none text-txt3">
            Answers come from the same queries the dashboard uses. Every tool call is shown.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setThreadId(null);
            setInput('');
          }}
          className="min-h-7 cursor-pointer border border-line px-2 py-1 text-[0.625rem] font-semibold uppercase leading-none tracking-[0.08em] text-txt3 hover:text-txt"
        >
          New conversation
        </button>
      </header>

      <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
        <Card title="Conversation">
          <div
            ref={scrollRef}
            className="flex h-[30rem] flex-col gap-3 overflow-y-auto px-4 py-4"
          >
            {loadingThread ? (
              <MessageSkeleton />
            ) : !messages || messages.length === 0 ? (
              <EmptyState
                headline="Ask about your fundraising"
                detail="Figures come from server-side aggregation, not from the model. If the data cannot answer a question, it will say so rather than estimate."
              />
            ) : (
              messages.map((m) => <Message key={m._id} message={m} />)
            )}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-txt3">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-txt3" />
                Working…
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-center gap-2 border-t border-line px-4 py-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question about donations"
              aria-label="Ask a question"
              disabled={busy}
              className="min-w-0 flex-1 border border-line bg-[var(--bg)] px-2 py-1.5 text-sm text-txt placeholder:text-txt3 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="min-h-7 cursor-pointer border border-[var(--txt)] bg-[var(--txt)] px-3 py-1.5 text-[0.625rem] font-semibold uppercase leading-none tracking-[0.08em] text-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Ask
            </button>
          </form>
        </Card>

        <div className="flex flex-col gap-3">
          <Card title="Try asking">
            <ul className="flex flex-col">
              {SUGGESTIONS.map((s) => (
                <li key={s} className="border-b border-line last:border-0">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send(s)}
                    className="w-full cursor-pointer px-4 py-2 text-left text-xs leading-snug text-txt2 hover:text-txt disabled:opacity-50"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="History">
            <div className="max-h-48 overflow-y-auto">
              {threads === undefined ? (
                <div className="px-4 py-3">
                  <Skeleton className="h-3 w-32" />
                </div>
              ) : threads.length === 0 ? (
                <p className="px-4 py-3 text-xs text-txt3">No conversations yet.</p>
              ) : (
                <ul>
                  {threads.map((t) => (
                    <li key={t._id} className="border-b border-line last:border-0">
                      <button
                        type="button"
                        onClick={() => setThreadId(t._id)}
                        className={`w-full cursor-pointer truncate px-4 py-2 text-left text-xs ${
                          t._id === threadId ? 'text-txt' : 'text-txt3 hover:text-txt'
                        }`}
                      >
                        {t.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

type ChatMessage = {
  _id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolArgs?: string;
};

function Message({ message }: { message: ChatMessage }) {
  if (message.role === 'tool') return <ToolCall message={message} />;

  if (message.role === 'user') {
    return (
      <div className="self-end max-w-[85%] border border-line bg-[var(--bg)] px-3 py-2 text-sm text-txt">
        {message.content}
      </div>
    );
  }

  return (
    <div className="max-w-[95%] whitespace-pre-wrap text-sm leading-relaxed text-txt">
      <InlineMarkdown text={message.content} />
    </div>
  );
}

/**
 * The tool card. The brief requires tool calls to be visible; this is also what
 * makes a wrong number diagnosable -- expand it and you can see whether the
 * model asked the wrong question (bad args) or the query answered it wrongly
 * (right args, wrong figures).
 */
function ToolCall({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const args = safeParse(message.toolArgs);
  const result = safeParse(message.content);
  const failed = result && typeof result === 'object' && 'error' in (result as object);

  return (
    <div className="border border-line bg-[var(--bg)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left"
      >
        <span className="eyebrow shrink-0">{open ? '−' : '+'}</span>
        <span className="num truncate text-[0.6875rem] font-semibold tracking-[0.02em] text-txt2">
          {message.toolName}
        </span>
        <span className="num truncate text-[0.6875rem] text-txt3">
          {summarizeArgs(args)}
        </span>
        {failed && (
          <span className="ml-auto shrink-0 text-[0.625rem] font-semibold uppercase text-danger">
            error
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2">
          <div className="eyebrow mb-1">Arguments</div>
          <pre className="num overflow-x-auto whitespace-pre-wrap break-all text-[0.6875rem] leading-snug text-txt2">
            {JSON.stringify(args ?? {}, null, 2)}
          </pre>
          <div className="eyebrow mb-1 mt-2">Result</div>
          <pre className="num max-h-64 overflow-auto whitespace-pre-wrap break-all text-[0.6875rem] leading-snug text-txt2">
            {result !== null ? JSON.stringify(result, null, 2) : message.content}
          </pre>
        </div>
      )}
    </div>
  );
}

function safeParse(text?: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** One-line arg preview so the collapsed card still says what was asked. */
function summarizeArgs(args: Record<string, unknown> | null): string {
  if (!args) return '';
  const a = args as Record<string, any>;
  const parts: string[] = [];
  if (a.range?.preset) parts.push(a.range.preset);
  if (a.range?.startISO) parts.push(`${a.range.startISO}→${a.range.endISO}`);
  if (Array.isArray(a.campaignIds)) parts.push(`${a.campaignIds.length} campaign(s)`);
  if (a.dimension) parts.push(a.dimension);
  if (a.granularity) parts.push(a.granularity);
  if (a.sortBy) parts.push(`by ${a.sortBy}`);
  if (a.minGiftCount) parts.push(`≥${a.minGiftCount} gifts`);
  if (a.limit) parts.push(`limit ${a.limit}`);
  return parts.join(' · ');
}

function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-8 w-2/3 self-end" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-4/5" />
    </div>
  );
}
