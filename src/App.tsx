import { useEffect, useState, type FormEvent } from 'react';
import type { AccountFixture, DashboardAccount, DeviceLoginResult, ResetCreditOption, ResetConsumeResult, UsageWindowFixture, UsageWindowSnapshot } from './types';
import './live-dashboard.css';

const demoAccounts: AccountFixture[] = [
  {
    key: 'A', name: '示範帳號 A', context: '個人 profile · fixture', credits: 1,
    windows: [
      { label: '短期使用窗口', usedPercent: 38, resetLabel: '示範重設：2 小時 18 分後' },
      { label: '每週使用窗口', usedPercent: 64, resetLabel: '示範重設：3 天 6 小時後' }
    ]
  },
  {
    key: 'B', name: '示範帳號 B', context: '工作 profile · fixture', credits: 0,
    windows: [
      { label: '短期使用窗口', usedPercent: 12, resetLabel: '示範重設：4 小時 42 分後' },
      { label: '每週使用窗口', usedPercent: 27, resetLabel: '示範重設：5 天 12 小時後' }
    ]
  }
];

function UsageWindow({ window }: { window: UsageWindowFixture }) {
  const percent = window.usedPercent;
  const available = typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100;
  const nearLimit = available && percent >= 60;
  return (
    <section className="usage-window" aria-label={window.label}>
      <div className="window-heading">
        <span className="window-name">{window.label}</span>
        <span className="percent">{available ? `${percent}%` : '官方來源未提供'}</span>
      </div>
      <div className="progress-track" role="progressbar" aria-label={window.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={available ? percent : undefined}>
        {available && <div className={`progress-fill${nearLimit ? ' near-limit' : ''}`} style={{ width: `${percent}%` }} />}
      </div>
      <div className="window-footer">
        <span>{available ? `已使用 ${percent}%` : '用量不可用'}</span>
        <span className="reset-label">{window.resetLabel || '重設時間未提供'}</span>
      </div>
    </section>
  );
}

function AccountCard({ account }: { account: AccountFixture }) {
  return (
    <article className="account-card">
      <header className="account-head">
        <div className="account-identity">
          <span className="avatar" aria-hidden="true">{account.key}</span>
          <div><h2>{account.name}</h2><p>{account.context}</p></div>
        </div>
        <span className="fixture-tag">FIXTURE</span>
      </header>
      <div className="windows">
        {account.windows.map((window) => <UsageWindow key={window.label} window={window} />)}
      </div>
      <footer className="account-foot"><span>來源：本機示範資料</span><span>同步：未連線</span></footer>
    </article>
  );
}

function FixtureApp() {
  const [notice, setNotice] = useState('');
  const refreshDemo = () => {
    setNotice('這是離線樣板，沒有連線到任何帳號。');
    window.setTimeout(() => setNotice(''), 2400);
  };

  return (
    <main className="app-shell">
      <header className="page-header">
        <div><p className="eyebrow">OPENAI PLAN MONITOR</p><h1>Codex 用量總覽</h1><p className="subtitle">依帳號查看使用窗口與下次重設資訊</p></div>
        <span className="demo-badge">FIXTURE · 離線示範</span>
      </header>
      <aside className="demo-warning" role="note"><strong>示範資料</strong><span>以下數字皆為虛構樣本；未連接 OpenAI、沒有即時同步，也不會觸發重置或帳務操作。</span></aside>
      <section className="summary-grid" aria-label="摘要">
        <div className="summary-card"><span>帳號</span><strong>2</strong><small>示範 profile</small></div>
        <div className="summary-card"><span>用量窗口</span><strong>4</strong><small>僅呈現 fixture</small></div>
        <div className="summary-card"><span>資料狀態</span><strong>離線樣板</strong><small>不含真實帳號資料</small></div>
      </section>
      <section className="accounts-grid" aria-label="示範帳號用量">
        {demoAccounts.map((account) => <AccountCard key={account.key} account={account} />)}
      </section>
      <section className="reset-card" aria-label="免費預存重置示範">
        <div><h2>免費預存重置</h2><p>重置功能尚未接線；此階段不會呼叫 consume，也不會改變帳號用量。</p></div>
        <strong className="credit-count">1 <small>個示範額度</small></strong>
        <button className="disabled-action" disabled aria-disabled="true">套用重置（未啟用）</button>
      </section>
      <footer className="page-footer"><span>畫面驗證階段 · 真實資料尚未接入</span><button className="refresh-button" onClick={refreshDemo}>刷新示範畫面</button></footer>
      {notice && <div className="toast" role="status" aria-live="polite">{notice}</div>}
    </main>
  );
}

function formatReset(epoch: number | null) {
  return epoch === null ? '重設時間未提供' : `重設時間：${new Date(epoch * 1000).toLocaleString()}`;
}

function formatCreditExpiry(credit: ResetCreditOption) {
  if (credit.expirationStatus === 'never') return '不會到期';
  if (credit.expirationStatus === 'unavailable' || credit.expiresAt === null) return '官方未提供到期時間';
  return new Date(credit.expiresAt * 1000).toLocaleString();
}

function resetOutcomeLabel(outcome: ResetConsumeResult['outcome']) {
  if (outcome === 'reset') return '官方已回報重置完成，並已重新讀取用量。';
  if (outcome === 'alreadyRedeemed') return '這筆額度先前已兌換；已重新讀取用量。';
  if (outcome === 'nothingToReset') return '目前沒有符合重置條件的用量窗口；未消耗額度。';
  return '官方回報沒有可用額度；已重新讀取狀態。';
}

function getWindowLabel(window: UsageWindowSnapshot, fallback: string) {
  const minutes = window.windowDurationMins;
  if (minutes === null) return fallback;
  if (minutes <= 360) return `短期窗口 · ${Math.round(minutes / 60)} 小時`;
  if (minutes <= 10080) return `長期窗口 · ${Math.round(minutes / 1440)} 天`;
  return `用量窗口 · ${minutes} 分鐘`;
}

function LiveUsageWindow({ label, window }: { label: string; window: UsageWindowSnapshot | null }) {
  const percent = window?.usedPercent;
  const available = typeof percent === 'number' && percent >= 0 && percent <= 100;
  return (
    <section className="usage-window" aria-label={label}>
      <div className="window-heading"><span className="window-name">{label}</span><span className="percent">{available ? `${percent}%` : '官方來源未提供'}</span></div>
      <div className="progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={available ? percent : undefined}>
        {available && <div className={`progress-fill${percent >= 75 ? ' near-limit' : ''}`} style={{ width: `${percent}%` }} />}
      </div>
      <div className="window-footer"><span>{available ? `已使用 ${percent}%` : '用量不可用'}</span><span className="reset-label">{formatReset(window?.resetsAt ?? null)}</span></div>
    </section>
  );
}

function statusLabel(account: DashboardAccount) {
  if (account.state === 'authenticated' && account.usageReadable) return '已連線';
  if (account.state === 'pending') return '等待官方驗證';
  if (account.state === 'checking' || account.state === 'starting') return '連線中';
  if (account.state === 'login-required') return '需要登入';
  if (account.state === 'failed') return '讀取失敗';
  if (account.state === 'disconnected') return '已中斷';
  return '尚未同步';
}

function LiveAccountCard({ account, busy, onRefresh, onLogin, onRemove, onLoadResetCredits, onConsumeReset }: {
  account: DashboardAccount; busy: boolean; onRefresh: () => void; onLogin: () => void; onRemove: () => void;
  onLoadResetCredits: () => void; onConsumeReset: (credit: ResetCreditOption) => void;
}) {
  const primary = account.usage?.primary ?? null;
  const secondary = account.usage?.secondary ?? null;
  return (
    <article className="account-card">
      <header className="account-head">
        <div className="account-identity"><span className="avatar" aria-hidden="true">{account.alias.slice(0, 1).toUpperCase()}</span><div><h2>{account.alias}</h2><p>獨立本機 profile · {statusLabel(account)}</p></div></div>
        <span className={`live-tag ${account.usageReadable ? 'live-tag-ok' : ''}`}>{account.usageReadable ? 'LIVE' : 'LOCAL'}</span>
      </header>
      <div className="windows">
        <LiveUsageWindow label={primary ? getWindowLabel(primary, '主要使用窗口') : '主要使用窗口'} window={primary} />
        <LiveUsageWindow label={secondary ? getWindowLabel(secondary, '次要使用窗口') : '次要使用窗口'} window={secondary} />
      </div>
      <footer className="account-foot"><span>免費預存重置額度：{account.usage?.availableResetCredits ?? '未提供'}</span><span>{account.usage?.syncedAt ? `同步：${new Date(account.usage.syncedAt).toLocaleTimeString()}` : '尚無同步資料'}</span></footer>
      {account.error && <p className="account-error" role="status">{account.error}</p>}
      <section className="reset-credits" aria-label="免費重置額度">
        <div className="reset-credits-heading"><div><h3>免費重置額度</h3><p>僅使用官方標示為可用的額度；每次操作都會再次確認。</p></div>
          {account.usageReadable && <button className="refresh-button" disabled={busy} onClick={onLoadResetCredits}>{account.resetNeedsRefresh ? '重新載入並確認結果' : account.resetDetailsLoaded ? '更新額度明細' : '查看可用額度與到期時間'}</button>}
        </div>
        {account.resetNeedsRefresh && <p className="reset-warning" role="status">上次重置結果需先確認；請重新載入明細後再操作。</p>}
        {account.resetDetailsLoaded && account.resetCredits === null && <p className="reset-empty">官方提供了額度數量，但沒有提供可選的逐筆明細，因此目前不能安全選取重置。</p>}
        {account.resetDetailsLoaded && account.resetCredits?.length === 0 && <p className="reset-empty">目前沒有可選的免費重置額度。</p>}
        {account.resetCredits?.map((credit) => <div className="reset-credit-row" key={credit.handle}>
          <div><strong>{credit.title || '免費重置額度'}</strong>{credit.description && <p>{credit.description}</p>}<small>到期時間：{formatCreditExpiry(credit)}</small></div>
          <button className="reset-action" disabled={busy || !account.usageReadable || account.resetNeedsRefresh} onClick={() => onConsumeReset(credit)}>重置用量</button>
        </div>)}
        {!account.usageReadable && <p className="reset-empty">登入並成功同步用量後，才會載入可用額度明細。</p>}
      </section>
      <div className="account-actions">
        <button className="refresh-button" disabled={busy} onClick={onRefresh}>{busy ? '讀取中…' : '刷新用量'}</button>
        {!account.usageReadable && ['not-connected', 'login-required', 'cancelled', 'cleaned', 'disconnected'].includes(account.state) && <button className="login-button" disabled={busy} onClick={onLogin}>官方登入</button>}
        <button className="remove-button" disabled={busy} onClick={onRemove}>移除並清除本機 profile</button>
      </div>
    </article>
  );
}

function LiveApp() {
  const api = window.dashboardApi!;
  const [accounts, setAccounts] = useState<DashboardAccount[]>([]);
  const [alias, setAlias] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [login, setLogin] = useState<DeviceLoginResult | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    void api.listAccounts().then((items) => { if (active) setAccounts(items); }).catch(() => { if (active) setNotice('無法載入本機帳號清單。'); });
    const unsubscribe = api.onAccountsChanged((items) => {
      setAccounts(items);
      setLogin((current) => current && items.some((item) => item.id === current.account.id && ['starting', 'pending'].includes(item.state)) ? current : null);
    });
    return () => { active = false; unsubscribe(); };
  }, [api]);

  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !alias.trim()) return;
    setBusy(true); setNotice('');
    try {
      const result = await api.addAccount(alias);
      setLogin(result); setAlias(''); setAccounts(await api.listAccounts());
    } catch { setNotice('新增帳號失敗；請確認名稱未重複後重試。'); }
    finally { setBusy(false); }
  }

  async function startLogin(accountId: string) {
    setBusyId(accountId); setNotice('');
    try { setLogin(await api.startLogin(accountId)); }
    catch { setNotice('無法啟動官方登入流程。'); }
    finally { setBusyId(''); }
  }

  async function refresh(accountId: string) {
    setBusyId(accountId); setNotice('');
    try { const updated = await api.refreshAccount(accountId); if (updated) setAccounts((current) => current.map((item) => item.id === accountId ? updated : item)); }
    catch { setNotice('用量讀取失敗；資料不會被改寫。'); }
    finally { setBusyId(''); }
  }

  async function loadResetCredits(accountId: string) {
    setBusyId(accountId); setNotice('');
    try {
      const updated = await api.refreshResetCredits(accountId);
      if (updated) setAccounts((current) => current.map((item) => item.id === accountId ? updated : item));
    } catch { setNotice('無法載入重置額度明細；尚未執行重置。'); }
    finally { setBusyId(''); }
  }

  async function consumeReset(accountId: string, credit: ResetCreditOption) {
    const expiry = formatCreditExpiry(credit);
    const label = credit.title || '免費重置額度';
    const explanation = credit.description || '官方未提供額度說明';
    const confirmed = window.confirm(`確定使用「${label}」重置用量？\n官方說明：${explanation}\n到期時間：${expiry}\n此操作會消耗這筆免費額度，並可能重置其涵蓋的用量窗口及改變下次重設時間。此操作可能無法撤回，不會付款或購買額度。`);
    if (!confirmed) return;
    setBusyId(accountId); setNotice('');
    try {
      const result = await api.consumeResetCredit(accountId, credit.handle);
      setAccounts((current) => current.map((item) => item.id === accountId ? result.account : item));
      setNotice(resetOutcomeLabel(result.outcome));
    } catch { setNotice('重置結果尚未確認；請在帳號卡按「重新載入並確認結果」，不要直接重試。'); }
    finally { setBusyId(''); }
  }

  async function remove(account: DashboardAccount) {
    if (!window.confirm(`確定移除「${account.alias}」並永久刪除其本機登入 profile？`)) return;
    setBusyId(account.id); setNotice('');
    try { await api.removeAccount(account.id); setLogin((current) => current?.account.id === account.id ? null : current); setAccounts(await api.listAccounts()); }
    catch { setNotice('移除失敗；本機 profile 尚未確認清除。'); }
    finally { setBusyId(''); }
  }

  const totalWindows = accounts.reduce((total, account) => total + Number(Boolean(account.usage?.primary)) + Number(Boolean(account.usage?.secondary)), 0);
  return (
    <main className="app-shell">
      <header className="page-header"><div><p className="eyebrow">OPENAI PLAN MONITOR</p><h1>Codex 用量總覽</h1><p className="subtitle">每個帳號使用獨立本機 Codex profile</p></div><span className="demo-badge live-badge">本機唯讀同步</span></header>
      <aside className="demo-warning"><strong>認證安全</strong><span>認證由 Codex CLI 保存於隔離 profile；此程式不讀取或複製 token。裝置代碼只在畫面記憶體短暫顯示。切勿與他人分享裝置代碼。只能在 OpenAI 官方 HTTPS 驗證頁輸入。若驗證要求 API key、付款或改方案，請取消。重置僅能選擇官方回報的可用免費額度，且每次都需再次確認。</span></aside>
      <section className="summary-grid" aria-label="摘要"><div className="summary-card"><span>本機帳號</span><strong>{accounts.length}</strong><small>各自隔離 profile</small></div><div className="summary-card"><span>可讀用量窗口</span><strong>{totalWindows}</strong><small>官方回傳欄位</small></div><div className="summary-card"><span>資料模式</span><strong>唯讀</strong><small>不含 API 帳務／方案操作</small></div></section>
      <form className="add-account-form" onSubmit={addAccount}><label htmlFor="account-alias">新增 ChatGPT／Codex 帳號</label><div><input id="account-alias" value={alias} onChange={(event) => setAlias(event.target.value)} maxLength={48} placeholder="本機辨識名稱，例如：個人" required /><button className="login-button" disabled={busy || !alias.trim()}>{busy ? '準備中…' : '新增並開始官方登入'}</button></div></form>
      {login && <section className="device-login" aria-live="polite"><strong>切勿與他人分享裝置代碼。</strong><span>僅由你本人前往官方頁面輸入；助理與程式不會讀取驗證頁內容。</span><code>{login.login.userCode}</code><a href={login.login.verificationUrl} target="_blank" rel="noreferrer">開啟官方 OpenAI 驗證頁</a><button className="remove-button" onClick={() => setLogin(null)}>隱藏代碼</button></section>}
      {notice && <p className="account-error" role="status">{notice}</p>}
      <section className="accounts-grid" aria-label="帳號用量">{accounts.map((account) => <LiveAccountCard key={account.id} account={account} busy={busyId === account.id || busy} onRefresh={() => void refresh(account.id)} onLogin={() => void startLogin(account.id)} onRemove={() => void remove(account)} onLoadResetCredits={() => void loadResetCredits(account.id)} onConsumeReset={(credit) => void consumeReset(account.id, credit)} />)}</section>
      {accounts.length === 0 && <p className="empty-state">尚未新增帳號。新增後會建立獨立 profile，僅在你明確開始時啟動官方 device-code 登入。</p>}
      <footer className="page-footer"><span>重置僅限官方回報的免費額度，需逐次確認；不含付款或購買 credits</span><button className="refresh-button" disabled={busy} onClick={() => { setBusy(true); void api.listAccounts().then(setAccounts).finally(() => setBusy(false)); }}>刷新帳號清單</button></footer>
    </main>
  );
}

export default function App() {
  return window.dashboardApi ? <LiveApp /> : <FixtureApp />;
}
