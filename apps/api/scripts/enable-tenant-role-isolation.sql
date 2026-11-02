-- Run once as a PostgreSQL superuser on the local SyncUp cluster.
-- The provisioner needs CREATEROLE to create one LOGIN role per workspace.
ALTER ROLE syncup_provisioner CREATEROLE;

-- Prevent tenant runtime roles from connecting to shared/system databases via PUBLIC.
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO syncup_provisioner;
REVOKE ALL ON DATABASE template1 FROM PUBLIC;
REVOKE ALL ON DATABASE syncup_control FROM PUBLIC;
GRANT CONNECT ON DATABASE syncup_control TO syncup;
