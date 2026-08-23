'use node';

import Anthropic from '@anthropic-ai/sdk';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { AGENT_TOOLS, SYSTEM_PROMPT, TOOLS_BY_NAME } from './tools';

/**
 * The assistant loop.
 *
 * A MANUAL loop rather than the SDK's tool runner, deliberately. Every tool call
 * and result is persisted to chatMessages as it happens, which the brief
 * requires and which also gives the UI live progress without implementing
 * streaming: the client subscribes to the messages query, so tool cards appear
 * one by one while the model is still working.
 *
 * Runs in Convex's Node runtime ('use node') so the Anthropic SDK has a normal
 * environment. Actions cannot touch ctx.db, so every tool goes through
 * ctx.runQuery -- the same queries the dashboard calls. That constraint is what
 * makes "the agent and the dashboard cannot disagree" structural rather than a
 * convention.
 */

/**
 * Sonnet 5 rather than Opus 5. This workload is tool routing plus a two-sentence
 * summary, not hard reasoning, and the correctness guarantees live in the server
 * -- an empty period answers honestly because the tool result carries
 * rowsMatched and the dataset's date bounds, not because the model is clever.
 * Cheaper and faster, and verified against BASELINE.md on all five required
 * questions before being adopted.
 */
const MODEL = 'claude-sonnet-5';

/**
 * Credentials, in precedence order.
 *
 * ANTHROPIC_API_KEY is the intended path and the one the brief describes -- it
 * is what a reviewer will set, and the only configuration this project treats as
 * supported.
 *
 * ANTHROPIC_AUTH_TOKEN is a LOCAL DEVELOPMENT convenience. `claude setup-token`
 * issues a long-lived OAuth credential tied to a Claude subscription, which the
 * Messages API accepts as `Authorization: Bearer` alongside the oauth beta
 * header. It draws on subscription usage instead of Console credits, which makes
 * iterating free. It is NOT an officially supported way to authenticate a
 * third-party application: the header and scopes carry no compatibility promise
 * and can stop working without notice. Never rely on it for a demo you cannot
 * fall back from -- set ANTHROPIC_API_KEY as well.
 *
 * The token is checked first so that setting it is an explicit local override;
 * with only ANTHROPIC_API_KEY set, behaviour is exactly the supported path.
 */
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';

type Credentials =
  | { mode: 'api_key'; apiKey: string }
  | { mode: 'oauth_token'; authToken: string }
  | { mode: 'none' };

function resolveCredentials(): Credentials {
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (authToken) return { mode: 'oauth_token', authToken };
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) return { mode: 'api_key', apiKey };
  return { mode: 'none' };
}

function createClient(credentials: Exclude<Credentials, { mode: 'none' }>): Anthropic {
  if (credentials.mode === 'oauth_token') {
    return new Anthropic({
      authToken: credentials.authToken,
      defaultHeaders: { 'anthropic-beta': OAUTH_BETA_HEADER },
    });
  }
  return new Anthropic({ apiKey: credentials.apiKey });
}
const MAX_TURNS = 8;

/** Result payloads are persisted for the UI; cap what we store per call. */
const MAX_STORED_RESULT = 4000;

export const ask = action({
  args: { threadId: v.id('chatThreads') },
  handler: async (ctx, { threadId }): Promise<{ ok: boolean; error?: string }> => {
    const credentials = resolveCredentials();
    if (credentials.mode === 'none') {
      await ctx.runMutation(internal.chat.appendMessage, {
        threadId,
        role: 'assistant',
        content:
          'The assistant is not configured. Set a credential on this Convex ' +
          'deployment and ask again:\n\n' +
          '  npx convex env set ANTHROPIC_API_KEY <key>\n\n' +
          'For local development you may instead set ANTHROPIC_AUTH_TOKEN to a ' +
          'token from `claude setup-token`, which bills subscription usage rather ' +
          'than API credits.',
      });
      return { ok: false, error: 'missing_credentials' };
    }
    // Surfaced in the Convex logs so it is obvious which credential answered.
    console.log(`[assistant] auth mode: ${credentials.mode}`);

    const history = await ctx.runQuery(internal.chat.historyForAgent, { threadId });
    if (history.length === 0) return { ok: false, error: 'empty_thread' };

    const client = createClient(credentials);

    const messages: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    }));

    const tools: Anthropic.Tool[] = AGENT_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool['input_schema'],
    }));

    try {
      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 4096,
          system: [
            {
              type: 'text',
              text: `${SYSTEM_PROMPT}\n\nToday's date is ${new Date()
                .toISOString()
                .slice(0, 10)} (UTC).`,
            },
          ],
          // `thinking` is omitted on purpose: Opus 5 runs adaptive thinking by
          // default, and SDK 0.65's types predate the 'adaptive' literal.
          tools,
          messages,
        });

        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();

        const toolUses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
        );

        if (toolUses.length === 0) {
          await ctx.runMutation(internal.chat.appendMessage, {
            threadId,
            role: 'assistant',
            content:
              text ||
              'I was not able to produce an answer for that. Try rephrasing the question.',
          });
          return { ok: true };
        }

        // Preserve the full assistant turn, tool_use blocks included.
        messages.push({ role: 'assistant', content: response.content });

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of toolUses) {
          const tool = TOOLS_BY_NAME.get(use.name);
          let payload: string;
          let isError = false;

          if (!tool) {
            payload = JSON.stringify({ error: `Unknown tool: ${use.name}` });
            isError = true;
          } else {
            try {
              const started = Date.now();
              const value = await tool.run(ctx, use.input);
              payload = JSON.stringify({
                ...(value as object),
                _meta: { tool: use.name, durationMs: Date.now() - started },
              });
            } catch (err) {
              // A tool failure is reported back to the model rather than thrown,
              // so it can retry with corrected arguments or say it cannot answer.
              payload = JSON.stringify({
                error: err instanceof Error ? err.message : 'Tool failed',
              });
              isError = true;
            }
          }

          // Persist before continuing: the UI shows tool cards as they land.
          await ctx.runMutation(internal.chat.appendMessage, {
            threadId,
            role: 'tool',
            content: payload.slice(0, MAX_STORED_RESULT),
            toolName: use.name,
            toolArgs: JSON.stringify(use.input ?? {}),
          });

          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: payload,
            ...(isError ? { is_error: true } : {}),
          });
        }

        // All tool results go back in a SINGLE user message.
        messages.push({ role: 'user', content: results });
      }

      await ctx.runMutation(internal.chat.appendMessage, {
        threadId,
        role: 'assistant',
        content:
          'I stopped after too many steps without reaching an answer. Try asking a ' +
          'narrower question.',
      });
      return { ok: false, error: 'max_turns' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await ctx.runMutation(internal.chat.appendMessage, {
        threadId,
        role: 'assistant',
        content: `The assistant hit an error and stopped rather than guess: ${message}`,
      });
      return { ok: false, error: message };
    }
  },
});
