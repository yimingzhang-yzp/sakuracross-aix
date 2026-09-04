import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main style={{ maxWidth: 480, margin: '10vh auto', textAlign: 'center' }}>
      <h1>権限がありません</h1>
      <p>この画面は店長・経理(ADMIN)専用です。管理者にアクセス権限の付与を依頼してください。</p>
      <Link href="/login">ログイン画面へ</Link>
    </main>
  );
}
