CREATE TABLE visits (
 appointment_id uuid PRIMARY KEY REFERENCES appointments(id),
 status text NOT NULL CHECK(status IN ('arrived','no_show','completed')),
 doctor_id uuid REFERENCES staff(id),
 arrived_at timestamptz,
 completed_at timestamptz,
 CONSTRAINT visit_attendance_consistency CHECK (
  (status='no_show' AND doctor_id IS NULL AND arrived_at IS NULL AND completed_at IS NULL) OR
  (status='arrived' AND doctor_id IS NOT NULL AND arrived_at IS NOT NULL AND completed_at IS NULL) OR
  (status='completed' AND doctor_id IS NOT NULL AND arrived_at IS NOT NULL AND completed_at>=arrived_at AND completed_at IS NOT NULL)
 )
);
CREATE INDEX visits_doctor_arrival ON visits(doctor_id,arrived_at);

CREATE TABLE visit_treatments (
 appointment_id uuid NOT NULL REFERENCES visits(appointment_id),
 service_id uuid NOT NULL REFERENCES services(id),
 service_name text NOT NULL,
 unit text NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 99),
 unit_price_cents integer NOT NULL CHECK(unit_price_cents BETWEEN 0 AND 100000000),
 PRIMARY KEY(appointment_id,service_id)
);
CREATE TABLE visit_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 appointment_id uuid NOT NULL UNIQUE REFERENCES visits(appointment_id),
 total_cents bigint NOT NULL CHECK(total_cents>=0),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 issued_by uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX visit_invoices_issued ON visit_invoices(issued_at);
CREATE TABLE visit_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL REFERENCES visit_invoices(id),
 amount_cents bigint NOT NULL CHECK(amount_cents>0),
 method text NOT NULL CHECK(method IN ('cash','wechat','alipay','card','transfer')),
 reference text NOT NULL DEFAULT '',
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 recorded_by uuid NOT NULL REFERENCES users(id),
 command_key uuid NOT NULL UNIQUE,
 CHECK(method='cash' OR length(btrim(reference))>0)
);
CREATE INDEX visit_payments_invoice ON visit_payments(invoice_id);
CREATE INDEX visit_payments_received ON visit_payments(received_at);
