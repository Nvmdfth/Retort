import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:9847',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'Mobile Chrome (Pixel 7)',
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
      },
    },
    {
      name: 'Mobile Safari (iPhone 14)',
      use: {
        ...devices['iPhone 14'],
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
      },
    },
    {
      name: 'TV Host Display (1080p)',
      use: {
        viewport: { width: 1920, height: 1080 },
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
      },
    },
  ],
});
