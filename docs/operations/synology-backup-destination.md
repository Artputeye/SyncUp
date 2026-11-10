# Synology NAS backup destination

## Configure the Shared Folder

1. In DSM, open **Control Panel → Shared Folder** and create a folder such as `SyncUp`.
2. Create a dedicated DSM user for the application, for example `syncup-backup`.
3. Grant that user **Read/Write** permission to the `SyncUp` shared folder.
4. Open **Control Panel → File Services → SMB** and enable SMB file service.
5. From the Windows machine running the SyncUp API, connect to the share once using that dedicated account. Store the credential in Windows Credential Manager; do not put the NAS password in SyncUp or source control.
6. Enter the UNC path in the SyncUp homepage Backup dialog, for example `\\\\192.168.1.10\\SyncUp`.

## Where the setting is stored

- The path is saved by the API in `SYNCUP_BACKUP_CONFIG_FILE`, or in `backup-location.json` under `SYNCUP_DATA_DIR`.
- If neither variable is set, the API uses its working directory's `data/backup-location.json` folder.
- Keep this configuration directory on persistent storage and restrict access to the API service account.
- The endpoint is protected by the Platform Admin session and stores only the path, never NAS credentials.

## Connection status

After saving, SyncUp checks that the API process can see the directory and has write access. If it reports **UNAVAILABLE**, verify:
- The NAS IP/name and shared-folder name are correct.
- SMB is enabled and the Windows host can open the UNC path.
- The Windows account running the API has Read/Write permission and has the NAS credential saved.

For Docker/Linux deployment, mount the SMB share on the host and pass the mounted directory path into the API container; a Windows UNC path is not directly usable inside a Linux container.

## Current scope

This step stores the destination and checks directory access. It does **not** yet run `pg_dump`, create backup archives, schedule daily/weekly/monthly jobs, copy files off-host, or perform restore tests. Those operations must be implemented and verified separately before the approved retention policy is active.
