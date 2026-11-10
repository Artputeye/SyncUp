"use strict";

const { Client } = require("pg");
const fs = require("node:fs");
const { createHash } = require("node:crypto");

const workspaceId = "c0130bf3-c1c0-4dfa-a915-7ca5155cacfd";
const workspaceSlug = "pos-local";
const databaseName = "syncup_ws_c0130bf3c1c0";
const runtimeRole = "syncup_rt_c0130bf3c1c0";
const migration = "20261107000100_tenant_inventory_stocktake";
const backupPath = "D:\\Back up\\SyncUp\\Backups\\pos-local_pre_stocktake_20261110044830.dump";
const backupSha = "b78890368bf2014664c38bb1e817d84f6716f0f8768d37b56010db6ebbe0ac40";

async function main() {
  const controlUrl = new URL(process.env.CONTROL_DATABASE_URL || "");
  const adminUrl = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL || "");
  for (const u of [controlUrl, adminUrl]) {
    if (!["localhost", "127.0.0.1", "::1"].includes(u.hostname)) throw new Error("Safety stop: non-local database URL.");
  }
  if (controlUrl.pathname !== "/syncup_control") throw new Error("Unexpected Control DB.");

  const control = new Client({ connectionString: controlUrl.toString(), options: "-c default_transaction_read_only=on" });
  await control.connect();
  let tenant;
  try {
    await control.query("BEGIN READ ONLY");
    const reg = await control.query(
      "SELECT w.id,w.slug,w.status,d.database_name,d.username runtime_role " +
      "FROM public.workspaces w JOIN public.workspace_databases d ON d.workspace_id=w.id WHERE w.id=$1",
      [workspaceId],
    );
    if (reg.rowCount !== 1 || reg.rows[0].slug !== workspaceSlug ||
      reg.rows[0].status !== "ACTIVE" || reg.rows[0].database_name !== databaseName ||
      reg.rows[0].runtime_role !== runtimeRole) throw new Error("Control workspace registration mismatch.");
    await control.query("COMMIT");

    adminUrl.pathname = "/" + databaseName;
    tenant = new Client({
      connectionString: adminUrl.toString(),
      options: "-c default_transaction_read_only=on",
      application_name: "syncup-pos-local-stocktake-post-migration-verification",
    });
    await tenant.connect();
    await tenant.query("BEGIN READ ONLY");
    const identity = await tenant.query(
      "SELECT current_database() db,current_user role,current_setting('transaction_read_only') read_only",
    );
    if (identity.rows[0].db !== databaseName || identity.rows[0].role !== "syncup_provisioner" ||
      identity.rows[0].read_only !== "on") throw new Error("Tenant read-only identity mismatch.");

    const schema = await tenant.query(
      "SELECT " +
      "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' " +
      "AND table_name IN ('stocktake_sessions','stocktake_lines')) tables_count," +
      "(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='stocktake_sessions') session_columns," +
      "(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='stocktake_lines') line_columns," +
      "(SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' AND t.typname='StockReferenceType') stock_reference_values," +
      "(SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' AND t.typname='StocktakeStatus') stocktake_status_values," +
      "(SELECT count(*)::int FROM pg_constraint WHERE conname=ANY(ARRAY[" +
      "'stocktake_sessions_pkey','stocktake_sessions_warehouse_id_fkey'," +
      "'stocktake_lines_pkey','stocktake_lines_session_id_fkey'," +
      "'stocktake_lines_variant_id_fkey','stocktake_lines_counted_quantity_check'," +
      "'stocktake_lines_unit_cost_check'])) constraints_count," +
      "(SELECT count(*)::int FROM pg_indexes WHERE schemaname='public' AND tablename IN ('stocktake_sessions','stocktake_lines')) indexes_count," +
      "(SELECT count(*)::int FROM public.stocktake_sessions) session_rows," +
      "(SELECT count(*)::int FROM public.stocktake_lines) line_rows," +
      "(SELECT count(*)::int FROM public.tenant_migrations WHERE version=$1) migration_ledger_rows," +
      "(SELECT count(*)::int FROM public.tenant_migrations) ledger_count," +
      "(SELECT array_agg(version ORDER BY version) FROM public.tenant_migrations) ledger_versions",
      [migration],
    );
    const s = schema.rows[0];
    if (s.tables_count !== 2 || s.session_columns !== 12 || s.line_columns !== 9 ||
      !s.stock_reference_values.includes("STOCKTAKE") ||
      s.stocktake_status_values.join(",") !== "DRAFT,IN_PROGRESS,FINALIZED,CANCELLED" ||
      s.constraints_count !== 7 || s.indexes_count !== 6 ||
      s.session_rows !== 0 || s.line_rows !== 0 ||
      s.migration_ledger_rows !== 1 || s.ledger_count !== 3) {
      throw new Error("Post-migration schema/ledger verification failed: " + JSON.stringify(s));
    }
    if (JSON.stringify(s.ledger_versions) !== JSON.stringify([
      "20261031000100_tenant_baseline",
      "202611030001_tenant_commerce",
      migration,
    ])) throw new Error("Unexpected tenant migration ledger lineage.");

    const grants = await tenant.query(
      "SELECT " +
      "has_database_privilege($1,current_database(),'CONNECT') can_connect," +
      "has_schema_privilege($1,'public','USAGE') schema_usage," +
      "has_table_privilege($1,'public.stocktake_sessions','SELECT') sessions_select," +
      "has_table_privilege($1,'public.stocktake_sessions','INSERT') sessions_insert," +
      "has_table_privilege($1,'public.stocktake_sessions','UPDATE') sessions_update," +
      "has_table_privilege($1,'public.stocktake_sessions','DELETE') sessions_delete," +
      "has_table_privilege($1,'public.stocktake_lines','SELECT') lines_select," +
      "has_table_privilege($1,'public.stocktake_lines','INSERT') lines_insert," +
      "has_table_privilege($1,'public.stocktake_lines','UPDATE') lines_update," +
      "has_table_privilege($1,'public.stocktake_lines','DELETE') lines_delete," +
      "has_table_privilege($1,'public.tenant_migrations','SELECT') ledger_select," +
      "has_table_privilege($1,'public.tenant_migrations','INSERT') ledger_insert",
      [runtimeRole],
    );
    const p = grants.rows[0];
    if (!p.can_connect || !p.schema_usage ||
      !Object.entries(p).filter(([k]) => !["can_connect","schema_usage","ledger_select","ledger_insert"].includes(k)).every(([,v])=>v===true) ||
      !p.ledger_select || p.ledger_insert) throw new Error("Runtime grants mismatch: " + JSON.stringify(p));

    const archiveHash = createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
    if (archiveHash !== backupSha) throw new Error("Pre-migration backup SHA-256 changed.");
    await tenant.query("COMMIT");
    console.log("POS_LOCAL_STOCKTAKE_POST_MIGRATION " + JSON.stringify({
      status: "PASS",
      workspace: reg.rows[0],
      tenantIdentity: identity.rows[0],
      schema: s,
      runtimeGrants: p,
      preMigrationBackup: { path: backupPath, sha256: archiveHash, unchanged: true },
      verificationReadOnly: true,
    }, null, 2));
  } catch (error) {
    await control.query("ROLLBACK").catch(() => undefined);
    if (tenant) await tenant.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (tenant) await tenant.end();
    await control.end();
  }
}
main().catch(error => {
  console.error("POS_LOCAL_STOCKTAKE_POST_MIGRATION_FAILED " + (error.stack || error.message));
  process.exitCode = 1;
});
