"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type User = { id: string; email: string; displayName: string; status: "ACTIVE"|"DISABLED"; isPlatformAdmin: boolean; createdAt: string; _count: { memberships: number } };
type Workspace = { id: string; slug: string; name: string; status: string; createdAt: string; memberCount: number; database: { provider?: string; databaseName?: string; schemaVersion?: string|null; status: "CONNECTED"|"DISCONNECTED"|"NOT_CONFIGURED" } };
type Member = { id: string; isOwner: boolean; user: { id: string; email: string; displayName: string; status: string }; roles: { key: string; name: string }[] };
type Role = { id: string; key: string; name: string; isSystem: boolean; permissions: { key: string; description: string|null }[] };

export default function PlatformAdminPage() {
  const router = useRouter();
  const [tab,setTab] = useState<"overview"|"users"|"workspaces">("overview");
  const [overview,setOverview] = useState<Record<string,number>>({});
  const [users,setUsers] = useState<User[]>([]);
  const [workspaces,setWorkspaces] = useState<Workspace[]>([]);
  const [search,setSearch] = useState("");
  const [selected,setSelected] = useState<Workspace|null>(null);
  const [members,setMembers] = useState<Member[]>([]);
  const [roles,setRoles] = useState<Role[]>([]);
  const [permissions,setPermissions] = useState<string[]>([]);
  const [editingRole,setEditingRole] = useState("");
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");

  async function api(path:string, init:RequestInit={}) {
    const response = await fetch(path,{...init,credentials:"same-origin",cache:"no-store",headers:{...(init.body?{"Content-Type":"application/json"}:{}),...init.headers}});
    const data = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(Array.isArray(data.message)?data.message.join(", "):data.message||"เกิดข้อผิดพลาด");
    return data;
  }
  async function loadOverview(){setOverview(await api("/api/platform-admin/overview"));}
  async function loadUsers(){setUsers(await api("/api/platform-admin/users"+(search.trim()?"?q="+encodeURIComponent(search.trim()):"")));}
  async function loadWorkspaces(){setWorkspaces(await api("/api/platform-admin/workspaces"));}
  async function loadWorkspaceDetails(workspace:Workspace){
    setSelected(workspace);
    const [memberRows,roleRows]=await Promise.all([
      api(`/api/platform-admin/workspaces/${workspace.id}/members`),
      api(`/api/platform-admin/workspaces/${workspace.id}/roles`)
    ]);
    setMembers(memberRows);setRoles(roleRows);
    const initial=roleRows.find((role:Role)=>role.key==="member")??roleRows[0];
    setEditingRole(initial?.key??"");setPermissions(initial?.permissions.map((p:{key:string})=>p.key)??[]);
  }
  async function load(){
    const me=await fetch("/api/auth/me",{credentials:"same-origin",cache:"no-store"});
    if(!me.ok){router.replace("/");return;}
    const identity=await me.json();
    if(!identity.user?.isPlatformAdmin){router.replace("/workspaces");return;}
    await Promise.all([loadOverview(),loadUsers(),loadWorkspaces()]);
  }
  useEffect(()=>{load().catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
  const allPermissions=useMemo(()=>Array.from(new Map(roles.flatMap(role=>role.permissions).map(permission=>[permission.key,permission])).values()),[roles]);

  async function changeUserStatus(user:User){
    const status=user.status==="ACTIVE"?"DISABLED":"ACTIVE";
    if(!window.confirm(`${status==="DISABLED"?"ปิดใช้งาน":"เปิดใช้งาน"}บัญชี ${user.email} ใช่หรือไม่?`))return;
    setBusy(true);setError("");setNotice("");
    try{await api(`/api/platform-admin/users/${user.id}/status`,{method:"PATCH",body:JSON.stringify({status})});await Promise.all([loadUsers(),loadOverview()]);setNotice("อัปเดตสถานะบัญชีแล้ว");}
    catch(e){setError(e instanceof Error?e.message:"อัปเดตไม่สำเร็จ");}finally{setBusy(false);}
  }
  async function changeWorkspaceStatus(workspace:Workspace){
    const status=workspace.status==="SUSPENDED"?"ACTIVE":"SUSPENDED";
    if(!window.confirm(`${status==="SUSPENDED"?"ระงับ":"เปิดใช้งาน"} Workspace ${workspace.name} ใช่หรือไม่?`))return;
    setBusy(true);setError("");setNotice("");
    try{await api(`/api/platform-admin/workspaces/${workspace.id}/status`,{method:"PATCH",body:JSON.stringify({status})});await Promise.all([loadWorkspaces(),loadOverview()]);setNotice("อัปเดตสถานะ Workspace แล้ว");}
    catch(e){setError(e instanceof Error?e.message:"อัปเดตไม่สำเร็จ");}finally{setBusy(false);}
  }
  async function changeMemberRole(member:Member,roleKey:string){
    if(!selected)return;setBusy(true);setError("");
    try{await api(`/api/platform-admin/workspaces/${selected.id}/members/${member.id}`,{method:"PATCH",body:JSON.stringify({roleKey})});await loadWorkspaceDetails(selected);setNotice("เปลี่ยนบทบาทสมาชิกแล้ว");}
    catch(e){setError(e instanceof Error?e.message:"เปลี่ยนบทบาทไม่สำเร็จ");}finally{setBusy(false);}
  }
  async function removeMember(member:Member){
    if(!selected||member.isOwner||!window.confirm(`นำ ${member.user.email} ออกจาก Workspace นี้ใช่หรือไม่?`))return;
    setBusy(true);setError("");
    try{await api(`/api/platform-admin/workspaces/${selected.id}/members/${member.id}/remove`,{method:"PATCH"});await loadWorkspaceDetails(selected);await loadWorkspaces();setNotice("นำสมาชิกออกแล้ว");}
    catch(e){setError(e instanceof Error?e.message:"นำสมาชิกออกไม่สำเร็จ");}finally{setBusy(false);}
  }
  async function savePermissions(){
    if(!selected||!editingRole)return;setBusy(true);setError("");
    try{await api(`/api/platform-admin/workspaces/${selected.id}/roles/${editingRole}/permissions`,{method:"PATCH",body:JSON.stringify({permissionKeys:permissions})});await loadWorkspaceDetails(selected);setNotice("บันทึกสิทธิ์ของบทบาทแล้ว");}
    catch(e){setError(e instanceof Error?e.message:"บันทึกสิทธิ์ไม่สำเร็จ");}finally{setBusy(false);}
  }
  async function logout(){await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin"});router.replace("/");router.refresh();}

  return <main className="workspace-shell admin-shell">
    <header className="topbar"><button className="brand brand-button" onClick={()=>router.push("/workspaces")}><span className="brand-mark">S</span> SyncUp <span className="admin-label">PLATFORM ADMIN</span></button><div className="user-menu"><button className="ghost" onClick={()=>router.push("/workspaces")}>Workspace ของฉัน</button><button className="ghost" onClick={logout}>ออกจากระบบ</button></div></header>
    <section className="dashboard-content">
      <div className="dashboard-head"><div><div className="eyebrow">SYSTEM CONTROL CENTER</div><h1>System Admin</h1><p className="subtle">จัดการบัญชีผู้ใช้ Workspace และโครงสร้างระบบจากส่วนกลาง</p></div><span className="admin-pill">Platform Admin</span></div>
      {error&&<div className="error" role="alert">{error}</div>}{notice&&<div className="success" role="status">{notice}</div>}
      <nav className="admin-tabs"><button className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}>ภาพรวม</button><button className={tab==="users"?"active":""} onClick={()=>setTab("users")}>ผู้ใช้</button><button className={tab==="workspaces"?"active":""} onClick={()=>setTab("workspaces")}>Workspace</button></nav>
      {loading?<p className="subtle">กำลังโหลดข้อมูลระบบ...</p>:<>
        {tab==="overview"&&<><div className="dashboard-stats admin-stats">{[["ผู้ใช้ทั้งหมด",overview.users],["บัญชีใช้งาน",overview.activeUsers],["บัญชีปิดใช้งาน",overview.disabledUsers],["Workspace ทั้งหมด",overview.workspaces],["Workspace ใช้งาน",overview.activeWorkspaces],["สมาชิกทั้งหมด",overview.memberships]].map(([label,value])=><div className="stat-card" key={String(label)}><span>{label}</span><strong>{value??0}</strong></div>)}</div><section className="panel"><div className="panel-heading"><div><h2>สถานะระบบ</h2><p>สถานะการเชื่อมต่อฐานข้อมูล Tenant ล่าสุดที่ตรวจสอบได้</p></div><button className="ghost" onClick={()=>loadWorkspaces().catch(e=>setError(e.message))}>ตรวจสอบอีกครั้ง</button></div><div className="admin-health-list">{workspaces.map(ws=><div className="admin-health-row" key={ws.id}><div><strong>{ws.name}</strong><small>/{ws.slug}</small></div><span className={`health-pill ${ws.database.status.toLowerCase()}`}>{ws.database.status==="CONNECTED"?"เชื่อมต่อได้":ws.database.status==="DISCONNECTED"?"เชื่อมต่อล้มเหลว":"ยังไม่ตั้งค่า"}</span></div>)}</div></section></>}
        {tab==="users"&&<section className="panel"><div className="panel-heading"><div><h2>จัดการผู้ใช้ทั้งหมด</h2><p>ค้นหาบัญชีและเปิดหรือปิดใช้งานการเข้าสู่ระบบ</p></div><span className="count-pill">{users.length} บัญชี</span></div><div className="admin-search"><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")loadUsers().catch(err=>setError(err.message));}} placeholder="ค้นหาชื่อหรืออีเมล"/><button className="primary" onClick={()=>loadUsers().catch(e=>setError(e.message))}>ค้นหา</button></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>ผู้ใช้</th><th>Workspace</th><th>สิทธิ์ระบบ</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>{users.map(user=><tr key={user.id}><td><strong>{user.displayName}</strong><small>{user.email}</small></td><td>{user._count.memberships}</td><td>{user.isPlatformAdmin?<span className="admin-pill">Platform Admin</span>:"—"}</td><td><span className={`status-pill ${user.status.toLowerCase()}`}>{user.status==="ACTIVE"?"ใช้งาน":"ปิดใช้งาน"}</span></td><td><button className={user.status==="ACTIVE"?"danger-button":"small-action"} disabled={busy} onClick={()=>changeUserStatus(user)}>{user.status==="ACTIVE"?"ปิดใช้งาน":"เปิดใช้งาน"}</button></td></tr>)}</tbody></table></div></section>}
        {tab==="workspaces"&&<section className="panel"><div className="panel-heading"><div><h2>จัดการ Workspace ทั้งหมด</h2><p>ตรวจสอบฐานข้อมูล ระงับหรือเปิดใช้งาน และจัดการสมาชิก/สิทธิ์</p></div><span className="count-pill">{workspaces.length} Workspace</span></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Workspace</th><th>สมาชิก</th><th>สถานะ</th><th>ฐานข้อมูล</th><th>การจัดการ</th></tr></thead><tbody>{workspaces.map(ws=><tr key={ws.id}><td><strong>{ws.name}</strong><small>/{ws.slug}</small><small>{ws.database.databaseName??"ไม่มีฐานข้อมูล"}</small></td><td>{ws.memberCount}</td><td><span className={`status-pill ${ws.status.toLowerCase()}`}>{ws.status}</span></td><td><span className={`health-pill ${ws.database.status.toLowerCase()}`}>{ws.database.status}</span><small>{ws.database.schemaVersion??"ยังไม่มี schema version"}</small></td><td><div className="table-actions"><button className="small-action" onClick={()=>loadWorkspaceDetails(ws).catch(e=>setError(e.message))}>สมาชิก/สิทธิ์</button><button className={ws.status==="SUSPENDED"?"small-action":"danger-button"} disabled={busy||ws.status==="PROVISIONING"||ws.status==="FAILED"} onClick={()=>changeWorkspaceStatus(ws)}>{ws.status==="SUSPENDED"?"เปิดใช้งาน":"ระงับ"}</button></div></td></tr>)}</tbody></table></div></section>}
      </>}
      <p className="dashboard-foot">ทุก API ในส่วนนี้ตรวจสอบ Platform Admin จาก Session ฝั่งเซิร์ฟเวอร์</p>
    </section>
    {selected&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}><section className="modal admin-modal"><div className="panel-heading"><div><div className="eyebrow">WORKSPACE CONTROL</div><h2>{selected.name}</h2><p>จัดการสมาชิกและสิทธิ์ของ Workspace นี้</p></div><button className="ghost" onClick={()=>setSelected(null)}>ปิด</button></div><h3>สมาชิก ({members.length})</h3><div className="admin-member-list">{members.map(member=><div className="admin-member-row" key={member.id}><div><strong>{member.user.displayName||member.user.email}</strong><small>{member.user.email}</small></div>{member.isOwner?<span className="owner-pill">เจ้าของ</span>:<><select disabled={busy} value={member.roles[0]?.key??"member"} onChange={e=>changeMemberRole(member,e.target.value)}>{roles.map(role=><option key={role.key} value={role.key}>{role.name}</option>)}</select><button className="remove-button" disabled={busy} onClick={()=>removeMember(member)}>นำออก</button></>}</div>)}</div><div className="admin-permissions"><h3>กำหนดสิทธิ์บทบาท</h3><div className="field"><label htmlFor="admin-role">บทบาท</label><select id="admin-role" value={editingRole} onChange={e=>{setEditingRole(e.target.value);setPermissions(roles.find(role=>role.key===e.target.value)?.permissions.map(p=>p.key)??[])}}>{roles.filter(role=>role.key!=="admin").map(role=><option key={role.key} value={role.key}>{role.name}</option>)}</select></div><div className="permission-list">{allPermissions.map(permission=><label className="permission-item" key={permission.key}><input type="checkbox" checked={permissions.includes(permission.key)} onChange={e=>setPermissions(current=>e.target.checked?[...current,permission.key]:current.filter(key=>key!==permission.key))}/><span><strong>{permission.description??permission.key}</strong><small>{permission.key}</small></span></label>)}</div><button className="primary" disabled={busy||!editingRole} onClick={savePermissions}>บันทึกสิทธิ์</button></div></section></div>}
  </main>;
}
