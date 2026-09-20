import type { ChatGptMarkdownSegment } from "./markdown";
import { confidentBoolean, judge, judgeConfigured, judgeEnabled } from "../../lib/judge";

/**
 * Item 17: unknown widget classification. The browser-side reader strips the embedded renderers it
 * knows (`.chart-widget-container`, code preview panes, buttons, media). When ChatGPT ships a new
 * widget, its control labels and status text arrive as ordinary Markdown segments and leak into the
 * answer. Jev looks only at segments that carry interactive markup and that are not standard
 * Markdown blocks, and drops the ones it is confident are UI chrome. Verdicts are sticky per HTML
 * so a block already streamed to Codex can never be retracted, and the filter never empties an
 * answer: when everything is chrome, the widget was the answer and the reader's output stands.
 */

/** Ordinary Markdown blocks are never judged; the reader's DOM rules own them. */
const STANDARD_MARKDOWN_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "hr", "table", "li", "dl",
  "ol:item", "ul:item",
]);
/** Markup that Markdown answers never need but widgets always carry. */
export const WIDGET_MARKUP_PATTERN =
  /\brole="(?:button|tab|tablist|toolbar|dialog|menu|menuitem|slider|switch|progressbar|group|region|status)"|\bdata-testid=|<(?:input|select|textarea|iframe|canvas|video|audio|form|progress|meter)\b|\bcontenteditable=|\btabindex=/i;

export const MAX_WIDGET_CANDIDATES = 6;
const MAX_WIDGET_HTML = 3_000;
const MAX_WIDGET_TEXT = 1_000;
const MAX_REMEMBERED_VERDICTS = 512;
const WIDGET_JUDGE_TIMEOUT_MS = 2_500;

export function looksLikeWidget(segment: Pick<ChatGptMarkdownSegment, "tag" | "html">): boolean {
  if (segment.tag !== undefined && STANDARD_MARKDOWN_TAGS.has(segment.tag)) return false;
  return WIDGET_MARKUP_PATTERN.test(segment.html);
}

const clip = (text: string, max: number): string => text.length > max ? `${text.slice(0, max)}…` : text;

export class ChatGptWidgetFilter {
  /** html → keep. Unsure, failed, and content verdicts all keep; only a confident chrome verdict drops. */
  private readonly verdicts = new Map<string, boolean>();

  constructor(private readonly onDrop: (excerpt: string) => void = () => {}) {}

  async filter(segments: ChatGptMarkdownSegment[]): Promise<ChatGptMarkdownSegment[]> {
    if (segments.length === 0 || !judgeEnabled() || !judgeConfigured()) return segments;
    const pending = [...new Map(
      segments.filter(segment => looksLikeWidget(segment) && !this.verdicts.has(segment.html)).map(segment => [segment.html, segment]),
    ).values()].slice(0, MAX_WIDGET_CANDIDATES);
    if (pending.length > 0) {
      const questions = Object.fromEntries(pending.map((_, index) => [
        `block_${index}`,
        {
          type: "boolean",
          instructions: `Is block ${index} part of the assistant's answer content (its prose, code, lists, tables, or link text), as opposed to UI chrome such as control labels, widget status or loading text, or renderer scaffolding?`,
        },
      ] as const)) as Record<string, { type: "boolean"; instructions: string }>;
      const answers = await judge("answer_widget", {
        blocks: pending.map((segment, index) => ({ index, tag: segment.tag ?? "root", text: clip(segment.text, MAX_WIDGET_TEXT), html: clip(segment.html, MAX_WIDGET_HTML) })),
        source: "Blocks extracted from a ChatGPT assistant message that carry interactive markup the bridge does not recognise. Real answer text must reach the user; widget controls and status text must not.",
      }, questions, { timeoutMs: WIDGET_JUDGE_TIMEOUT_MS }).catch(() => undefined);
      pending.forEach((segment, index) => {
        const keep = confidentBoolean(answers?.[`block_${index}`]) !== false;
        this.remember(segment.html, keep);
        if (!keep) this.onDrop(clip(segment.text.replace(/\s+/g, " ").trim(), 120));
      });
    }
    const kept = segments.filter(segment => this.verdicts.get(segment.html) !== false);
    return kept.length === 0 ? segments : kept;
  }

  private remember(html: string, keep: boolean): void {
    this.verdicts.set(html, keep);
    if (this.verdicts.size > MAX_REMEMBERED_VERDICTS) this.verdicts.delete(this.verdicts.keys().next().value as string);
  }
}
