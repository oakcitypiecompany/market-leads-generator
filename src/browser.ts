import { chromium } from 'playwright';
import { DATA_DIR } from './db.ts';

// Own Chrome profile under data/, so the IG login here is separate from your everyday browser.
export function openBrowser(headless = false) {
  return chromium.launchPersistentContext(DATA_DIR + 'browser-profile', {
    channel: 'chrome',
    headless,
    viewport: { width: 1280, height: 900 },
  });
}
