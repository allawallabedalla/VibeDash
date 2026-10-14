import { defineConfig, devices } from '@playwright/test';

const mac = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const iphone = {
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  // Rendered with Chromium; the iPhone profile provides touch and the mobile viewport.
  defaultBrowserType: 'chromium' as const,
};

export default defineConfig({
  testDir: 'tests/visual',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },
  projects: [
    { name: 'mac-light', use: { ...mac, colorScheme: 'light' } },
    { name: 'mac-dark', use: { ...mac, colorScheme: 'dark' } },
    { name: 'iphone-light', use: { ...iphone, colorScheme: 'light' } },
    { name: 'iphone-dark', use: { ...iphone, colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
