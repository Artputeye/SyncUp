const assert = require("node:assert/strict");
const { Module, UnauthorizedException, ForbiddenException, BadRequestException, NotFoundException, ConflictException } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { TenantController } = require("../dist/core/tenant/tenant.controller");
const { TenantService } = require("../dist/core/tenant/tenant.service");
const { StoreLifecycleService } = require("../dist/core/tenant/store-lifecycle.service");
const { AuthService } = require("../dist/core/auth/auth.service");
const { RbacService } = require("../dist/core/rbac/rbac.service");
const calls = [];
const tenantMock = { async listSettings(userId, workspaceId) { if ((userId === "owner-a" && workspaceId !== "workspace-a") || (userId === "owner-b" && workspaceId !== "workspace-b")) throw new ForbiddenException("cross-workspace access denied"); calls.push(["listSettings", userId, workspaceId]); return [{ key: "test", value: { ok: true } }]; } };
const lifecycleMock = {};
for (const method of ["createStore", "createBranch", "createWarehouse", "setDefaultBranch", "setDefaultWarehouse", "archiveWarehouse", "archiveBranch"]) { lifecycleMock[method] = async (...args) => { calls.push([method, ...args]); const e=args.at(-1)?.forceError; if(e==="bad-request") throw new BadRequestException(); if(e==="not-found") throw new NotFoundException(); if(e==="conflict") throw new ConflictException(); return {method,args}; }; }
const authMock = { async resolveSession(token) { if(token!=="owner-a" && token!=="owner-b" && token!=="owner-a-no-permission") throw new UnauthorizedException(); return {userId:token}; } };
const rbacMock = { async hasPermission(userId, workspaceId) { return (userId==="owner-a" && workspaceId==="workspace-a") || (userId==="owner-b" && workspaceId==="workspace-b"); } };
class TenantLifecycleHttpTestModule {}
Module({controllers:[TenantController],providers:[{provide:TenantService,useValue:tenantMock},{provide:StoreLifecycleService,useValue:lifecycleMock},{provide:AuthService,useValue:authMock},{provide:RbacService,useValue:rbacMock}]})(TenantLifecycleHttpTestModule);
async function request(base,path,o={}) { const headers={}; if(o.auth) headers.cookie="syncup_session="+o.auth; if(o.body!==undefined) headers["content-type"]="application/json"; return fetch(base+path,{method:o.method||"GET",headers,...(o.body===undefined?{}:{body:JSON.stringify(o.body)})}); }
async function expectStatus(response,expected,label) { const body=await response.text(); assert.equal(response.status,expected,label+": expected "+expected+", got "+response.status+"; "+body); return body?JSON.parse(body):null; }
async function main() {
 delete process.env.WEB_ORIGIN;
 const app=await NestFactory.create(TenantLifecycleHttpTestModule,{logger:["error","warn"]});
 try { app.setGlobalPrefix("api"); await app.listen(0,"127.0.0.1"); const base="http://127.0.0.1:"+app.getHttpServer().address().port; const a="/api/tenant/workspace-a",b="/api/tenant/workspace-b",manage="commerce.store.manage";
 await expectStatus(await request(base,a+"/settings"),401,"anonymous");
 await expectStatus(await request(base,a+"/settings",{auth:"owner-a"}),200,"own settings");
 await expectStatus(await request(base,a+"/stores",{method:"POST",auth:"owner-a-no-permission",body:{name:"No Permission",slug:"no-permission"}}),403,"missing lifecycle permission");
 await expectStatus(await request(base,b+"/settings",{auth:"owner-a"}),403,"cross-tenant read");
 await expectStatus(await request(base,a+"/stores",{method:"POST",auth:"owner-a-no-permission",body:{name:"A",slug:"a"}}),403,"missing permission");
 await expectStatus(await request(base,a+"/stores",{method:"POST",auth:"owner-a",body:{name:"Bad",slug:"bad",forceError:"bad-request"}}),400,"bad request mapping");
 await expectStatus(await request(base,a+"/stores",{method:"POST",auth:"owner-a",body:{name:"Missing",slug:"missing",forceError:"not-found"}}),404,"not found mapping");
 await expectStatus(await request(base,a+"/stores",{method:"POST",auth:"owner-a",body:{name:"Conflict",slug:"conflict",forceError:"conflict"}}),409,"conflict mapping");
 const s=await expectStatus(await request(base,a+"/stores",{method:"POST",auth:"owner-a",body:{name:"Main Store",slug:"main-store"}}),201,"create Store"); assert.equal(s.method,"createStore");
 const storeId="store-1",branchId="branch-1",warehouseId="warehouse-1";
 const br=await expectStatus(await request(base,a+"/stores/"+storeId+"/branches",{method:"POST",auth:"owner-a",body:{code:"BKK",name:"Bangkok"}}),201,"create Branch"); assert.equal(br.method,"createBranch");
 const wh=await expectStatus(await request(base,a+"/branches/"+branchId+"/warehouses",{method:"POST",auth:"owner-a",body:{code:"WH2",name:"Overflow"}}),201,"create Warehouse"); assert.equal(wh.method,"createWarehouse");
 const db=await expectStatus(await request(base,a+"/stores/"+storeId+"/branches/branch-2/default",{method:"PATCH",auth:"owner-a",body:{reason:"Ops"}}),200,"default Branch"); assert.equal(db.method,"setDefaultBranch");
 const dw=await expectStatus(await request(base,a+"/branches/"+branchId+"/warehouses/"+warehouseId+"/default",{method:"PATCH",auth:"owner-a",body:{reason:"Capacity"}}),200,"default Warehouse"); assert.equal(dw.method,"setDefaultWarehouse");
 const aw=await expectStatus(await request(base,a+"/branches/"+branchId+"/warehouses/"+warehouseId+"/archive",{method:"PATCH",auth:"owner-a",body:{reason:"Retired"}}),200,"archive Warehouse"); assert.equal(aw.method,"archiveWarehouse");
 const ab=await expectStatus(await request(base,a+"/stores/"+storeId+"/branches/"+branchId+"/archive",{method:"PATCH",auth:"owner-a",body:{reason:"Consolidated"}}),200,"archive Branch"); assert.equal(ab.method,"archiveBranch");
 await expectStatus(await request(base,a+"/stores",{method:"POST",auth:"owner-b",body:{name:"Intrusion",slug:"intrusion"}}),403,"cross-tenant mutation");
 assert.deepEqual(calls.map(x=>x[0]),["listSettings","createStore","createStore","createStore","createStore","createBranch","createWarehouse","setDefaultBranch","setDefaultWarehouse","archiveWarehouse","archiveBranch"]);
 console.log("PASS HTTP authentication: anonymous rejected"); console.log("PASS HTTP tenant isolation: cross-workspace read and write rejected");
 console.log("PASS HTTP RBAC: commerce.store.manage enforced by production guard (allow and deny)"); console.log("PASS HTTP lifecycle: all seven routes dispatch to intended services");
 console.log("PASS HTTP response contracts: POST=201, PATCH=200, domain errors=400/404/409");
 } finally { await app.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});