import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'CROSS ROPPONGI | 請求書管理',
  description: 'CROSS ROPPONGI 請求書管理 管理画面',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          padding: '2rem',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif',
          color: '#1f2933',
          background: '#f8fafc',
        }}
      >
        {children}
      </body>
    </html>
  );
}
