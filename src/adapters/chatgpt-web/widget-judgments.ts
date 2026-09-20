import type { ChatGptMarkdownSegment } from "./markdown";
import { confidentBoolean, judge } from "../../lib/judge";

/**
 * Item 17: unknown widget classification. The browser-side reader strips the embedded renderers it
 * knows (`.chart-widget-container`, code preview panes, buttons, media). When ChatGPT ships a new
 * widget, its control labels and status text arrive as ordinary Markdown segments and leak into the
 * answer. Jev judges every text-bearing block before streaming. Only identical content reuses
 * a verdict; unjudged or uncertain content is never released.
 */

/** Ordinary Markdown tags used by the markup inspection helper. */
const STANDARD_MARKDOWN_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "hr", "table", "li", "dl",
  "ol:item", "ul:item",
]);
/** Markup that Markdown answers never need but widgets always carry. */
export const WIDGET_MARKUP_PATTERN =
  /\brole="(?:button|tab|tablist|toolbar|dialog|menu|menuitem|slider|switch|progressbar|group|region|status)"|\bdata-testid=|<(?:input|select|textarea|iframe|canvas|video|audio|form|progress|meter)\b|\bcontenteditable=|\btabindex=/i;

export const MAX_WIDGET_CANDIDATES = 6;
const MAX_REMEMBERED_VERDICTS = 512;
const WIDGET_JUDGE_TIMEOUT_MS = 2_500;

export function looksLikeWidget(segment: Pick<ChatGptMarkdownSegment, "tag" | "html">): boolean {
  if (segment.tag !== undefined && STANDARD_MARKDOWN_TAGS.has(segment.tag)) return false;
  return WIDGET_MARKUP_PATTERN.test(segment.html);
}

const clip = (text: string, max: number): string => text.length > max ? `${text.slice(0, max)}…` : text;

export class ChatGptWidgetFilter {
  /** Content identity to a completed Jev verdict. */
  private readonly verdicts = new Map<string, boolean>();

  constructor(private readonly onDrop: (excerpt: string) => void = () => {}) {}

  async filter(segments: ChatGptMarkdownSegment[]): Promise<ChatGptMarkdownSegment[]> {
    const blocks = segments.map(segment => ({ segment, identity: JSON.stringify([segment.tag, segment.text, segment.html]) }));
    const decisions = new Map(this.verdicts);
    const pending = [...new Map(
      blocks.filter(block => block.segment.text.trim() && !decisions.has(block.identity)).map(block => [block.identity, block]),
    ).values()];
    for (let offset = 0; offset < pending.length; offset += MAX_WIDGET_CANDIDATES) {
      const batch = pending.slice(offset, offset + MAX_WIDGET_CANDIDATES);
      const questions = Object.fromEntries(batch.map((_block, index) => [
        `block_${index}`,
        {
          type: "boolean",
          instructions: `Is block ${index} part of the assistant's answer content (its prose, code, lists, tables, or link text), as opposed to UI chrome such as control labels, widget status or loading text, or renderer scaffolding?`,
        },
      ] as const)) as Record<string, { type: "boolean"; instructions: string }>;
      const answers = await judge("answer_widget", {
        blocks: batch.map(({ segment }, index) => ({ index, tag: segment.tag ?? "root", text: segment.text, html: segment.html })),
        source: "All text-bearing blocks extracted from a ChatGPT assistant message. Real answer text must reach the user; widget controls and status text must not.",
      }, questions, { timeoutMs: WIDGET_JUDGE_TIMEOUT_MS });
      batch.forEach(({ segment, identity }, index) => {
        const keep = confidentBoolean(answers[`block_${index}`]);
        decisions.set(identity, keep);
        this.remember(identity, keep);
        if (!keep) this.onDrop(clip(segment.text.replace(/\s+/g, " ").trim(), 120));
      });
    }
    return blocks.filter(block => !block.segment.text.trim() || decisions.get(block.identity) === true).map(block => block.segment);
  }

  private remember(html: string, keep: boolean): void {
    this.verdicts.set(html, keep);
    if (this.verdicts.size > MAX_REMEMBERED_VERDICTS) this.verdicts.delete(this.verdicts.keys().next().value as string);
  }
}
