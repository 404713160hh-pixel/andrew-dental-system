import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ignored=new Set(['.git','node_modules','backups','logs','screenshots','test-results','playwright-report','release','coverage']);
function list(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const file=resolve(directory,entry.name);if(relative(root,file).replaceAll('\\','/')==='server/data'||ignored.has(entry.name)||entry.name==='SHA256.json'||entry.name==='RELEASE-MANIFEST.json'||entry.name.endsWith('.original.txt')||/^\.env(\.|$)/.test(entry.name)&&entry.name!=='.env.example'||/\.sqlite(?:[.-]|$)|\.log$|\.server\.lock$/.test(entry.name))return[];if(entry.isSymbolicLink())throw new Error('Release cannot contain symlinks');return entry.isDirectory()?list(file):[file];});}
const files=list(root).sort().map(file=>({path:relative(root,file).replaceAll('\\','/'),bytes:statSync(file).size,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}));
writeFileSync(resolve(root,'RELEASE-MANIFEST.json'),JSON.stringify({format:'andrew-source-release-v3',generatedAt:new Date().toISOString(),version:JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version,excludes:'databases, backups, secrets, dependency directories and generated test artifacts',files},null,2)+'\n');
console.log(JSON.stringify({ok:true,files:files.length,manifest:'RELEASE-MANIFEST.json'}));
