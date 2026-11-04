// Vector source for the native tab bar. WeChat requires raster icon files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const output = fileURLToPath(new URL('../src/assets/tabbar/', import.meta.url));
mkdirSync(output, { recursive: true });
const shapes = {
  home: '<path d="M3.5 10.5 12 3.5l8.5 7v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M9 20.5v-7h6v7"/>',
  appointments: '<rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M8 3.5v4m8-4v4M4 10h16m-12 4h3m-3 3h6"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5v-1a7.5 6 0 0 1 15 0v1"/>',
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 81, height: 81 }, deviceScaleFactor: 1 });
  for (const [name, shape] of Object.entries(shapes)) {
    for (const active of [false, true]) {
      const filename = name + (active ? '-active' : '');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="81" height="81" viewBox="0 0 28 28"><g transform="translate(2 2)" fill="none" stroke="${active ? '#292d30' : '#85817a'}" stroke-width="${active ? '1.9' : '1.65'}" stroke-linecap="round" stroke-linejoin="round">${shape}</g></svg>`;
      writeFileSync(resolve(output, filename + '.svg'), svg + '\n');
      await page.setContent(`<style>html,body{margin:0;width:81px;height:81px;background:transparent}</style>${svg}`);
      await page.screenshot({ path: resolve(output, filename + '.png'), omitBackground: true });
    }
  }
} finally { await browser.close(); }
console.log('Generated six 81px native tab bar icons.');
