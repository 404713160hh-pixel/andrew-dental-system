import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './sync-contracts.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, [resolve(root, '../node_modules/typescript/bin/tsc'), '-p', resolve(root, 'tsconfig.json')], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
function copyAssets(relative = '') {
  for (const entry of readdirSync(resolve(root, 'src', relative), { withFileTypes: true })) {
    const item = resolve(root, 'src', relative, entry.name);
    const target = resolve(root, 'dist', relative, entry.name);
    if (entry.isDirectory()) copyAssets(join(relative, entry.name));
    else if (['.json', '.wxml', '.wxss', '.svg', '.png'].includes(extname(entry.name))) {
      mkdirSync(dirname(target), { recursive: true }); cpSync(item, target);
    }
  }
}
copyAssets();
console.log('原生小程序已构建到 miniprogram/dist；开发者工具导入 miniprogram 目录。');
