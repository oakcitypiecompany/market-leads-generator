import { openBrowser } from './browser.ts';

const ctx = await openBrowser();
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://www.instagram.com/accounts/login/');
console.log('Log in with your personal Instagram account (not the business), then close the window.');
await new Promise(resolve => ctx.on('close', resolve));
