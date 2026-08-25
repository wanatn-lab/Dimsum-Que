import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import App from './App.jsx';

const convexUrl = import.meta.env.VITE_CONVEX_URL;

function Root() {
  // ยังไม่ตั้งค่า Convex — ขึ้นข้อความแนะนำแทนหน้าจอว่างๆ/error ที่งง
  if (!convexUrl) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#020617',
          color: '#f8fafc',
          fontFamily: 'sans-serif',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div>
          <p style={{ fontSize: 20, fontWeight: 700 }}>ยังไม่ได้ตั้งค่า Convex</p>
          <p style={{ marginTop: 8, color: '#94a3b8' }}>
            เพิ่ม environment variable <code>VITE_CONVEX_URL</code> ใน Cloudflare Pages settings
            <br />
            (ได้จากการรัน <code>npx convex dev</code>) แล้ว deploy ใหม่อีกครั้ง
          </p>
        </div>
      </div>
    );
  }

  const convex = new ConvexReactClient(convexUrl);
  return (
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
