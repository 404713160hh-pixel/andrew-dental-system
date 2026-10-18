-- Version 002: immutable finance, clinical addenda, identity merge and recovery.
CREATE TABLE payments (
 id TEXT PRIMARY KEY,
 settlement_id TEXT NOT NULL REFERENCES settlements(id),
 amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= 100000000000),
 method TEXT NOT NULL CHECK(method IN ('cash','bank','pos')),
 reference TEXT NOT NULL,
 reason TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL REFERENCES users(id),
 recording_basis TEXT NOT NULL DEFAULT 'staff-verified-manual'
);
CREATE INDEX payments_settlement_time ON payments(settlement_id, recorded_at);
CREATE INDEX payments_time ON payments(recorded_at);
CREATE TABLE refunds (
 id TEXT PRIMARY KEY,
 payment_id TEXT NOT NULL REFERENCES payments(id),
 amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= 100000000000),
 reference TEXT NOT NULL,
 reason TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX refunds_payment_time ON refunds(payment_id, recorded_at);
CREATE INDEX refunds_time ON refunds(recorded_at);
CREATE TABLE invoice_adjustments (
 id TEXT PRIMARY KEY,
 settlement_id TEXT NOT NULL REFERENCES settlements(id),
 type TEXT NOT NULL CHECK(type = 'void'),
 amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= 100000000000),
 reason TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL REFERENCES users(id)
);
CREATE UNIQUE INDEX invoice_single_void ON invoice_adjustments(settlement_id) WHERE type = 'void';
CREATE TABLE reconciliations (
 id TEXT PRIMARY KEY,
 clinic_id TEXT NOT NULL REFERENCES clinics(id),
 business_date TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0),
 expected_cash INTEGER NOT NULL,
 expected_bank INTEGER NOT NULL,
 expected_pos INTEGER NOT NULL,
 observed_cash INTEGER NOT NULL,
 observed_bank INTEGER NOT NULL,
 observed_pos INTEGER NOT NULL,
 source_signature TEXT NOT NULL,
 reference TEXT NOT NULL,
 reason TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL REFERENCES users(id),
 UNIQUE(clinic_id, business_date, revision)
);
CREATE INDEX reconciliations_clinic_day ON reconciliations(clinic_id, business_date, revision DESC);
CREATE TABLE visit_addenda (
 id TEXT PRIMARY KEY,
 visit_id TEXT NOT NULL REFERENCES visits(id),
 original_version INTEGER NOT NULL CHECK(original_version > 0),
 reason TEXT NOT NULL,
 content TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL REFERENCES users(id),
 author_name TEXT NOT NULL
);
CREATE INDEX visit_addenda_visit_time ON visit_addenda(visit_id, recorded_at);
CREATE TABLE patient_aliases (
 id TEXT PRIMARY KEY,
 source_id TEXT NOT NULL UNIQUE REFERENCES patients(id),
 target_id TEXT NOT NULL REFERENCES patients(id),
 reason TEXT NOT NULL,
 identity_evidence TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL REFERENCES users(id),
 CHECK(source_id <> target_id)
);
CREATE TABLE password_reset_tokens (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 token_hash TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER,
 issued_by TEXT NOT NULL REFERENCES users(id),
 identity_evidence TEXT NOT NULL,
 reason TEXT NOT NULL
);
CREATE INDEX password_reset_user_expiry ON password_reset_tokens(user_id, expires_at);
CREATE TABLE account_recovery_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 requested_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','issued','resolved')),
 resolved_at TEXT
);
CREATE UNIQUE INDEX one_pending_recovery ON account_recovery_requests(user_id) WHERE status = 'pending';
CREATE TRIGGER payments_no_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT,'Payment ledger is append only'); END;
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT,'Payment ledger is append only'); END;
CREATE TRIGGER refunds_no_update BEFORE UPDATE ON refunds BEGIN SELECT RAISE(ABORT,'Refund ledger is append only'); END;
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds BEGIN SELECT RAISE(ABORT,'Refund ledger is append only'); END;
CREATE TRIGGER invoice_adjustments_no_update BEFORE UPDATE ON invoice_adjustments BEGIN SELECT RAISE(ABORT,'Invoice adjustments are append only'); END;
CREATE TRIGGER invoice_adjustments_no_delete BEFORE DELETE ON invoice_adjustments BEGIN SELECT RAISE(ABORT,'Invoice adjustments are append only'); END;
CREATE TRIGGER reconciliations_no_update BEFORE UPDATE ON reconciliations BEGIN SELECT RAISE(ABORT,'Reconciliations are append only'); END;
CREATE TRIGGER reconciliations_no_delete BEFORE DELETE ON reconciliations BEGIN SELECT RAISE(ABORT,'Reconciliations are append only'); END;
CREATE TRIGGER visit_addenda_no_update BEFORE UPDATE ON visit_addenda BEGIN SELECT RAISE(ABORT,'Clinical addenda are append only'); END;
CREATE TRIGGER visit_addenda_no_delete BEFORE DELETE ON visit_addenda BEGIN SELECT RAISE(ABORT,'Clinical addenda are append only'); END;
CREATE TRIGGER patient_aliases_no_update BEFORE UPDATE ON patient_aliases BEGIN SELECT RAISE(ABORT,'Patient aliases are append only'); END;
CREATE TRIGGER patient_aliases_no_delete BEFORE DELETE ON patient_aliases BEGIN SELECT RAISE(ABORT,'Patient aliases are append only'); END;
