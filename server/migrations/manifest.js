import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory=dirname(fileURLToPath(import.meta.url));
const sources=[readFileSync(resolve(directory,'../schema.sql'),'utf8'),readFileSync(resolve(directory,'extensions.sql'),'utf8'),readFileSync(resolve(directory,'headquarters.sql'),'utf8')];
export const requiredTables=[...new Set(sources.flatMap(source=>[...source.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z][A-Za-z0-9_]*)/gi)].map(match=>match[1])))];
export const legacyTables=['metadata','users','sessions','audit','patients','clinics','dentists','qualifications','schedules','appointments','visits','treatments','settlements','costs','quarterReports','settings'];
