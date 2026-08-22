import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';

/**
 * Chat persistence. Threads and messages, including WHICH tool ran with WHAT
 * arguments -- the schema calls this out, and it is what makes the assistant
 * debuggable rather than magic. When a number is wrong you need to see whether
 * the model asked the wrong question or the tool answered it wrongly.
 */

export const listThreads = query({
  args: {},
  handler: async (ctx) => {
    const threads = await ctx.db.query('chatThreads').collect();
    return threads.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listMessages = query({
  args: { threadId: v.optional(v.id('chatThreads')) },
  handler: async (ctx, { threadId }) => {
    if (!threadId) return [];
    return ctx.db
      .query('chatMessages')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId))
      .collect();
  },
});

export const createThread = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) =>
    ctx.db.insert('chatThreads', {
      title: title.trim().slice(0, 80) || 'New conversation',
      createdAt: Date.now(),
    }),
});

/** Internal: the agent action appends through these, never directly. */
export const appendMessage = internalMutation({
  args: {
    threadId: v.id('chatThreads'),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('tool')),
    content: v.string(),
    toolName: v.optional(v.string()),
    toolArgs: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    ctx.db.insert('chatMessages', { ...args, createdAt: Date.now() }),
});

export const addUserMessage = mutation({
  args: { threadId: v.id('chatThreads'), content: v.string() },
  handler: async (ctx, { threadId, content }) => {
    const text = content.trim();
    if (!text) throw new Error('Message cannot be empty');
    if (text.length > 4000) throw new Error('Message is too long');
    return ctx.db.insert('chatMessages', {
      threadId,
      role: 'user',
      content: text,
      createdAt: Date.now(),
    });
  },
});

/**
 * Internal: the conversation as the model should see it.
 *
 * Tool messages are excluded. They are already represented in the transcript the
 * action rebuilds each turn, and replaying persisted tool JSON as plain user
 * text would let stale figures leak back into a later answer.
 */
export const historyForAgent = internalQuery({
  args: { threadId: v.id('chatThreads') },
  handler: async (ctx, { threadId }) => {
    const messages = await ctx.db
      .query('chatMessages')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId))
      .collect();
    return messages
      .filter((m) => m.role !== 'tool')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  },
});
