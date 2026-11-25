/** Names of physical keys and gamepad buttons, as shown on key caps. */
const NAMES: Record<string, string> = {
  Space: 'Пробел', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Del', CapsLock: 'Caps', Backquote: 'ё',
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt', MetaLeft: 'Cmd', MetaRight: 'Cmd',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Mouse0: 'ЛКМ', Mouse1: 'СКМ', Mouse2: 'ПКМ',
}
const PAD = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L3', 'R3', '✚↑', '✚↓', '✚←', '✚→']

export function keyName(code: string): string {
  const pad = /^Pad(\d+)$/.exec(code)
  if (pad) return PAD[Number(pad[1])] ?? `Pad ${pad[1]}`
  return NAMES[code] ?? code.replace(/^(Key|Digit|Numpad)/, '')
}

export type Device = 'keyboard' | 'gamepad'

export const isPadCode = (code: string): boolean => /^(Pad|Stick)/.test(code)

/** The key to show for an action: one of the device in use, else the first there is. */
export function shownKey(codes: readonly string[], device: Device): string | undefined {
  return codes.find((c) => isPadCode(c) === (device === 'gamepad')) ?? codes[0]
}

/** Keyboard keys of an action replaced by one; gamepad and mouse stay. */
export function withKey(codes: readonly string[], key: string): string[] {
  return [key, ...codes.filter((c) => c !== key && (isPadCode(c) || c.startsWith('Mouse')))]
}
