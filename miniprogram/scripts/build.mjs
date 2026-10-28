import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, extname, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { miniBuildConfig, developmentApiUrl } from './build-config.mjs';
import './sync-contracts.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildConfig = miniBuildConfig();
const result = spawnSync(process.execPath, [resolve(root, '../node_modules/typescript/bin/tsc'), '-p', resolve(root, 'tsconfig.json')], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const configTarget = resolve(root, 'dist/config.js');
const compiledConfig = readFileSync(configTarget, 'utf8');
const defaultLiteral = `'${developmentApiUrl}'`;
if (compiledConfig.split(defaultLiteral).length !== 2) throw new Error('小程序编译配置格式发生变化，请检查 API 地址注入。');
if (buildConfig.apiUrl !== developmentApiUrl) writeFileSync(configTarget, compiledConfig.replace(defaultLiteral, JSON.stringify(buildConfig.apiUrl)));
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
const require = createRequire(import.meta.url);
const packagePath = require.resolve('@vant/weapp/package.json');
const vendorPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
if (vendorPackage.version !== '1.11.7') throw new Error('请使用锁定的 @vant/weapp@1.11.7 后重新构建。');
const outputRoot = resolve(root, 'dist');
const vendorTarget = resolve(outputRoot, 'vendor/vant');
if (!vendorTarget.startsWith(outputRoot + sep)) throw new Error('组件输出目录超出小程序构建目录。');
rmSync(vendorTarget, { recursive: true, force: true });
cpSync(resolve(dirname(packagePath), 'dist'), vendorTarget, { recursive: true });
cpSync(resolve(dirname(packagePath), 'LICENSE'), resolve(vendorTarget, 'LICENSE'));

let outputBytes = 0;
function verifyOutput(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) verifyOutput(path);
    else {
      outputBytes += statSync(path).size;
      if (!path.endsWith('.json')) continue;
      const config = JSON.parse(readFileSync(path, 'utf8'));
      for (const component of Object.values(config.usingComponents ?? {})) {
        if (/^(?:plugin|wx):\/\//.test(component)) continue;
        const target = component.startsWith('/') ? resolve(outputRoot, '.' + component) : resolve(dirname(path), component);
        if (!target.startsWith(outputRoot + sep)) throw new Error('组件引用超出构建目录：' + component);
        for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
          if (!existsSync(target + extension)) throw new Error('组件构建文件缺失：' + target + extension);
        }
      }
    }
  }
}
verifyOutput(outputRoot);
if (outputBytes >= 2 * 1024 * 1024) throw new Error('小程序构建产物超过 2 MiB，请先检查包体。');
console.log(`已复制 @vant/weapp@${vendorPackage.version} 与 LICENSE；构建产物 ${outputBytes} 字节。`);
console.log('原生小程序已构建到 miniprogram/dist；开发者工具导入 miniprogram 目录。');
