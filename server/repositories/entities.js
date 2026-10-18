// Explicit row mappings keep SQL storage independent from the public object protocol.
const snake = key => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const model = (fields, booleans = [], aliases = {}) => ({ fields: ['id', ...fields.split(' '), 'version'], booleans, aliases });
export const models = {
  clinics: model('name address supervisor phone email area active', ['active']),
  dentists: model('employeeNo name dob phone email address active', ['active']),
  qualifications: model('name issuer description active', ['active']),
  treatments: model('name unit unitPrice active', ['active']),
  patients: model('name dob phone email address emergencyName emergencyPhone allergyStatus allergyDeclaredAt allergyVerifiedBy allergyVerifiedAt allergySource createdClinicId createdAt active mergedIntoId', ['active']),
  schedules: model('clinicId dentistId start end capacity active', ['active'], {start:'start_at',end:'end_at'}),
  appointments: model('patientId clinicId dentistId scheduleId start end problem specialNeeds status attended previousId createdAt cancelReason cancelledAt statusReason statusChangedAt', ['attended'], {start:'start_at',end:'end_at'}),
  visits: model('appointmentId patientId clinicId dentistId problem specialNeeds notes status completedAt'),
  settlements: model('number visitId patientId clinicId dentistId date total'),
  costs: model('quarter clinicId dentistId supplies operations evidence note status reviewedBy reviewedAt'),
  quarterReports: model('quarter revenue supplies operations netProfit fund fundRate negativeProfitPolicy revenueBasis status createdAt scope sourceSignature approvedBy approvedAt invalidatedAt invalidatedReason'),
  settings: model('cancellationHours fundRate')
};
export const tables = Object.keys(models);
const children = {
  patients:[{key:'allergies',table:'patient_allergies',parent:'patient_id',fields:['id','name','reaction','note']},{key:'accessClinicIds',table:'patient_clinic_access',parent:'patient_id',value:'clinic_id'}],
  dentists:[{key:'qualificationIds',table:'dentist_qualifications',parent:'dentist_id',value:'qualification_id'},{key:'qualificationDetails',table:'dentist_qualification_details',parent:'dentist_id',fields:['qualificationId','certificateNo','verifiedAt','verifiedBy','note']}],
  visits:[{key:'lines',table:'visit_lines',parent:'visit_id',fields:['id','treatmentId','name','quantity','unitPrice']}],
  settlements:[{key:'lines',table:'settlement_lines',parent:'settlement_id',fields:['id','treatmentId','name','quantity','unitPrice','subtotal']}],
  costs:[{key:'reviewHistory',table:'cost_review_history',parent:'cost_id',fields:['at','userId','action','version']}],
  quarterReports:[{key:'clinicIds',table:'quarter_report_clinics',parent:'report_id',value:'clinic_id'},{key:'history',table:'quarter_report_history',parent:'report_id',fields:['at','action','userId','version','priorStatus','priorVersion']},{key:'rows',table:'quarter_report_rows',parent:'report_id',fields:['clinicId','dentistId','revenue','supplies','operations','netProfit','costId','costVersion']}]
};
export function fieldColumn(table,field) {
  const m=models[table];
  if(!m||!m.fields.includes(field))throw new Error(`Unknown query field ${table}.${field}`);
  return m.aliases[field]||snake(field);
}
function bind(value,boolean=false) { return value===undefined||value===null?null:boolean?Number(Boolean(value)):value; }
function rowObject(row,fields,booleans=[],aliases={}) {
  const result={};
  for(const field of fields){const value=row[aliases[field]||snake(field)];if(value!==undefined)result[field]=value===null?null:booleans.includes(field)?Boolean(value):value;}
  return result;
}
export function createRepositories(sql) {
  function hydrate(table,rows) {
    const m=models[table]; if(!m)throw new Error('Unknown table');
    const objects=rows.map(r=>rowObject(r,m.fields,m.booleans,m.aliases));
    if(!objects.length)return objects;
    const byId=new Map(objects.map(o=>[o.id,o]));
    // Batch child hydration avoids one SQL query per patient/visit.
    for(const child of children[table]||[]){
      for(const object of objects)object[child.key]=[];
      const ids=[...byId.keys()];
      for(let i=0;i<ids.length;i+=300){
        const chunk=ids.slice(i,i+300),marks=chunk.map(()=>'?').join(',');
        const records=sql.prepare(`SELECT * FROM ${child.table} WHERE ${child.parent} IN (${marks}) ORDER BY position`).all(...chunk);
        for(const record of records){
          const item=child.value?record[child.value]:rowObject(record,child.fields);
          if(table==='quarterReports'&&child.key==='rows')item.settlementIds=[];
          byId.get(record[child.parent])[child.key].push(item);
        }
      }
    }
    if(table==='quarterReports'){
      const ids=[...byId.keys()];
      for(let i=0;i<ids.length;i+=300){const chunk=ids.slice(i,i+300);for(const r of sql.prepare(`SELECT * FROM quarter_report_settlements WHERE report_id IN (${chunk.map(()=>'?')}) ORDER BY item_position`).all(...chunk))byId.get(r.report_id)?.rows[r.position]?.settlementIds.push(r.settlement_id);}
    }
    return objects;
  }
  function put(table,object) {
    const m=models[table];if(!m)throw new Error('Unknown table');
    const columns=m.fields.map(f=>fieldColumn(table,f));
    sql.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?')}) ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).map(c=>`${c}=excluded.${c}`).join(',')}`).run(...m.fields.map(f=>bind(object[f],m.booleans.includes(f))));
    for(const child of children[table]||[]){
      sql.prepare(`DELETE FROM ${child.table} WHERE ${child.parent}=?`).run(object.id);
      const fields=child.value?[child.value]:child.fields.map(snake);
      const columns=[child.parent,'position',...fields];
      const insert=sql.prepare(`INSERT INTO ${child.table}(${columns.join(',')}) VALUES(${columns.map(()=>'?')})`);
      for(const [position,item] of (object[child.key]||[]).entries()){
        insert.run(object.id,position,...(child.value?[item]:child.fields.map(f=>bind(item[f]))));
        if(table==='quarterReports'&&child.key==='rows')for(const [itemPosition,settlementId] of (item.settlementIds||[]).entries())sql.prepare('INSERT INTO quarter_report_settlements(report_id,position,settlement_id,item_position) VALUES(?,?,?,?)').run(object.id,position,settlementId,itemPosition);
      }
    }
    return object;
  }
  function compile(table,where={}) {
    const clauses=[],params=[];
    for(const [field,value] of Object.entries(where)){
      const column=fieldColumn(table,field),boolean=models[table].booleans.includes(field);
      if(value===null){clauses.push(`${column} IS NULL`);continue;}
      if(value&&typeof value==='object'&&!Array.isArray(value)){
        for(const [operator,operand] of Object.entries(value)){
          if(operator==='$in'){
            if(!Array.isArray(operand))throw new Error('Query $in must be an array');
            clauses.push(operand.length?`${column} IN (${operand.map(()=>'?')})`:'0');params.push(...operand.map(v=>bind(v,boolean)));continue;
          }
          const op={$lt:'<',$lte:'<=',$gt:'>',$gte:'>=',$ne:'<>',$like:'LIKE'}[operator];
          if(!op)throw new Error('Unknown query operator');clauses.push(`${column} ${op} ?`);params.push(bind(operand,boolean));
        }
      }else{clauses.push(`${column}=?`);params.push(bind(value,boolean));}
    }
    return {condition:clauses.length?clauses.join(' AND '):'1',params};
  }
  function query(table,condition='1',params=[],options={}) {
    if(!models[table])throw new Error('Unknown table');
    const order=options.orderBy?`${fieldColumn(table,options.orderBy[0])} ${options.orderBy[1]==='desc'?'DESC':'ASC'},rowid`:'rowid';
    const limit=options.limit===undefined?'':' LIMIT ? OFFSET ?';
    if(options.limit!==undefined){if(!Number.isInteger(options.limit)||options.limit<0||!Number.isInteger(options.offset||0)||(options.offset||0)<0)throw new Error('Invalid pagination');params=[...params,options.limit,options.offset||0];}
    return hydrate(table,sql.prepare(`SELECT * FROM ${table} WHERE ${condition} ORDER BY ${order}${limit}`).all(...params));
  }
  return {
    all:table=>query(table),get:(table,key)=>query(table,'id=?',[key],{limit:1})[0]||null,put,query,
    find(table,options={}){const q=compile(table,options.where);return query(table,q.condition,q.params,options);},
    count(table,options={}){const q=compile(table,options.where);return sql.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${q.condition}`).get(...q.params).count;},
    countQuery(table,condition='1',params=[]){if(!models[table])throw new Error('Unknown table');return sql.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${condition}`).get(...params).count;}
  };
}
