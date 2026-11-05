-- Reconciled financial sources, not appointment prices, fund quarterly incentives.
ALTER TABLE staff ADD COLUMN birth_date date CHECK(birth_date>='1900-01-01');
ALTER TABLE staff ADD COLUMN home_address text;
ALTER TABLE staff ADD COLUMN email text;
CREATE TABLE incentive_months (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id),
 month date NOT NULL CHECK(extract(day FROM month)=1), reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 500),
 no_activity boolean NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','closed')),
 source_revision integer NOT NULL DEFAULT 1 CHECK(source_revision>0), row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0),
 created_by uuid NOT NULL REFERENCES users(id), created_staff_id uuid NOT NULL REFERENCES staff(id),
 updated_by uuid NOT NULL REFERENCES users(id), closed_by uuid REFERENCES users(id), closed_staff_id uuid REFERENCES staff(id),
 closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(clinic_id,month), CHECK((status='closed' AND closed_by IS NOT NULL AND closed_staff_id IS NOT NULL AND closed_at IS NOT NULL) OR (status='draft' AND closed_by IS NULL AND closed_staff_id IS NULL AND closed_at IS NULL)),
 CHECK(closed_by IS DISTINCT FROM created_by AND closed_staff_id IS DISTINCT FROM created_staff_id)
);
CREATE INDEX incentive_month_period ON incentive_months(month,clinic_id,status);
CREATE TABLE doctor_financial_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), month_id uuid NOT NULL REFERENCES incentive_months(id),
 source_revision integer NOT NULL CHECK(source_revision>0), doctor_id uuid NOT NULL REFERENCES staff(id),
 doctor_name text NOT NULL, employee_no text NOT NULL,
 revenue_cents bigint NOT NULL CHECK(revenue_cents BETWEEN -1000000000000 AND 1000000000000),
 material_cost_cents bigint NOT NULL CHECK(material_cost_cents BETWEEN -1000000000000 AND 1000000000000),
 operating_expense_cents bigint NOT NULL CHECK(operating_expense_cents BETWEEN -1000000000000 AND 1000000000000),
 revenue_reference text NOT NULL CHECK(length(trim(revenue_reference)) BETWEEN 1 AND 500),
 material_reference text NOT NULL CHECK(length(trim(material_reference)) BETWEEN 1 AND 500),
 expense_reference text NOT NULL CHECK(length(trim(expense_reference)) BETWEEN 1 AND 500),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(month_id,source_revision,doctor_id)
);
CREATE TRIGGER immutable_doctor_financial_sources BEFORE UPDATE OR DELETE ON doctor_financial_sources FOR EACH ROW EXECUTE FUNCTION protect_append_only();
CREATE TABLE incentive_pools (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quarter text NOT NULL CHECK(quarter ~ '^[0-9]{4}-Q[1-4]$'),
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 500),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','voided')),
 rule_version text NOT NULL CHECK(rule_version='quarterly-positive-contribution-v1'),
 total_revenue_cents bigint NOT NULL, total_material_cost_cents bigint NOT NULL, total_operating_expense_cents bigint NOT NULL,
 net_profit_cents bigint NOT NULL, fund_cents bigint NOT NULL CHECK(fund_cents>=0),
 clinic_count integer NOT NULL CHECK(clinic_count>0), doctor_count integer NOT NULL CHECK(doctor_count>=0),
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0),
 created_by uuid NOT NULL REFERENCES users(id), created_staff_id uuid NOT NULL REFERENCES staff(id),
 submitted_at timestamptz, approved_by uuid REFERENCES users(id), approved_staff_id uuid REFERENCES staff(id), approved_at timestamptz,
 void_reason text, voided_by uuid REFERENCES users(id), voided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(net_profit_cents=total_revenue_cents-total_material_cost_cents-total_operating_expense_cents),
 CHECK(fund_cents=(greatest(net_profit_cents,0)::numeric/10)::bigint),
 CHECK((status='approved' AND approved_by IS NOT NULL AND approved_staff_id IS NOT NULL AND approved_at IS NOT NULL) OR (status<>'approved' AND approved_by IS NULL AND approved_staff_id IS NULL AND approved_at IS NULL)),
 CHECK(approved_by IS DISTINCT FROM created_by AND approved_staff_id IS DISTINCT FROM created_staff_id),
 CHECK((status='voided' AND void_reason IS NOT NULL AND voided_by IS NOT NULL AND voided_at IS NOT NULL) OR (status<>'voided' AND void_reason IS NULL AND voided_by IS NULL AND voided_at IS NULL))
);
CREATE UNIQUE INDEX incentive_one_live_quarter ON incentive_pools(quarter) WHERE(status<>'voided');
CREATE TABLE incentive_pool_sources (
 pool_id uuid NOT NULL REFERENCES incentive_pools(id), month_id uuid NOT NULL REFERENCES incentive_months(id),
 source_revision integer NOT NULL CHECK(source_revision>0), clinic_id uuid NOT NULL REFERENCES clinics(id), clinic_name text NOT NULL,
 month date NOT NULL, reference text NOT NULL, no_activity boolean NOT NULL,
 closed_by uuid NOT NULL REFERENCES users(id), closed_staff_id uuid NOT NULL REFERENCES staff(id), closed_at timestamptz NOT NULL,
 PRIMARY KEY(pool_id,month_id), UNIQUE(pool_id,clinic_id,month)
);
CREATE INDEX incentive_sources_month ON incentive_pool_sources(month_id,pool_id);
CREATE TRIGGER immutable_incentive_pool_sources BEFORE UPDATE OR DELETE ON incentive_pool_sources FOR EACH ROW EXECUTE FUNCTION protect_append_only();
CREATE TABLE doctor_quarter_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pool_id uuid NOT NULL REFERENCES incentive_pools(id),
 clinic_id uuid NOT NULL REFERENCES clinics(id), clinic_name text NOT NULL, doctor_id uuid NOT NULL REFERENCES staff(id),
 doctor_name text NOT NULL, employee_no text NOT NULL,
 revenue_cents bigint NOT NULL, material_cost_cents bigint NOT NULL, operating_expense_cents bigint NOT NULL, net_profit_cents bigint NOT NULL,
 CHECK(net_profit_cents=revenue_cents-material_cost_cents-operating_expense_cents), UNIQUE(pool_id,clinic_id,doctor_id)
);
CREATE TRIGGER immutable_doctor_quarter_results BEFORE UPDATE OR DELETE ON doctor_quarter_results FOR EACH ROW EXECUTE FUNCTION protect_append_only();
CREATE TABLE incentive_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pool_id uuid NOT NULL REFERENCES incentive_pools(id), doctor_id uuid NOT NULL REFERENCES staff(id),
 doctor_name text NOT NULL, employee_no text NOT NULL, contribution_cents bigint NOT NULL, weight_cents bigint NOT NULL CHECK(weight_cents>=0),
 amount_cents bigint NOT NULL CHECK(amount_cents>=0), row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0),
 UNIQUE(pool_id,doctor_id), CHECK(weight_cents=greatest(contribution_cents,0))
);
CREATE TABLE incentive_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), allocation_id uuid NOT NULL REFERENCES incentive_allocations(id),
 amount_cents bigint NOT NULL CHECK(amount_cents>0), reference text NOT NULL UNIQUE CHECK(length(trim(reference)) BETWEEN 1 AND 500),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed')), result_reference text UNIQUE,
 row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0),
 created_by uuid NOT NULL REFERENCES users(id), created_staff_id uuid NOT NULL REFERENCES staff(id), created_at timestamptz NOT NULL DEFAULT now(),
 resolved_by uuid REFERENCES users(id), resolved_staff_id uuid REFERENCES staff(id), resolved_at timestamptz,
 CHECK((status='pending' AND result_reference IS NULL AND resolved_by IS NULL AND resolved_staff_id IS NULL AND resolved_at IS NULL) OR (status<>'pending' AND result_reference IS NOT NULL AND resolved_by IS NOT NULL AND resolved_staff_id IS NOT NULL AND resolved_at IS NOT NULL)),
 CHECK(result_reference IS NULL OR length(trim(result_reference)) BETWEEN 1 AND 500)
);
CREATE INDEX incentive_payments_allocation ON incentive_payments(allocation_id,status);
CREATE FUNCTION guard_incentive_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE capacity bigint; pool_status text; used numeric; ref text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.status<>'pending' OR NEW.status='pending' OR
    (NEW.allocation_id,NEW.amount_cents,NEW.reference,NEW.created_by,NEW.created_staff_id,NEW.created_at) IS DISTINCT FROM
    (OLD.allocation_id,OLD.amount_cents,OLD.reference,OLD.created_by,OLD.created_staff_id,OLD.created_at) THEN
   RAISE EXCEPTION 'Payment result is immutable' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.status<>'pending' THEN RAISE EXCEPTION 'New payment must be pending' USING ERRCODE='23514'; END IF;
 SELECT a.amount_cents,p.status INTO capacity,pool_status FROM incentive_allocations a JOIN incentive_pools p ON p.id=a.pool_id WHERE a.id=NEW.allocation_id FOR UPDATE OF a;
 IF pool_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'Pool is not approved' USING ERRCODE='23514'; END IF;
 FOR ref IN SELECT DISTINCT x FROM unnest(ARRAY[NEW.reference,NEW.result_reference]) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('andrew.incentive.payment.'||ref,0));
  IF EXISTS(SELECT 1 FROM incentive_payments p WHERE p.id<>NEW.id AND (p.reference=ref OR p.result_reference=ref)) THEN
   RAISE EXCEPTION 'Payment evidence reference already used' USING ERRCODE='23505';
  END IF;
 END LOOP;
 SELECT coalesce(sum(amount_cents),0) INTO used FROM incentive_payments WHERE allocation_id=NEW.allocation_id AND id<>NEW.id AND status IN ('pending','succeeded');
 IF NEW.status IN ('pending','succeeded') THEN used:=used+NEW.amount_cents; END IF;
 IF used>capacity THEN RAISE EXCEPTION 'Payment exceeds allocation' USING ERRCODE='23514'; END IF;
 UPDATE incentive_allocations SET row_version=row_version+1 WHERE id=NEW.allocation_id;
 RETURN NEW;
END $$;
CREATE TRIGGER incentive_payment_guard BEFORE INSERT OR UPDATE ON incentive_payments FOR EACH ROW EXECUTE FUNCTION guard_incentive_payment();
CREATE TRIGGER no_delete_incentive_payments BEFORE DELETE ON incentive_payments FOR EACH ROW EXECUTE FUNCTION protect_append_only();
