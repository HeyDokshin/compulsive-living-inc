import type { Registry } from '../registry/Registry'
import type { CommandDef } from '../types'
import { addLogSink, type LogRecord } from '../util/log'
import { keyCodeOf } from '../input/Input'

const MAX_LINES = 300

/** Split a command line, honoring "quoted strings". */
export function parseArgs(line: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]!)
  return out
}

/** In-game developer console (toggle with ` / ё). Commands come from the `commands` registry. */
export class DevConsole {
  private root = document.createElement('div')
  private output = document.createElement('div')
  private input = document.createElement('input')
  private history: string[] = []
  private historyIndex = -1
  open = false

  constructor(private commands: Registry<CommandDef>) {
    this.root.style.cssText =
      'position:fixed;left:0;right:0;top:0;height:42%;display:none;flex-direction:column;z-index:30;' +
      'background:rgba(16,22,30,.88);color:#dfe8f0;font:13px/1.45 ui-monospace,Menlo,monospace;backdrop-filter:blur(4px)'
    this.output.style.cssText = 'flex:1;overflow:auto;padding:8px 12px;white-space:pre-wrap'
    this.input.style.cssText = 'border:0;outline:0;padding:8px 12px;background:rgba(255,255,255,.07);color:#fff;font:inherit'
    this.input.placeholder = 'команда… (help — список, Tab — дополнение, ↑↓ — история)'
    this.root.append(this.output, this.input)
    document.body.appendChild(this.root)

    this.input.addEventListener('keydown', (e) => this.onKey(e))
    addLogSink((r) => this.onLog(r))
    this.print('Консоль разработчика. Введите help.', '#8fb3c9')
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open
    this.root.style.display = this.open ? 'flex' : 'none'
    if (this.open) setTimeout(() => this.input.focus())
    else this.input.blur()
  }

  print(text: string, color?: string): void {
    const line = document.createElement('div')
    line.textContent = text
    if (color) line.style.color = color
    this.output.appendChild(line)
    while (this.output.childElementCount > MAX_LINES) this.output.firstElementChild!.remove()
    this.output.scrollTop = this.output.scrollHeight
  }

  clear(): void {
    this.output.replaceChildren()
  }

  find(name: string): CommandDef | undefined {
    return this.commands.get(name) ?? this.commands.all().find((c) => c.name === name)
  }

  async execute(line: string): Promise<void> {
    const [name, ...args] = parseArgs(line.trim())
    if (!name) return
    this.print(`> ${line}`, '#7fd3ff')
    const cmd = this.find(name.replace(/^\//, ''))
    if (!cmd) return this.print(`Неизвестная команда "${name}". help — список команд.`, '#ff9c8a')
    try {
      const result = await cmd.run(args, { print: (t) => this.print(t) })
      if (typeof result === 'string' && result) this.print(result)
    } catch (e) {
      this.print(String(e instanceof Error ? e.message : e), '#ff9c8a')
      if (cmd.usage) this.print(`usage: ${cmd.name} ${cmd.usage}`, '#c9b98f')
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (keyCodeOf(e) === 'Backquote') {
      e.preventDefault()
      return
    }
    if (e.key === 'Escape') return this.toggle(false)
    if (e.key === 'Enter') {
      const line = this.input.value
      this.input.value = ''
      if (line.trim()) {
        this.history.unshift(line)
        this.historyIndex = -1
        void this.execute(line)
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const dir = e.key === 'ArrowUp' ? 1 : -1
      this.historyIndex = Math.max(-1, Math.min(this.history.length - 1, this.historyIndex + dir))
      this.input.value = this.history[this.historyIndex] ?? ''
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const v = this.input.value
      if (v.includes(' ')) return
      const names = this.commands
        .all()
        .map((c) => c.name)
        .filter((n) => n.startsWith(v))
        .sort()
      if (names.length === 1) this.input.value = names[0] + ' '
      else if (names.length > 1) this.print(names.join('  '), '#8fb3c9')
    }
  }

  private onLog(r: LogRecord): void {
    const color = r.level === 'error' ? '#ff9c8a' : r.level === 'warn' ? '#ffd27f' : '#9aa9b5'
    this.print(`[${r.source}] ${r.message}`, color)
  }
}
