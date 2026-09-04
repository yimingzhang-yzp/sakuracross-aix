'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'ダッシュボード', exact: true },
  { href: '/admin/chat', label: 'チャットテスト' },
  { href: '/admin/escalations', label: '未回答キュー' },
  { href: '/admin/knowledge', label: 'ナレッジ管理' },
  { href: '/admin/knowledge/import', label: 'マニュアル取込' },
  { href: '/admin/conversations', label: '会話ログ' },
  { href: '/admin/staff', label: 'スタッフ(仮登録)' },
  { href: '/admin/settings', label: '設定' },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav>
      {LINKS.map((link) => {
        const active =
          'exact' in link && link.exact
            ? pathname === link.href
            : link.href === '/admin/knowledge'
              ? pathname.startsWith('/admin/knowledge') && !pathname.startsWith('/admin/knowledge/import')
              : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} className={active ? 'active' : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
