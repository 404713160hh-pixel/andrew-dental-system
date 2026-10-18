import { spawnSync } from 'node:child_process';
for(const script of ['tools/build-styles.mjs','tools/build-docs.mjs']){
  const result=spawnSync(process.execPath,[script],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
