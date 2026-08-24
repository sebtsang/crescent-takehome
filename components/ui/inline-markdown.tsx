import type { ReactNode } from 'react';

/**
 * Renders the inline markdown the assistant actually emits: **bold** and
 * `code`. Nothing else.
 *
 * Scope is deliberately narrow. Block structure -- numbered lists, bullets,
 * paragraph breaks -- already renders correctly through `whitespace-pre-wrap`
 * on the container, so parsing it into <ol>/<ul> would change spacing that is
 * currently fine and risk a regression for no gain.
 *
 * Returns React elements, never an HTML string, so there is no
 * dangerouslySetInnerHTML and no injection surface. That matters here: this
 * text is model output shaped by tool results, which carry donor names read
 * from the database.
 */

// Capturing group so split() keeps the delimiters. Unmatched or empty markers
// (a lone ** , or ****) fail the pattern and fall through as literal text.
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

export function InlineMarkdown({ text }: { text: string }): ReactNode {
  return text
    .split(INLINE)
    .filter((part) => part !== '')
    .map((part, i) => {
      if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={i}
            className="rounded-sm border border-line bg-[var(--bg)] px-1 py-px font-mono text-[0.9em]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return <span key={i}>{part}</span>;
    });
}
