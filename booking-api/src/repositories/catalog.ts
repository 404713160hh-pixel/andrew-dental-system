import type { Clinic,Chair,Doctor,Service,Qualification,Patient,PatientInput,Shift,Appointment,BookingPolicy,AppointmentEvent } from '@andrew/shared';
import type { Db } from '../db.js';
import { one,iso } from '../db.js';
export const patientSelect=`SELECT p.id,p.name,to_char(p.birth_date,'YYYY-MM-DD') AS "birthDate",p.phone,p.email,
 p.billing_address AS "billingAddress",p.emergency_name AS "emergencyName",p.emergency_phone AS "emergencyPhone",
 p.allergy_status AS "allergyStatus",p.row_version AS "rowVersion",p.is_demo AS "isDemo",
 ARRAY(SELECT substance FROM patient_allergies a WHERE a.patient_id=p.id ORDER BY substance) AS allergies FROM patients p`;
export const clinicSelect=`SELECT id,name,address,phone,email,timezone,active,row_version AS "rowVersion" FROM clinics`;
export const chairSelect=`SELECT id,clinic_id AS "clinicId",name,active,row_version AS "rowVersion" FROM chairs`;
export const qualificationSelect=`SELECT id,name,active,row_version AS "rowVersion" FROM qualifications`;
export const doctorSelect=`SELECT s.id,s.employee_no AS "employeeNo",s.name,s.phone,s.specialty,s.active,s.row_version AS "rowVersion",
 s.is_demo AS "isDemo",s.bio,s.focus_areas AS "focusAreas",
 ARRAY(SELECT DISTINCT ds.clinic_id FROM doctor_shifts ds JOIN clinics c ON c.id=ds.clinic_id AND c.active
 WHERE ds.doctor_id=s.id AND ds.status='published' AND ds.ends_at>clock_timestamp() ORDER BY ds.clinic_id) AS "clinicIds",
 coalesce((SELECT jsonb_agg(jsonb_build_object('qualificationId',d.qualification_id,'qualificationName',q.name,'validFrom',d.valid_from,'validUntil',d.valid_until) ORDER BY q.name)
 FROM dentist_qualifications d JOIN qualifications q ON q.id=d.qualification_id WHERE d.dentist_id=s.id),'[]') AS qualifications,
 ARRAY(SELECT v.id FROM services v WHERE v.active AND NOT EXISTS(SELECT 1 FROM service_qualifications sq WHERE sq.service_id=v.id AND NOT EXISTS(
 SELECT 1 FROM dentist_qualifications dq JOIN qualifications q ON q.id=dq.qualification_id WHERE dq.dentist_id=s.id AND dq.qualification_id=sq.qualification_id AND q.active
 AND dq.valid_from<=now() AND (dq.valid_until IS NULL OR dq.valid_until>now())))) AS "serviceIds" FROM staff s`;
export const serviceSelect=`SELECT v.id,v.name,v.description,v.duration_minutes AS "durationMinutes",v.buffer_minutes AS "bufferMinutes",v.price_cents AS "priceCents",v.unit,v.active,v.row_version AS "rowVersion",
 ARRAY(SELECT clinic_id FROM clinic_services cs WHERE cs.service_id=v.id ORDER BY clinic_id) AS "clinicIds",
 ARRAY(SELECT qualification_id FROM service_qualifications sq WHERE sq.service_id=v.id ORDER BY qualification_id) AS "qualificationIds" FROM services v`;
export const shiftSelect=`SELECT ds.id,ds.clinic_id AS "clinicId",ds.doctor_id AS "doctorId",s.name AS "doctorName",ds.starts_at AS "startsAt",ds.ends_at AS "endsAt",ds.status,ds.row_version AS "rowVersion",
 ARRAY(SELECT service_id FROM doctor_shift_services dss WHERE dss.shift_id=ds.id ORDER BY service_id) AS "serviceIds" FROM doctor_shifts ds JOIN staff s ON s.id=ds.doctor_id`;
export const appointmentSelect=`SELECT a.id,a.appointment_no AS "appointmentNo",a.patient_id AS "patientId",p.name AS "patientName",p.is_demo AS "patientIsDemo",r.clinic_id AS "clinicId",c.name AS "clinicName",c.address AS "clinicAddress",
 r.doctor_id AS "doctorId",d.name AS "doctorName",d.is_demo AS "doctorIsDemo",r.service_id AS "serviceId",a.service_name AS "serviceName",r.chair_id AS "chairId",r.starts_at AS "startsAt",r.ends_at AS "endsAt",r.occupied_until AS "occupiedUntil",
 a.status,a.attendance,a.policy_snapshot AS policy,a.row_version AS "rowVersion",a.supersedes_appointment_id AS "supersedesAppointmentId",
 (SELECT newer.id FROM appointments newer WHERE newer.supersedes_appointment_id=a.id) AS "replacementAppointmentId",
 a.cancellation_reason AS "cancellationReason",a.created_at AS "createdAt" FROM appointments a
 JOIN resource_reservations r ON r.id=a.reservation_id JOIN patients p ON p.id=a.patient_id
 JOIN clinics c ON c.id=r.clinic_id JOIN staff d ON d.id=r.doctor_id`;
export const getPatient=(db:Db,id:string)=>one<Patient>(db,patientSelect+' WHERE p.id=$1',[id]);
export async function getAppointment(db:Db,id:string,policy:BookingPolicy):Promise<Appointment|undefined>{
 const a=await one<Appointment>(db,appointmentSelect+' WHERE a.id=$1',[id]);
 if(a){a.startsAt=iso(a.startsAt);a.endsAt=iso(a.endsAt);a.occupiedUntil=iso(a.occupiedUntil);a.createdAt=iso(a.createdAt);if(!('cancellationNoticeMinutes' in a.policy))a.policy=policy;}
 return a;
}
export async function events(db:Db,id:string):Promise<AppointmentEvent[]>{
 const result=await db.query<AppointmentEvent>(`SELECT e.id,e.kind,e.reason,e.occurred_at AS "occurredAt",u.display_name AS "actorName" FROM appointment_events e JOIN users u ON u.id=e.actor_id WHERE e.appointment_id=$1 ORDER BY e.occurred_at,e.id`,[id]);
 return result.rows.map(r=>({...r,occurredAt:iso(r.occurredAt)}));
}
export type CatalogResult=Clinic|Chair|Doctor|Service|Qualification;
export const insertPatient=async(db:Db,input:PatientInput,userId:string|null=null)=>{
 const p=await one<{id:string}>(db,`INSERT INTO patients(user_id,name,birth_date,phone,email,billing_address,emergency_name,emergency_phone,allergy_status)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING id`,[userId,input.name,input.birthDate,input.phone,input.email||null,input.billingAddress,input.emergencyName,input.emergencyPhone,input.allergyStatus]);
 if(!p)throw new Error('Patient insertion failed');
 await saveAllergies(db,p.id,input.allergies);return (await getPatient(db,p.id))!;
};
export async function saveAllergies(db:Db,id:string,allergies:string[]){
 await db.query('DELETE FROM patient_allergies WHERE patient_id=$1',[id]);
 for(const value of allergies)await db.query('INSERT INTO patient_allergies(patient_id,substance)VALUES($1,$2)',[id,value]);
}
