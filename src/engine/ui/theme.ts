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
  --ui-radius: 18px;
  --ui-font: ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif;
}
.cl-ui { position: fixed; inset: 0; pointer-events: none; z-index: 10; font-family: var(--ui-font); color: var(--ui-text); }
.cl-ui * { box-sizing: border-box; }
.cl-slot { position: absolute; display: flex; gap: 10px; pointer-events: none; }
.cl-slot > * { pointer-events: auto; }
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
.cl-window { background: var(--ui-bg); border-radius: 26px; box-shadow: 0 14px 40px rgba(110, 80, 70, .28);
  border: 3px solid #fff; min-width: 300px; max-width: min(92vw, 720px); max-height: 86vh; overflow: auto;
  animation: cl-pop .22s cubic-bezier(.3, 1.4, .5, 1); }
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
`
