import type { Principal } from '@andrew/shared';
import type { Db } from './db.js';
import { one } from './db.js';
import { isHq,scopeIds,clinicAccess } from './auth.js';
import { requireThat } from './errors.js';
import { PRIVACY_VERSION } from './privacy.js';

/** Reception sees identity matches for the patient's chain consent or a local task. */
export async function requirePatientVisible(db:Db,user:Principal,patientId:string) {
 if(isHq(user))return;
 const scopes=scopeIds(user,['manager','front']);
 const allowed=await one(db,`SELECT 1 FROM patients p WHERE p.id=$1 AND (
  EXISTS(SELECT 1 FROM patient_clinic_access x WHERE x.patient_id=p.id AND x.clinic_id=ANY($2::uuid[])) OR
  EXISTS(SELECT 1 FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.patient_id=p.id AND r.clinic_id=ANY($2::uuid[])) OR
  EXISTS(SELECT 1 FROM patient_privacy_consents pc WHERE pc.patient_id=p.id AND pc.policy_version=$3 AND pc.revoked_at IS NULL))`,[patientId,scopes,PRIVACY_VERSION]);
 requireThat(allowed,404,'NOT_FOUND','未找到该患者资料');
}
export async function requirePatientInClinic(db:Db,user:Principal,patientId:string,clinicId:string) {
 clinicAccess(user,clinicId,['hq','manager','front']);
 if(isHq(user))return;
 const allowed=await one(db,`SELECT 1 FROM patients p WHERE p.id=$1 AND (
  EXISTS(SELECT 1 FROM patient_clinic_access x WHERE x.patient_id=p.id AND x.clinic_id=$2) OR
  EXISTS(SELECT 1 FROM appointments a JOIN resource_reservations r ON r.id=a.reservation_id WHERE a.patient_id=p.id AND r.clinic_id=$2) OR
  EXISTS(SELECT 1 FROM patient_privacy_consents pc WHERE pc.patient_id=p.id AND pc.policy_version=$3 AND pc.revoked_at IS NULL))`,[patientId,clinicId,PRIVACY_VERSION]);
 requireThat(allowed,404,'NOT_FOUND','未找到可用于本次预约的患者资料，请先核对身份与资料告知');
}
