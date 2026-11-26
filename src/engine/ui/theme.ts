/** Shared look of all game UI: cream panels, warm brown text, rounded font, soft shadows. */
export const UI_CSS = /* css */ `
:root {
  --ui-bg: #fffaf0;
  --ui-bg-2: #f7eedc;
  --ui-line: #eadcc2;
  --ui-text: #6b5a4e;
  --ui-text-soft: #a08c7c;
  --ui-accent: #7fcfb0;
  --ui-accent-2: #ffb3c7;
  --ui-gold: #f4c76b;
  --ui-shadow: 0 6px 18px rgba(120, 90, 70, .18);
  --ui-zoom: 1;
  --ui-radius: 18px;
  --ui-font: ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif;
}
.cl-ui { position: fixed; inset: 0; zoom: var(--ui-zoom); pointer-events: none; z-index: 10; font-family: var(--ui-font); color: var(--ui-text); }
.cl-ui * { box-sizing: border-box; }
.cl-slot { position: absolute; display: flex; gap: 10px; pointer-events: none; }
.cl-slot > * { pointer-events: auto; }
.cl-slot-screen { inset: 0; }
.cl-clock { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; pointer-events: none; }
.cl-clock-time { font-size: 40px; font-weight: 800; line-height: 1; letter-spacing: -0.02em; color: #fffdf7; font-variant-numeric: tabular-nums;
  text-shadow: 0 2px 0 rgba(90, 70, 60, 0.35), 0 6px 18px rgba(60, 40, 30, 0.3); }
.cl-clock-date { display: flex; gap: 6px; align-items: center; padding: 4px 12px; border-radius: 999px; background: var(--ui-bg); color: var(--ui-text);
  font-size: 13px; font-weight: 700; box-shadow: 0 4px 14px rgba(80, 60, 40, 0.18); }
.cl-slot { transition: opacity 0.4s ease; }
.cl-bare { pointer-events: auto; animation: cl-pop 0.22s ease-out; }
.cl-quiet { transition: opacity 0.5s ease, transform 0.5s ease; }
.cl-quiet:not([data-awake]) { opacity: 0; transform: translateY(-6px); pointer-events: none; }
.cl-ui[data-peek] .cl-quiet { opacity: 1; transform: none; pointer-events: auto; }
.cl-ui[data-cinema] .cl-slot:not(.cl-slot-screen) { opacity: 0; pointer-events: none; }
.cl-ui[data-cinema] .cl-slot:not(.cl-slot-screen) > * { pointer-events: none; }
.cl-slot-screen > * { pointer-events: none; }
.cl-slot-hud\\.topLeft { top: 16px; left: 16px; flex-direction: column; align-items: flex-start; }
.cl-slot-hud\\.topRight { top: 16px; right: 16px; flex-direction: column; align-items: flex-end; }
.cl-slot-hud\\.bottomLeft { bottom: 18px; left: 18px; align-items: flex-end; }
.cl-slot-hud\\.bottomRight { bottom: 18px; right: 18px; align-items: flex-end; }
.cl-slot-hud\\.bottom { bottom: 24px; left: 50%; transform: translateX(-50%); flex-direction: column; align-items: center; }
.cl-slot-hud\\.bottom > * { pointer-events: none; }
.cl-slot-hud\\.center { top: 50%; left: 50%; transform: translate(-50%, -50%); flex-direction: column; align-items: center; }

.cl-pill { background: rgba(255, 250, 240, .9); border-radius: 999px; padding: 7px 16px; font-weight: 700; font-size: 14px;
  box-shadow: var(--ui-shadow); display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.cl-key { display: inline-block; min-width: 22px; padding: 1px 7px; border-radius: 8px; background: var(--ui-bg-2);
  border: 1.5px solid var(--ui-line); font-size: 12px; font-weight: 800; text-align: center; color: var(--ui-text-soft); }

.cl-backdrop { position: absolute; inset: 0; background: rgba(90, 70, 80, .18); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center; pointer-events: auto; animation: cl-fade .18s ease-out; }
.cl-backdrop.clear { background: transparent; backdrop-filter: none; }
.cl-backdrop.left { justify-content: flex-start; padding-left: 4vw; }
.cl-backdrop.right { justify-content: flex-end; padding-right: 4vw; }
.cl-backdrop.bottom { align-items: flex-end; padding-bottom: 5vh; }
.cl-window { background: var(--ui-bg); border-radius: 26px; box-shadow: 0 14px 40px rgba(110, 80, 70, .28);
  border: 3px solid #fff; min-width: 300px; max-width: min(calc(92vw / var(--ui-zoom)), 720px); max-height: calc(86vh / var(--ui-zoom)); overflow: auto;
  animation: cl-pop .22s cubic-bezier(.3, 1.4, .5, 1); }
.cl-window.wide { max-width: min(calc(96vw / var(--ui-zoom)), 1040px); }
.cl-window-body > * { max-width: 100%; }
.cl-window-title { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 18px 6px 22px; font-size: 20px; font-weight: 800; }
.cl-window-body { padding: 8px 20px 20px; }
.cl-close { border: 0; background: var(--ui-bg-2); color: var(--ui-text-soft); width: 32px; height: 32px; border-radius: 50%;
  font-size: 18px; font-weight: 800; cursor: pointer; }
.cl-close:hover { background: var(--ui-accent-2); color: #fff; }

.cl-btn { border: 0; border-radius: 999px; padding: 8px 18px; font: 800 14px var(--ui-font); cursor: pointer;
  background: var(--ui-accent); color: #fff; box-shadow: 0 3px 0 rgba(0, 0, 0, .08); transition: transform .08s; }
.cl-btn:hover { transform: translateY(-1px); filter: brightness(1.04); }
.cl-btn:active { transform: translateY(1px); }
.cl-btn.secondary { background: var(--ui-bg-2); color: var(--ui-text); }
.cl-btn:disabled { opacity: .45; cursor: default; transform: none; }

.cl-grid { display: grid; gap: 8px; }
.cl-dialogue { background: #fffaf0; border-radius: 18px; padding: 14px 16px; min-height: 84px; font-size: 15px; line-height: 1.45;
  box-shadow: inset 0 0 0 2px rgba(201, 150, 106, .25); }
.cl-dialogue-speaker { font-weight: 800; font-size: 12px; color: var(--ui-accent); margin-bottom: 4px; }
.cl-slotbox { position: relative; width: 64px; height: 64px; border-radius: 18px; background: var(--ui-bg-2);
  border: 3px solid transparent; display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: transform .1s, border-color .1s; }
.cl-slotbox:hover { transform: scale(1.05); }
.cl-slotbox.selected { border-color: var(--ui-accent); background: #eef9f3; }
.cl-slotbox.equipped::after { content: '✦'; position: absolute; top: 2px; left: 6px; color: var(--ui-gold); font-size: 13px; }
.cl-slotbox img { width: 48px; height: 48px; image-rendering: pixelated; pointer-events: none; }
.cl-count { position: absolute; right: 4px; bottom: 2px; font-size: 12px; font-weight: 800; background: #fff;
  border-radius: 999px; padding: 0 6px; box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }

.cl-toasts { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column;
  gap: 8px; align-items: center; }
.cl-toast { background: var(--ui-bg); border-radius: 999px; padding: 9px 20px; font-weight: 700; font-size: 15px;
  box-shadow: var(--ui-shadow); animation: cl-pop .25s cubic-bezier(.3, 1.4, .5, 1); display: flex; gap: 8px; align-items: center; }
.cl-toast img { width: 28px; height: 28px; image-rendering: pixelated; }
@keyframes cl-pop { from { transform: scale(.85); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes cl-fade { from { opacity: 0 } to { opacity: 1 } }
.cl-bells-float { position: absolute; right: 12px; top: 100%; font-weight: 800; font-size: 14px; white-space: nowrap; pointer-events: none;
  text-shadow: 0 1px 0 #fff, 0 0 6px #fff; animation: cl-float 1.4s ease-out forwards; }
@keyframes cl-float { 0% { transform: translateY(6px); opacity: 0 } 15% { transform: translateY(0); opacity: 1 } 100% { transform: translateY(-34px); opacity: 0 } }
.cl-input { border: 2px solid var(--ui-line); border-radius: 14px; padding: 9px 14px; font: 700 15px var(--ui-font); color: var(--ui-text);
  background: #fff; outline: none; width: 100%; }
.cl-code { font: 500 12px ui-monospace, Menlo, monospace; resize: vertical; }
.cl-row { display: flex; align-items: center; gap: 8px; border: 0; border-radius: 12px; padding: 6px 10px; background: none; text-align: left; cursor: pointer;
  font: 700 14px var(--ui-font); color: var(--ui-text); flex: none; }
.cl-row:hover { background: var(--ui-bg-2); }
.cl-row[aria-pressed='true'] { background: #eef9f3; box-shadow: inset 0 0 0 2px var(--ui-accent); }
.cl-input:focus { border-color: var(--ui-accent); }
.cl-input::placeholder { color: var(--ui-text-soft); opacity: .7; }

.cl-title { position: absolute; inset: 0; pointer-events: auto; display: flex; align-items: center; gap: 24px; padding: 4vh 5vw; overflow: auto;
  background: linear-gradient(90deg, rgba(255, 250, 240, .55), rgba(255, 250, 240, 0) 60%); animation: cl-fade .5s ease-out; }
.cl-title-side { display: flex; flex-direction: column; align-items: flex-start; gap: 26px; flex: none; }
.cl-title-logo { margin: 0; font-size: clamp(44px, 7vw, 84px); line-height: .95; font-weight: 900; letter-spacing: -.02em; color: #fffaf0;
  -webkit-text-stroke: 10px #8a6a55; paint-order: stroke fill; filter: drop-shadow(0 6px 0 rgba(110, 80, 70, .28)); animation: cl-bob 5s ease-in-out infinite; }
.cl-title-menu { display: flex; flex-direction: column; gap: 10px; width: 270px; }
.cl-title-btn { border: 3px solid #fff; border-radius: 22px; padding: 11px 22px; text-align: left; cursor: pointer; background: rgba(255, 250, 240, .94);
  color: var(--ui-text); font: 800 18px var(--ui-font); box-shadow: var(--ui-shadow); transition: transform .12s; }
.cl-title-btn small { display: block; font-size: 12px; font-weight: 700; opacity: .85; margin-top: 2px; }
.cl-title-btn:hover, .cl-title-btn.on { transform: translateX(8px); }
.cl-title-btn.on { border-color: var(--ui-accent); }
.cl-title-btn.main { background: var(--ui-accent); color: #fff; }
.cl-title-btn:focus-visible, .cl-btn:focus-visible, .cl-slotbox:focus-visible, .cl-close:focus-visible, .cl-row:focus-visible, input:focus-visible { outline: 3px solid var(--ui-gold); outline-offset: 2px; }
.cl-title-panel { margin: auto; max-height: calc(88vh / var(--ui-zoom)); }
.cl-title-busy { display: flex; align-items: center; gap: 12px; font-weight: 800; font-size: 18px; background: rgba(255, 250, 240, .94);
  border-radius: 999px; padding: 12px 24px; box-shadow: var(--ui-shadow); }
.cl-title-dots { display: inline-flex; gap: 5px; }
.cl-title-dots i { width: 9px; height: 9px; border-radius: 50%; background: var(--ui-accent); }
.cl-title .cl-pill { white-space: normal; max-width: min(420px, 88vw); }
.cl-title-version { position: fixed; left: 16px; bottom: 12px; font-size: 12px; font-weight: 700; color: #fff; text-shadow: 0 1px 3px rgba(90, 70, 60, .6); }
@keyframes cl-bob { 50% { transform: translateY(-6px) } }
@media (max-width: 760px) {
  .cl-title { flex-direction: column; justify-content: flex-start; }
  .cl-title-side { align-items: center; text-align: center; gap: 16px; }
  .cl-title-panel { margin: 0 auto; max-height: none; flex: none; }
}
@media (max-width: 560px) {
  .cl-slot-hud\\.topLeft { max-width: 52vw; }
  .cl-slot-hud\\.topRight { gap: 6px; }
  .cl-slot-hud\\.topRight .cl-pill { padding: 5px 11px; font-size: 12px; }
  .cl-slot-hud\\.bottom { bottom: 76px; }
  .cl-window { min-width: 0; border-radius: 20px; }
  .cl-window-body { padding: 6px 14px 16px; }
}
@media (prefers-reduced-motion: reduce) { .cl-title-logo { animation: none } }
`
