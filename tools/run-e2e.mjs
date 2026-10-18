import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, basename, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=mkdtempSync(join(tmpdir(),'dental-e2e-'));
try {
  const child=spawnSync(process.execPath,[resolve(root,'node_modules/@playwright/test/cli.js'),'test',...process.argv.slice(2)],{cwd:root,stdio:'inherit',env:{...process.env,DENTAL_E2E_DATABASE:join(fixture,'browser.sqlite')}});
  process.exitCode=child.status??1;
} finally {
  const target=resolve(fixture);
  if(!target.startsWith(resolve(tmpdir())+sep)||!basename(target).startsWith('dental-e2e-'))throw new Error('Unexpected E2E cleanup path');
  rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
