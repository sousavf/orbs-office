const STYLE_ID = 'office3d-controls-style';

const STYLE = `
.office3d-controls {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 5;
  display: flex;
  gap: 8px;
}
.office3d-button {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  color: var(--fg);
  backdrop-filter: blur(6px);
  cursor: pointer;
}
.office3d-button:hover { background: var(--line); }
.office3d-button svg { width: 20px; height: 20px; }
@media (max-width: 720px) {
  .office3d-controls { bottom: 72px; }
}
`;

function icon(mirror: boolean): string {
  const flip = mirror ? ' transform="translate(24 0) scale(-1 1)"' : '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g${flip}><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3v5h-5"/></g></svg>`;
}

function makeButton(label: string, mirror: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'office3d-button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon(mirror);
  button.addEventListener('click', onClick);
  return button;
}

/** Two rotate buttons, bottom-left, styled like the legend. Returns a remover. */
export function mountRotateButtons(parent: HTMLElement, rotate: (step: -1 | 1) => void): () => void {
  if (document.getElementById(STYLE_ID) === null) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.append(style);
  }
  const wrap = document.createElement('div');
  wrap.className = 'office3d-controls';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Rotate view');
  wrap.append(
    makeButton('Rotate view left (Q)', true, () => rotate(-1)),
    makeButton('Rotate view right (E)', false, () => rotate(1)),
  );
  parent.append(wrap);
  return () => wrap.remove();
}
