ALTER TABLE visits ADD COLUMN materials_recorded boolean NOT NULL DEFAULT false;
CREATE INDEX visits_completion_time ON visits(completed_at) WHERE completed_at IS NOT NULL;

CREATE TABLE visit_materials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 appointment_id uuid NOT NULL REFERENCES visits(appointment_id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 unit text NOT NULL CHECK(length(btrim(unit)) BETWEEN 1 AND 20),
 quantity_milli integer NOT NULL CHECK(quantity_milli BETWEEN 1 AND 1000000),
 unit_cost_cents integer NOT NULL CHECK(unit_cost_cents BETWEEN 0 AND 10000000),
 cost_cents bigint GENERATED ALWAYS AS ((quantity_milli::bigint*unit_cost_cents+500)/1000) STORED
);
CREATE INDEX visit_materials_appointment ON visit_materials(appointment_id);

CREATE TABLE clinic_monthly_expenses (
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 month date NOT NULL CHECK(extract(day FROM month)=1),
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)<=40),
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(clinic_id,month)
);
