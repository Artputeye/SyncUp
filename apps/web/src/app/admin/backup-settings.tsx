"use client";

import { FormEvent, useEffect, useState } from "react";

type BackupStatus = {
  configured: boolean;
  path: string | null;
  updatedAt: string | null;
  status: "NOT_CONFIGURED" | "READY" | "UNAVAILABLE";
  message: string;
};

export default function BackupSettingsPanel() {
  const [path, setPath] = useState("");
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const draft = window.localStorage.getItem("syncup_backup_path") ?? "";
    if (draft) setPath(draft);
    fetch("/api/platform-admin/backup-location", { credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("ไม่สามารถอ่านการตั้งค่า Backup ได้");
        const current = await response.json() as BackupStatus;
        if (!draft) {
          setStatus(current);
          if (current.path) setPath(current.path);
          return;
        }
        setBusy(true);
        const savedResponse = await fetch("/api/platform-admin/backup-location", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: draft })
        });
        const saved = await savedResponse.json().catch(() => ({})) as BackupStatus & { message?: string };
        if (!savedResponse.ok) throw new Error(saved.message || "บันทึก Path ไม่สำเร็จ");
        setStatus(saved);
        window.localStorage.removeItem("syncup_backup_path");
        setNotice(saved.status === "READY" ? "บันทึก Path จากหน้าแรกแล้ว และ Server เข้าถึงโฟลเดอร์ได้" : "บันทึก Path จากหน้าแรกแล้ว แต่ Server ยังเข้าถึงโฟลเดอร์ไม่ได้");
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : "โหลดการตั้งค่าไม่สำเร็จ"))
      .finally(() => setBusy(false));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform-admin/backup-location", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: path.trim() })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "บันทึก Path ไม่สำเร็จ");
      setStatus(data as BackupStatus);
      window.localStorage.removeItem("syncup_backup_path");
      setNotice(data.status === "READY" ? "บันทึกแล้ว และ Server เข้าถึงโฟลเดอร์ได้" : "บันทึก Path แล้ว แต่ Server ยังเข้าถึงโฟลเดอร์ไม่ได้");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึก Path ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel">
    <div className="panel-heading"><div><h2>ตำแหน่งจัดเก็บ Backup</h2><p>กำหนด Shared Folder บน Synology NAS ให้ Server ใช้เป็นปลายทางสำรองข้อมูล</p></div></div>
    <form onSubmit={save}>
      <div className="field">
        <label htmlFor="backup-location">Backup Path</label>
        <input id="backup-location" required maxLength={1024} value={path} onChange={event => setPath(event.target.value)} placeholder="\\\\192.168.1.10\\SyncUp" />
      </div>
      <p className="subtle" style={{ fontSize: 12, lineHeight: 1.8 }}>ตัวอย่าง: <code>\\\\192.168.1.10\\SyncUp</code> · ต้องสร้าง Shared Folder ใน Synology และให้บัญชี Windows ที่ใช้รัน API มีสิทธิ์เขียน</p>
      <div className="modal-actions"><button className="primary" disabled={busy || !path.trim()}>{busy ? "กำลังบันทึก..." : "บันทึกและตรวจสอบ Path"}</button></div>
    </form>
    {status && <div className={status.status === "READY" ? "success" : status.status === "UNAVAILABLE" ? "error" : "subtle"} role="status" style={{ marginTop: 16 }}>{status.message}{status.updatedAt ? ` · แก้ไข ${new Date(status.updatedAt).toLocaleString("th-TH")}` : ""}</div>}
    {error && <div className="error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    {notice && <div className="success" role="status" style={{ marginTop: 12 }}>{notice}</div>}
    <p className="subtle" style={{ fontSize: 11, marginTop: 18 }}>ขณะนี้ระบบบันทึกปลายทางและตรวจสอบสิทธิ์เข้าถึงเท่านั้น ยังไม่ได้สั่ง pg_dump หรือกำหนดตารางเวลา Backup อัตโนมัติ</p>
  </section>;
}
