import { getLineChannelEnv } from '@sakura-cross/line-router';

import { db } from '@/lib/db';
import type { LinePushPayload } from '@/lib/line/queue';

import { dispatchNowAction, retryJobAction } from './actions';

// LINE 配信や一括処理を含むため、既定(15秒)より長い上限を設定する
export const maxDuration = 60;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const [jobs, params] = await Promise.all([
    db().job.findMany({ where: { kind: 'LINE_PUSH' }, orderBy: { createdAt: 'desc' }, take: 100 }),
    searchParams,
  ]);
  const staffEnv = getLineChannelEnv('staff');
  const adminEnv = getLineChannelEnv('admin');

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>LINE 送信ログ</h1>
        <span className="spacer" />
        <form action={dispatchNowAction}>
          <button type="submit" className="btn">
            待機中のジョブを今すぐ送信
          </button>
        </form>
      </div>
      {params.ok ? <div className="alert success">{params.ok}</div> : null}
      <div className="alert warn">
        スタッフ用アカウント: {staffEnv.configured ? '接続済み' : '未設定(モック送信。内容はサーバーログに出力されます)'} / 管理用アカウント:{' '}
        {adminEnv.configured ? '接続済み' : '未設定'}
      </div>
      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>日時</th>
              <th>用途</th>
              <th>宛先</th>
              <th>内容</th>
              <th>状態</th>
              <th className="num">試行</th>
              <th>エラー</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  送信ログはありません
                </td>
              </tr>
            ) : (
              jobs.map((job) => {
                const p = job.payload as unknown as LinePushPayload;
                const first = p.messages?.[0];
                const summary = first?.type === 'text' ? String((first as { text?: string }).text ?? '').slice(0, 80) : first?.type === 'flex' ? `[Flex] ${String((first as { altText?: string }).altText ?? '')}` : first?.type;
                return (
                  <tr key={job.id}>
                    <td className="small">{job.createdAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
                    <td>
                      <span className="badge">{p.kind}</span>
                      <div className="muted small">{p.channel}</div>
                    </td>
                    <td className="small">
                      <code>{p.to}</code>
                    </td>
                    <td className="small" style={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}>
                      {summary}
                    </td>
                    <td>
                      <span className={`badge ${job.status === 'DONE' ? 'ok' : job.status === 'FAILED' ? 'danger' : job.status === 'PENDING' ? 'warn' : ''}`}>{job.status}</span>
                    </td>
                    <td className="num">
                      {job.attempts}/{job.maxAttempts}
                    </td>
                    <td className="small" style={{ color: 'var(--danger)', maxWidth: 240 }}>
                      {job.lastError}
                    </td>
                    <td>
                      {job.status === 'FAILED' ? (
                        <form action={retryJobAction}>
                          <input type="hidden" name="id" value={job.id} />
                          <button type="submit" className="btn sm">
                            再試行
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
