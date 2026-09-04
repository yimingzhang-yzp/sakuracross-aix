'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/liff/preference', label: '希望提出' },
  { href: '/liff/schedule', label: 'シフト確認' },
  { href: '/liff/timeclock', label: '打刻' },
  { href: '/liff/payslip', label: '給与明細' },
];

export function LiffNav() {
  const pathname = usePathname();
  return (
    <nav style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
      {ITEMS.map((item) => (
        <Link key={item.href} href={item.href} className={`btn sm ${pathname.startsWith(item.href) ? 'primary' : ''}`}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
