import { afterEach, expect, test } from "bun:test";
import {
  ChatGptWidgetFilter,
  MAX_WIDGET_CANDIDATES,
  looksLikeWidget,
} from "../src/adapters/chatgpt-web/widget-judgments";
import { ChatGptMarkdownBuffer, type ChatGptMarkdownSegment } from "../src/adapters/chatgpt-web/markdown";
import { configureJudgeForTests } from "../src/lib/judge";

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

/** Boolean fake: `content[text]` is the probability that a block with that text is answer content. */
function withJev(content: Record<string, number> | (() => never), enabled = true) {
  const seen: Array<{ state: { blocks: Array<{ index: number; text: string; html: string }> }; questions: Record<string, unknown> }> = [];
  const restoreJev = configureJudgeForTests({
    enabled,
    apiKey: () => "test-key",
    evaluate: (async (options: { state: { blocks: Array<{ index: number; text: string; html: string }> }; questions: Record<string, unknown> }) => {
      seen.push({ state: options.state, questions: options.questions });
      if (typeof content === "function") content();
      const answers = Object.fromEntries(options.state.blocks.flatMap(block => {
        const probability = (content as Record<string, number>)[block.text];
        return probability === undefined ? [] : [[`block_${block.index}`, { type: "boolean", probability }]];
      }));
      return { answers, usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } };
    }) as never,
  });
  return { restore: restoreJev, seen };
}

const segment = (key: string, tag: string, html: string, text: string, streamable = true): ChatGptMarkdownSegment => ({
  key, tag, html, text, streamable,
});

const prose = segment("0:p", "p", "<p>The answer is <strong>42</strong>.</p>", "The answer is 42.");
const list = segment("1:ul:item", "ul:item", '<ul><li data-testid="li">first</li></ul>', "first");
const widget = segment(
  "2:div",
  "div",
  '<div data-testid="map-widget"><div role="button" tabindex="0">Zoom in</div><span>Loading map…</span></div>',
  "Zoom in\nLoading map…",
);
const richCard = segment(
  "3:div",
  "div",
  '<div class="card"><input type="range"><p>Estimated total: 1,240 kcal</p></div>',
  "Estimated total: 1,240 kcal",
);
const plain = segment("4:p", "p", "<p>Done.</p>", "Done.", false);

test("standard Markdown blocks are never judged, interactive markup outside them is", () => {
  expect(looksLikeWidget(prose)).toBe(false);
  expect(looksLikeWidget(list)).toBe(false);
  expect(looksLikeWidget(widget)).toBe(true);
  expect(looksLikeWidget(richCard)).toBe(true);
  expect(looksLikeWidget({ tag: "root", html: "<em>just words</em>" })).toBe(false);
  expect(looksLikeWidget({ tag: "inline", html: '<span><iframe src="x"></iframe></span>' })).toBe(true);
});

test("a confidently judged widget is dropped, answer-like cards are kept, prose is never sent to Jev", async () => {
  const jev = withJev({ [widget.text]: 0.05, [richCard.text]: 0.9 });
  restore = jev.restore;
  const dropped: string[] = [];
  const filter = new ChatGptWidgetFilter(excerpt => dropped.push(excerpt));

  const kept = await filter.filter([prose, list, widget, richCard, plain]);

  expect(kept.map(entry => entry.key)).toEqual(["0:p", "1:ul:item", "3:div", "4:p"]);
  expect(jev.seen).toHaveLength(1);
  expect(jev.seen[0]!.state.blocks.map(block => block.text)).toEqual([widget.text, richCard.text]);
  expect(Object.keys(jev.seen[0]!.questions)).toEqual(["block_0", "block_1"]);
  expect(dropped).toEqual(["Zoom in Loading map…"]);
});

test("verdicts are sticky per block: no re-asking and no retroactive drop after a kept block was committed", async () => {
  const jev = withJev({ [widget.text]: 0.5 });
  restore = jev.restore;
  const filter = new ChatGptWidgetFilter();
  const buffer = new ChatGptMarkdownBuffer(text => text, 0);

  const first = await filter.filter([prose, widget, plain]);
  expect(first).toHaveLength(3);
  expect(buffer.observe(first, 1_000)).toContain("Zoom in");

  // The unsure verdict is remembered; a later scan with the same block asks nothing and drops nothing.
  const second = await filter.filter([prose, widget, plain]);
  expect(second).toHaveLength(3);
  expect(jev.seen).toHaveLength(1);
  expect(() => buffer.observe(second, 2_000)).not.toThrow();
  expect(buffer.finish().markdown).toContain("Zoom in");
});

test("Jev failures, disabled Jev, and all-chrome answers keep the reader's output unchanged", async () => {
  const failing = withJev(() => { throw new Error("gateway down"); });
  restore = failing.restore;
  expect(await new ChatGptWidgetFilter().filter([widget, plain])).toEqual([widget, plain]);
  restore();

  const disabled = withJev({ [widget.text]: 0 }, false);
  restore = disabled.restore;
  expect(await new ChatGptWidgetFilter().filter([widget, plain])).toEqual([widget, plain]);
  expect(disabled.seen).toHaveLength(0);
  restore();

  const allChrome = withJev({ [widget.text]: 0 });
  restore = allChrome.restore;
  expect(await new ChatGptWidgetFilter().filter([widget])).toEqual([widget]);
});

test("at most MAX_WIDGET_CANDIDATES new blocks are judged per scan; the rest wait for the next one", async () => {
  const many = Array.from({ length: MAX_WIDGET_CANDIDATES + 2 }, (_, index) => segment(
    `${index}:div`,
    "div",
    `<div role="button">control ${index}</div>`,
    `control ${index}`,
  ));
  const jev = withJev(Object.fromEntries(many.map(entry => [entry.text, 0])));
  restore = jev.restore;
  const filter = new ChatGptWidgetFilter();

  const first = await filter.filter([...many, plain]);
  expect(jev.seen[0]!.state.blocks).toHaveLength(MAX_WIDGET_CANDIDATES);
  expect(first.map(entry => entry.key)).toEqual([`${MAX_WIDGET_CANDIDATES}:div`, `${MAX_WIDGET_CANDIDATES + 1}:div`, "4:p"]);

  const second = await filter.filter([...many, plain]);
  expect(jev.seen).toHaveLength(2);
  expect(jev.seen[1]!.state.blocks).toHaveLength(2);
  expect(second.map(entry => entry.key)).toEqual(["4:p"]);
});
