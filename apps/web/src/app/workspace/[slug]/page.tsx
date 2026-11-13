"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Role = { id: string; key: string; name: string; isSystem: boolean; permissions: { key: string; description: string | null }[] };
type Member = { id: string; isOwner: boolean; user: { id: string; email: string; displayName: string; status: string }; roles: { key: string; name: string }[] };
type Workspace = { id: string; slug: string; name: string; type?: "POS" | "ONLINE" | null; status: string; isOwner: boolean };
const roleLabels: Record<string,string> = { admin:"ผู้ดูแลระบบ", member:"สมาชิก", viewer:"ผู้ดูอย่างเดียว" };

export default function WorkspaceHomePage() {
  const { slug } = useParams<{slug:string}>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace|null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [editingRole, setEditingRole] = useState("member");
  const [permissions, setPermissions] = useState<string[]>([]);

  async function api(path:string, init:RequestInit={}) {
    const response = await fetch(path, { ...init, credentials:"same-origin", cache:"no-store", headers:{ ...(init.body?{"Content-Type":"application/json"}:{}), ...init.headers } });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(Array.isArray(data.message)?data.message.join(", "):data.message||"เกิดข้อผิดพลาด");
    return data;
  }
  async function load() {
    const me = await fetch("/api/auth/me",{cache:"no-store"});
    if (!me.ok) { router.replace("/"); return; }
    const meData = await me.json(); setCurrentUserId(meData.user?.userId ?? meData.user?.id ?? "");
    const list = await api("/api/workspaces") as Workspace[];
    const current = list.find(item=>item.slug===slug);
    if (!current) { router.replace("/workspaces"); return; }
    if (current.status === "ACTIVE" && current.type === "POS") { router.replace("/workspace/" + current.slug + "/pos"); return; }
    if (current.status === "ACTIVE" && current.type === "ONLINE") { router.replace("/workspace/" + current.slug + "/online"); return; }
    setWorkspace(current);
    const [memberRows, roleRows] = await Promise.all([
      api(`/api/workspaces/${current.id}/members`) as Promise<Member[]>,
      api(`/api/workspaces/${current.id}/roles`) as Promise<Role[]>
    ]);
    setMembers(memberRows); setRoles(roleRows);
    const initial = roleRows.find(role=>role.key===editingRole) ?? roleRows.find(role=>role.key==="member");
    if (initial && permissions.length===0) setPermissions(initial.permissions.map(p=>p.key));
  }
  useEffect(()=>{ let active=true; load().catch(e=>setError(e.message)).finally(()=>{if(active)setLoading(false)}); return ()=>{active=false}; },[slug]);
  const allPermissions = useMemo(()=>Array.from(new Map(roles.flatMap(role=>role.permissions).map(permission=>[permission.key,permission])).values()),[roles]);
  const canManage = !!workspace && (workspace.isOwner || members.some(member=>member.user.id===currentUserId && member.roles.some(role=>role.key==="admin")));
  const currentRole = roles.find(role=>role.key===editingRole);
  async function addMember(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!workspace)return; setBusy(true);setError("");setNotice("");
    try { await api(`/api/workspaces/${workspace.id}/members`,{method:"POST",body:JSON.stringify({email,roleKey:newRole})});setEmail("");await load();setNotice("เพิ่มสมาชิกเรียบร้อยแล้ว"); }
    catch(e){setError(e instanceof Error?e.message:"เพิ่มสมาชิกไม่สำเร็จ")} finally{setBusy(false)}
  }
  async function changeRole(member:Member, roleKey:string) {
    if(!workspace)return;setBusy(true);setError("");
    try{await api(`/api/workspaces/${workspace.id}/members/${member.id}`,{method:"PATCH",body:JSON.stringify({roleKey})});await load();setNotice("อัปเดตบทบาทแล้ว")}
    catch(e){setError(e instanceof Error?e.message:"เปลี่ยนบทบาทไม่สำเร็จ")}finally{setBusy(false)}
  }
  async function removeMember(member:Member) {
    if(!workspace||!window.confirm(`นำ ${member.user.email} ออกจาก Workspace ใช่หรือไม่?`))return;
    setBusy(true);setError("");
    try{await api(`/api/workspaces/${workspace.id}/members/${member.id}`,{method:"DELETE"});await load();setNotice("นำสมาชิกออกแล้ว")}
    catch(e){setError(e instanceof Error?e.message:"นำสมาชิกออกไม่สำเร็จ")}finally{setBusy(false)}
  }
  async function savePermissions() {
    if(!workspace)return;setBusy(true);setError("");
    try{await api(`/api/workspaces/${workspace.id}/roles/${editingRole}/permissions`,{method:"PUT",body:JSON.stringify({permissionKeys:permissions})});await load();setNotice("บันทึกสิทธิ์ของบทบาทแล้ว")}
    catch(e){setError(e instanceof Error?e.message:"บันทึกสิทธิ์ไม่สำเร็จ")}finally{setBusy(false)}
  }
  async function logout(){await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin"});router.replace("/");router.refresh()}

  return <main className="workspace-shell">
    <header className="topbar"><button className="brand brand-button" onClick={()=>router.push("/workspaces")}><span className="brand-mark">S</span> SyncUp</button><div className="user-menu"><button className="ghost" onClick={()=>router.push("/workspaces")}>Workspace ทั้งหมด</button><button className="ghost" onClick={logout}>ออกจากระบบ</button></div></header>
    <section className="dashboard-content">
      <div className="dashboard-head"><div><div className="eyebrow">WORKSPACE DASHBOARD</div><h1>{workspace?.name??"กำลังโหลด..."}</h1><p className="subtle">{workspace?"/"+workspace.slug:"จัดการทีมและสิทธิ์การเข้าถึงในพื้นที่ทำงานนี้"}</p></div><span className="status">{workspace?.status??"LOADING"}</span></div>
      {error&&<div className="error" role="alert">{error}</div>}{notice&&<div className="success" role="status">{notice}</div>}
      <div className="dashboard-stats"><div className="stat-card"><span>สมาชิกทั้งหมด</span><strong>{members.length}</strong></div><div className="stat-card"><span>บทบาท</span><strong>{roles.length}</strong></div><div className="stat-card"><span>สถานะ Workspace</span><strong className="stat-status">{workspace?.status==="ACTIVE"?"พร้อมใช้งาน":workspace?.status??"—"}</strong></div></div>
      <section className="panel"><div className="panel-heading"><div><h2>สมาชิกในทีม</h2><p>เพิ่มผู้ใช้ที่มีบัญชี SyncUp แล้ว และกำหนดบทบาทให้แต่ละคน</p></div><span className="count-pill">{members.length} คน</span></div>
        <form className="invite-form" onSubmit={addMember}><div className="field"><label htmlFor="member-email">อีเมลสมาชิก</label><input id="member-email" type="email" required placeholder="name@company.com" value={email} onChange={e=>setEmail(e.target.value)}/></div><div className="field"><label htmlFor="member-role">บทบาทเริ่มต้น</label><select id="member-role" value={newRole} onChange={e=>setNewRole(e.target.value)}>{roles.filter(role=>role.key!=="admin"||workspace?.isOwner).map(role=><option key={role.key} value={role.key}>{roleLabels[role.key]??role.name}</option>)}</select></div><button className="primary invite-button" disabled={busy||loading}>＋ เพิ่มสมาชิก</button></form>
        {loading?<p className="subtle">กำลังโหลดสมาชิก...</p>:<div className="member-list">{members.map(member=><div className="member-row" key={member.id}><div className="member-avatar">{(member.user.displayName||member.user.email).slice(0,1).toUpperCase()}</div><div className="member-identity"><strong>{member.user.displayName||member.user.email}</strong><span>{member.user.email}</span></div><div className="member-role">{member.isOwner?<span className="owner-pill">เจ้าของ</span>:<select aria-label={`บทบาทของ ${member.user.email}`} value={member.roles[0]?.key??"member"} disabled={busy||!canManage} onChange={e=>changeRole(member,e.target.value)}>{roles.filter(role=>role.key!=="admin"||workspace?.isOwner).map(role=><option key={role.key} value={role.key}>{roleLabels[role.key]??role.name}</option>)}</select>}</div>{!member.isOwner&&canManage&&<button className="remove-button" disabled={busy} onClick={()=>removeMember(member)}>นำออก</button>}</div>)}</div>}
      </section>
      {workspace?.isOwner&&<section className="panel"><div className="panel-heading"><div><h2>การกำหนดสิทธิ์ตามบทบาท</h2><p>เลือกบทบาทแล้วเปิดหรือปิดสิทธิ์ที่ต้องการ บทบาทผู้ดูแลระบบมีสิทธิ์เต็มและไม่สามารถแก้ไขได้</p></div></div><div className="permission-editor"><div className="field role-picker"><label htmlFor="edit-role">เลือกบทบาท</label><select id="edit-role" value={editingRole} onChange={e=>{setEditingRole(e.target.value);setPermissions(roles.find(r=>r.key===e.target.value)?.permissions.map(p=>p.key)??[])}}>{roles.filter(role=>role.key!=="admin").map(role=><option key={role.key} value={role.key}>{roleLabels[role.key]??role.name}</option>)}</select></div><div className="permission-list">{allPermissions.map(permission=><label className="permission-item" key={permission.key}><input type="checkbox" checked={permissions.includes(permission.key)} onChange={e=>setPermissions(current=>e.target.checked?[...current,permission.key]:current.filter(key=>key!==permission.key))}/><span><strong>{permission.description??permission.key}</strong><small>{permission.key}</small></span></label>)}</div><div className="permission-footer"><span className="subtle">{currentRole?.name??"บทบาท"} · {permissions.length} สิทธิ์</span><button className="primary" disabled={busy} onClick={savePermissions}>บันทึกสิทธิ์</button></div></div></section>}
      <div className="dashboard-foot">การเข้าถึงข้อมูล Workspace ถูกตรวจสอบจากฝั่งเซิร์ฟเวอร์ทุกคำขอ</div>
    </section>
  </main>;
}
