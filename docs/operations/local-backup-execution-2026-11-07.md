# SyncUp Local Backup Execution — 2026-11-07

Status: **Local Control + Tenant backups created; isolated restore verification PASS. Local storage is temporary and not security-protected by BitLocker. Off-host backup gate remains OPEN.**

## Authorization and scope

- Operator explicitly authorized temporary local backup storage under `D:\\Back up\\SyncUp`.
- Network was unavailable; no NAS, SMB, or other network destination was contacted.
- Destination used: `D:\\Back up\\SyncUp\\Backups\\`.
- Existing archives were not overwritten.
- Both source databases were connected using read-only transactions for verification; `pg_dump` was used for the archives.
- No source DDL/DML, migration, module install/enable/disable, deployment, commit, or push was performed.
- A temporary helper script was removed after execution; no permanent project code change was intended.

## BitLocker status supplied by operator

`manage-bde -status D:` returned:

- Conversion Status: `Used Space Only Encrypted`
- Percentage Encrypted: `100.0%`
- Encryption Method: `XTS-AES 128`
- Protection Status: `Protection Off`
- Lock Status: `Unlocked`
- Key Protectors: `None Found`

**Security disposition:** BitLocker has encrypted the used space, but protection is OFF and no key protector exists. Therefore the volume is not effectively protected against unauthorized offline access. The PostgreSQL custom-format dumps are not independently encrypted. Treat both files as sensitive local-only temporary backups; do not label them encrypted backups.

## Fresh Control DB archive

- Source: `syncup_control`; source connection role: `syncup`.
- Archive: `D:\\Back up\\SyncUp\\Backups\\syncup_control_20261107022928_d9d27b00.dump`
- Size: 41,227 bytes.
- SHA-256: `f3f5d5ef33a11153a71b8fd640a5b8ec96a70b0dad15e23f6d81cad601cc3992`
- `pg_restore --list`: PASS.
- Isolated restore database: `syncup_recovery_control_20261107022928_d9d27b00`.
- Restore verification: 12 tables, 317 rows, 7 migration ledger entries.
- Schema objects, every table data checksum, migration ledger, server version, and recovery DB identity all matched.
- Runtime role `syncup` cannot connect to the recovery database.
- Recovery database default transaction mode is read-only; recovery database retained locally.

## Fresh Tenant DB archive

- Workspace: `pos-local`; source: `syncup_ws_c0130bf3c1c0`; source connection role: `syncup_provisioner`.
- Archive: `D:\\Back up\\SyncUp\\Backups\\pos-local_20261107022352_b25ca603.dump`
- Size: 125,633 bytes.
- SHA-256: `01be3ffae783f2c69bcd764c1cc670018675b96c6dd0ad27e0232e644eb9e53c`
- `pg_restore --list`: PASS.
- Isolated restore database: `syncup_recovery_pos_local_20261107022352_b25ca603`.
- Restore verification: 37 tables, 19 rows; Baseline and Commerce migration ledger entries matched.
- Schema objects and every table data checksum matched.
- Tenant runtime role cannot connect to the recovery database.
- Recovery database default transaction mode is read-only; recovery database retained locally.

## Final disposition

| Check | Result |
|---|---|
| Fresh Control custom-format archive | PASS |
| Fresh Tenant custom-format archive | PASS |
| Control isolated restore and schema/data/ledger checks | PASS |
| Tenant isolated restore and schema/data/ledger checks | PASS |
| Existing archives overwritten | NO |
| BitLocker protection | NOT ACTIVE — protection off, no key protectors |
| Independently encrypted backup files | NO |
| Encrypted off-host backup | OPEN — network unavailable |
| Production migrations or lifecycle changes | NONE |
| Deployment / commit / push | NONE |

The recovery databases are restore-test targets on the same local PostgreSQL instance, not off-host backups. Keep this temporary set access-restricted and arrange BitLocker protection/key recovery and an encrypted off-host copy when network access is restored.
