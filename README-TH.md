# Dim Sum Queue — Convex Real-time

โปรเจกต์นี้ใช้ Convex เป็นฐานข้อมูลหลัก ทุกหน้าจอจะได้รับข้อมูลใหม่อัตโนมัติผ่าน `useQuery` และรองรับสูงสุด 50 เข่งต่อรายการ

## ครั้งแรกบนเครื่องนี้

```powershell
npm install
npx convex login
```

## ทดสอบกับ Convex Development

เปิด Terminal ที่ 1:

```powershell
npm run convex:dev
```

เปิด Terminal ที่ 2:

```powershell
npm run dev
```

## Deploy Convex Production + Cloudflare Workers

```powershell
npm run deploy
```

คำสั่งนี้จะอัปเดต schema/mutation ของ Convex, build หน้าเว็บด้วย URL ของ Production Convex และ deploy ไฟล์ `dist` ไป Cloudflare Workers ตามลำดับ

> ห้ามเปิดหน้าเว็บ Production ก่อน `convex deploy` สำเร็จ เพราะหน้าเว็บเวอร์ชันใหม่นี้ต้องใช้ mutation ชุดใหม่ใน `convex/pots.ts`
