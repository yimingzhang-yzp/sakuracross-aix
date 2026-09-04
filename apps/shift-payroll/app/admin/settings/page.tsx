import { loadSettings } from '@/lib/db';

import { SettingsForm } from './settings-form';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const [settings, params] = await Promise.all([loadSettings(), searchParams]);
  return (
    <>
      <h1>設定</h1>
      <p className="muted">
        時給・締め日・丸め・休憩・深夜割増・週上限などの業務パラメータです。給与計算の実行時点の値がスナップショットとして各計算に保存されます。
      </p>
      {params.saved ? <div className="alert success">保存しました。</div> : null}
      {params.error ? <div className="alert error">{params.error}</div> : null}
      <SettingsForm settings={settings} />
    </>
  );
}
