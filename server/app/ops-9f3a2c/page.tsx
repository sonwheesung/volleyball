'use client';
// 배구명가 운영 콘솔 (BACKEND_SYSTEM §13.15) — 로그인 게이트 + 대시보드(개요·쿠폰·공지·운영설정·문의/환불).
// URL은 /admin 아님(추측 차단, 2026-07-04 사용자 요청) — 실제 보안은 ADMIN_TOKEN(requireAdmin fail-closed §13.15).
// 인라인 스타일 + 내장 <style>(정적 CSS)만 — 외부 스크립트/스타일 0(XSS 표면 최소). 관리자 전용 화면.
import { useCallback, useEffect, useId, useMemo, useState } from 'react';

type Json = Record<string, unknown>;
type Tab = 'overview' | 'coupons' | 'anns' | 'settings' | 'tickets';

async function apiCall(path: string, token: string, init?: RequestInit): Promise<{ status: number; body: Json }> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
  let body: Json = {};
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

const CSS = `
:root{--bg:#0a0e16;--panel:#0f1420;--card:#141b29;--card2:#0f1622;--bd:#232d3f;--bd2:#1a2334;--tx:#e7edf6;--mut:#8a97ab;--ac:#19c2ae;--ac2:#5b9bff;--dg:#ff6b5a;--gd:#2bd17e;--wn:#f2a93b;--vi:#9b7bff;}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--tx);font-family:'Pretendard',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;}
.oc-login{min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 600px at 50% -10%,#16243a 0%,var(--bg) 60%);padding:24px;}
.oc-login-card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--bd);border-radius:18px;padding:34px 30px;box-shadow:0 24px 60px rgba(0,0,0,.5);}
.oc-logo{font-size:26px;font-weight:900;letter-spacing:-.5px;display:flex;align-items:center;gap:10px;}
.oc-sub{color:var(--mut);font-size:13px;margin:8px 0 24px;line-height:1.6;}
.oc-label{font-size:12px;font-weight:700;color:var(--mut);margin-bottom:7px;display:block;text-transform:uppercase;letter-spacing:.4px;}
.oc-input{width:100%;background:var(--card2);border:1px solid var(--bd);border-radius:10px;padding:12px 14px;color:var(--tx);font-size:14px;outline:none;transition:border-color .15s,box-shadow .15s;}
.oc-input:focus{border-color:var(--ac);box-shadow:0 0 0 3px rgba(25,194,174,.16);}
.oc-input::placeholder{color:#5c6a80;}
select.oc-input{appearance:none;-webkit-appearance:none;cursor:pointer;padding-right:30px;background-image:linear-gradient(45deg,transparent 50%,var(--mut) 50%),linear-gradient(135deg,var(--mut) 50%,transparent 50%);background-position:calc(100% - 16px) center,calc(100% - 11px) center;background-size:5px 5px,5px 5px;background-repeat:no-repeat;}
select.oc-input option{background:var(--card);color:var(--tx);}
.oc-btn{border:none;border-radius:10px;padding:12px 18px;font-size:14px;font-weight:800;cursor:pointer;transition:transform .08s,filter .15s,background .15s;background:var(--ac);color:#04150e;}
.oc-btn:hover{filter:brightness(1.08);} .oc-btn:active{transform:translateY(1px);} .oc-btn:disabled{opacity:.5;cursor:not-allowed;}
.oc-btn.blue{background:var(--ac2);color:#fff;} .oc-btn.red{background:var(--dg);color:#fff;} .oc-btn.ghost{background:transparent;border:1px solid var(--bd);color:var(--tx);}
.oc-btn.sm{padding:7px 12px;font-size:12.5px;border-radius:8px;}
.oc-err{color:var(--dg);font-size:13px;margin-top:12px;} .oc-ok{color:var(--gd);font-size:13px;margin-top:12px;}
.oc-shell{display:grid;grid-template-columns:240px 1fr;min-height:100vh;}
.oc-side{background:var(--panel);border-right:1px solid var(--bd2);padding:20px 14px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;}
.oc-nav{display:flex;flex-direction:column;gap:4px;margin-top:22px;flex:1;}
.oc-navitem{display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:10px;color:var(--mut);font-size:14px;font-weight:600;cursor:pointer;border:none;background:transparent;text-align:left;transition:background .12s,color .12s;width:100%;}
.oc-navitem:hover{background:var(--bd2);color:var(--tx);}
.oc-navitem.on{background:rgba(25,194,174,.14);color:var(--ac);font-weight:800;}
.oc-navitem .ic{width:18px;text-align:center;font-size:15px;}
.oc-navitem .bdg{margin-left:auto;background:var(--dg);color:#fff;font-size:11px;font-weight:800;border-radius:999px;padding:1px 7px;}
.oc-main{padding:26px 30px;max-width:1080px;}
.oc-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;}
.oc-h1{font-size:22px;font-weight:900;letter-spacing:-.3px;} .oc-crumb{color:var(--mut);font-size:13px;margin-top:3px;}
.oc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:24px;}
.oc-stat{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:18px;}
.oc-stat .k{color:var(--mut);font-size:12.5px;font-weight:700;display:flex;align-items:center;gap:7px;}
.oc-stat .v{font-size:28px;font-weight:900;margin-top:8px;letter-spacing:-.5px;}
.oc-stat .s{color:var(--mut);font-size:12px;margin-top:3px;}
.oc-card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:20px;margin-bottom:18px;}
.oc-card h3{font-size:15px;font-weight:800;margin:0 0 14px;display:flex;align-items:center;gap:8px;}
.oc-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;}
.oc-field{display:flex;flex-direction:column;gap:6px;}
.oc-table{width:100%;border-collapse:collapse;font-size:13px;}
.oc-table th{text-align:left;color:var(--mut);font-weight:700;font-size:12px;padding:9px 10px;border-bottom:1px solid var(--bd);text-transform:uppercase;letter-spacing:.3px;}
.oc-table td{padding:11px 10px;border-bottom:1px solid var(--bd2);vertical-align:middle;}
.oc-table tr:last-child td{border-bottom:none;}
.oc-badge{display:inline-block;font-size:11.5px;font-weight:800;border-radius:999px;padding:2px 9px;}
.oc-badge.gd{background:rgba(43,209,126,.16);color:var(--gd);} .oc-badge.mut{background:var(--bd2);color:var(--mut);}
.oc-badge.dg{background:rgba(255,107,90,.16);color:var(--dg);} .oc-badge.wn{background:rgba(242,169,59,.16);color:var(--wn);} .oc-badge.ac{background:rgba(91,155,255,.16);color:var(--ac2);}
.oc-empty{color:var(--mut);font-size:13px;padding:22px 0;text-align:center;}
.oc-tick{border:1px solid var(--bd);border-radius:12px;padding:15px;margin-bottom:12px;background:var(--card2);}
.oc-tick.refund{border-color:rgba(255,107,90,.4);} .oc-tick.done{border-color:rgba(43,209,126,.4);}
.oc-mut{color:var(--mut);font-size:12px;} .oc-pre{margin-top:10px;max-height:280px;overflow:auto;background:#070b12;border:1px solid var(--bd);color:#c8d2e0;padding:12px;border-radius:10px;font-size:11px;line-height:1.5;}
textarea.oc-input{resize:vertical;min-height:44px;font-family:inherit;}
.oc-toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:12px 20px;font-size:13.5px;font-weight:700;box-shadow:0 12px 40px rgba(0,0,0,.5);z-index:50;}
.oc-charts{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
@media(max-width:820px){.oc-charts{grid-template-columns:1fr;}}
.oc-chart{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:18px 18px 12px;}
.oc-chart .ct{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;}
.oc-chart .ct .t{font-size:14px;font-weight:800;} .oc-chart .ct .v{font-size:13px;font-weight:800;color:var(--ac);}
.oc-chart .ct .tag{font-size:10.5px;font-weight:700;color:var(--wn);background:rgba(242,169,59,.14);border-radius:6px;padding:2px 7px;margin-left:7px;}
.oc-svg{width:100%;height:auto;display:block;overflow:visible;}
.oc-svg rect,.oc-svg path,.oc-svg circle{transition:opacity .2s;}
.oc-xaxis{display:flex;justify-content:space-between;margin-top:9px;color:var(--mut);font-size:10.5px;font-variant-numeric:tabular-nums;}
.oc-empty2{color:var(--mut);font-size:12px;text-align:center;padding:60px 0;}
.oc-cardhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.oc-cardhead h3{margin:0;}
.oc-table tr.clk{cursor:pointer;} .oc-table tr.clk:hover td{background:rgba(255,255,255,.028);}
.oc-modal-bd{position:fixed;inset:0;background:rgba(3,6,11,.68);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;padding:56px 20px 40px;z-index:100;overflow-y:auto;}
.oc-modal{width:100%;max-width:520px;background:var(--card);border:1px solid var(--bd);border-radius:18px;box-shadow:0 32px 90px rgba(0,0,0,.65);animation:ocpop .17s cubic-bezier(.2,.8,.2,1);}
.oc-modal.wide{max-width:640px;}
@keyframes ocpop{from{opacity:0;transform:translateY(-10px) scale(.985);}to{opacity:1;transform:none;}}
.oc-modal-h{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--bd2);}
.oc-modal-h .mt{font-size:16px;font-weight:800;} .oc-modal-h .ms{font-size:12px;color:var(--mut);margin-top:2px;}
.oc-x{background:transparent;border:none;color:var(--mut);font-size:17px;cursor:pointer;padding:4px 9px;border-radius:9px;line-height:1;}
.oc-x:hover{background:var(--bd2);color:var(--tx);}
.oc-modal-b{padding:22px;display:flex;flex-direction:column;gap:15px;}
.oc-modal-f{display:flex;justify-content:flex-end;gap:10px;padding:15px 22px;border-top:1px solid var(--bd2);}
.oc-fld{display:flex;flex-direction:column;gap:7px;} .oc-fld .oc-input{width:100%;}
.oc-frow{display:flex;gap:12px;} .oc-frow .oc-fld{flex:1;}
.oc-dl{display:flex;flex-direction:column;}
.oc-dl-row{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:13px 2px;border-bottom:1px solid var(--bd2);}
.oc-dl-row:last-child{border-bottom:none;}
.oc-dl-k{color:var(--mut);font-size:13px;font-weight:600;flex-shrink:0;}
.oc-dl-v{font-size:14px;font-weight:600;text-align:right;word-break:break-word;}
.oc-dl-v.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;letter-spacing:.3px;}
.oc-dl-block{padding:13px 2px;border-bottom:1px solid var(--bd2);}
.oc-dl-block .oc-dl-k{margin-bottom:8px;}
.oc-dl-block .txt{font-size:14px;line-height:1.65;white-space:pre-wrap;}
.oc-modal-f.split{justify-content:space-between;}
.oc-modal-b.tight{gap:0;padding-top:8px;padding-bottom:8px;}
`;

export default function OpsConsole() {
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState<boolean | null>(null); // null=확인중, false=로그인, true=대시보드

  // 부팅 시 저장 토큰으로 자동 검증
  useEffect(() => {
    const t = localStorage.getItem('adminToken') ?? '';
    if (!t) { setAuthed(false); return; }
    setToken(t);
    apiCall('/api/admin/setting', t).then((r) => setAuthed(r.status !== 401));
  }, []);

  const onLogin = (t: string) => { setToken(t); localStorage.setItem('adminToken', t); setAuthed(true); };
  const onLogout = () => { localStorage.removeItem('adminToken'); setToken(''); setAuthed(false); };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {authed === null ? (
        <div className="oc-login"><div className="oc-sub">확인 중…</div></div>
      ) : authed ? (
        <Dashboard token={token} onLogout={onLogout} />
      ) : (
        <Login initial={token} onLogin={onLogin} />
      )}
    </>
  );
}

function Login({ initial, onLogin }: { initial: string; onLogin: (t: string) => void }) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!v.trim() || busy) return;
    setBusy(true); setErr('');
    const r = await apiCall('/api/admin/setting', v.trim());
    setBusy(false);
    if (r.status === 401) { setErr('토큰이 올바르지 않습니다.'); return; }
    onLogin(v.trim());
  };
  return (
    <div className="oc-login">
      <div className="oc-login-card">
        <div className="oc-logo">🏐 운영 콘솔</div>
        <div className="oc-sub">배구명가 관리자 전용 · ADMIN_TOKEN으로 로그인</div>
        <label className="oc-label">ADMIN TOKEN</label>
        <input className="oc-input" type="password" placeholder="관리자 토큰 입력" value={v}
          onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} autoFocus />
        <button className="oc-btn" style={{ width: '100%', marginTop: 18 }} onClick={submit} disabled={busy || !v.trim()}>
          {busy ? '확인 중…' : '로그인'}
        </button>
        {err ? <p className="oc-err">{err}</p> : null}
      </div>
    </div>
  );
}

const NAV: { id: Tab; ic: string; label: string }[] = [
  { id: 'overview', ic: '📊', label: '대시보드' },
  { id: 'coupons', ic: '🎟', label: '쿠폰' },
  { id: 'anns', ic: '📢', label: '공지' },
  { id: 'settings', ic: '⚙', label: '운영 설정' },
  { id: 'tickets', ic: '✉', label: '문의 · 환불' },
];
const TITLES: Record<Tab, string> = { overview: '대시보드', coupons: '쿠폰 관리', anns: '공지 관리', settings: '운영 설정', tickets: '문의 · 환불' };

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [coupons, setCoupons] = useState<Json[]>([]);
  const [anns, setAnns] = useState<Json[]>([]);
  const [setting, setSetting] = useState<Json | null>(null);
  const [tickets, setTickets] = useState<Json[]>([]);
  const [stats, setStats] = useState<Json | null>(null);
  const [toast, setToast] = useState('');

  const api = useCallback((p: string, init?: RequestInit) => apiCall(p, token, init), [token]);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    const [c, a, s, tk, st] = await Promise.all([api('/api/admin/coupon'), api('/api/admin/announcement'), api('/api/admin/setting'), api('/api/admin/ticket'), api('/api/admin/stats')]);
    setCoupons((c.body.coupons as Json[]) ?? []);
    setAnns((a.body.announcements as Json[]) ?? []);
    setSetting((s.body.setting as Json) ?? null);
    setTickets((tk.body.tickets as Json[]) ?? []);
    setStats(st.body.ok ? st.body : null);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const openTickets = useMemo(() => tickets.filter((t) => t.status !== 'answered' && t.status !== 'refunded').length, [tickets]);

  return (
    <div className="oc-shell">
      <aside className="oc-side">
        <div className="oc-logo" style={{ fontSize: 19, paddingLeft: 6 }}>🏐 운영 콘솔</div>
        <nav className="oc-nav">
          {NAV.map((n) => (
            <button key={n.id} className={`oc-navitem${tab === n.id ? ' on' : ''}`} onClick={() => setTab(n.id)}>
              <span className="ic">{n.ic}</span>{n.label}
              {n.id === 'tickets' && openTickets > 0 ? <span className="bdg">{openTickets}</span> : null}
            </button>
          ))}
        </nav>
        <button className="oc-btn ghost sm" onClick={onLogout}>로그아웃</button>
      </aside>

      <main className="oc-main">
        <div className="oc-top">
          <div>
            <div className="oc-h1">{TITLES[tab]}</div>
            <div className="oc-crumb">배구명가 · 운영</div>
          </div>
          <button className="oc-btn ghost sm" onClick={() => { load(); flash('새로고침됨'); }}>↻ 새로고침</button>
        </div>

        {tab === 'overview' && <Overview stats={stats} setting={setting} openTickets={openTickets} />}
        {tab === 'coupons' && <Coupons coupons={coupons} api={api} reload={load} flash={flash} />}
        {tab === 'anns' && <Anns anns={anns} api={api} reload={load} flash={flash} />}
        {tab === 'settings' && <Settings setting={setting} api={api} reload={load} flash={flash} />}
        {tab === 'tickets' && <Tickets tickets={tickets} api={api} reload={load} />}
      </main>
      {toast ? <div className="oc-toast">{toast}</div> : null}
    </div>
  );
}

function Stat({ k, v, s, ic }: { k: string; v: string; s?: string; ic?: string }) {
  return <div className="oc-stat"><div className="k">{ic ? <span>{ic}</span> : null}{k}</div><div className="v">{v}</div>{s ? <div className="s">{s}</div> : null}</div>;
}

// 공용 모달 — 등록/수정/상세를 팝업으로(리스트 화면과 분리). 배경/ESC 닫기.
function Modal({ title, sub, wide, onClose, children, footer }: { title: string; sub?: string; wide?: boolean; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="oc-modal-bd" onClick={onClose}>
      <div className={`oc-modal${wide ? ' wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="oc-modal-h"><div><div className="mt">{title}</div>{sub ? <div className="ms">{sub}</div> : null}</div><button className="oc-x" onClick={onClose}>✕</button></div>
        <div className="oc-modal-b">{children}</div>
        {footer ? <div className="oc-modal-f">{footer}</div> : null}
      </div>
    </div>
  );
}

const nnum = (v: unknown): number => (typeof v === 'number' ? v : 0);
const narr = (v: unknown): number[] => (Array.isArray(v) ? (v as number[]) : []);
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => String(i));
function axisLabels(labels: string[]): string[] {
  if (labels.length <= 6) return labels;
  const step = Math.max(1, Math.floor(labels.length / 4));
  return labels.filter((_, i) => i % step === 0 || i === labels.length - 1);
}

function Overview({ stats, setting, openTickets }: { stats: Json | null; setting: Json | null; openTickets: number }) {
  const maint = !!setting?.maintenance;
  const minV = (setting?.minVersion as string) || '—';
  const latV = (setting?.latestVersion as string) || '—';
  const kpi = (stats?.kpi as Json) ?? {};
  const labels = (stats?.labels as string[]) ?? [];
  const series = (stats?.series as Json) ?? {};
  const newUsers = narr(series.newUsers), dau = narr(series.dau), revenue = narr(series.revenue), ad = narr(series.ad), hourly = narr(stats?.hourly);
  const revTotal = revenue.reduce((a, b) => a + b, 0);
  const hourTotal = hourly.reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="oc-grid">
        <Stat ic={maint ? '🔧' : '🟢'} k="서버 상태" v={maint ? '점검 중' : '정상'} s={maint ? '진입 차단' : '서비스 중'} />
        <Stat ic="👥" k="총 가입자" v={nnum(kpi.totalUsers).toLocaleString()} s={`오늘 신규 +${nnum(kpi.newToday)}`} />
        <Stat ic="🟢" k="실시간 접속" v={String(nnum(kpi.active30m))} s="최근 30분(로그인)" />
        <Stat ic="✉" k="미처리 문의" v={String(openTickets)} s="답변 대기" />
        <Stat ic="💳" k="결제 전환율" v={`${nnum(kpi.conversion)}%`} s={`결제자 ${nnum(kpi.payers)}명`} />
        <Stat ic="📺" k="오늘 광고" v={String(nnum(kpi.adToday))} s={`시청자 ${nnum(kpi.adUsersToday)}명`} />
        <Stat ic="💤" k="비활성" v={nnum(kpi.inactive).toLocaleString()} s="14일+ 미접속" />
        <Stat ic="🚪" k="탈퇴" v={nnum(kpi.withdrawn).toLocaleString()} s="계정 삭제" />
        <Stat ic="⬆" k="버전 게이트" v={`${minV} / ${latV}`} s="강제 / 최신" />
      </div>
      <div className="oc-charts">
        <BarsCard title="일별 매출" value={`₩${revTotal.toLocaleString()}`} tag="결제 #43 후" labels={labels} data={revenue} color="#2bd17e" unit="원" />
        <BarsCard title="신규 가입" value={`+${nnum(kpi.newToday)} 오늘`} labels={labels} data={newUsers} color="#5b9bff" unit="명" />
        <LineCard title="일일 활성 사용자 (DAU)" value={`${nnum(kpi.dauToday)} 오늘`} labels={labels} data={dau} color="#19c2ae" />
        <BarsCard title="일별 광고 시청" value={`${nnum(kpi.adToday)} 오늘`} labels={labels} data={ad} color="#f2a93b" unit="회" />
        <BarsCard title="시간대별 접속" value={`${hourTotal}건`} tag="로그인 기준" labels={HOUR_LABELS} data={hourly} color="#9b7bff" unit="" />
      </div>
    </>
  );
}

const CW = 320, CH = 140, PADY = 12;
// Catmull-Rom → 베지어 부드러운 곡선
function smoothPath(p: [number, number][]): string {
  if (p.length < 2) return '';
  let d = `M ${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
function Grid() {
  return <>{[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" y1={(CH * g).toFixed(0)} x2={CW} y2={(CH * g).toFixed(0)} stroke="#fff" strokeOpacity="0.05" strokeWidth="1" />)}</>;
}

function BarsCard({ title, value, tag, labels, data, color, unit }: { title: string; value: string; tag?: string; labels: string[]; data: number[]; color: string; unit: string }) {
  const uid = useId().replace(/[:]/g, '');
  const max = Math.max(1, ...data), n = Math.max(1, data.length);
  const gap = n > 20 ? 2 : 5, bw = (CW - gap * (n - 1)) / n, r = Math.min(3.5, bw / 2.5);
  return (
    <div className="oc-chart">
      <div className="ct"><span className="t">{title}{tag ? <span className="tag">{tag}</span> : null}</span><span className="v">{value}</span></div>
      {data.length === 0 ? <div className="oc-empty2">데이터 없음</div> : (
        <>
          <svg className="oc-svg" viewBox={`0 0 ${CW} ${CH}`}>
            <defs><linearGradient id={`b${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="1" /><stop offset="100%" stopColor={color} stopOpacity="0.28" /></linearGradient></defs>
            <Grid />
            {data.map((v, i) => { const h = (v / max) * (CH - PADY); return (
              <rect key={i} x={(i * (bw + gap)).toFixed(2)} y={(CH - Math.max(h, 2)).toFixed(2)} width={bw.toFixed(2)} height={Math.max(h, 2).toFixed(2)} rx={r} fill={`url(#b${uid})`} opacity={v === 0 ? 0.22 : 1}>
                <title>{`${labels[i] ?? i}${unit === '' ? '시' : ''}: ${v.toLocaleString()}${unit}`}</title>
              </rect>); })}
          </svg>
          <div className="oc-xaxis">{axisLabels(labels).map((l, i) => <span key={i}>{l}</span>)}</div>
        </>
      )}
    </div>
  );
}

function LineCard({ title, value, labels, data, color }: { title: string; value: string; labels: string[]; data: number[]; color: string }) {
  const uid = useId().replace(/[:]/g, '');
  const max = Math.max(1, ...data), n = data.length;
  const pts: [number, number][] = data.map((v, i) => [n > 1 ? (i / (n - 1)) * CW : 0, CH - PADY - (v / max) * (CH - PADY * 2)]);
  const line = smoothPath(pts);
  return (
    <div className="oc-chart">
      <div className="ct"><span className="t">{title}</span><span className="v">{value}</span></div>
      {n < 2 ? <div className="oc-empty2">데이터 없음</div> : (
        <>
          <svg className="oc-svg" viewBox={`0 0 ${CW} ${CH}`}>
            <defs><linearGradient id={`a${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.34" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
            <Grid />
            <path d={`${line} L ${CW} ${CH} L 0 ${CH} Z`} fill={`url(#a${uid})`} />
            <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={pts[n - 1][0].toFixed(1)} cy={pts[n - 1][1].toFixed(1)} r="4" fill={color} stroke="#0a0e16" strokeWidth="2.5" />
          </svg>
          <div className="oc-xaxis">{axisLabels(labels).map((l, i) => <span key={i}>{l}</span>)}</div>
        </>
      )}
    </div>
  );
}

const CAT: Record<string, string> = { bug: '오류', suggestion: '건의', question: '질문', refund: '환불신청', etc: '기타' };
function StatusBadge({ s }: { s: string }) {
  const cls = s === 'refunded' ? 'gd' : s === 'answered' ? 'ac' : 'wn';
  const ko = s === 'refunded' ? '환불완료' : s === 'answered' ? '답변완료' : s === 'open' ? '대기' : s;
  return <span className={`oc-badge ${cls}`}>{ko}</span>;
}

type Api = (p: string, i?: RequestInit) => Promise<{ status: number; body: Json }>;

function Coupons({ coupons, api, reload, flash }: { coupons: Json[]; api: Api; reload: () => void; flash: (m: string) => void }) {
  const [modal, setModal] = useState<null | 'new' | Json>(null);
  return (
    <div className="oc-card">
      <div className="oc-cardhead"><h3>쿠폰 <span className="oc-mut">({coupons.length})</span></h3><button className="oc-btn sm" onClick={() => setModal('new')}>＋ 쿠폰 발급</button></div>
      {coupons.length === 0 ? <div className="oc-empty">발급된 쿠폰이 없습니다. 우측 상단 “＋ 쿠폰 발급”으로 만드세요.</div> : (
        <table className="oc-table">
          <thead><tr><th>코드</th><th>보상</th><th>대상</th><th>상태</th><th>종료</th></tr></thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={String(c.id)} className="clk" onClick={() => setModal(c)}>
                <td style={{ fontWeight: 800 }}>{String(c.code)}</td>
                <td>{String(c.rewardDiamonds)} 💎</td>
                <td>{c.targetUserId ? <span className="oc-badge ac">개인</span> : <span className="oc-badge mut">전체</span>}</td>
                <td>{c.disabled ? <span className="oc-badge dg">비활성</span> : <span className="oc-badge gd">활성</span>}</td>
                <td className="oc-mut">{c.endsAt ? String(c.endsAt).slice(0, 10) : '무기한'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modal ? <CouponModal coupon={modal === 'new' ? null : modal} api={api} reload={reload} flash={flash} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function CouponModal({ coupon, api, reload, flash, onClose }: { coupon: Json | null; api: Api; reload: () => void; flash: (m: string) => void; onClose: () => void }) {
  const isNew = !coupon;
  const [editMode, setEditMode] = useState(isNew); // 신규=바로 편집 / 기존=상세보기 먼저
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(coupon ? String(coupon.code) : '');
  const [reward, setReward] = useState(coupon ? String(coupon.rewardDiamonds) : '100');
  const [mode, setMode] = useState<'all' | 'user'>(coupon?.targetUserId ? 'user' : 'all');
  const [target, setTarget] = useState(coupon?.targetUserId ? String(coupon.targetUserId) : '');
  const [ends, setEnds] = useState(coupon?.endsAt ? String(coupon.endsAt).slice(0, 10) : '');
  const [disabled, setDisabled] = useState(!!coupon?.disabled);
  const save = async () => {
    setBusy(true);
    const target2 = mode === 'user' ? (target.trim() || null) : null;
    const r = isNew
      ? await api('/api/admin/coupon', { method: 'POST', body: JSON.stringify({ code, rewardDiamonds: Number(reward), targetUserId: target2, endsAt: ends || null }) })
      : await api('/api/admin/coupon', { method: 'PATCH', body: JSON.stringify({ id: coupon!.id, rewardDiamonds: Number(reward), endsAt: ends || null, disabled, targetUserId: target2 }) });
    setBusy(false);
    if (r.body.ok) { flash(isNew ? `쿠폰 발급: ${r.body.code}` : '쿠폰 수정됨'); reload(); onClose(); }
    else flash(`${isNew ? '발급' : '수정'} 실패: ${r.body.reason ?? r.status}`);
  };
  const del = async () => {
    if (!window.confirm(`쿠폰 "${String(coupon!.code)}"을(를) 삭제할까요?`)) return;
    setBusy(true);
    const r = await api(`/api/admin/coupon?id=${encodeURIComponent(String(coupon!.id))}`, { method: 'DELETE' });
    setBusy(false);
    if (r.body.ok) { flash('쿠폰 삭제됨'); reload(); onClose(); }
    else flash(r.body.reason === 'has-redemptions' ? '사용 기록이 있어 삭제 불가 — 비활성화하세요' : `삭제 실패(${r.status})`);
  };
  const invalid = isNew ? (!code.trim() || (mode === 'user' && !target.trim())) : false;

  if (!editMode && coupon) return (
    <Modal title={String(coupon.code)} sub="쿠폰 상세" onClose={onClose}
      footer={<><button className="oc-btn ghost" style={{ color: 'var(--dg)', borderColor: 'rgba(255,107,90,.35)', marginRight: 'auto' }} onClick={del} disabled={busy}>삭제</button><button className="oc-btn ghost" onClick={onClose}>닫기</button><button className="oc-btn" onClick={() => setEditMode(true)}>수정</button></>}>
      <div className="oc-dl">
        <div className="oc-dl-row"><span className="oc-dl-k">코드</span><span className="oc-dl-v mono">{String(coupon.code)}</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">보상</span><span className="oc-dl-v">{String(coupon.rewardDiamonds)} 💎</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">대상</span><span className="oc-dl-v">{coupon.targetUserId ? <>{'개인 '}<span className="mono" style={{ fontSize: 12.5 }}>{String(coupon.targetUserId)}</span></> : <span className="oc-badge mut">전체</span>}</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">상태</span><span className="oc-dl-v">{coupon.disabled ? <span className="oc-badge dg">비활성</span> : <span className="oc-badge gd">활성</span>}</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">종료일</span><span className="oc-dl-v">{coupon.endsAt ? String(coupon.endsAt).slice(0, 10) : '무기한'}</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">생성일</span><span className="oc-dl-v">{coupon.createdAt ? String(coupon.createdAt).slice(0, 19).replace('T', ' ') : '—'}</span></div>
      </div>
    </Modal>
  );

  return (
    <Modal title={isNew ? '쿠폰 발급' : '쿠폰 수정'} sub={isNew ? '새 쿠폰을 만듭니다' : String(coupon!.code)} onClose={onClose}
      footer={<><button className="oc-btn ghost" onClick={isNew ? onClose : () => setEditMode(false)} disabled={busy}>취소</button><button className="oc-btn" onClick={save} disabled={invalid || busy}>{busy ? '처리 중…' : isNew ? '발급' : '저장'}</button></>}>
      <div className="oc-fld"><label className="oc-label">코드</label><input className="oc-input" placeholder="welcome, SEASON2627 …" value={code} onChange={(e) => setCode(e.target.value)} disabled={!isNew} /></div>
      <div className="oc-frow">
        <div className="oc-fld"><label className="oc-label">보상 다이아</label><input className="oc-input" type="number" value={reward} onChange={(e) => setReward(e.target.value)} /></div>
        <div className="oc-fld"><label className="oc-label">대상</label><select className="oc-input" value={mode} onChange={(e) => setMode(e.target.value as 'all' | 'user')}><option value="all">전체</option><option value="user">개인</option></select></div>
      </div>
      {mode === 'user' ? <div className="oc-fld"><label className="oc-label">대상 user id</label><input className="oc-input" placeholder="userId" value={target} onChange={(e) => setTarget(e.target.value)} /></div> : null}
      <div className="oc-fld"><label className="oc-label">종료일 (빈칸=무기한)</label><input className="oc-input" placeholder="YYYY-MM-DD" value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
      {!isNew ? <div className="oc-fld"><label className="oc-label">상태</label><select className="oc-input" value={disabled ? '1' : '0'} onChange={(e) => setDisabled(e.target.value === '1')}><option value="0">활성</option><option value="1">비활성</option></select></div> : null}
    </Modal>
  );
}

function Anns({ anns, api, reload, flash }: { anns: Json[]; api: Api; reload: () => void; flash: (m: string) => void }) {
  const [modal, setModal] = useState<null | 'new' | Json>(null);
  return (
    <div className="oc-card">
      <div className="oc-cardhead"><h3>공지 <span className="oc-mut">({anns.length})</span></h3><button className="oc-btn sm" onClick={() => setModal('new')}>＋ 공지 발행</button></div>
      {anns.length === 0 ? <div className="oc-empty">발행된 공지가 없습니다. 우측 상단 “＋ 공지 발행”으로 만드세요.</div> : (
        <table className="oc-table">
          <thead><tr><th>제목</th><th>고정</th><th>종료</th></tr></thead>
          <tbody>
            {anns.map((a) => (
              <tr key={String(a.id)} className="clk" onClick={() => setModal(a)}>
                <td style={{ fontWeight: 700 }}>{String(a.title)}</td>
                <td>{a.pinned ? <span className="oc-badge wn">📌 고정</span> : <span className="oc-mut">—</span>}</td>
                <td className="oc-mut">{a.endsAt ? String(a.endsAt).slice(0, 10) : '무기한'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modal ? <AnnModal ann={modal === 'new' ? null : modal} api={api} reload={reload} flash={flash} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function AnnModal({ ann, api, reload, flash, onClose }: { ann: Json | null; api: Api; reload: () => void; flash: (m: string) => void; onClose: () => void }) {
  const isNew = !ann;
  const [editMode, setEditMode] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(ann ? String(ann.title ?? '') : '');
  const [body, setBody] = useState(ann ? String(ann.body ?? '') : '');
  const [ends, setEnds] = useState(ann?.endsAt ? String(ann.endsAt).slice(0, 10) : '');
  const [pinned, setPinned] = useState(!!ann?.pinned);
  const save = async () => {
    setBusy(true);
    const r = isNew
      ? await api('/api/admin/announcement', { method: 'POST', body: JSON.stringify({ title, body, endsAt: ends || null, pinned }) })
      : await api('/api/admin/announcement', { method: 'PATCH', body: JSON.stringify({ id: ann!.id, title, body, endsAt: ends || null, pinned }) });
    setBusy(false);
    if (r.body.ok) { flash(isNew ? '공지 발행됨' : '공지 수정됨'); reload(); onClose(); }
    else flash(`${isNew ? '발행' : '수정'} 실패: ${r.body.reason ?? r.status}`);
  };
  const del = async () => {
    if (!window.confirm(`공지 "${String(ann!.title)}"을(를) 삭제할까요?`)) return;
    setBusy(true);
    const r = await api(`/api/admin/announcement?id=${encodeURIComponent(String(ann!.id))}`, { method: 'DELETE' });
    setBusy(false);
    if (r.body.ok) { flash('공지 삭제됨'); reload(); onClose(); } else flash('삭제 실패');
  };

  if (!editMode && ann) return (
    <Modal title={String(ann.title)} sub="공지 상세" onClose={onClose}
      footer={<><button className="oc-btn ghost" style={{ color: 'var(--dg)', borderColor: 'rgba(255,107,90,.35)', marginRight: 'auto' }} onClick={del} disabled={busy}>삭제</button><button className="oc-btn ghost" onClick={onClose}>닫기</button><button className="oc-btn" onClick={() => setEditMode(true)}>수정</button></>}>
      <div className="oc-dl">
        <div className="oc-dl-block"><div className="oc-dl-k">내용</div><div className="txt">{String(ann.body)}</div></div>
        <div className="oc-dl-row"><span className="oc-dl-k">상단 고정</span><span className="oc-dl-v">{ann.pinned ? <span className="oc-badge wn">📌 고정</span> : '아니오'}</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">종료일</span><span className="oc-dl-v">{ann.endsAt ? String(ann.endsAt).slice(0, 10) : '무기한'}</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">발행일</span><span className="oc-dl-v">{ann.createdAt ? String(ann.createdAt).slice(0, 19).replace('T', ' ') : '—'}</span></div>
      </div>
    </Modal>
  );

  return (
    <Modal title={isNew ? '공지 발행' : '공지 수정'} sub={isNew ? undefined : String(ann!.title)} onClose={onClose}
      footer={<><button className="oc-btn ghost" onClick={isNew ? onClose : () => setEditMode(false)} disabled={busy}>취소</button><button className="oc-btn" onClick={save} disabled={!title.trim() || !body.trim() || busy}>{busy ? '처리 중…' : isNew ? '발행' : '저장'}</button></>}>
      <div className="oc-fld"><label className="oc-label">제목</label><input className="oc-input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="oc-fld"><label className="oc-label">내용</label><textarea className="oc-input" value={body} onChange={(e) => setBody(e.target.value)} style={{ height: 100 }} /></div>
      <div className="oc-frow">
        <div className="oc-fld"><label className="oc-label">종료일 (빈칸=무기한)</label><input className="oc-input" placeholder="YYYY-MM-DD" value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
        <div className="oc-fld"><label className="oc-label">상단 고정</label><label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44, fontSize: 14 }}><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> 고정</label></div>
      </div>
    </Modal>
  );
}

function Settings({ setting, api, reload, flash }: { setting: Json | null; api: (p: string, i?: RequestInit) => Promise<{ status: number; body: Json }>; reload: () => void; flash: (m: string) => void }) {
  const [minV, setMinV] = useState(''); const [latV, setLatV] = useState('');
  const [androidUrl, setAndroidUrl] = useState(''); const [iosUrl, setIosUrl] = useState('');
  const [maint, setMaint] = useState(false); const [maintT, setMaintT] = useState(''); const [maintB, setMaintB] = useState('');
  useEffect(() => {
    if (!setting) return;
    setMinV((setting.minVersion as string) ?? ''); setLatV((setting.latestVersion as string) ?? '');
    setAndroidUrl((setting.androidStoreUrl as string) ?? ''); setIosUrl((setting.iosStoreUrl as string) ?? '');
    setMaint(!!setting.maintenance); setMaintT((setting.maintenanceTitle as string) ?? ''); setMaintB((setting.maintenanceBody as string) ?? '');
  }, [setting]);
  const save = async () => {
    const r = await api('/api/admin/setting', { method: 'POST', body: JSON.stringify({ minVersion: minV || null, latestVersion: latV || null, androidStoreUrl: androidUrl || null, iosStoreUrl: iosUrl || null, maintenance: maint, maintenanceTitle: maintT || null, maintenanceBody: maintB || null }) });
    flash(r.body.ok ? '설정 저장됨' : `저장 실패(${r.status})`); if (r.body.ok) reload();
  };
  return (
    <>
      <div className="oc-card">
        <h3>버전 게이트</h3>
        <div className="oc-row">
          <div className="oc-field"><label className="oc-label">강제 최소버전 (미만 진입 차단)</label><input className="oc-input" placeholder="예: 1.0.0" value={minV} onChange={(e) => setMinV(e.target.value)} style={{ width: 200 }} /></div>
          <div className="oc-field"><label className="oc-label">최신버전 (미만 소프트 배너)</label><input className="oc-input" placeholder="예: 1.2.0" value={latV} onChange={(e) => setLatV(e.target.value)} style={{ width: 200 }} /></div>
        </div>
        <div className="oc-row" style={{ marginTop: 12 }}>
          <div className="oc-field" style={{ flex: 1, minWidth: 280 }}><label className="oc-label">플레이스토어 주소</label><input className="oc-input" value={androidUrl} onChange={(e) => setAndroidUrl(e.target.value)} /></div>
          <div className="oc-field" style={{ flex: 1, minWidth: 280 }}><label className="oc-label">앱스토어 주소 (애플 출시 전 비움)</label><input className="oc-input" value={iosUrl} onChange={(e) => setIosUrl(e.target.value)} /></div>
        </div>
      </div>
      <div className="oc-card">
        <h3>서버 점검</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
          <input type="checkbox" checked={maint} onChange={(e) => setMaint(e.target.checked)} /> 점검 모드 (전체 진입 차단)
        </label>
        <div className="oc-field" style={{ marginBottom: 10 }}><label className="oc-label">점검 제목</label><input className="oc-input" value={maintT} onChange={(e) => setMaintT(e.target.value)} disabled={!maint} /></div>
        <textarea className="oc-input" placeholder="점검 내용" value={maintB} onChange={(e) => setMaintB(e.target.value)} disabled={!maint} style={{ height: 72 }} />
      </div>
      <button className="oc-btn" onClick={save}>설정 저장</button>
    </>
  );
}

function Tickets({ tickets, api, reload }: { tickets: Json[]; api: Api; reload: () => void }) {
  const [cat, setCat] = useState('all');
  const [st, setSt] = useState<'all' | 'answered' | 'unanswered'>('unanswered');
  const [sel, setSel] = useState<Json | null>(null);
  const filtered = tickets.filter((t) => {
    if (cat !== 'all' && String(t.category) !== cat) return false;
    const isOpen = String(t.status ?? 'open') === 'open';
    if (st === 'unanswered' && !isOpen) return false;
    if (st === 'answered' && isOpen) return false;
    return true;
  });
  const ss = { padding: '8px 10px', width: 126 } as const;
  return (
    <div className="oc-card">
      <div className="oc-cardhead">
        <h3>문의 · 환불 <span className="oc-mut">({filtered.length}/{tickets.length})</span></h3>
        <div className="oc-row" style={{ gap: 10 }}>
          <select className="oc-input" value={cat} onChange={(e) => setCat(e.target.value)} style={ss}>
            <option value="all">전체 유형</option><option value="bug">오류</option><option value="suggestion">건의</option><option value="question">질문</option><option value="refund">환불신청</option><option value="etc">기타</option>
          </select>
          <select className="oc-input" value={st} onChange={(e) => setSt(e.target.value as 'all' | 'answered' | 'unanswered')} style={{ ...ss, width: 116 }}>
            <option value="all">전체 상태</option><option value="unanswered">미답변</option><option value="answered">답변</option>
          </select>
        </div>
      </div>
      {filtered.length === 0 ? <div className="oc-empty">조건에 맞는 문의가 없습니다.</div> : (
        <table className="oc-table">
          <thead><tr><th>유형</th><th>상태</th><th>사용자</th><th>내용</th><th>날짜</th></tr></thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={String(t.id)} className="clk" onClick={() => setSel(t)}>
                <td>{CAT[String(t.category)] ?? String(t.category)}</td>
                <td><StatusBadge s={String(t.status)} /></td>
                <td>{String(t.displayName ?? t.userId).slice(0, 18)}</td>
                <td style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(t.content)}</td>
                <td className="oc-mut">{String(t.createdAt).slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sel ? <TicketModal t={sel} api={api} reload={reload} onClose={() => setSel(null)} /> : null}
    </div>
  );
}

function TicketModal({ t, api, reload, onClose }: { t: Json; api: Api; reload: () => void; onClose: () => void }) {
  const [reply, setReply] = useState((t.reply as string) ?? '');
  const [amount, setAmount] = useState('');
  const [snap, setSnap] = useState('');
  const [msg, setMsg] = useState('');
  const saveReply = async () => { const r = await api('/api/admin/ticket/reply', { method: 'POST', body: JSON.stringify({ ticketId: t.id, reply }) }); setMsg(r.body.ok ? '답변 저장됨' : `실패(${r.status})`); reload(); };
  const doRefund = async () => {
    const amt = Math.floor(Number(amount));
    if (!amt || amt <= 0) { setMsg('환불 다이아를 입력하세요'); return; }
    const note = reply.trim() || '환불 처리';
    const r = await api('/api/admin/refund', { method: 'POST', body: JSON.stringify({ userId: t.userId, amount: amt, note, ticketId: t.id, key: `refund:ticket:${t.id}` }) });
    setMsg(r.body.ok ? `환불 반영 · 잔액 ${r.body.balance}💎${r.body.applied ? '' : ' (이미 처리됨)'}` : `환불 실패(${r.status}: ${r.body.reason ?? ''})`);
    reload();
  };
  const viewSnap = async () => { const r = await api(`/api/admin/ticket/snapshot?ticketId=${t.id}`); setSnap(r.body.snapshot ? JSON.stringify(r.body.snapshot, null, 2) : '(진단 스냅샷 없음)'); };
  return (
    <Modal wide title="문의 상세" sub={`${CAT[String(t.category)] ?? String(t.category)} · ${String(t.displayName ?? t.userId)}`} onClose={onClose}
      footer={<button className="oc-btn ghost" onClick={onClose}>닫기</button>}>
      <div className="oc-row" style={{ gap: 8 }}>
        <span className="oc-badge ac">{CAT[String(t.category)] ?? String(t.category)}</span>
        <StatusBadge s={String(t.status)} />
        <b>{String(t.displayName ?? t.userId)}</b>
        <span className="oc-mut">잔액 {String(t.balance)}💎</span>
      </div>
      <div className="oc-mut">기기 {String(t.platform ?? t.userPlatform ?? '?')} {String(t.osVersion ?? '')} · 앱 {String(t.appVersion ?? '')} · {String(t.createdAt).slice(0, 19).replace('T', ' ')}</div>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, background: 'var(--card2)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14, lineHeight: 1.6 }}>{String(t.content)}</div>
      <div className="oc-fld"><label className="oc-label">답변 / 환불 사유 (감사기록에 남음)</label><textarea className="oc-input" value={reply} onChange={(e) => setReply(e.target.value)} style={{ height: 70 }} /></div>
      <div className="oc-row">
        <button className="oc-btn blue sm" onClick={saveReply}>답변 저장</button>
        {String(t.category) === 'refund' ? (
          <>
            <input className="oc-input" placeholder="환불 💎" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} />
            <button className="oc-btn red sm" onClick={doRefund}>환불(회수)</button>
          </>
        ) : null}
        <button className="oc-btn ghost sm" onClick={viewSnap}>진단 스냅샷</button>
        {msg ? <span className="oc-mut" style={{ fontSize: 12.5 }}>{msg}</span> : null}
      </div>
      {snap ? <pre className="oc-pre">{snap}</pre> : null}
    </Modal>
  );
}
