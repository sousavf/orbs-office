import { ensureOverlayStyles } from './overlay-styles';

/** Dims the scene while the office is not connected, and says so when it is connected but empty. */
export class StatusLayer {
  private readonly root = document.createElement('div');
  private readonly message = document.createElement('p');

  constructor(container: HTMLElement) {
    ensureOverlayStyles();
    this.root.className = 'o3-dim';
    this.root.hidden = true;
    this.message.hidden = true;
    this.message.textContent =
      import.meta.env.MODE === 'public' ? 'The office is quiet right now.' : 'No bots yet. Create a bot in Orbs.';
    this.root.append(this.message);
    container.append(this.root);
  }

  set(connected: boolean, botCount: number): void {
    this.root.hidden = connected && botCount > 0;
    this.root.classList.toggle('o3-tint', !connected);
    this.message.hidden = !(connected && botCount === 0);
  }

  dispose(): void {
    this.root.remove();
  }
}
