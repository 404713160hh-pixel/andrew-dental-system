CREATE TABLE patient_clinic_access (
 patient_id uuid NOT NULL REFERENCES patients(id),
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(patient_id,clinic_id)
);
CREATE TABLE patient_privacy_consents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 patient_id uuid NOT NULL REFERENCES patients(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 policy_version text NOT NULL,
 notice_accepted boolean NOT NULL CHECK(notice_accepted),
 sensitive_accepted boolean NOT NULL CHECK(sensitive_accepted),
 guardian_name text,
 guardian_relationship text,
 guardian_accepted boolean NOT NULL DEFAULT false,
 accepted_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 CHECK((guardian_name IS NULL AND guardian_relationship IS NULL AND guardian_accepted=false)
    OR (guardian_name IS NOT NULL AND guardian_relationship IS NOT NULL AND length(trim(guardian_name))>0 AND length(trim(guardian_relationship))>0 AND guardian_accepted=true))
);
CREATE INDEX patient_privacy_consent_lookup ON patient_privacy_consents(patient_id,policy_version,accepted_at DESC);
