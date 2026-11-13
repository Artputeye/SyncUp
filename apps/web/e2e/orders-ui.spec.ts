import { expect, test, type Page } from "@playwright/test";
const slug=process.env.LOCAL_TEST_WORKSPACE_SLUG??"pos-local";
async function signIn(page:Page,email:string,password:string){await page.goto("/login");await page.getByLabel("อีเมล").fill(email);await page.locator("#password").fill(password);await page.getByRole("button",{name:"เข้าสู่ระบบ"}).click();await expect(page).toHaveURL(/\/workspaces\/?(?:\?.*)?$/,{timeout:20000})}
test("Orders UI creates, posts and records a payment",async({page})=>{
 const email=process.env.LOCAL_TEST_MANAGER_EMAIL,password=process.env.LOCAL_TEST_MANAGER_PASSWORD;
 test.skip(!email||!password,"Manager credentials are required.");
 const wid="c0130bf3-c1c0-4dfa-a915-7ca5155cacfd",sid="33333333-3333-4333-8333-333333333333",bid="44444444-4444-4444-8444-444444444444",hid="55555555-5555-4555-8555-555555555555",vid="22222222-2222-4222-8222-222222222222",oid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 let orderStatus:"RESERVED"|"POSTED"|"CANCELLED"="RESERVED",createdBody:any=null,payments:any[]=[],returns:any[]=[],refunds:any[]=[];
 const detail=()=>({id:oid,order_number:"SO-E2E-2026-000001",status:orderStatus,currency:"THB",subtotal:"200.0000",tax_amount:"14.0000",total_amount:"214.0000",item_count:1,created_at:new Date().toISOString(),posted_at:orderStatus==="POSTED"?new Date().toISOString():null,tax_mode:"VAT",price_tax_mode:"EXCLUSIVE",store_name:"Store E2E",branch_code:"BKK",branch_name:"สาขาทดสอบ",warehouse_code:"WH",warehouse_name:"คลังทดสอบ",cancelled_at:null,cancel_reason:null,items:[{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",product_name:"สินค้า E2E",variant_title:"รุ่นทดสอบ",sku:"ORD-UI-001",uom_code:"EA",quantity:"2.000",base_quantity:"2.000",unit_price:"100.0000",tax_amount:"14.0000",total_amount:"214.0000",unit_cost_snapshot:orderStatus==="POSTED"?"40.000000":null,reservation_status:"CONSUMED"}]});
 await signIn(page,email!,password!);
 await page.route(/\/api\/workspaces$/,r=>r.fulfill({json:[{id:wid,slug,name:"E2E Workspace"}]}));
 await page.route(/\/api\/tenant\/[^/]+\/products(?:\?.*)?$/,r=>r.fulfill({json:{items:[{id:"11111111-1111-4111-8111-111111111111",name:"สินค้า E2E",status:"ACTIVE",variants:[{id:vid,sku:"ORD-UI-001",title:"รุ่นทดสอบ",status:"ACTIVE",sellUoms:[{id:"66666666-6666-4666-8666-666666666666",code:"EA",name:"ชิ้น",usage:"BASE"}]}]}]}}));
 await page.route(/\/api\/tenant\/[^/]+\/stores$/,r=>r.fulfill({json:[{id:sid,name:"Store E2E",status:"ACTIVE"}]}));
 await page.route(/\/api\/tenant\/[^/]+\/stores\/[^/]+\/branches$/,r=>r.fulfill({json:[{id:bid,code:"BKK",name:"สาขาทดสอบ",status:"ACTIVE"}]}));
 await page.route(/\/api\/tenant\/[^/]+\/stores\/[^/]+\/branches\/[^/]+\/warehouses$/,r=>r.fulfill({json:[{id:hid,code:"WH",name:"คลังทดสอบ",status:"ACTIVE",isDefault:true}]}));
 await page.route(/\/api\/tenant\/[^/]+\/orders(?:\/.*)?(?:\?.*)?$/,async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
  if(method==="POST"&&path.endsWith("/orders")){createdBody=req.postDataJSON();return route.fulfill({status:201,json:{...detail(),idempotentReplay:false}})}
  if(method==="GET"&&path.endsWith("/orders"))return route.fulfill({json:{items:createdBody?[{...detail()}]:[],pagination:{page:1,pageSize:50,total:createdBody?1:0,totalPages:createdBody?1:0}}});
  if(method==="POST"&&path.endsWith("/post")){orderStatus="POSTED";return route.fulfill({status:201,json:{id:oid,status:orderStatus,idempotentReplay:false}})}
  if(method==="POST"&&path.endsWith("/payments")){const body=req.postDataJSON();payments.push({id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",payment_number:"PAY-E2E-000001",method:body.method,status:"CAPTURED",currency:"THB",amount:body.amount,refunded_amount:"0.0000",received_at:new Date().toISOString()});return route.fulfill({status:201,json:payments[0]})}
  if(method==="GET"&&path.endsWith("/payments"))return route.fulfill({json:{items:payments}});
  if(method==="POST"&&path.endsWith("/returns")){returns.push({id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",return_number:"RET-E2E-000001",status:"POSTED",currency:"THB",total_amount:"50.0000",created_at:new Date().toISOString()});return route.fulfill({status:201,json:{id:returns[0].id,return_number:returns[0].return_number,status:"POSTED"}})}
  if(method==="GET"&&path.endsWith("/returns"))return route.fulfill({json:{items:returns}});
  if(method==="POST"&&path.endsWith("/refunds")){refunds.push({id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",refund_number:"REF-E2E-000001",currency:"THB",amount:req.postDataJSON().amount,reason:"คืนเงินทดสอบ",refunded_at:new Date().toISOString()});return route.fulfill({status:201,json:refunds[0]})}
  if(method==="GET"&&path.endsWith("/refunds"))return route.fulfill({json:{items:refunds}});
  if(method==="GET"&&path.endsWith("/"+oid))return route.fulfill({json:detail()});
  return route.continue();
 });
 await page.goto("/workspace/"+slug+"/orders");
 await expect(page.getByRole("heading",{name:"คำสั่งขาย",exact:true})).toBeVisible();
 await page.locator(".order-cart-line select").first().selectOption(vid);
 await page.locator(".order-cart-line input[type=number]").fill("2");
 await page.getByRole("button",{name:"สร้าง Order และจองสต็อก"}).click();
 await expect(page.getByRole("button",{name:/SO-E2E-2026-000001/})).toBeVisible();
 expect(createdBody.items[0].variantId).toBe(vid);
 await page.getByRole("button",{name:"ยืนยันขาย / ตัดสต็อก"}).click();
 await expect(page.getByRole("heading",{name:"รับชำระเงิน"})).toBeVisible();
 await page.locator(".order-payment-form input[type=number]").fill("214");
 await page.getByRole("button",{name:"บันทึกรับชำระ"}).click();
 await expect(page.getByText("PAY-E2E-000001")).toBeVisible();
 await page.getByRole("button",{name:"ดู / พิมพ์ใบรับเงิน"}).click();
 await expect(page.getByRole("heading",{name:"ใบรับเงิน / SALES RECEIPT"})).toBeVisible();
 await expect(page.getByText("SO-E2E-2026-000001").last()).toBeVisible();
 await expect(page.getByText("ไม่ใช่ใบกำกับภาษี")).toBeVisible();
 await page.getByRole("button",{name:"ปิด"}).click();
 await page.locator(".order-return-lines input").fill("1");
 await page.getByRole("button",{name:"บันทึกรับคืน"}).click();
 await expect(page.getByRole("button",{name:/RET-E2E-000001/})).toBeVisible();
 await page.locator(".order-refund-form input[type=number]").fill("50");
 await page.getByRole("button",{name:"บันทึก Refund"}).click();
 await expect(page.getByText("REF-E2E-000001")).toBeVisible();
});
