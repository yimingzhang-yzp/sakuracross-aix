import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'CROSS ROPPONGI | AI上司 管理画面',
  description: 'CROSS ROPPONGI AI上司(新人教育・現場 Q&A ボット)管理画面',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
