-- New Control DB tables must inherit the existing application runtime role's
-- access pattern. Only non-superuser roles already authorized to read, insert,
-- and update module_installations receive access to module lifecycle audit rows.
DO $$
DECLARE
  application_role RECORD;
BEGIN
  FOR application_role IN
    SELECT rolname
    FROM pg_roles
    WHERE NOT rolsuper
      AND has_table_privilege(rolname, 'public.module_installations', 'SELECT')
      AND has_table_privilege(rolname, 'public.module_installations', 'INSERT')
      AND has_table_privilege(rolname, 'public.module_installations', 'UPDATE')
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT ON TABLE public.platform_audit_logs TO %I',
      application_role.rolname
    );
  END LOOP;
END $$;
