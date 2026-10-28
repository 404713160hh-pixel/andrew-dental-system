-- Account administration uses optimistic versions and forces temporary
-- credentials to be changed before any business endpoints are available.
ALTER TABLE users ADD COLUMN account_version integer NOT NULL DEFAULT 1 CHECK(account_version > 0);
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
