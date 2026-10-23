import { loadConfig } from './config.js';
import { poolFor } from './db.js';
import { createApp } from './app.js';
const config=loadConfig();const pool=poolFor(config.DATABASE_URL);const app=await createApp(config,pool,true);
await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
await app.listen({host:config.BOOKING_HOST,port:config.BOOKING_PORT});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>pool.end()).then(()=>process.exit(0));});
