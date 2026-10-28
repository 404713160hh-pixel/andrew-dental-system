import { z } from 'zod';
import type { Db } from './db.js';
import { one } from './db.js';
import { audit } from './auth.js';
import { requireThat } from './errors.js';

export const PRIVACY_VERSION = '2026-10-27-v1';
const guardianInput = z.object({
 name:z.string().trim().min(1).max(100), relationship:z.string().trim().min(1).max(100), accepted:z.literal(true)
}).strict();
export const privacyInput = z.object({
 policyVersion:z.literal(PRIVACY_VERSION), noticeAccepted:z.literal(true), sensitiveAccepted:z.literal(true),
 guardian:guardianInput.nullable()
}).strict();
export type PrivacyConsent = z.infer<typeof privacyInput>;

/** Saves the recorded assertion; it does not claim guardian identity was verified. */
export async function recordConsent(db:Db,actorId:string,patientId:string,birthDate:string,consent:PrivacyConsent,requestId:string) {
 const result=await one<{minor:boolean}>(db,"SELECT ($1::date + interval '14 years') > (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date AS minor",[birthDate]);
 requireThat(!result!.minor || consent.guardian,400,'GUARDIAN_CONSENT_REQUIRED','未满14周岁须由父母或其他监护人填写并确认同意');
 const guardian=consent.guardian;
 await db.query(`INSERT INTO patient_privacy_consents(patient_id,actor_id,policy_version,notice_accepted,sensitive_accepted,guardian_name,guardian_relationship,guardian_accepted)
  VALUES($1,$2,$3,true,true,$4,$5,$6)`,[patientId,actorId,consent.policyVersion,guardian?.name??null,guardian?.relationship??null,!!guardian]);
 await audit(db,actorId,'patient.privacy.accepted',patientId,requestId,{policyVersion:consent.policyVersion,guardianDeclared:!!guardian});
}
export async function hasCurrentConsent(db:Db,patientId:string,actorId:string) {
 return !!await one(db,'SELECT 1 FROM patient_privacy_consents WHERE patient_id=$1 AND actor_id=$2 AND policy_version=$3 AND revoked_at IS NULL LIMIT 1',[patientId,actorId,PRIVACY_VERSION]);
}
