import { resetSettings, updateSettings } from '../actions';
import { ActionForm } from '../action-form';
import { getStore, loadSettings } from '@/lib/store';

export default async function SettingsPage() {
  const store = await getStore();
  const settings = await loadSettings(store);
  const rules = [...settings.emergencyRules, { id: '', title: '', keywords: [] as string[], response: '' }];

  return (
    <>
      <div className="page-header">
        <h1>設定</h1>
        <form action={resetSettings}>
          <button type="submit" className="btn btn-sm">
            既定値に戻す
          </button>
        </form>
      </div>
      <p className="muted">Bot の文言・しきい値・緊急固定応答はすべてここで変更できます(コードにハードコードしていません)。保存すると即時反映されます。</p>

      <ActionForm action={updateSettings} submitLabel="設定を保存">
        <section className="card">
          <h2>緊急キーワードの固定応答</h2>
          <p className="small muted">
            メッセージにキーワードが含まれると、AI を介さず 1 秒以内にこの応答を返します(末尾に「責任者連絡先」が付きます)。キーワードは読点・カンマ・改行区切り。
          </p>
          <input type="hidden" name="ruleCount" value={rules.length} />
          {rules.map((rule, i) => (
            <div key={rule.id || `new-${i}`} className="card" style={{ background: '#f8fafc' }}>
              <input type="hidden" name={`rule_${i}_id`} value={rule.id} />
              <div className="grid grid-2">
                <div className="field">
                  <label>タイトル {rule.id ? '' : '(新規追加)'}</label>
                  <input className="input" name={`rule_${i}_title`} defaultValue={rule.title} placeholder="例: 救急・体調不良者" />
                </div>
                <div className="field">
                  <label>キーワード</label>
                  <input className="input" name={`rule_${i}_keywords`} defaultValue={rule.keywords.join('、')} placeholder="救急、救急車、倒れた" />
                </div>
              </div>
              <div className="field">
                <label>固定応答</label>
                <textarea name={`rule_${i}_response`} defaultValue={rule.response} style={{ minHeight: 140 }} />
              </div>
              {rule.id ? (
                <label className="small">
                  <input type="checkbox" name={`rule_${i}_remove`} /> このルールを削除
                </label>
              ) : null}
            </div>
          ))}
          <div className="field">
            <label htmlFor="managerContact">責任者連絡先(固定応答の末尾に付く)</label>
            <textarea id="managerContact" name="managerContact" defaultValue={settings.managerContact} style={{ minHeight: 60 }} />
          </div>
        </section>

        <section className="card">
          <h2>LINE の文言</h2>
          <div className="field">
            <label htmlFor="greeting">友だち追加時のあいさつ(「記録され、店長が閲覧できます」の明示は必須)</label>
            <textarea id="greeting" name="greeting" defaultValue={settings.greeting} />
          </div>
          <div className="field">
            <label htmlFor="loggingNotice">記録告知文(新しい会話の最初の応答に付く)</label>
            <input id="loggingNotice" className="input" name="loggingNotice" defaultValue={settings.loggingNotice} />
          </div>
          <div className="field">
            <label htmlFor="escalationReply">マニュアルに根拠が無いときの返答</label>
            <textarea id="escalationReply" name="escalationReply" defaultValue={settings.escalationReply} style={{ minHeight: 80 }} />
          </div>
          <div className="field">
            <label htmlFor="lowConfidenceSuffix">確信度が低いときに回答末尾へ付ける注意書き</label>
            <input id="lowConfidenceSuffix" className="input" name="lowConfidenceSuffix" defaultValue={settings.lowConfidenceSuffix} />
          </div>
          <div className="field">
            <label htmlFor="hrRedirectReply">給与・評価・シフト割当など個別人事の質問への返答</label>
            <textarea id="hrRedirectReply" name="hrRedirectReply" defaultValue={settings.hrRedirectReply} style={{ minHeight: 80 }} />
          </div>
          <div className="field">
            <label htmlFor="managerAnswerTemplate">店長回答を届けるテンプレート({'{{question}}'} / {'{{answer}}'})</label>
            <textarea id="managerAnswerTemplate" name="managerAnswerTemplate" defaultValue={settings.managerAnswerTemplate} style={{ minHeight: 80 }} />
          </div>
          <div className="field">
            <label htmlFor="nonTextReply">画像・スタンプを受けたときの返答</label>
            <textarea id="nonTextReply" name="nonTextReply" defaultValue={settings.nonTextReply} style={{ minHeight: 60 }} />
          </div>
        </section>

        <section className="card">
          <h2>回答生成のパラメータ</h2>
          <div className="grid grid-4">
            <div className="field">
              <label htmlFor="answerMaxChars">回答の目安文字数</label>
              <input id="answerMaxChars" className="input" type="number" name="answerMaxChars" min={100} max={2000} defaultValue={settings.answerMaxChars} />
            </div>
            <div className="field">
              <label htmlFor="sessionMinutes">会話セッション(分)</label>
              <input id="sessionMinutes" className="input" type="number" name="sessionMinutes" min={5} max={240} defaultValue={settings.sessionMinutes} />
              <span className="hint">この時間無応答で新しい会話に</span>
            </div>
            <div className="field">
              <label htmlFor="maxTurns">文脈に渡す最大往復数</label>
              <input id="maxTurns" className="input" type="number" name="maxTurns" min={1} max={30} defaultValue={settings.maxTurns} />
            </div>
            <div className="field">
              <label htmlFor="retrieveLimit">検索チャンク数</label>
              <input id="retrieveLimit" className="input" type="number" name="retrieveLimit" min={3} max={30} defaultValue={settings.retrieveLimit} />
            </div>
          </div>
        </section>
      </ActionForm>
    </>
  );
}
