-- REVIEW CANDIDATE ONLY — lifecycle invariants not expressible as row-local CHECKs.
-- Run after Commerce tables and the partial unique default indexes exist.
-- The deferred checks evaluate the final transaction state, allowing Store+Branch+Warehouse
-- and Branch+default-Warehouse to be created atomically.

CREATE OR REPLACE FUNCTION public.assert_store_branch_warehouse_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.stores s
    WHERE s.status = 'ACTIVE'
      AND (
        (SELECT count(*) FROM public.branches b
         WHERE b.store_id = s.id AND b.status = 'ACTIVE' AND b.is_default) <> 1
        OR EXISTS (
          SELECT 1 FROM public.branches b
          WHERE b.store_id = s.id AND b.status = 'ACTIVE'
            AND (
              (SELECT count(*) FROM public.warehouses w
               WHERE w.branch_id = b.id AND w.status = 'ACTIVE') < 1
              OR
              (SELECT count(*) FROM public.warehouses w
               WHERE w.branch_id = b.id AND w.status = 'ACTIVE' AND w.is_default) <> 1
            )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Active Store must have exactly one active default Branch; each active Branch must have at least one active Warehouse and exactly one active default Warehouse'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS stores_branch_warehouse_lifecycle_ct ON public.stores;
CREATE CONSTRAINT TRIGGER stores_branch_warehouse_lifecycle_ct
AFTER INSERT OR UPDATE ON public.stores
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_store_branch_warehouse_lifecycle();

DROP TRIGGER IF EXISTS branches_branch_warehouse_lifecycle_ct ON public.branches;
CREATE CONSTRAINT TRIGGER branches_branch_warehouse_lifecycle_ct
AFTER INSERT OR UPDATE OR DELETE ON public.branches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_store_branch_warehouse_lifecycle();

DROP TRIGGER IF EXISTS warehouses_branch_warehouse_lifecycle_ct ON public.warehouses;
CREATE CONSTRAINT TRIGGER warehouses_branch_warehouse_lifecycle_ct
AFTER INSERT OR UPDATE OR DELETE ON public.warehouses
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_store_branch_warehouse_lifecycle();

-- Audit is written in the same application transaction as each lifecycle mutation.
-- Partial unique indexes remain the immediate at-most-one-default concurrency guard.
