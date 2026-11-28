import { defineConfig } from '@playwright/test'

/**
 * End-to-end: the built one-file game (dist/index.html) opened from disk, as players open it,
 * in Chromium and in WebKit (the macOS app and Safari). Run `npm run build` first: `npm run e2e`.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.e2e.ts',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: { viewport: { width: 1100, height: 700 }, trace: 'off' },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
    },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
