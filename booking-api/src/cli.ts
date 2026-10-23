import { loadConfig } from './config.js';
import { migrate,poolFor } from './db.js';
import { seed } from './seed.js';
import { enrichDemoData } from './demo.js';
import { hashPassword } from './auth.js';
import { transaction,one } from './db.js';
const config=loadConfig();const pool=poolFor(config.DATABASE_URL);
try {
 if(process.argv[2]==='migrate')console.log(JSON.stringify({migrations:await migrate(pool)}));
 else if(process.argv[2]==='seed'){
  if(config.NODE_ENV==='production')throw new Error('Synthetic seeding is disabled in production');
  const password=process.env.SEED_PASSWORD;if(!password)throw new Error('Set SEED_PASSWORD in .env.booking');
  console.log(JSON.stringify(await seed(pool,password)));
 }else if(process.argv[2]==='demo'){
  if(config.NODE_ENV==='production')throw new Error('Synthetic demo enrichment is disabled in production');
  console.log(JSON.stringify(await enrichDemoData(pool,config.NODE_ENV,config.TRANSFER_BUFFER_MINUTES)));
 }else if(process.argv[2]==='create-admin'){
  const username=process.env.ADMIN_USERNAME?.trim().toLowerCase();const password=process.env.ADMIN_PASSWORD;
  if(!username||!/^[a-z0-9._-]{2,80}$/.test(username)||!password||password.length<12)throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD (12+ characters) in environment');
  const hash=await hashPassword(password);
  await transaction(pool,async db=>{
   const result=await one<{id:string}>(db,'INSERT INTO users(username,password_hash,display_name)VALUES($1,$2,$3)RETURNING id',[username,hash,process.env.ADMIN_NAME?.trim()||'总部管理员']);
   await db.query("INSERT INTO role_assignments(user_id,role)VALUES($1,'hq')",[result!.id]);
  });console.log(JSON.stringify({created:true,role:'hq'}));
 }else throw new Error('Usage: cli.ts migrate|seed|demo|create-admin');
}finally{await pool.end();}
