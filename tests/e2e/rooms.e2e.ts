/**
 * A walk through the game as a player takes it: a new island, into the house, curtains drawn, saved
 * inside, loaded again (straight into the room), out to the island, into the museum and back. No
 * errors on the way, and each frame stays within its budget of draw calls and triangles.
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/**
 * What a frame may cost (all passes, 1100 × 700, default zoom) — about 1.5 × what it cost when set
 * (0.19: island 129 calls / 523 k triangles, house 72 / 74 k). Raise on purpose, with a reason.
 */
const BUDGET = {
  island: { calls: 200, triangles: 800_000 },
  room: { calls: 120, triangles: 150_000 },
}

const HOUSE = 'house:home'
const MUSEUM = 'museum:hall'

// errors the browser prints about the software GPU, not about the game
const NOISE = /GL Driver|GPU stall|swiftshader|WebGL: |Automatic fallback to software|ReadPixels|TUNNEL/i

type G = {
  sessions: { session: { slot: string }; save(): Promise<unknown>; load(slot: string): Promise<void> }
  title: { create(o: { name: string; player: string; seed: number }): Promise<void> }
  ui: { close(): void }
  devConsole: { execute(line: string): Promise<void> }
  interiors: { current: string | null; area(id: string): { x: number; z: number } }
  changingPlace: boolean
  world: { onIsland: boolean; surfaceY(x: number, z: number): number }
  renderer: { chunks: { pending: number }; frameStats(): { calls: number; triangles: number }; scene: { getObjectByName(n: string): unknown } }
  entities: { world: { with(...c: string[]): Iterable<{ transform: { x: number; y: number; z: number; rotY: number } }> } }
  engineConfig: { camera: { zoom: number } }
}
declare const game: G

const run = (page: Page, line: string) => page.evaluate((l) => game.devConsole.execute(l), line)

/** Wait until the veil is down and the place is meshed. */
async function settled(page: Page, place: string | null): Promise<void> {
  await page.waitForFunction((p) => game.interiors.current === p && !game.changingPlace && game.renderer.chunks.pending === 0, place, { timeout: 60_000 })
  await page.waitForTimeout(800)
  await page.evaluate(() => game.ui.close())
}

async function frame(page: Page): Promise<{ calls: number; triangles: number }> {
  await page.waitForTimeout(500)
  return page.evaluate(() => game.renderer.frameStats())
}

test('into the house and the museum and back, saved and loaded in a room', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text())
  })
  const shot = async (name: string) => info.attach(name, { body: await page.screenshot(), contentType: 'image/png' })

  await page.goto(pathToFileURL(resolve('dist/index.html')).href)
  await page.waitForFunction(() => typeof game !== 'undefined' && !!game.sessions, null, { timeout: 120_000 })
  await page.evaluate(() => game.title.create({ name: 'Проверка', player: 'Тест', seed: 7 }))
  await settled(page, null)
  await run(page, 'time 11:00')

  const island = await frame(page)
  info.annotations.push({ type: 'island frame', description: JSON.stringify(island) })
  expect(island.calls).toBeLessThan(BUDGET.island.calls)
  expect(island.triangles).toBeLessThan(BUDGET.island.triangles)
  await shot('island')

  // --- the house ---------------------------------------------------------------------------------
  await run(page, 'house in')
  await settled(page, HOUSE)
  expect(await page.evaluate(() => game.world.onIsland)).toBe(false)
  expect(await page.evaluate(() => !!game.renderer.scene.getObjectByName('room-shell'))).toBe(true)
  const room = await frame(page)
  info.annotations.push({ type: 'room frame', description: JSON.stringify(room) })
  expect(room.calls).toBeLessThan(BUDGET.room.calls)
  expect(room.triangles).toBeLessThan(BUDGET.room.triangles)
  await shot('house')

  // curtains: stand in front of the left back window, facing it, and use it
  await page.evaluate(() => {
    const a = game.interiors.area('house:home')
    const p = [...game.entities.world.with('player', 'transform')][0]!.transform
    // the starting room is 8 × 8, centered in its 16 × 16 area: the window is the 3rd cell of the back wall
    Object.assign(p, { x: a.x + 4 + 2 + 0.5, z: a.z + 4 + 1 + 0.5, rotY: Math.PI })
  })
  await expect(page.getByText('Задёрнуть шторы')).toBeVisible()
  await page.keyboard.press('KeyE')
  await expect(page.getByText('Открыть шторы')).toBeVisible()
  await page.waitForTimeout(1500)
  await shot('curtains drawn')

  // saved in the room, loaded straight back into it
  await page.evaluate(() => game.sessions.save())
  await page.evaluate(() => game.sessions.load(game.sessions.session.slot))
  await settled(page, HOUSE)
  expect(await page.evaluate(() => game.world.onIsland)).toBe(false)
  await expect(page.getByText('Открыть шторы')).toBeVisible() // the curtains stayed drawn

  // out: back on the island, standing on its ground
  await run(page, 'house out')
  await settled(page, null)
  const out = await page.evaluate(() => {
    const t = [...game.entities.world.with('player', 'transform')][0]!.transform
    return { y: t.y, ground: game.world.surfaceY(t.x, t.z), island: game.world.onIsland }
  })
  expect(out.island).toBe(true)
  expect(Math.abs(out.y - out.ground)).toBeLessThan(1.5)
  await shot('back outside')

  // --- the museum ------------------------------------------------------------------------------------
  await run(page, 'museum all')
  await run(page, 'museum in')
  await settled(page, MUSEUM)
  expect(await page.evaluate(() => !!game.renderer.scene.getObjectByName('room-shell'))).toBe(true)
  await page.evaluate(() => (game.engineConfig.camera.zoom = 1.8))
  await page.waitForTimeout(1000)
  await shot('museum')
  await run(page, 'museum out')
  await settled(page, null)

  expect(errors).toEqual([])
})
