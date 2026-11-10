import type { BubbleKey, BubbleSpec } from '../actors/types';
import { bubbleImage, bubbleLabel } from './icons';

export interface BotOverlayOptions {
  /** Interns: smaller type and icons. */
  readonly compact: boolean;
  readonly botId: string;
  readonly onReplyClick: (botId: string) => void;
}

const COMPACT_SCALE = 0.65;
/** Pixels a reply bubble keeps clear of the screen edge. */
const REPLY_EDGE = 6;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** Restarts the one-shot pop animation on `node`. */
function pop(node: HTMLElement): void {
  node.classList.remove('o3-pop');
  void node.offsetWidth;
  node.classList.add('o3-pop');
}

/**
 * The DOM that floats above one character: reply bubble, chatter line, state bubble and name, stacked
 * upward from the head. The owner sets content; the layer positions `root`. Everything but the reply
 * bubble ignores the pointer.
 */
export class BotOverlay {
  readonly root = element('div', 'o3-bot');
  /** World point just above the head that the stack hangs from. */
  anchorX = 0;
  anchorY = 0;
  anchorZ = 0;
  private readonly name = element('div', 'o3-name');
  private readonly badge = element('div', 'o3-badge');
  private readonly icon = element('img', 'o3-icon');
  private readonly count = element('span', 'o3-count');
  private zzz: HTMLDivElement | null = null;
  private speech: HTMLDivElement | null = null;
  private reply: HTMLButtonElement | null = null;
  private replyText: HTMLSpanElement | null = null;
  private badgeKey: BubbleKey | null = null;
  private lastTransform = '';
  private lastZ = '';
  private lastOpacity = '1';
  private lastVisible = true;
  private replyShift = 0;
  private replyWidth = 0;

  constructor(private readonly options: BotOverlayOptions) {
    if (options.compact) this.root.classList.add('o3-compact');
    this.icon.alt = '';
    this.badge.hidden = true;
    this.count.hidden = true;
    this.badge.append(this.icon, this.count);
    this.root.append(this.badge, this.name);
  }

  get replyShowing(): boolean {
    return this.reply !== null && !this.reply.hidden;
  }

  setName(text: string): void {
    if (this.name.textContent !== text) this.name.textContent = text;
  }

  /** Lifts the whole stack, to keep neighbouring names from overprinting each other. */
  setLift(pixels: number): void {
    this.name.style.marginBottom = pixels === 0 ? '' : `${pixels}px`;
  }

  /** A small "Zzz" under the name while the bot sleeps; it drifts unless motion is reduced (CSS). */
  setSleeping(sleeping: boolean): void {
    if (!sleeping) {
      if (this.zzz !== null) this.zzz.hidden = true;
      return;
    }
    if (this.zzz === null) {
      this.zzz = element('div', 'o3-zzz');
      this.zzz.setAttribute('aria-hidden', 'true');
      for (const letter of 'zZz') {
        const node = document.createElement('span');
        node.textContent = letter;
        this.zzz.append(node);
      }
      this.root.append(this.zzz);
    }
    this.zzz.hidden = false;
  }

  setLabelShown(shown: boolean): void {
    this.name.classList.toggle('o3-off', !shown);
  }

  setBadge(spec: BubbleSpec | null, animate: boolean): void {
    if (spec === null) {
      this.badge.hidden = true;
      this.badgeKey = null;
      return;
    }
    const changed = spec.key !== this.badgeKey;
    if (changed) {
      const image = bubbleImage(spec.key);
      const scale = this.options.compact ? COMPACT_SCALE : 1;
      this.icon.src = image.src;
      this.icon.width = Math.round(image.width * scale);
      this.icon.height = Math.round(image.height * scale);
      this.badge.setAttribute('role', 'img');
      this.badge.setAttribute('aria-label', bubbleLabel(spec.key));
      this.badgeKey = spec.key;
    }
    this.count.hidden = spec.count === undefined;
    this.count.textContent = spec.count === undefined ? '' : String(spec.count);
    this.badge.hidden = false;
    if (changed && animate) pop(this.badge);
  }

  /** A short chatter line, or null to clear. */
  setSpeech(line: string | null): void {
    if (line === null) {
      if (this.speech !== null) this.speech.hidden = true;
      return;
    }
    if (this.speech === null) {
      this.speech = element('div', 'o3-speech');
      this.root.insertBefore(this.speech, this.badge);
    }
    this.speech.textContent = line;
    this.speech.hidden = false;
  }

  /** The bot's latest chat reply, or null to clear. */
  setReply(text: string | null, animate: boolean, botName: string): void {
    if (text === null) {
      if (this.reply !== null) this.reply.hidden = true;
      return;
    }
    if (this.reply === null) {
      const button = element('button', 'o3-reply');
      button.type = 'button';
      this.replyText = element('span', '');
      button.append(this.replyText);
      button.addEventListener('click', () => this.options.onReplyClick(this.options.botId));
      this.reply = button;
      this.root.prepend(button);
    }
    if (this.replyText !== null) this.replyText.textContent = text.trim();
    this.replyWidth = 0;
    this.reply.setAttribute('aria-label', `${botName} says: ${text.trim()}. Open chat`);
    this.reply.hidden = false;
    if (animate) pop(this.reply);
  }

  /** Top-centre of the stack in viewport pixels, or null while it is hidden. */
  topCentre(): { x: number; y: number } | null {
    if (this.root.style.display === 'none') return null;
    const box = this.root.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top };
  }

  setOpacity(opacity: number): void {
    const value = opacity.toFixed(2);
    if (value === this.lastOpacity) return;
    this.lastOpacity = value;
    this.root.style.opacity = value;
  }

  /** Called by the layer once per frame with the stack's anchor in layer pixels and the layer's width. */
  place(x: number, y: number, visible: boolean, layerWidth: number): void {
    if (visible !== this.lastVisible) {
      this.lastVisible = visible;
      this.root.style.display = visible ? '' : 'none';
    }
    if (!visible) return;
    // Whole pixels keep the text crisp.
    const transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    if (transform !== this.lastTransform) {
      this.lastTransform = transform;
      this.root.style.transform = transform;
    }
    if (this.replyShowing) this.keepReplyOnScreen(x, layerWidth);
    // Nearer characters (lower on screen) draw over farther ones; a showing reply sits above every name.
    const z = String(Math.round(y) + (this.replyShowing ? 100_000 : 0));
    if (z !== this.lastZ) {
      this.lastZ = z;
      this.root.style.zIndex = z;
    }
  }

  /** Slides the reply bubble sideways, tail left in place, when its box would run off the screen. */
  private keepReplyOnScreen(x: number, layerWidth: number): void {
    const reply = this.reply;
    if (reply === null) return;
    if (this.replyWidth === 0) this.replyWidth = reply.offsetWidth;
    const width = this.replyWidth;
    const left = x - width / 2;
    const shift = Math.round(Math.min(Math.max(left, REPLY_EDGE), Math.max(REPLY_EDGE, layerWidth - width - REPLY_EDGE)) - left);
    if (shift === this.replyShift) return;
    this.replyShift = shift;
    reply.style.translate = shift === 0 ? '' : `${shift}px 0`;
    reply.style.setProperty('--o3-tail', `${-shift}px`);
  }

  destroy(): void {
    this.root.remove();
  }
}
