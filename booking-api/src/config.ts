import { config as dotenv } from 'dotenv';
import { join } from 'node:path';
import { projectRoot } from './paths.js';
import { z } from 'zod';
dotenv({path: join(projectRoot,'.env.booking'), quiet:true});
const integer = (defaultValue:number,min:number,max:number)=>z.coerce.number().int().min(min).max(max).default(defaultValue);
const settings=z.object({
 NODE_ENV:z.enum(['development','test','production']).default('development'),
 DATABASE_URL:z.string().min(1), BOOKING_PORT:integer(3310,1,65535), BOOKING_HOST:z.string().default('127.0.0.1'),
 ALLOW_DEMO_LOGIN:z.enum(['true','false']).default('false'), CORS_ORIGINS:z.string().default('http://127.0.0.1:5173,http://localhost:5173'),
 HOLD_SECONDS:integer(300,30,900), CANCELLATION_NOTICE_MINUTES:integer(120,0,10080),
 TRANSFER_BUFFER_MINUTES:integer(30,0,240), SLOT_STEP_MINUTES:integer(15,5,60), SESSION_HOURS:integer(12,1,72)
});
export type Config=z.infer<typeof settings>;
export function loadConfig(overrides:Partial<Config>={}):Config{
 const result=settings.parse({...process.env,...overrides});
 if(result.NODE_ENV==='production'&&result.ALLOW_DEMO_LOGIN==='true') throw new Error('Production forbids demo login');
 return result;
}
