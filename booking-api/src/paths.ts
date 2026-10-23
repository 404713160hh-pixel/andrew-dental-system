import { existsSync,readFileSync } from 'node:fs';
import { dirname,join,parse } from 'node:path';
import { fileURLToPath } from 'node:url';
let candidate=dirname(fileURLToPath(import.meta.url));
while(candidate!==parse(candidate).root){
 const file=join(candidate,'package.json');
 if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).name==='andrew-dental-system')break;
 candidate=dirname(candidate);
}
export const projectRoot=candidate;
