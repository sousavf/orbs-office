// Safe Markdown subset renderer. Builds DOM with createElement/textContent only, so text is never parsed as HTML.

const FENCE = /^```/;
const HEADING = /^#{1,6}\s+(.*\S)\s*$/;
const QUOTE = /^>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const NESTED_INDENT = 2;

const INLINE = new RegExp(
  [
    '`(?<code>[^`\\n]+)`',
    '\\[(?<label>[^\\]\\n]+)\\]\\((?<href>[^)\\s]+)\\)',
    '\\*\\*(?=\\S)(?<strong>.+?)(?<=\\S)\\*\\*',
    '(?<!\\w)__(?=\\S)(?<strongu>.+?)(?<=\\S)__(?!\\w)',
    '(?<![\\w*])\\*(?=[^\\s*])(?<em>.+?)(?<=[^\\s*])\\*(?![\\w*])',
    '(?<!\\w)_(?=\\S)(?<emu>.+?)(?<=\\S)_(?!\\w)',
    '(?<bare>https?://[^\\s<>"\')\\]]+)',
  ].join('|'),
  'g',
);

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  if (text !== undefined) created.textContent = text;
  return created;
}

/** The URL when it is http(s), otherwise null. */
function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function link(label: string, raw: string): Node {
  const href = safeHref(raw);
  if (href === null) return document.createTextNode(label);
  const anchor = node('a', label);
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

function wrap<K extends keyof HTMLElementTagNameMap>(tag: K, inner: string): HTMLElementTagNameMap[K] {
  const created = node(tag);
  created.append(...inline(inner));
  return created;
}

function inline(text: string): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const g = match.groups ?? {};
    if (match.index > last) out.push(document.createTextNode(text.slice(last, match.index)));
    last = match.index + match[0].length;
    if (g.code !== undefined) out.push(node('code', g.code));
    else if (g.label !== undefined && g.href !== undefined) out.push(link(g.label, g.href));
    else if (g.strong !== undefined || g.strongu !== undefined) out.push(wrap('strong', g.strong ?? g.strongu ?? ''));
    else if (g.em !== undefined || g.emu !== undefined) out.push(wrap('em', g.em ?? g.emu ?? ''));
    else if (g.bare !== undefined) {
      const url = g.bare.replace(/[.,;:!?]+$/, '');
      out.push(link(url, url));
      last -= g.bare.length - url.length;
    }
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

interface Item {
  ordered: boolean;
  start: number;
  text: string;
  children: Item[];
}

function listElement(items: Item[]): HTMLElement {
  const first = items[0];
  const list = node(first?.ordered === true ? 'ol' : 'ul');
  if (first?.ordered === true && first.start !== 1) list.setAttribute('start', String(first.start));
  for (const item of items) {
    const li = node('li');
    li.append(...inline(item.text));
    if (item.children.length > 0) li.append(listElement(item.children));
    list.append(li);
  }
  return list;
}

function parseItem(match: RegExpExecArray): Item {
  const marker = match[2] ?? '';
  return { ordered: /\d/.test(marker), start: Number.parseInt(marker, 10), text: match[3] ?? '', children: [] };
}

function blocks(lines: string[], into: ParentNode): void {
  let i = 0;
  const isSpecial = (line: string): boolean =>
    FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || LIST_ITEM.test(line);
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (FENCE.test(line)) {
      const end = lines.findIndex((candidate, index) => index > i && FENCE.test(candidate));
      if (end !== -1) {
        const pre = node('pre');
        pre.append(node('code', lines.slice(i + 1, end).join('\n')));
        into.append(pre);
        i = end + 1;
        continue;
      }
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const p = node('p');
      p.className = 'md-heading';
      p.append(wrap('strong', heading[1] ?? ''));
      into.append(p);
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        inner.push(QUOTE.exec(lines[i] ?? '')?.[1] ?? '');
        i += 1;
      }
      const quote = node('blockquote');
      blocks(inner, quote);
      into.append(quote);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const top: Item[] = [];
      while (i < lines.length) {
        const match = LIST_ITEM.exec(lines[i] ?? '');
        if (match === null) break;
        const item = parseItem(match);
        const parent = top[top.length - 1];
        if ((match[1] ?? '').length >= NESTED_INDENT && parent !== undefined) parent.children.push(item);
        else top.push(item);
        i += 1;
      }
      into.append(listElement(top));
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && (paragraph.length === 0 || !isSpecial(lines[i] ?? ''))) {
      paragraph.push(lines[i] ?? '');
      i += 1;
    }
    const p = node('p');
    paragraph.forEach((text, index) => {
      if (index > 0) p.append(node('br'));
      p.append(...inline(text));
    });
    into.append(p);
  }
}

/** Renders a safe Markdown subset (paragraphs, code, emphasis, headings, lists, quotes, http(s) links). */
export function renderMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  blocks(text.replace(/\r\n?/g, '\n').split('\n'), fragment);
  return fragment;
}
