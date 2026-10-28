import type { Principal } from '@andrew/shared';
import type { Db } from './db.js';
import { one } from './db.js';
import { isHq,scopeIds,clinicAccess } from './auth.js';
import { requireThat } from './errors.js';

/** Patients become visible within a clinic through intake or a prior appointment. */
export async function requirePatientVisible(db:Db,user:Principal,patientId:string) {
 if(isHq(user))return;
 const scopes=scopeIds(user,['manager','front']);
 const allowed=await one(db,`SELECT 1 FROM patients p WHERE p.id=$1 AND (
  EXISTS(SELECT 1 FROM patient_clinic_access x WHERE x.patient_id=p.id AND x.clinic_id=ANY($2::uuid[])) OR
  EXISTS(SELECT 1 FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.patient_id=p.id AND r.clinic_id=ANY($2::uuid[])))`,[patientId,scopes]);
 requireThat(allowed,404,'NOT_FOUND','未找到该患者资料');
}
export async function requirePatientInClinic(db:Db,user:Principal,patientId:string,clinicId:string) {
 clinicAccess(user,clinicId,['hq','manager','front']);
 if(isHq(user))return;
 const allowed=await one(db,`SELECT 1 FROM patients p WHERE p.id=$1 AND (
  EXISTS(SELECT 1 FROM patient_clinic_access x WHERE x.patient_id=p.id AND x.clinic_id=$2) OR
  EXISTS(SELECT 1 FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.patient_id=p.id AND r.clinic_id=$2))`,[patientId,clinicId]);
 requireThat(allowed,404,'NOT_FOUND','患者尚未授权该门诊或无本门诊就诊记录');
}
