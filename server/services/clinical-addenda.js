import { id } from '../db.js';
import { fail, requireObject, version, text } from './shared.js';
export const clinicalCommands={
  'visit.addendum':(db,user,p)=>{
    const visit=requireObject(db,'visits',p.id);version(visit,p);
    if(user.role!=='manager'&&visit.dentistId!==user.dentistId)fail('只能为本人接诊记录添加附记',403,'FORBIDDEN');
    if(visit.status!=='completed')fail('未完成的就诊请直接编辑原记录',409,'VISIT_INCOMPLETE');
    const result={id:id('ADDENDUM'),visitId:visit.id,originalVersion:visit.version,reason:text(p.reason,'附记原因',1000),content:text(p.content,'更正附记',5000),recordedAt:new Date().toISOString(),recordedBy:user.id,authorName:user.name};
    db.sql.prepare('INSERT INTO visit_addenda(id,visit_id,original_version,reason,content,recorded_at,recorded_by,author_name) VALUES(?,?,?,?,?,?,?,?)').run(result.id,visit.id,visit.version,result.reason,result.content,result.recordedAt,user.id,user.name);return result;
  }
};
