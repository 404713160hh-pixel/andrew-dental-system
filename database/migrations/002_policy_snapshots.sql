-- Preserve the cancellation rules that were accepted for this booking even
-- if a later deployment changes the defaults. Historical rows remain readable.
ALTER TABLE booking_holds ADD COLUMN policy_snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE appointments ADD COLUMN policy_snapshot jsonb NOT NULL DEFAULT '{}';
