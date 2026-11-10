const STYLE_ID = 'office3d-overlay-style';
const INK = '#1d2127';

const STYLE = `
.o3-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  pointer-events: none;
}
.o3-bot {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  contain: layout style;
  pointer-events: none;
  font: 600 12px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.o3-name {
  max-height: 20px;
  padding: 1px 0;
  overflow: hidden;
  color: #fff;
  white-space: nowrap;
  -webkit-text-stroke: 3px #10131a;
  paint-order: stroke fill;
  transition: opacity 0.15s, max-height 0.15s;
}
.o3-compact .o3-name { font-size: 10px; }
.o3-name.o3-off { max-height: 0; padding: 0; opacity: 0; }
.o3-badge {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  transform-origin: 50% 100%;
}
.o3-badge[hidden] { display: none; }
.o3-icon { display: block; }
.o3-count {
  color: #fff;
  font-size: 12px;
  -webkit-text-stroke: 3px #10131a;
  paint-order: stroke fill;
  margin-bottom: 4px;
}
.o3-speech, .o3-reply {
  position: relative;
  margin-bottom: 7px;
  padding: 4px 8px;
  border: 2px solid ${INK};
  border-radius: 8px;
  background: #fff;
  color: ${INK};
  font: 600 11px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif;
  transform-origin: 50% 100%;
}
.o3-speech { white-space: nowrap; }
.o3-speech::after, .o3-reply::after {
  content: '';
  position: absolute;
  left: clamp(14px, calc(50% + var(--o3-tail, 0px)), calc(100% - 14px));
  bottom: -7px;
  width: 8px;
  height: 8px;
  background: #fff;
  border-right: 2px solid ${INK};
  border-bottom: 2px solid ${INK};
  transform: translateX(-50%) rotate(45deg);
}
.o3-reply {
  box-sizing: content-box;
  max-width: 200px;
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  pointer-events: auto;
}
.o3-reply:focus-visible { outline: 2px solid var(--focus, #3b6cf6); outline-offset: 2px; }
.o3-reply > span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.o3-zzz {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 22px;
  color: #fff;
  font-weight: 700;
  -webkit-text-stroke: 3px #10131a;
  paint-order: stroke fill;
}
.o3-zzz[hidden] { display: none; }
.o3-zzz span { display: block; animation: o3-zzz 2.4s ease-in-out infinite; }
.o3-zzz span:nth-child(1) { font-size: 9px; }
.o3-zzz span:nth-child(2) { font-size: 12px; animation-delay: 0.4s; }
.o3-zzz span:nth-child(3) { font-size: 15px; animation-delay: 0.8s; }
@keyframes o3-zzz { 0%, 100% { opacity: 0.35; transform: translateY(2px); } 50% { opacity: 1; transform: translateY(-3px); } }
.o3-pop { animation: o3-pop 0.15s ease-out; }
@keyframes o3-pop { from { transform: scale(0.65); } to { transform: scale(1); } }
.o3-dim {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-items: center;
  color: var(--fg, ${INK});
  font: 600 20px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif;
  text-align: center;
  pointer-events: none;
}
.o3-dim[hidden] { display: none; }
.o3-tint { background: color-mix(in srgb, var(--bg, #eef0f3) 60%, transparent); }
.o3-dim p { margin: 0; padding: 0 24px; text-shadow: 0 0 8px var(--bg, #eef0f3), 0 0 3px var(--bg, #eef0f3); }
@media (prefers-reduced-motion: reduce) {
  .o3-pop { animation: none; }
  .o3-zzz span { animation: none; opacity: 1; }
  .o3-name { transition: none; }
}
`;

/** Adds the overlay stylesheet to the page once. */
export function ensureOverlayStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.append(style);
}
