-- REVIEWED CANDIDATE ONLY. Not an active Prisma migration. Do not apply to pos-local without separate approval.
-- Target workspace: pos-local / c0130bf3-c1c0-4dfa-a915-7ca5155cacfd.
-- Adds missing Admin catalog grants and provisions the Cashier system role.
-- Does not change memberships, existing Manager grants, Inventory Staff, or legacy inventory.manage.

BEGIN;

DO $$
DECLARE
  target_workspace CONSTANT UUID := 'c0130bf3-c1c0-4dfa-a915-7ca5155cacfd';
  admin_keys TEXT[] := ARRAY[
    'workspace.view','workspace.manage','members.view','members.manage','roles.manage','modules.manage',
    'commerce.store.view','commerce.store.manage','commerce.warehouse.view','commerce.warehouse.manage',
    'commerce.product.view','commerce.product.create','commerce.product.update','commerce.product.archive',
    'commerce.pricing.manage','commerce.inventory.view','commerce.inventory.reservation.manage',
    'commerce.inventory.receive','commerce.inventory.issue','commerce.inventory.movement.reverse',
    'commerce.inventory.adjust','commerce.inventory.transfer','commerce.inventory.stocktake',
    'commerce.sales.view','commerce.sales.create','commerce.sales.discount','commerce.sales.void',
    'commerce.orders.view','commerce.orders.manage','commerce.reports.view'
  ];
  manager_keys TEXT[] := ARRAY[
    'workspace.view','members.view','modules.manage','commerce.store.view','commerce.store.manage',
    'commerce.warehouse.view','commerce.warehouse.manage','commerce.product.view','commerce.product.create',
    'commerce.product.update','commerce.product.archive','commerce.pricing.manage','commerce.inventory.view',
    'commerce.inventory.reservation.manage','commerce.inventory.receive','commerce.inventory.issue',
    'commerce.inventory.movement.reverse','commerce.inventory.adjust','commerce.inventory.transfer',
    'commerce.inventory.stocktake','commerce.sales.view','commerce.sales.create','commerce.sales.discount',
    'commerce.sales.void','commerce.orders.view','commerce.orders.manage','commerce.reports.view'
  ];
  cashier_keys TEXT[] := ARRAY[
    'workspace.view','commerce.store.view','commerce.product.view','commerce.inventory.view',
    'commerce.sales.view','commerce.sales.create','commerce.orders.view'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id=target_workspace AND slug='pos-local' AND status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Safety stop: expected active pos-local workspace identity not found';
  END IF;

  IF (SELECT count(*) FROM public.roles
      WHERE workspace_id=target_workspace AND key='admin' AND is_system) <> 1
     OR (SELECT count(*) FROM public.roles
         WHERE workspace_id=target_workspace AND key='manager' AND is_system) <> 1 THEN
    RAISE EXCEPTION 'Safety stop: expected exactly one system Admin and Manager role';
  END IF;

  IF (SELECT count(*) FROM public.permissions WHERE key = ANY(admin_keys)) <> 30 THEN
    RAISE EXCEPTION 'Safety stop: current 30-key permission catalog is incomplete';
  END IF;

  IF (SELECT array_agg(p.key::text ORDER BY p.key::text)
      FROM public.role_permissions rp
      JOIN public.roles r ON r.id=rp.role_id
      JOIN public.permissions p ON p.id=rp.permission_id
      WHERE r.workspace_id=target_workspace AND r.key='manager')
     IS DISTINCT FROM
     (SELECT array_agg(k ORDER BY k) FROM unnest(manager_keys) AS k) THEN
    RAISE EXCEPTION 'Safety stop: Manager grant matrix differs from reviewed 27-key catalog';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.roles
    WHERE workspace_id=target_workspace AND key='cashier' AND NOT is_system
  ) THEN
    RAISE EXCEPTION 'Safety stop: existing Cashier role is not a system role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id=rp.role_id
    JOIN public.permissions p ON p.id=rp.permission_id
    WHERE r.workspace_id=target_workspace AND r.key='cashier'
      AND NOT (p.key = ANY(cashier_keys))
  ) THEN
    RAISE EXCEPTION 'Safety stop: existing Cashier role contains grants outside its reviewed 7-key matrix';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE key='commerce.inventory.manage') THEN
    RAISE EXCEPTION 'Safety stop: legacy commerce.inventory.manage permission is missing';
  END IF;
END $$;

-- Create Cashier only when absent. No membership is assigned.
INSERT INTO public.roles (id,workspace_id,key,name,is_system)
VALUES (
  gen_random_uuid(),
  'c0130bf3-c1c0-4dfa-a915-7ca5155cacfd',
  'cashier',
  'พนักงานขาย',
  TRUE
)
ON CONFLICT (workspace_id,key) DO NOTHING;

-- Add all catalog permissions to Admin; preserve any legacy grant outside the catalog.
INSERT INTO public.role_permissions (role_id,permission_id)
SELECT r.id,p.id
FROM public.roles r
JOIN public.permissions p ON p.key = ANY(ARRAY[
  'workspace.view','workspace.manage','members.view','members.manage','roles.manage','modules.manage',
  'commerce.store.view','commerce.store.manage','commerce.warehouse.view','commerce.warehouse.manage',
  'commerce.product.view','commerce.product.create','commerce.product.update','commerce.product.archive',
  'commerce.pricing.manage','commerce.inventory.view','commerce.inventory.reservation.manage',
  'commerce.inventory.receive','commerce.inventory.issue','commerce.inventory.movement.reverse',
  'commerce.inventory.adjust','commerce.inventory.transfer','commerce.inventory.stocktake',
  'commerce.sales.view','commerce.sales.create','commerce.sales.discount','commerce.sales.void',
  'commerce.orders.view','commerce.orders.manage','commerce.reports.view'
])
WHERE r.workspace_id='c0130bf3-c1c0-4dfa-a915-7ca5155cacfd'
  AND r.key='admin' AND r.is_system
ON CONFLICT (role_id,permission_id) DO NOTHING;

-- Cashier receives only its seven default read/sales grants.
INSERT INTO public.role_permissions (role_id,permission_id)
SELECT r.id,p.id
FROM public.roles r
JOIN public.permissions p ON p.key = ANY(ARRAY[
  'workspace.view','commerce.store.view','commerce.product.view','commerce.inventory.view',
  'commerce.sales.view','commerce.sales.create','commerce.orders.view'
])
WHERE r.workspace_id='c0130bf3-c1c0-4dfa-a915-7ca5155cacfd'
  AND r.key='cashier' AND r.is_system
ON CONFLICT (role_id,permission_id) DO NOTHING;

DO $$
DECLARE
  target_workspace CONSTANT UUID := 'c0130bf3-c1c0-4dfa-a915-7ca5155cacfd';
  admin_keys TEXT[] := ARRAY[
    'workspace.view','workspace.manage','members.view','members.manage','roles.manage','modules.manage',
    'commerce.store.view','commerce.store.manage','commerce.warehouse.view','commerce.warehouse.manage',
    'commerce.product.view','commerce.product.create','commerce.product.update','commerce.product.archive',
    'commerce.pricing.manage','commerce.inventory.view','commerce.inventory.reservation.manage',
    'commerce.inventory.receive','commerce.inventory.issue','commerce.inventory.movement.reverse',
    'commerce.inventory.adjust','commerce.inventory.transfer','commerce.inventory.stocktake',
    'commerce.sales.view','commerce.sales.create','commerce.sales.discount','commerce.sales.void',
    'commerce.orders.view','commerce.orders.manage','commerce.reports.view'
  ];
  manager_keys TEXT[] := ARRAY[
    'workspace.view','members.view','modules.manage','commerce.store.view','commerce.store.manage',
    'commerce.warehouse.view','commerce.warehouse.manage','commerce.product.view','commerce.product.create',
    'commerce.product.update','commerce.product.archive','commerce.pricing.manage','commerce.inventory.view',
    'commerce.inventory.reservation.manage','commerce.inventory.receive','commerce.inventory.issue',
    'commerce.inventory.movement.reverse','commerce.inventory.adjust','commerce.inventory.transfer',
    'commerce.inventory.stocktake','commerce.sales.view','commerce.sales.create','commerce.sales.discount',
    'commerce.sales.void','commerce.orders.view','commerce.orders.manage','commerce.reports.view'
  ];
  cashier_keys TEXT[] := ARRAY[
    'workspace.view','commerce.store.view','commerce.product.view','commerce.inventory.view',
    'commerce.sales.view','commerce.sales.create','commerce.orders.view'
  ];
BEGIN
  IF (SELECT array_agg(p.key::text ORDER BY p.key::text)
      FROM public.role_permissions rp
      JOIN public.roles r ON r.id=rp.role_id
      JOIN public.permissions p ON p.id=rp.permission_id
      WHERE r.workspace_id=target_workspace AND r.key='admin' AND p.key=ANY(admin_keys))
     IS DISTINCT FROM
     (SELECT array_agg(k ORDER BY k) FROM unnest(admin_keys) AS k) THEN
    RAISE EXCEPTION 'Admin verification failed: catalog grant set is not exactly 30 keys';
  END IF;

  IF (SELECT array_agg(p.key::text ORDER BY p.key::text)
      FROM public.role_permissions rp
      JOIN public.roles r ON r.id=rp.role_id
      JOIN public.permissions p ON p.id=rp.permission_id
      WHERE r.workspace_id=target_workspace AND r.key='manager')
     IS DISTINCT FROM
     (SELECT array_agg(k ORDER BY k) FROM unnest(manager_keys) AS k) THEN
    RAISE EXCEPTION 'Manager verification failed: existing 27-key matrix changed';
  END IF;

  IF (SELECT array_agg(p.key::text ORDER BY p.key::text)
      FROM public.role_permissions rp
      JOIN public.roles r ON r.id=rp.role_id
      JOIN public.permissions p ON p.id=rp.permission_id
      WHERE r.workspace_id=target_workspace AND r.key='cashier')
     IS DISTINCT FROM
     (SELECT array_agg(k ORDER BY k) FROM unnest(cashier_keys) AS k) THEN
    RAISE EXCEPTION 'Cashier verification failed: expected exactly 7 grants';
  END IF;
END $$;

COMMIT;
