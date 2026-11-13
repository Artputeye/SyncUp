#!/usr/bin/env node
'use strict';
// Offline preflight only: no database connection and no business-data writes.
const fs = require('node:fs');
const path = require('node:path');

const FILES = {
  'products.csv': ['product_name','description','sku','barcode','variant_title','uom_code','uom_name','uom_type','conversion_to_base','tax_category_code','status'],
  'tax_setup.csv': ['store_code','tax_profile_name','tax_mode','price_tax_mode','rounding_level','rounding_method','currency_minor_units','profile_valid_from','profile_valid_to','tax_category_code','tax_category_name','tax_rate_percent','rate_valid_from','rate_valid_to'],
  'store_prices.csv': ['store_code','sku','uom_code','currency','price','valid_from','valid_to','publish_status'],
  'opening_stock.csv': ['sku','quantity','unitCost'],
};
const ALLOWED = {
  uom_type: ['BASE','SELL','PURCHASE','SELL_AND_PURCHASE'],
  status: ['DRAFT','ACTIVE','ARCHIVED'],
  tax_mode: ['VAT','NO_VAT'],
  price_tax_mode: ['INCLUSIVE','EXCLUSIVE'],
  rounding_level: ['DOCUMENT'],
  rounding_method: ['HALF_UP'],
  publish_status: ['DRAFT','PUBLISHED','UNPUBLISHED'],
};
const errors = [], warnings = [], stats = {};
const clean = v => String(v == null ? '' : v).trim();
const key = v => clean(v).toUpperCase();
function issue(list,file,row,message) { list.push({file,row,message}); }
function parseCsv(source,file) {
  const input = source.replace(/^\uFEFF/,'');
  const rows=[]; let row=[], cell='', quoted=false;
  for (let i=0;i<input.length;i++) {
    const c=input[i];
    if (quoted) {
      if (c === '"') { if (input[i+1] === '"') { cell+='"'; i++; } else quoted=false; }
      else cell+=c;
    } else if (c === '"' && cell.length===0) quoted=true;
    else if (c === ',') { row.push(cell); cell=''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i+1] === '\n') i++;
      row.push(cell); cell='';
      if (row.some(v=>clean(v)!=='')) rows.push(row);
      row=[];
    } else cell+=c;
  }
  if (quoted) issue(errors,file,rows.length+1,'พบเครื่องหมาย quote ที่ไม่ปิด');
  row.push(cell); if (row.some(v=>clean(v)!=='')) rows.push(row);
  if (!rows.length) return {headers:[],records:[]};
  const headers=rows[0].map(clean), seen=new Set();
  headers.forEach(h=>{
    if (!h) issue(errors,file,1,'มีชื่อคอลัมน์ว่าง');
    if (seen.has(h)) issue(errors,file,1,'ชื่อคอลัมน์ซ้ำ: '+h);
    seen.add(h);
  });
  const records=rows.slice(1).map((values,index)=>{
    if (values.length!==headers.length) issue(errors,file,index+2,'จำนวนคอลัมน์ '+values.length+' ไม่ตรงกับ header '+headers.length);
    return Object.fromEntries(headers.map((h,i)=>[h,clean(values[i])]));
  });
  return {headers,records};
}
function decimal(v) { return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(clean(v)) ? Number(v) : NaN; }
function validDate(v) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(clean(v)) && !Number.isNaN(Date.parse(v));
}
function dateField(file,row,field,value,required) {
  if ((!value && !required) || (value && validDate(value))) return;
  issue(errors,file,row,field+' ต้องเป็น ISO 8601 พร้อม timezone');
}
function enumField(file,row,field,value) {
  if (value && ALLOWED[field] && !ALLOWED[field].includes(key(value))) issue(errors,file,row,field+' ไม่ถูกต้อง: '+value);
}
function readFile(dir,name) {
  const full=path.join(dir,name);
  if (!fs.existsSync(full)) { issue(errors,name,0,'ไม่พบไฟล์'); return {headers:[],records:[]}; }
  return parseCsv(fs.readFileSync(full,'utf8'),name);
}
function run(dir) {
  const data={};
  for (const name of Object.keys(FILES)) {
    const parsed=readFile(dir,name); data[name]=parsed;
    if (JSON.stringify(parsed.headers)!==JSON.stringify(FILES[name]))
      issue(errors,name,1,'header ต้องตรงตามลำดับ: '+FILES[name].join(','));
    stats[name]=parsed.records.length;
  }
  const products=data['products.csv'].records, tax=data['tax_setup.csv'].records;
  const prices=data['store_prices.csv'].records, opening=data['opening_stock.csv'].records;
  const productBySku=new Map(), productUoms=new Set();
  const categoryCodes=new Set(tax.map(r=>key(r.tax_category_code)).filter(Boolean));
  products.forEach((r,i)=>{
    const n=i+2, sku=key(r.sku), uom=key(r.uom_code);
    ['product_name','sku','variant_title','uom_code','uom_name','uom_type','conversion_to_base','status'].forEach(f=>{
      if (!clean(r[f])) issue(errors,'products.csv',n,'ขาดค่า '+f);
    });
    if (sku && productBySku.has(sku)) issue(errors,'products.csv',n,'SKU ซ้ำ: '+r.sku);
    if (sku) productBySku.set(sku,r);
    if (sku && uom) {
      const pair=sku+'|'+uom;
      if (productUoms.has(pair)) issue(errors,'products.csv',n,'SKU/UOM ซ้ำ: '+r.sku+'/'+r.uom_code);
      productUoms.add(pair);
    }
    enumField('products.csv',n,'uom_type',r.uom_type);
    enumField('products.csv',n,'status',r.status);
    const factor=decimal(r.conversion_to_base);
    if (!Number.isFinite(factor) || factor<=0) issue(errors,'products.csv',n,'conversion_to_base ต้องมากกว่า 0');
    if (r.tax_category_code && !categoryCodes.has(key(r.tax_category_code)))
      issue(errors,'products.csv',n,'ไม่พบ tax_category_code ใน tax_setup.csv: '+r.tax_category_code);
  });
  const profiles=new Set();
  tax.forEach((r,i)=>{
    const n=i+2;
    ['store_code','tax_profile_name','tax_mode','price_tax_mode','rounding_level','rounding_method','currency_minor_units'].forEach(f=>{
      if (!clean(r[f])) issue(errors,'tax_setup.csv',n,'ขาดค่า '+f);
    });
    ['tax_mode','price_tax_mode','rounding_level','rounding_method'].forEach(f=>enumField('tax_setup.csv',n,f,r[f]));
    const minor=decimal(r.currency_minor_units);
    if (!Number.isInteger(minor) || minor<0 || minor>4) issue(errors,'tax_setup.csv',n,'currency_minor_units ต้องเป็นจำนวนเต็ม 0–4');
    const profileKey=key(r.store_code)+'|'+key(r.tax_profile_name);
    if (profiles.has(profileKey)) issue(errors,'tax_setup.csv',n,'store_code/tax_profile_name ซ้ำ');
    profiles.add(profileKey);
    if (r.tax_mode==='VAT') {
      ['tax_category_code','tax_category_name','tax_rate_percent'].forEach(f=>{
        if (!clean(r[f])) issue(errors,'tax_setup.csv',n,'โหมด VAT ต้องระบุ '+f);
      });
      const rate=decimal(r.tax_rate_percent);
      if (!Number.isFinite(rate) || rate<0 || rate>100) issue(errors,'tax_setup.csv',n,'tax_rate_percent ต้องอยู่ระหว่าง 0–100');
    } else if (r.tax_mode==='NO_VAT' && clean(r.tax_rate_percent)) {
      warnings.push({file:'tax_setup.csv',row:n,message:'NO_VAT แต่ระบุ tax_rate_percent; โปรดตรวจสอบ'});
    }
    dateField('tax_setup.csv',n,'profile_valid_from',r.profile_valid_from,true);
    dateField('tax_setup.csv',n,'profile_valid_to',r.profile_valid_to,false);
    dateField('tax_setup.csv',n,'rate_valid_from',r.rate_valid_from,r.tax_mode==='VAT');
    dateField('tax_setup.csv',n,'rate_valid_to',r.rate_valid_to,false);
    if (r.profile_valid_from && r.profile_valid_to && Date.parse(r.profile_valid_to)<=Date.parse(r.profile_valid_from))
      issue(errors,'tax_setup.csv',n,'profile_valid_to ต้องอยู่หลัง profile_valid_from');
    if (r.rate_valid_from && r.rate_valid_to && Date.parse(r.rate_valid_to)<=Date.parse(r.rate_valid_from))
      issue(errors,'tax_setup.csv',n,'rate_valid_to ต้องอยู่หลัง rate_valid_from');
  });
  const priceKeys=new Set();
  prices.forEach((r,i)=>{
    const n=i+2, sku=key(r.sku), uom=key(r.uom_code);
    ['store_code','sku','uom_code','currency','price','valid_from','publish_status'].forEach(f=>{
      if (!clean(r[f])) issue(errors,'store_prices.csv',n,'ขาดค่า '+f);
    });
    if (sku && !productBySku.has(sku)) issue(errors,'store_prices.csv',n,'ไม่พบ SKU ใน products.csv: '+r.sku);
    if (sku && uom && !productUoms.has(sku+'|'+uom)) issue(errors,'store_prices.csv',n,'ไม่พบ SKU/UOM ใน products.csv: '+r.sku+'/'+r.uom_code);
    if (r.currency && !/^[A-Z]{3}$/.test(r.currency)) issue(errors,'store_prices.csv',n,'currency ต้องเป็นรหัส 3 ตัวอักษร เช่น THB');
    const amount=decimal(r.price);
    if (!Number.isFinite(amount) || amount<0) issue(errors,'store_prices.csv',n,'price ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
    enumField('store_prices.csv',n,'publish_status',r.publish_status);
    dateField('store_prices.csv',n,'valid_from',r.valid_from,true);
    dateField('store_prices.csv',n,'valid_to',r.valid_to,false);
    if (r.valid_from && r.valid_to && Date.parse(r.valid_to)<=Date.parse(r.valid_from))
      issue(errors,'store_prices.csv',n,'valid_to ต้องอยู่หลัง valid_from');
    const k=[key(r.store_code),sku,uom,key(r.currency),r.valid_from].join('|');
    if (priceKeys.has(k)) issue(errors,'store_prices.csv',n,'รายการราคา key ซ้ำ');
    priceKeys.add(k);
  });
  const openingSkus=new Set();
  opening.forEach((r,i)=>{
    const n=i+2, sku=key(r.sku);
    ['sku','quantity','unitCost'].forEach(f=>{if (!clean(r[f])) issue(errors,'opening_stock.csv',n,'ขาดค่า '+f);});
    if (sku && !productBySku.has(sku)) issue(errors,'opening_stock.csv',n,'ไม่พบ SKU ใน products.csv: '+r.sku);
    if (sku && openingSkus.has(sku)) issue(errors,'opening_stock.csv',n,'SKU ซ้ำใน opening stock: '+r.sku);
    openingSkus.add(sku);
    const qty=decimal(r.quantity), cost=decimal(r.unitCost);
    if (!Number.isFinite(qty) || qty<=0) issue(errors,'opening_stock.csv',n,'quantity ต้องมากกว่า 0');
    if (!Number.isFinite(cost) || cost<0) issue(errors,'opening_stock.csv',n,'unitCost ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  });
  const populated=Object.values(stats).some(v=>v>0);
  console.log('POS-LOCAL DATA INTAKE PREFLIGHT (offline; no database access)');
  console.log('Directory: '+dir);
  Object.keys(stats).forEach(f=>console.log('- '+f+': '+stats[f]+' data row(s)'));
  console.log('Status: '+(!populated?'TEMPLATE_ONLY':errors.length?'BLOCKED':'VALIDATION_PASS'));
  console.log('Errors: '+errors.length+'; Warnings: '+warnings.length);
  errors.forEach(e=>console.log('ERROR '+e.file+(e.row?':'+e.row:'')+': '+e.message));
  warnings.forEach(w=>console.log('WARN '+w.file+':'+w.row+': '+w.message));
  if (!populated) console.log('No business data supplied; this is not approval to create or import records.');
  if (errors.length) process.exitCode=1;
}
run(path.resolve(process.argv[2] || __dirname));
