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

const MODEL = 'claude-opus-5';
const MAX_TURNS = 8;

/** Result payloads are persisted for the UI; cap what we store per call. */
const MAX_STORED_RESULT = 4000;

export const ask = action({
  args: { threadId: v.id('chatThreads') },
  handler: async (ctx, { threadId }): Promise<{ ok: boolean; error?: string }> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.chat.appendMessage, {
        threadId,
        role: 'assistant',
        content:
          'The assistant is not configured: ANTHROPIC_API_KEY is not set on this ' +
          'Convex deployment. Set it with `npx convex env set ANTHROPIC_API_KEY <key>` ' +
          'and ask again.',
      });
      return { ok: false, error: 'missing_api_key' };
    }

    const history = await ctx.runQuery(internal.chat.historyForAgent, { threadId });
    if (history.length === 0) return { ok: false, error: 'empty_thread' };

    const client = new Anthropic({ apiKey });

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
