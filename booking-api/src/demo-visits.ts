import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { audit } from './auth.js';
import type { Config } from './config.js';
import { one, transaction } from './db.js';
import { operationalSource } from './visit-profit.js';

const batch = 'demo-visit-finance-v1';
const dayMs = 86400000;
const must: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

export async function prepareDemoVisits(pool: pg.Pool, config: Config, enabled: boolean) {
  must(enabled && config.NODE_ENV === 'development', 'Explicit development demo visit maintenance is required');
  const dbName = decodeURIComponent(new URL(config.DATABASE_URL).pathname.slice(1));
  must(dbName === 'andrew_booking_preview' || /^andrew_test_[a-z0-9_]+$/.test(dbName), 'A named course preview or disposable test database is required');
  return transaction(pool,async db=>{
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('andrew.demo.visit.finance',0))");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('andrew.compensation.periods',0))");
    must((await one<{name:string}>(db,'SELECT current_database() AS name'))?.name===dbName,'Database identity differs');
    const actor=await one<{id:string}>(db,`SELECT u.id FROM users u JOIN staff s ON s.user_id=u.id AND s.is_demo
      WHERE u.username='hq' AND u.active AND EXISTS(SELECT 1 FROM role_assignments r WHERE r.user_id=u.id AND r.role='hq')`);
    must(actor,'A provenance-marked demonstration HQ employee is required');
    const clinics=(await db.query<{id:string}>(`SELECT c.id FROM clinics c JOIN demo_seed_records m ON m.record_id=c.id
      WHERE m.record_kind='clinic' AND m.record_key IN ('seed:clinic:a','seed:clinic:b') AND c.active AND c.address ~ '虚构|课程演示' ORDER BY m.record_key`)).rows;
    must(clinics.length===2,'Expected both fictional clinics');
    const doctors=(await db.query<{id:string}>(`SELECT s.id FROM staff s JOIN demo_seed_records m ON m.record_id=s.id
      WHERE m.record_kind='doctor' AND m.record_key ~ '^(seed:doctor:[ab]|demo:doctor:[c-h])$' AND s.active AND s.is_demo AND s.is_dentist
      ORDER BY s.employee_no`)).rows;
    const patients=(await db.query<{id:string}>(`SELECT p.id FROM patients p JOIN demo_seed_records m ON m.record_id=p.id
      WHERE m.record_kind='patient' AND m.record_key ~ '^(seed:patient:[ab]|demo:patient:[3-8])$' AND p.is_demo
      ORDER BY m.record_key`)).rows;
    must(doctors.length===8 && patients.length===8,'Expected eight fictional doctors and patients');

    const now=Date.now();
    const today=new Date(now+8*3600000).toISOString().slice(0,10);
    const dateAt=(offset:number)=>new Date(Date.parse(today+'T00:00:00Z')+offset*dayMs).toISOString().slice(0,10);
    const dates=new Set(Array.from({length:8},(_,i)=>dateAt(-i)));
    const monthIndex=Number(today.slice(5,7))-1;
    const currentQuarter=Math.floor(monthIndex/3)*3;
    for(let offset=-3;offset<=monthIndex-currentQuarter;offset++){
      const month=new Date(Date.UTC(Number(today.slice(0,4)),currentQuarter+offset,1)).toISOString().slice(0,7);
      for(const day of ['08','15','22']) if(month+'-'+day<=today) dates.add(month+'-'+day);
    }
    let visitsAdded=0,expensesAdded=0;
    const availableMonths=new Set<string>();
    for(const [ci,clinic] of clinics.entries()){
      const services=(await db.query<{id:string;name:string;unit:string;price_cents:number;duration_minutes:number;buffer_minutes:number}>(`SELECT s.* FROM services s
        JOIN clinic_services cs ON cs.service_id=s.id AND cs.clinic_id=$1
        JOIN demo_seed_records m ON m.record_id=s.id AND m.record_kind='service'
        WHERE s.active AND m.record_key ~ '^(seed:service:(initial|consultation)|demo:service:(child|restoration|implant|orthodontic))$' ORDER BY m.record_key`,[clinic.id])).rows;
      must(services.length===6,'Both clinics require the six fictional services');
      for(const date of [...dates].sort()){
        const weekday=new Date(date+'T00:00:00Z').getUTCDay();
        if((ci===0&&weekday===0)||(ci===1&&weekday===1))continue;
        const number=Number(date.slice(-2));
        for(let sample=0;sample<3;sample++){
          const key=`DEMO-VISIT-${date.replaceAll('-','')}-${ci+1}-${sample+1}`;
          if(await one(db,`SELECT 1 FROM appointments a JOIN audit_events e ON e.target_id=a.id AND e.action='demo.visit.finance' AND e.request_id=$2
            WHERE a.appointment_no=$1`,[key,batch])){availableMonths.add(clinic.id+':'+date.slice(0,7));continue;}
          must(!await one(db,'SELECT 1 FROM appointments WHERE appointment_no=$1',[key]),'Reserved demo appointment number already in use');
          const service=services[(number+sample+ci)%services.length]!;
          const amount=service.price_cents+36000+((number+2*sample+ci*3)%9)*4200;
          const duration=service.duration_minutes;
          const minutes=duration+service.buffer_minutes;
          const patientId=patients[(number+sample+ci*3)%patients.length]!.id;
          let booked=false;
          for(let option=0;option<24&&!booked;option++){
            const doctorId=doctors[sample===0 && option===0 ? 0 : (number+sample+ci*3+option)%doctors.length]!.id;
            const start=Date.parse(date+'T09:30:00+08:00')+(sample*120+option%4*30)*60000;
            const end=start+minutes*60000;
            const finished=start+duration*60000;
            if(end+60000>=now)continue;
            const range=[new Date(start),new Date(end)];
            const chair=await one<{id:string}>(db,`SELECT c.id FROM chairs c WHERE c.clinic_id=$1 AND c.active
              AND NOT EXISTS(SELECT 1 FROM chair_blocks b WHERE b.chair_id=c.id AND b.starts_at<$3 AND b.ends_at>$2)
              AND NOT EXISTS(SELECT 1 FROM resource_reservations r WHERE (r.chair_id=c.id OR r.patient_id=$4 OR r.doctor_id=$5)
                AND r.status IN ('booked','held') AND r.starts_at<$3 AND r.occupied_until>$2) ORDER BY c.id LIMIT 1`,
              [clinic.id,...range,patientId,doctorId]);
            if(!chair)continue;
            let shift=await one<{id:string}>(db,`SELECT ds.id FROM doctor_shifts ds JOIN doctor_shift_services ss ON ss.shift_id=ds.id AND ss.service_id=$5
              WHERE ds.clinic_id=$1 AND ds.doctor_id=$2 AND ds.status='published' AND ds.starts_at<=$3 AND ds.ends_at>=$4 LIMIT 1`,
              [clinic.id,doctorId,...range,service.id]);
            if(!shift){
              if(await one(db,`SELECT id FROM doctor_shifts WHERE doctor_id=$1 AND status='published'
                AND starts_at<$3::timestamptz+CASE WHEN clinic_id<>$4 THEN $5::int*interval '1 minute' ELSE interval '0' END
                AND ends_at>$2::timestamptz-CASE WHEN clinic_id<>$4 THEN $5::int*interval '1 minute' ELSE interval '0' END LIMIT 1`,
                [doctorId,...range,clinic.id,config.TRANSFER_BUFFER_MINUTES]))continue;
              shift=await one<{id:string}>(db,`INSERT INTO doctor_shifts(clinic_id,doctor_id,starts_at,ends_at,created_by)
                VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,[clinic.id,doctorId,...range,actor.id]);
              if(!shift)continue;
              await db.query('INSERT INTO doctor_shift_services(shift_id,service_id) VALUES($1,$2)',[shift.id,service.id]);
            }
            const reservation=(await one<{id:string}>(db,`INSERT INTO resource_reservations(patient_id,clinic_id,service_id,doctor_id,chair_id,shift_id,starts_at,ends_at,occupied_until,status)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'booked') RETURNING id`,
              [patientId,clinic.id,service.id,doctorId,chair.id,shift.id,range[0],new Date(finished),range[1]]))!.id;
            const hold=(await one<{id:string}>(db,`INSERT INTO booking_holds(reservation_id,created_by,expires_at,consumed_at,created_at)
              VALUES($1,$2,$3,$3,$3) RETURNING id`,[reservation,actor.id,range[0]]))!.id;
            const id=(await one<{id:string}>(db,`INSERT INTO appointments(appointment_no,patient_id,reservation_id,hold_id,service_name,price_cents,created_by,created_at)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[key,patientId,reservation,hold,service.name,service.price_cents,actor.id,range[0]]))!.id;
            await db.query(`INSERT INTO appointment_events(appointment_id,actor_id,kind,reason,occurred_at)
              VALUES($1,$2,'confirmed','虚构演示预约',$3)`,[id,actor.id,range[0]]);
            const completedAt=new Date(finished);
            await db.query(`INSERT INTO visits(appointment_id,status,doctor_id,arrived_at,completed_at,materials_recorded)
              VALUES($1,'completed',$2,$3,$4,true)`,[id,doctorId,range[0],completedAt]);
            await db.query(`INSERT INTO visit_treatments(appointment_id,service_id,service_name,unit,quantity,unit_price_cents)
              VALUES($1,$2,$3,$4,1,$5)`,[id,service.id,service.name,service.unit,amount]);
            await db.query(`INSERT INTO visit_materials(appointment_id,name,unit,quantity_milli,unit_cost_cents)
              VALUES($1,'一次性诊疗套件（演示）','包',1000,1800),($1,'消毒和防护用品（演示）','份',$2,900)`,[id,(1+(number+sample)%4)*1000]);
            const invoice=(await one<{id:string}>(db,`INSERT INTO visit_invoices(appointment_id,total_cents,issued_at,issued_by)
              VALUES($1,$2,$3,$4) RETURNING id`,[id,amount,completedAt,actor.id]))!.id;
            const partial=(number+sample+ci)%7===0;
            const paid=partial?Math.floor(amount/2):amount;
            const paymentMethod=['cash','wechat','alipay','card'][(sample+number)%4]!;
            await db.query(`INSERT INTO visit_payments(invoice_id,amount_cents,method,reference,received_at,recorded_by,command_key)
              VALUES($1,$2,$3,$4,$5,$6,$7)`,[invoice,paid,paymentMethod,'虚构收款-'+key,completedAt,actor.id,randomUUID()]);
            await audit(db,actor.id,'demo.visit.finance',id,batch,{fictional:true,appointmentNo:key,clinicId:clinic.id,doctorId});
            availableMonths.add(clinic.id+':'+date.slice(0,7));
            visitsAdded++;booked=true;
          }
        }
      }
      for(const entry of availableMonths){
        const [id,month]=entry.split(':');
        if(id!==clinic.id)continue;
        const result=await db.query(`INSERT INTO clinic_monthly_expenses(clinic_id,month,items,updated_by)
          SELECT $1,$2,$3,$4 WHERE NOT EXISTS(
            SELECT 1 FROM incentive_months WHERE clinic_id=$1 AND month=$2 AND status='closed' AND reference=$5
          ) ON CONFLICT DO NOTHING`,
          [clinic.id,month+'-01',JSON.stringify([
            {label:'场地与水电（虚构演示）',amountCents:12000+ci*4900,reference:'虚构演示-'+month+'-A'},
            {label:'前台与公共服务（虚构演示）',amountCents:9800+ci*3100,reference:'虚构演示-'+month+'-B'},
          ]),actor.id,operationalSource]);
        if(result.rowCount){expensesAdded++;await audit(db,actor.id,'demo.visit.operating_expenses',clinic.id,batch,{fictional:true,month});}
      }
    }
    must(availableMonths.size>=2,'Unable to fill both demonstration clinics');
    const financeUsers=(await db.query<{user_id:string;staff_id:string;username:string}>(`SELECT u.id AS user_id,s.id AS staff_id,u.username
      FROM users u JOIN staff s ON s.user_id=u.id AND s.is_demo AND s.active AND NOT s.is_dentist
      WHERE u.id=$1 OR (u.username='demo.incentive.audit' AND u.password_hash LIKE 'disabled-demo-incentive-%')`,[actor.id])).rows;
    const maker=financeUsers.find(u=>u.username==='hq');
    const reviewer=financeUsers.find(u=>u.username==='demo.incentive.audit');
    let awardExamplesAdded=0;
    if(maker&&reviewer){
      const awards=(await db.query<{id:string;amount_cents:string}>(`SELECT a.id,a.amount_cents FROM incentive_allocations a
        JOIN incentive_pools p ON p.id=a.pool_id
        WHERE p.reference='虚构演示-季度激励-v1' AND p.status='approved' AND p.approved_by=$1
          AND a.doctor_id=ANY($2::uuid[]) AND a.amount_cents>=4
          AND NOT EXISTS(SELECT 1 FROM incentive_payments x WHERE x.allocation_id=a.id)
        ORDER BY a.amount_cents DESC LIMIT 2 FOR UPDATE OF a`,[reviewer.user_id,doctors.map(d=>d.id)])).rows;
      for(const [index,award] of awards.entries()){
        const proof='虚构演示-奖金发放-'+award.id;
        const record=await one<{id:string}>(db,`INSERT INTO incentive_payments(allocation_id,amount_cents,reference,created_by,created_staff_id)
          VALUES($1,$2,$3,$4,$5) RETURNING id`,[award.id,(BigInt(award.amount_cents)/4n).toString(),proof,maker.user_id,maker.staff_id]);
        if(index===0) await db.query(`UPDATE incentive_payments SET status='succeeded',result_reference=$2,resolved_by=$3,
          resolved_staff_id=$4,resolved_at=clock_timestamp(),row_version=row_version+1 WHERE id=$1`,
          [record!.id,proof+'-结果',reviewer.user_id,reviewer.staff_id]);
        await audit(db,maker.user_id,'demo.incentive.offline_record',record!.id,batch,{fictional:true,allocationId:award.id});
        awardExamplesAdded++;
      }
    }
    return {fictional:true,visitsAdded,expensesAdded,clinicMonths:availableMonths.size,awardExamplesAdded};
  });
}
