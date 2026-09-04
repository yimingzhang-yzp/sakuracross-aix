'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS: Array<{ title: string; items: Array<{ href: string; label: string }> }> = [
  {
    title: 'シフト',
    items: [
      { href: '/admin', label: 'ダッシュボード' },
      { href: '/admin/calendar', label: 'カレンダー・必要人員' },
      { href: '/admin/periods', label: 'シフト期間・生成' },
      { href: '/admin/open-shifts', label: '欠員募集' },
    ],
  },
  {
    title: '勤怠・給与',
    items: [
      { href: '/admin/attendance', label: '勤怠管理' },
      { href: '/admin/payroll', label: '給与計算' },
    ],
  },
  {
    title: 'マスタ',
    items: [
      { href: '/admin/staff', label: 'スタッフ' },
      { href: '/admin/templates', label: '必要人員テンプレート' },
      { href: '/admin/settings', label: '設定' },
      { href: '/admin/notifications', label: 'LINE 送信ログ' },
    ],
  },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav>
      {SECTIONS.map((section) => (
        <div key={section.title}>
          <div className="section">{section.title}</div>
          {section.items.map((item) => {
            const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={active ? 'active' : undefined}>
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
