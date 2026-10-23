CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE CHECK(username=lower(username)),
 password_hash text NOT NULL, display_name text NOT NULL, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE clinics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, address text NOT NULL,
 phone text NOT NULL, email text NOT NULL DEFAULT '', timezone text NOT NULL DEFAULT 'Asia/Shanghai' CHECK(timezone='Asia/Shanghai'),
 active boolean NOT NULL DEFAULT true, row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0)
);
CREATE TABLE patients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE REFERENCES users(id), name text NOT NULL,
 birth_date date NOT NULL CHECK(birth_date>='1900-01-01'), phone text NOT NULL, email text,
 billing_address text NOT NULL, emergency_name text NOT NULL, emergency_phone text NOT NULL,
 allergy_status text NOT NULL DEFAULT 'unknown' CHECK(allergy_status IN ('unknown','none_reported','known')),
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0), created_at timestamptz NOT NULL DEFAULT now()
);
-- A phone number is contact information, deliberately not UNIQUE.
CREATE TABLE patient_allergies (
 patient_id uuid NOT NULL REFERENCES patients(id), substance text NOT NULL CHECK(length(trim(substance))>0),
 PRIMARY KEY(patient_id,substance)
);
CREATE TABLE staff (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE REFERENCES users(id),
 employee_no text NOT NULL UNIQUE, name text NOT NULL, phone text NOT NULL,
 specialty text NOT NULL DEFAULT '', is_dentist boolean NOT NULL DEFAULT true,
 active boolean NOT NULL DEFAULT true, row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0)
);
CREATE TABLE role_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('front','doctor','manager','hq')), clinic_id uuid REFERENCES clinics(id),
 CHECK((role='hq' AND clinic_id IS NULL) OR (role<>'hq' AND clinic_id IS NOT NULL)),
 UNIQUE NULLS NOT DISTINCT(user_id,role,clinic_id)
);
CREATE TABLE qualifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true,
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0)
);
CREATE TABLE dentist_qualifications (
 dentist_id uuid NOT NULL REFERENCES staff(id), qualification_id uuid NOT NULL REFERENCES qualifications(id),
 valid_from timestamptz NOT NULL, valid_until timestamptz,
 PRIMARY KEY(dentist_id,qualification_id), CHECK(valid_until IS NULL OR valid_until>valid_from)
);
CREATE TABLE services (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, description text NOT NULL DEFAULT '',
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 10 AND 240),
 buffer_minutes integer NOT NULL DEFAULT 0 CHECK(buffer_minutes BETWEEN 0 AND 120),
 price_cents integer NOT NULL DEFAULT 0 CHECK(price_cents>=0), unit text NOT NULL DEFAULT '次',
 active boolean NOT NULL DEFAULT true, row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0)
);
CREATE TABLE clinic_services (
 clinic_id uuid NOT NULL REFERENCES clinics(id), service_id uuid NOT NULL REFERENCES services(id), PRIMARY KEY(clinic_id,service_id)
);
CREATE TABLE service_qualifications (
 service_id uuid NOT NULL REFERENCES services(id), qualification_id uuid NOT NULL REFERENCES qualifications(id), PRIMARY KEY(service_id,qualification_id)
);
CREATE TABLE chairs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id), name text NOT NULL,
 active boolean NOT NULL DEFAULT true, row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0), UNIQUE(id,clinic_id), UNIQUE(clinic_id,name)
);
CREATE TABLE chair_blocks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chair_id uuid NOT NULL REFERENCES chairs(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, reason text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), CHECK(ends_at>starts_at)
);
CREATE INDEX chair_blocks_range ON chair_blocks USING gist(chair_id,tstzrange(starts_at,ends_at,'[)'));
CREATE TABLE doctor_shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id), doctor_id uuid NOT NULL REFERENCES staff(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','cancelled')),
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0), created_by uuid NOT NULL REFERENCES users(id),
 CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '16 hours'), UNIQUE(id,clinic_id,doctor_id),
 EXCLUDE USING gist(doctor_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(status='published')
);
CREATE INDEX shifts_clinic_start ON doctor_shifts(clinic_id,starts_at) WHERE(status='published');
CREATE TABLE doctor_shift_services (
 shift_id uuid NOT NULL REFERENCES doctor_shifts(id), service_id uuid NOT NULL REFERENCES services(id), PRIMARY KEY(shift_id,service_id)
);
-- One occupancy ledger spans holds AND appointments: separate EXCLUDE indexes
-- on those two tables alone cannot reject a cross-table race.
CREATE TABLE resource_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id),
 clinic_id uuid NOT NULL REFERENCES clinics(id), service_id uuid NOT NULL REFERENCES services(id),
 doctor_id uuid NOT NULL REFERENCES staff(id), chair_id uuid NOT NULL,
 shift_id uuid NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, occupied_until timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('held','booked','released','expired')), expires_at timestamptz,
 CHECK(ends_at>starts_at AND occupied_until>=ends_at), CHECK(status<>'held' OR expires_at IS NOT NULL),
 FOREIGN KEY(chair_id,clinic_id) REFERENCES chairs(id,clinic_id),
 FOREIGN KEY(shift_id,clinic_id,doctor_id) REFERENCES doctor_shifts(id,clinic_id,doctor_id),
 EXCLUDE USING gist(doctor_id WITH =,tstzrange(starts_at,occupied_until,'[)') WITH &&) WHERE(status IN ('held','booked')),
 EXCLUDE USING gist(chair_id WITH =,tstzrange(starts_at,occupied_until,'[)') WITH &&) WHERE(status IN ('held','booked')),
 EXCLUDE USING gist(patient_id WITH =,tstzrange(starts_at,occupied_until,'[)') WITH &&) WHERE(status IN ('held','booked'))
);
CREATE INDEX reservation_expiration ON resource_reservations(expires_at) WHERE(status='held');
CREATE TABLE booking_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reservation_id uuid NOT NULL UNIQUE REFERENCES resource_reservations(id),
 created_by uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL,
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0), consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE appointments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), appointment_no text NOT NULL UNIQUE,
 patient_id uuid NOT NULL REFERENCES patients(id), reservation_id uuid NOT NULL UNIQUE REFERENCES resource_reservations(id),
 hold_id uuid NOT NULL UNIQUE REFERENCES booking_holds(id),
 status text NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled','rescheduled')),
 -- Attendance and care progression are separate from booking state.
 attendance text NOT NULL DEFAULT 'not_recorded' CHECK(attendance='not_recorded'),
 supersedes_appointment_id uuid UNIQUE REFERENCES appointments(id), cancellation_reason text,
 service_name text NOT NULL, price_cents integer NOT NULL CHECK(price_cents>=0),
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0), created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(supersedes_appointment_id IS DISTINCT FROM id)
);
CREATE INDEX appointments_patient ON appointments(patient_id,created_at DESC);
CREATE TABLE appointment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), appointment_id uuid NOT NULL REFERENCES appointments(id),
 actor_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL CHECK(kind IN ('confirmed','cancelled','rescheduled','replacement_confirmed')),
 reason text, detail jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE command_receipts (
 user_id uuid NOT NULL REFERENCES users(id), command_key text NOT NULL, request_hash text NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,command_key)
);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id), action text NOT NULL,
 target_id uuid, detail jsonb NOT NULL DEFAULT '{}', request_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiration ON sessions(expires_at);

CREATE FUNCTION protect_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Append-only event history' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_appointment_events BEFORE UPDATE OR DELETE ON appointment_events FOR EACH ROW EXECUTE FUNCTION protect_append_only();
CREATE TRIGGER immutable_audit_events BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION protect_append_only();

CREATE FUNCTION check_patient_allergy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p uuid; state text; n integer;
BEGIN
 IF TG_TABLE_NAME='patients' THEN p:=NEW.id;
 ELSE p:=COALESCE(NEW.patient_id,OLD.patient_id); END IF;
 SELECT allergy_status INTO state FROM patients WHERE id=p;
 SELECT count(*) INTO n FROM patient_allergies WHERE patient_id=p;
 IF (state='known' AND n=0) OR (state<>'known' AND n>0) THEN
  RAISE EXCEPTION 'Allergy declaration and details disagree' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER patient_allergy_declaration AFTER INSERT OR UPDATE ON patients DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_patient_allergy();
CREATE CONSTRAINT TRIGGER patient_allergy_details AFTER INSERT OR UPDATE OR DELETE ON patient_allergies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_patient_allergy();

CREATE FUNCTION check_reservation_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid; r resource_reservations%ROWTYPE; a appointments%ROWTYPE; h booking_holds%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='resource_reservations' THEN rid:=NEW.id;
 ELSE rid:=NEW.reservation_id; END IF;
 SELECT * INTO r FROM resource_reservations WHERE id=rid;
 SELECT * INTO a FROM appointments WHERE reservation_id=rid;
 SELECT * INTO h FROM booking_holds WHERE reservation_id=rid;
 IF r.status='held' AND (h.id IS NULL OR h.consumed_at IS NOT NULL OR h.expires_at<>r.expires_at) THEN
  RAISE EXCEPTION 'Hold must own its reservation' USING ERRCODE='23514'; END IF;
 IF r.status='booked' AND (a.id IS NULL OR a.status<>'confirmed' OR a.patient_id<>r.patient_id OR h.consumed_at IS NULL OR a.hold_id<>h.id) THEN
  RAISE EXCEPTION 'Confirmed appointment must own its reservation' USING ERRCODE='23514'; END IF;
 IF a.id IS NOT NULL AND (a.patient_id<>r.patient_id OR (a.status='confirmed')<>(r.status='booked')) THEN
  RAISE EXCEPTION 'Appointment and occupancy state disagree' USING ERRCODE='23514'; END IF;
 IF a.supersedes_appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM appointments prior_appt WHERE prior_appt.id=a.supersedes_appointment_id AND prior_appt.patient_id=a.patient_id AND prior_appt.status='rescheduled') THEN
  RAISE EXCEPTION 'Replacement must retain the patient and trace a rescheduled original' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER reservation_owner AFTER INSERT OR UPDATE ON resource_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reservation_owner();
CREATE CONSTRAINT TRIGGER appointment_occupancy AFTER INSERT OR UPDATE ON appointments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reservation_owner();
CREATE CONSTRAINT TRIGGER hold_occupancy AFTER INSERT OR UPDATE ON booking_holds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reservation_owner();
