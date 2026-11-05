import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';

const root=resolve(import.meta.dirname,'..');
const source=resolve(root,'docs/design/source-current');
const model=JSON.parse(await readFile(resolve(source,'compensation-model.json'),'utf8'));
const sql=await readFile(resolve(root,model.schema),'utf8');
assert.equal(createHash('sha256').update(sql).digest('hex'),model.schemaSha256,'Document model must match the current migration');
const url=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
assert.ok(url,'A database connection is required; it will not be printed');
const client=new pg.Client({connectionString:url});
const normalizeType=t=>({int4:'INTEGER',int8:'BIGINT',bool:'BOOLEAN',timestamptz:'TIMESTAMPTZ',_text:'TEXT[]',float8:'DOUBLE PRECISION'}[t]||t.toUpperCase());
const tex=await readFile(resolve(source,'main.tex'),'utf8');
const fieldTex=s=>s.replaceAll('_','\\_\\allowbreak{}');
const checks=[];
try {
 await client.connect();
 const migration=await client.query('SELECT checksum FROM schema_migrations WHERE version=$1',['008_staff_compensation.sql']);
 assert.equal(migration.rows[0]?.checksum,model.schemaSha256,'Connected database must have this migration');
 for(const [name,fields] of Object.entries(model.tables)){
  const columns=(await client.query('SELECT column_name,udt_name,is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',['public',name])).rows;
  assert.deepEqual(columns.map(c=>c.column_name).sort(),fields.map(f=>f.name).sort(),name+' column set');
  const primary=(await client.query(`SELECT a.attname AS field FROM pg_constraint k JOIN LATERAL unnest(k.conkey) f(n) ON true JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=f.n WHERE k.contype='p' AND k.conrelid=$1::regclass`,['public.'+name])).rows.map(r=>r.field).sort();
  assert.deepEqual(primary,fields.filter(f=>f.pk).map(f=>f.name).sort(),name+' primary key');
  for(const f of fields){const actual=columns.find(c=>c.column_name===f.name);assert.equal(normalizeType(actual.udt_name),f.type,name+'.'+f.name+' type');assert.equal(actual.is_nullable==='YES',f.nullable,name+'.'+f.name+' nullability');}
  const fks=(await client.query(`SELECT a.attname AS field,p.relname AS parent,b.attname AS target FROM pg_constraint k JOIN pg_class p ON p.oid=k.confrelid JOIN LATERAL unnest(k.conkey,k.confkey) f(n,m) ON true JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=f.n JOIN pg_attribute b ON b.attrelid=k.confrelid AND b.attnum=f.m WHERE k.contype='f' AND k.conrelid=$1::regclass`,['public.'+name])).rows;
  for(const f of fields.filter(v=>v.reference))assert.ok(fks.some(k=>k.field===f.name&&k.parent+'.'+k.target===f.reference),name+'.'+f.name+' foreign key');
  const anchor='\\label{schema_'+name+'}';assert.equal(tex.split(anchor).length-1,1,name+' dictionary must occur once');
  const block=tex.slice(tex.indexOf(anchor),tex.indexOf('\\end{longtable}',tex.indexOf(anchor)));
  const docRows=block.split('\n').filter(line=>line.startsWith('\\Cell{'));
  const docFields=docRows.map(line=>line.slice(6,line.indexOf('} &')).replaceAll('\\allowbreak{}','').replaceAll('\\_','_'));
  assert.deepEqual(docFields.sort(),fields.map(f=>f.name).sort(),name+' exact documented field set');
  for(const f of fields){
   const line=docRows.find(v=>v.startsWith('\\Cell{'+fieldTex(f.name)+'} &'));
   assert.equal(line.split(' & ')[1],'\\Cell{'+f.type+'}',name+'.'+f.name+' documented type');
   assert.ok(line.split(' & ')[2].includes(f.nullable?'NULL':'NN'),name+'.'+f.name+' documented nullability');
  }
  checks.push({table:name,fields:fields.length,columns:true,types:true,nullability:true,primaryKey:true,foreignKeys:true});
 }
 const result={status:'passed',checkedAt:new Date().toISOString(),scope:'staff, identity and quarterly compensation tables',schemaSha256:model.schemaSha256,tables:checks.length,fields:checks.reduce((n,c)=>n+c.fields,0),checks};
 const output=process.argv[2];if(output)await writeFile(resolve(output),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({status:result.status,tables:result.tables,fields:result.fields,schemaSha256:result.schemaSha256}));
}finally{await client.end();}
