import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, sep } from 'node:path';
// A generated declaration keeps the native mini-program root self-contained.
// Shared modules are flattened so the native project has no workspace imports.
const sharedRoot = fileURLToPath(new URL('../../shared/src/', import.meta.url));
const visited = new Set();
function declarations(path) {
  const target = resolve(path);
  if (!target.startsWith(resolve(sharedRoot) + sep)) throw new Error('Shared declaration escaped its source directory');
  if (visited.has(target)) return '';
  visited.add(target);
  return readFileSync(target, 'utf8').replace(/^export \* from ['"](.+?)\.js['"];?\s*$/gm,
    (_line, name) => declarations(resolve(dirname(target), name + '.ts')));
}
const source = declarations(resolve(sharedRoot, 'index.ts'));
writeFileSync(fileURLToPath(new URL('../src/contracts.d.ts', import.meta.url)), '// Generated from shared/src/index.ts and its shared declarations. Do not edit.\n' + source);
