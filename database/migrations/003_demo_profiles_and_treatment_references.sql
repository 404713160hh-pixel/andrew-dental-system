-- Read-only demo markers are never accepted from patient/staff form DTOs.
ALTER TABLE staff ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE staff ADD COLUMN bio text NOT NULL DEFAULT '';
ALTER TABLE staff ADD COLUMN focus_areas text[] NOT NULL DEFAULT '{}';
ALTER TABLE patients ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

-- Internal provenance for safe, additive development data. No public API exposes
-- or writes this registry. A same-name ordinary record is never adopted.
CREATE TABLE demo_seed_records (
 record_key text PRIMARY KEY,
 record_kind text NOT NULL CHECK(record_kind IN ('clinic','doctor','patient','service','qualification','treatment_reference')),
 record_id uuid NOT NULL,
 enriched_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(record_kind,record_id)
);

CREATE TABLE treatment_references (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reference_code text NOT NULL UNIQUE,
 category text NOT NULL,
 name text NOT NULL,
 price_min_cents integer NOT NULL CHECK(price_min_cents>=0),
 price_max_cents integer NOT NULL CHECK(price_max_cents>=price_min_cents),
 unit text NOT NULL CHECK(unit IN ('次','颗','疗程')),
 reference_year integer NOT NULL CHECK(reference_year BETWEEN 2000 AND 2200),
 source_label text NOT NULL CHECK(length(trim(source_label))>0),
 description text NOT NULL,
 booking_service_id uuid REFERENCES services(id) ON DELETE SET NULL,
 sort_order integer NOT NULL CHECK(sort_order>=0)
);

