import { signal } from '@preact/signals'
import { h } from 'preact'
import type { Game } from '../Game'
import { createLogger } from '../util/log'
import { TitleScreen } from './TitleScreen'
import type { NewSessionOptions } from './SessionManager'

const log = createLogger('title')

export type TitleView = 'main' | 'new' | 'islands' | 'mods' | 'settings'

/**
 * The title screen: the latest island (or an unsaved one) as a living backdrop, seen by a drifting
 * camera. While it is up the HUD is hidden, input is paused and nothing is saved.
 */
export class Title {
  readonly visible = signal(false)
  readonly view = signal<TitleView>('main')
  /** A line for the player (a failed load…). */
  readonly note = signal('')
  /** Text shown while an island is being built ('' = not busy). */
  readonly busy = signal('')

  constructor(private game: Game) {}

  show(view: TitleView = 'main', note = ''): void {
    const g = this.game
    this.view.value = view
    this.note.value = note
    g.ui.close()
    g.ui.cover.value = {
      component: () => h(TitleScreen, { game: g }),
      onEscape: () => {
        if (!this.busy.value) this.view.value = 'main'
      },
    }
    g.camera.cinematic = g.engineConfig.title
    this.visible.value = true
  }

  /** Into the game: the camera glides down to the player. */
  play(): void {
    const g = this.game
    if (!this.visible.value) return
    this.visible.value = false
    g.ui.cover.value = null
    g.camera.cinematic = null
    g.renderer.iso.glide(g.engineConfig.title.glide)
  }

  /** The most recent island — it may already be the backdrop. */
  async resume(slot: string): Promise<void> {
    const s = this.game.sessions.session
    if (!s.demo && s.slot === slot) this.play()
    else await this.load(slot)
  }

  load(slot: string): Promise<void> {
    return this.work('Плывём на остров…', async () => {
      await this.game.sessions.load(slot)
      if (!this.game.sessions.session.demo) this.play()
    })
  }

  /** Mods were switched: rebuild the backdrop with them. */
  applyMods(): Promise<void> {
    return this.work('Подключаем моды…', () => this.game.applyMods())
  }

  create(opts: NewSessionOptions): Promise<void> {
    return this.work('Поднимаем остров из моря…', async () => {
      await this.game.sessions.newGame(opts)
      this.play()
      this.game.events.emit('session:created', { slot: this.game.sessions.session.slot })
    })
  }

  /** Save and go back to the title. */
  async leaveGame(view: TitleView = 'main'): Promise<void> {
    try {
      await this.game.sessions.save()
      this.show(view)
    } catch (e) {
      log.error('save failed, staying in the game:', e)
      this.game.ui.toast('Не получилось сохранить остров — остаёмся в игре')
    }
  }

  private async work(text: string, fn: () => Promise<void>): Promise<void> {
    if (this.busy.value) return
    this.busy.value = text
    this.note.value = ''
    await new Promise((r) => setTimeout(r, 60)) // let the text show up before the heavy part
    try {
      await fn()
    } catch (e) {
      log.error(e)
      this.note.value = `Не получилось: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      this.busy.value = ''
    }
  }
}
