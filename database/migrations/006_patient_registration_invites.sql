-- The raw invitation is shown once to the staff member and is never stored.
CREATE TABLE patient_registration_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 patient_id uuid NOT NULL REFERENCES patients(id),
 code_hash text NOT NULL UNIQUE CHECK(length(code_hash)=64),
 issued_by uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_registration_invites_patient ON patient_registration_invites(patient_id,created_at DESC);
