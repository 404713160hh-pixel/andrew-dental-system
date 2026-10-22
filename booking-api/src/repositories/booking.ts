import type { BookingSlot,BookingPolicy } from '@andrew/shared';
import type { Db } from '../db.js';
import { iso } from '../db.js';
export interface SlotFilter {clinicId:string;serviceId:string;date:string;doctorId?:string;patientId?:string;ignoreReservationId?:string;startsAt?:string;chairId?:string;shiftId?:string}
export async function querySlots(db:Db,filter:SlotFilter,policy:BookingPolicy):Promise<BookingSlot[]>{
 const start=new Date(filter.date+'T00:00:00+08:00');const end=new Date(start.getTime()+86400000);
 const result=await db.query<BookingSlot>(`SELECT DISTINCT ON (ds.doctor_id,t.starts_at)
 ds.clinic_id AS "clinicId",c.name AS "clinicName",v.id AS "serviceId",v.name AS "serviceName",ds.doctor_id AS "doctorId",d.name AS "doctorName",
 ch.id AS "chairId",ds.id AS "shiftId",t.starts_at AS "startsAt",t.starts_at+v.duration_minutes*interval '1 minute' AS "endsAt",
 t.starts_at+(v.duration_minutes+v.buffer_minutes)*interval '1 minute' AS "occupiedUntil",v.duration_minutes AS "durationMinutes",v.buffer_minutes AS "bufferMinutes",v.price_cents AS "priceCents"
 FROM doctor_shifts ds JOIN staff d ON d.id=ds.doctor_id AND d.active AND d.is_dentist
 JOIN clinics c ON c.id=ds.clinic_id AND c.active
 JOIN doctor_shift_services dss ON dss.shift_id=ds.id AND dss.service_id=$4
 JOIN services v ON v.id=dss.service_id AND v.active
 JOIN clinic_services cs ON cs.clinic_id=ds.clinic_id AND cs.service_id=v.id
 JOIN chairs ch ON ch.clinic_id=ds.clinic_id AND ch.active
 CROSS JOIN LATERAL generate_series(greatest(ds.starts_at,$1::timestamptz),least(ds.ends_at-(v.duration_minutes+v.buffer_minutes)*interval '1 minute',$2::timestamptz-interval '1 microsecond'),$5::int*interval '1 minute') AS t(starts_at)
 WHERE ds.status='published' AND ds.clinic_id=$3 AND t.starts_at>clock_timestamp()
 AND ($6::uuid IS NULL OR ds.doctor_id=$6)
 AND ($9::timestamptz IS NULL OR t.starts_at=$9)
 AND ($10::uuid IS NULL OR ch.id=$10) AND ($11::uuid IS NULL OR ds.id=$11)
 AND NOT EXISTS(SELECT 1 FROM service_qualifications sq WHERE sq.service_id=v.id AND NOT EXISTS(
  SELECT 1 FROM dentist_qualifications dq JOIN qualifications q ON q.id=dq.qualification_id AND q.active
  WHERE dq.dentist_id=ds.doctor_id AND dq.qualification_id=sq.qualification_id AND dq.valid_from<=t.starts_at
  AND (dq.valid_until IS NULL OR dq.valid_until>=t.starts_at+(v.duration_minutes+v.buffer_minutes)*interval '1 minute')))
 AND NOT EXISTS(SELECT 1 FROM chair_blocks b WHERE b.chair_id=ch.id AND tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(t.starts_at,t.starts_at+(v.duration_minutes+v.buffer_minutes)*interval '1 minute','[)'))
 AND NOT EXISTS(SELECT 1 FROM resource_reservations r WHERE r.id IS DISTINCT FROM $8::uuid
  AND (r.doctor_id=ds.doctor_id OR r.chair_id=ch.id OR r.patient_id=$7::uuid)
  AND (r.status='booked' OR r.status='held' AND r.expires_at>clock_timestamp())
  AND tstzrange(r.starts_at,r.occupied_until,'[)')&&tstzrange(t.starts_at,t.starts_at+(v.duration_minutes+v.buffer_minutes)*interval '1 minute','[)'))
 ORDER BY ds.doctor_id,t.starts_at,ch.id LIMIT 500`,[start.toISOString(),end.toISOString(),filter.clinicId,filter.serviceId,policy.slotStepMinutes,filter.doctorId??null,filter.patientId??null,filter.ignoreReservationId??null,filter.startsAt??null,filter.chairId??null,filter.shiftId??null]);
 return result.rows.map(row=>({...row,startsAt:iso(row.startsAt),endsAt:iso(row.endsAt),occupiedUntil:iso(row.occupiedUntil)})).sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||a.doctorName.localeCompare(b.doctorName));
}
