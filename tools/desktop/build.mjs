/**
 * The game as a macOS app with its own window: npm run app
 * Uses what macOS already has (WebKit); needs only the Xcode command line tools (swiftc).
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const page = join(root, 'dist', 'index.html')
const app = join(root, 'dist', 'Compulsive Living.app')
const MIN = '13.0'

if (process.platform !== 'darwin') fail('эта сборка — для macOS; на других системах откройте dist/index.html')
if (!existsSync(page)) fail('сначала npm run build')

const run = (cmd, ...args) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] })
const work = mkdtempSync(join(tmpdir(), 'cl-app-'))
try {
  rmSync(app, { recursive: true, force: true })
  const contents = join(app, 'Contents')
  mkdirSync(join(contents, 'MacOS'), { recursive: true })
  mkdirSync(join(contents, 'Resources'))
  copyFileSync(page, join(contents, 'Resources', 'index.html'))

  // one binary for Apple and Intel machines
  const parts = ['arm64', 'x86_64'].map((arch) => {
    const out = join(work, arch)
    run('swiftc', '-O', '-swift-version', '5', '-target', `${arch}-apple-macosx${MIN}`, '-o', out, join(here, 'main.swift'))
    return out
  })
  run('lipo', '-create', '-output', join(contents, 'MacOS', 'CompulsiveLiving'), ...parts)

  // icon.png (1024) → icon.icns
  const set = join(work, 'icon.iconset')
  mkdirSync(set)
  for (const size of [16, 32, 128, 256, 512])
    for (const scale of [1, 2])
      execFileSync(
        'sips',
        ['-z', `${size * scale}`, `${size * scale}`, join(here, 'icon.png'), '--out', join(set, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)],
        { stdio: 'ignore' },
      )
  run('iconutil', '-c', 'icns', '-o', join(contents, 'Resources', 'icon.icns'), set)

  writeFileSync(
    join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Compulsive Living</string>
  <key>CFBundleDisplayName</key><string>Compulsive Living</string>
  <key>CFBundleIdentifier</key><string>inc.compulsive-living.game</string>
  <key>CFBundleExecutable</key><string>CompulsiveLiving</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>${MIN}</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.games</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`,
  )
  // signed for this machine (no developer account needed)
  run('codesign', '--force', '--deep', '--sign', '-', app)
} finally {
  rmSync(work, { recursive: true, force: true })
}
const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(1)
console.log(`dist/Compulsive Living.app готово (программа ${mb(join(app, 'Contents/MacOS/CompulsiveLiving'))} МБ + игра ${mb(page)} МБ)`)

function fail(message) {
  console.error(message)
  process.exit(1)
}
