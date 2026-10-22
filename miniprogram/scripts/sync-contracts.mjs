import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// A generated declaration keeps the native mini-program root self-contained.
// DTO definitions still have exactly one authored source: shared/src/index.ts.
const source = readFileSync(new URL('../../shared/src/index.ts', import.meta.url), 'utf8');
writeFileSync(fileURLToPath(new URL('../src/contracts.d.ts', import.meta.url)), '// Generated from shared/src/index.ts. Do not edit.\n' + source);
