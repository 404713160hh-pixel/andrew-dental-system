\set ON_ERROR_STOP on
\getenv app_user POSTGRES_APP_USER
\getenv app_password POSTGRES_APP_PASSWORD
\getenv bootstrap_password PGPASSWORD
SELECT set_config('andrew.runtime_user', :'app_user', false) AS runtime_user,
       set_config('andrew.runtime_password', :'app_password', false) AS runtime_password,
       set_config('andrew.bootstrap_password', :'bootstrap_password', false) AS bootstrap_password \gset
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('andrew.booking.runtime-role', 0));
DO $provision$
DECLARE
  runtime_user text := current_setting('andrew.runtime_user');
  runtime_password text := current_setting('andrew.runtime_password');
  existing record;
BEGIN
  IF runtime_user !~ '^[a-z][a-z0-9_]{2,62}$' OR runtime_user = current_user THEN
    RAISE EXCEPTION 'Runtime role must be a distinct lowercase PostgreSQL role';
  END IF;
  IF runtime_password !~ '^[0-9a-fA-F]{32,}$' OR runtime_password = current_setting('andrew.bootstrap_password') THEN
    RAISE EXCEPTION 'Runtime password must be independent random hexadecimal with at least 32 characters';
  END IF;
  SELECT oid, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls INTO existing
  FROM pg_roles WHERE rolname = runtime_user;
  IF FOUND THEN
    IF existing.rolsuper OR existing.rolcreatedb OR existing.rolcreaterole OR existing.rolreplication OR existing.rolbypassrls
       OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member = existing.oid)
       OR EXISTS(SELECT 1 FROM pg_class WHERE relowner = existing.oid)
       OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner = existing.oid)
       OR EXISTS(SELECT 1 FROM pg_database WHERE datdba = existing.oid) THEN
      RAISE EXCEPTION 'Existing runtime role owns objects or has elevated privileges; use a dedicated role';
    END IF;
    EXECUTE format('ALTER ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', runtime_user, runtime_password);
  ELSE
    EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', runtime_user, runtime_password);
  END IF;
  -- This is a dedicated application database. A runtime role must not inherit
  -- schema creation or temporary-object privileges from PUBLIC.
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), runtime_user);
  EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', runtime_user);
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', runtime_user);
  -- Revoke previous grants first so reruns also narrow old installations.
  EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', runtime_user);
  EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', runtime_user);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO %I', runtime_user);
  -- These relationships are replaced transactionally or represent revocable sessions.
  EXECUTE format('GRANT DELETE ON public.sessions, public.patient_allergies, public.role_assignments, public.dentist_qualifications, public.clinic_services, public.service_qualifications TO %I', runtime_user);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', runtime_user);
  EXECUTE format('REVOKE INSERT, UPDATE ON public.schema_migrations FROM %I', runtime_user);
  EXECUTE format('REVOKE UPDATE ON public.audit_events, public.patient_privacy_consents FROM %I', runtime_user);
  -- Consent records remain append-only except for recording withdrawal time.
  EXECUTE format('GRANT UPDATE (revoked_at) ON public.patient_privacy_consents TO %I', runtime_user);
END
$provision$;
COMMIT;
