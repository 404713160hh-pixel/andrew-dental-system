import { spawnSync } from 'node:child_process';
import { readdirSync, unlinkSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const directory=resolve(process.env.DENTAL_BACKUP_DIR||resolve(root,'backups'));
const hours=Number(process.env.DENTAL_BACKUP_INTERVAL_HOURS||6),keep=Number(process.env.DENTAL_BACKUP_KEEP||28);
if(!Number.isFinite(hours)||hours<.1||hours>720||!Number.isInteger(keep)||keep<1||keep>10000)throw new Error('Invalid backup interval or retention');
mkdirSync(directory,{recursive:true});
function backup(){
  const file=resolve(directory,`dental-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
  const result=spawnSync(process.execPath,[resolve(root,'tools/database.mjs'),'backup',file],{encoding:'utf8'});
  if(result.status!==0){console.error(JSON.stringify({level:'error',event:'backup.failed',at:new Date().toISOString()}));return false;}
  const files=readdirSync(directory).filter(name=>/^dental-\d{4}-\d{2}-\d{2}T[\dTZ-]+\.sqlite$/.test(name)).sort().reverse();
  for(const name of files.slice(keep)){const target=resolve(directory,name);if(dirname(target)!==directory||!statSync(target).isFile())continue;unlinkSync(target);}
  console.log(JSON.stringify({level:'info',event:'backup.completed',at:new Date().toISOString(),retained:Math.min(files.length,keep)}));
  return true;
}
const success=backup();
if(process.argv.includes('--once')){process.exit(success?0:1);}
const timer=setInterval(backup,hours*3600000);
function stop(){clearInterval(timer);process.exit(0);}
process.once('SIGTERM',stop);process.once('SIGINT',stop);
