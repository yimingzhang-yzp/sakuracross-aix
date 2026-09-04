import { formatTokyoFull } from '@/lib/format';
import { getStore } from '@/lib/store';

export default async function StaffPage() {
  const store = await getStore();
  const staff = await store.listStaff();
  const provisional = staff.filter((s) => !s.isActive && s.lineUserId);
  const registered = staff.filter((s) => s.isActive);

  return (
    <>
      <div className="page-header">
        <h1>スタッフ</h1>
      </div>
      <div className="notice notice-info">
        LINE から初めて話しかけてきた未登録のユーザーは、会話を記録するために<strong>仮登録スタッフ</strong>として自動作成されます(シフト給与システムの
        スタッフ登録が整うまでの暫定運用)。本人との紐付け・氏名の修正はシフト給与システム側のスタッフ管理で行います。
      </div>

      <section className="card">
        <h2>仮登録スタッフ({provisional.length})</h2>
        {provisional.length === 0 ? (
          <p className="muted">仮登録のスタッフはいません。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>表示名</th>
                <th>LINE userId(末尾)</th>
                <th>初回接触</th>
              </tr>
            </thead>
            <tbody>
              {provisional.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="mono">…{s.lineUserId?.slice(-8)}</td>
                  <td>{formatTokyoFull(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>登録済みスタッフ({registered.length})</h2>
        {registered.length === 0 ? (
          <p className="muted">登録済みのスタッフはいません(シフト給与システムで登録します)。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>氏名</th>
                <th>職種</th>
                <th>LINE 連携</th>
                <th>管理権限</th>
                <th>入店日</th>
              </tr>
            </thead>
            <tbody>
              {registered.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.role}</td>
                  <td>{s.lineUserId ? <span className="badge badge-green">連携済み</span> : <span className="badge badge-gray">未連携</span>}</td>
                  <td>{s.accessRole === 'ADMIN' ? <span className="badge badge-blue">ADMIN</span> : '—'}</td>
                  <td>{s.hiredAt ? formatTokyoFull(s.hiredAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
