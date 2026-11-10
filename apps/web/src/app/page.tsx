"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

const categories = [
  { icon: "▦", title: "ร้านค้าและสาขา", detail: "Workspace · Store · Branch", href: "/login" },
  { icon: "◇", title: "สินค้าและคลัง", detail: "Product · Inventory · Stocktake", href: "/login" },
  { icon: "⌁", title: "ขายหน้าร้านและ POS", detail: "Checkout · Orders · Sales", href: "/login" },
  { icon: "♧", title: "ทีมงานและสิทธิ์", detail: "Members · Roles · Permissions", href: "/login" },
];

const highlights = [
  { tag: "WORKSPACE", title: "ทุกสาขาในพื้นที่ทำงานเดียว", description: "แยกข้อมูลร้านค้า สาขา คลังสินค้า และทีมงานอย่างเป็นระบบ", icon: "▦" },
  { tag: "INVENTORY", title: "ควบคุมสต๊อกได้ครบวงจร", description: "รับเข้า จ่ายออก ปรับยอด โอนคลัง และตรวจสอบประวัติย้อนหลัง", icon: "◇" },
  { tag: "COMMERCE", title: "พร้อมต่อยอดงานขาย", description: "เตรียมพื้นที่สำหรับ POS คำสั่งซื้อ และการจัดการสินค้า", icon: "⌁" },
];

export default function HomePage() {
  const [search, setSearch] = useState("");
  const filteredCategories = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return categories;
    return categories.filter(item => (item.title + " " + item.detail).toLocaleLowerCase().includes(term));
  }, [search]);

  function submitSearch() {
    document.getElementById("solutions")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <main className="home-shell">
      <header className="market-header">
        <div className="market-header-main">
          <Link href="/" className="home-brand" aria-label="SyncUp home">
            <span className="home-brand-mark">S</span><span>SyncUp</span>
          </Link>
          <form className="market-search" role="search" onSubmit={event => { event.preventDefault(); submitSearch(); }}>
            <span aria-hidden="true">⌕</span>
            <input aria-label="ค้นหาความสามารถของ SyncUp" value={search} onChange={event => setSearch(event.target.value)} placeholder="ค้นหาระบบจัดการร้านค้า สินค้า หรือคลังสินค้า" />
            <button type="submit">ค้นหา</button>
          </form>
          <Link className="home-login-button" href="/login">เข้าสู่ระบบ</Link>
        </div>
        <nav className="market-nav" aria-label="เมนูหลัก">
          <a href="#solutions">หมวดหมู่ระบบ</a>
          <a href="#highlights">ความสามารถ</a>
          <a href="#about">เกี่ยวกับ SyncUp</a>
        </nav>
      </header>

      <section className="market-hero" id="about">
        <div className="market-hero-copy">
          <div className="home-eyebrow"><span /> BUSINESS MANAGEMENT PLATFORM</div>
          <h1>จัดการธุรกิจ<br /><em>ง่ายขึ้นในที่เดียว</em></h1>
          <p>พื้นที่ทำงานสำหรับร้านค้าและธุรกิจยุคใหม่ เชื่อมข้อมูลสินค้า สต๊อก สาขา และทีมงานให้ทำงานร่วมกันได้อย่างเป็นระบบ</p>
          <div className="home-hero-actions">
            <Link href="/login" className="home-primary-button">เริ่มต้นใช้งาน <span>→</span></Link>
            <a href="#solutions" className="home-text-link">เลือกดูหมวดหมู่ <span>↓</span></a>
          </div>
          <div className="home-trust"><span className="home-trust-icon">✓</span> แยกข้อมูลตาม Workspace · กำหนดสิทธิ์ได้ · ขยายระบบได้</div>
        </div>
        <div className="market-hero-panel">
          <div className="market-panel-heading"><span>SYNCUP WORKSPACE</span><b><i /> READY TO WORK</b></div>
          <div className="market-panel-title">ภาพรวมการจัดการธุรกิจ</div>
          <div className="market-metric-grid">
            <div><span>Workspace</span><strong>01</strong><small>พื้นที่ทำงาน</small></div>
            <div><span>Inventory</span><strong>360°</strong><small>จัดการคลังครบวงจร</small></div>
            <div><span>Team access</span><strong>RBAC</strong><small>กำหนดสิทธิ์ตามบทบาท</small></div>
          </div>
          <div className="market-panel-flow">
            <div><span>01</span><b>สินค้า</b><small>Product catalog</small></div><i>→</i>
            <div><span>02</span><b>คลังสินค้า</b><small>Inventory</small></div><i>→</i>
            <div><span>03</span><b>การขาย</b><small>Commerce</small></div>
          </div>
          <div className="market-panel-foot"><span><i /> ระบบออกแบบเป็นโมดูล</span><span>SYNCUP PLATFORM</span></div>
        </div>
      </section>

      <section className="market-categories" id="solutions">
        <div className="market-section-head"><div><span className="home-eyebrow">EXPLORE THE PLATFORM</span><h2>เลือกดูตามหมวดหมู่</h2></div><span>เครื่องมือสำคัญสำหรับธุรกิจในที่เดียว</span></div>
        <div className="market-category-grid">
          {filteredCategories.map(item => (
            <Link href={item.href} className="market-category-card" key={item.title}>
              <span className="market-category-icon">{item.icon}</span>
              <span className="market-category-title">{item.title}</span>
              <span className="market-category-detail">{item.detail}</span>
              <span className="market-category-arrow">↗</span>
            </Link>
          ))}
        </div>
        {filteredCategories.length === 0 && <p className="market-empty">ไม่พบหมวดหมู่ที่ตรงกับ “{search}” ลองค้นหาด้วยคำอื่น</p>}
      </section>

      <section className="market-highlights" id="highlights">
        <div className="market-section-head"><div><span className="home-eyebrow">BUILT FOR DAILY OPERATIONS</span><h2>ระบบที่เติบโตไปพร้อมธุรกิจ</h2></div><Link href="/login">เข้าสู่ Workspace →</Link></div>
        <div className="market-highlight-grid">
          {highlights.map((item, index) => (
            <article className="market-highlight-card" key={item.tag}>
              <div className="market-highlight-top"><span>{item.tag}</span><b>0{index + 1}</b></div>
              <span className="market-highlight-icon">{item.icon}</span>
              <h3>{item.title}</h3><p>{item.description}</p>
              <Link href="/login">ดูรายละเอียด <span>→</span></Link>
            </article>
          ))}
        </div>
      </section>

      <section className="market-cta">
        <div><span className="home-eyebrow">ONE CONNECTED WORKSPACE</span><h2>เริ่มต้นจัดการธุรกิจ<br />อย่างเป็นระบบวันนี้</h2></div>
        <Link href="/login" className="home-primary-button">เข้าสู่ระบบ <span>→</span></Link>
      </section>

      <footer className="home-footer"><Link href="/" className="home-brand"><span className="home-brand-mark">S</span><span>SyncUp</span></Link><span>© 2026 SyncUp. Built for businesses moving forward.</span><Link href="/login">เข้าสู่ระบบ <span>→</span></Link></footer>
    </main>
  );
}
