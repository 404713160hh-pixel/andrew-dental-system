import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function list(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{if(['node_modules','.git','data','backups','site'].includes(entry.name))return[];const path=resolve(directory,entry.name);return entry.isDirectory()?list(path):['.js','.mjs'].includes(extname(path))?[path]:[];});}
const files=list(root);let imports=0;
for(const file of files){
 const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr);process.exit(1);}
 const text=readFileSync(file,'utf8');
 for(const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)){const target=resolve(dirname(file),match[1]);if(!existsSync(target)||!statSync(target).isFile())throw new Error(`Missing local import ${match[1]} in ${file}`);imports++;}
}
console.log(JSON.stringify({ok:true,javascriptFiles:files.length,localImports:imports}));
