'use client';
// 배구명가 운영 콘솔 (BACKEND_SYSTEM §13.15) — 로그인 게이트 + 대시보드(개요·쿠폰·공지·운영설정·문의/환불).
// URL은 /admin 아님(추측 차단, 2026-07-04 사용자 요청) — 실제 보안은 ADMIN_TOKEN(requireAdmin fail-closed §13.15).
// 인라인 스타일 + 내장 <style>(정적 CSS)만 — 외부 스크립트/스타일 0(XSS 표면 최소). 관리자 전용 화면.
import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';

type Json = Record<string, unknown>;
type Tab = 'overview' | 'users' | 'payments' | 'ads' | 'achv' | 'coupons' | 'anns' | 'settings' | 'tickets';

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
.oc-main{padding:26px 34px;min-width:0;max-width:1200px;margin:0 auto;width:100%;}
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
.oc-navgrp{font-size:10.5px;font-weight:800;letter-spacing:1px;color:var(--mut);opacity:.62;text-transform:uppercase;padding:15px 13px 6px;}
.oc-seg{display:inline-flex;background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:3px;gap:2px;}
.oc-segb{border:none;background:transparent;color:var(--mut);font-size:12.5px;font-weight:700;padding:6px 14px;border-radius:8px;cursor:pointer;transition:background .12s,color .12s;}
.oc-segb:hover{color:var(--tx);} .oc-segb.on{background:var(--ac);color:#04110d;font-weight:800;}
.oc-bar{height:8px;border-radius:999px;background:var(--bd2);overflow:hidden;flex:1;} .oc-bar>i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#19c2ae,#3ad6a6);}
.oc-achrow{display:flex;align-items:center;gap:14px;padding:11px 4px;border-bottom:1px solid var(--bd2);} .oc-achrow:last-child{border-bottom:none;}
.oc-achrow .t{font-size:13.5px;font-weight:700;} .oc-achrow .d{font-size:11.5px;color:var(--mut);margin-top:2px;}
.oc-achrow .meta{width:210px;flex-shrink:0;} .oc-achrow .pct{width:78px;text-align:right;font-weight:800;font-size:13px;flex-shrink:0;} .oc-achrow .cnt{font-size:11px;color:var(--mut);text-align:right;}
.oc-pill{display:inline-block;font-size:11px;font-weight:800;padding:2px 9px;border-radius:999px;}
.oc-pill.g{background:rgba(43,209,126,.16);color:#4fe0a0;} .oc-pill.y{background:rgba(242,169,59,.16);color:#f2b95f;} .oc-pill.r{background:rgba(240,90,90,.16);color:#ff8f8f;} .oc-pill.b{background:rgba(91,155,255,.16);color:#8fb8ff;}
.oc-mut{color:var(--mut);font-weight:600;}
.oc-pager{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:14px;font-size:13px;color:var(--mut);}
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

const NAV: { id: Tab; ic: string; label: string; grp?: string }[] = [
  { id: 'overview', ic: '📊', label: '대시보드' },
  { id: 'users', ic: '👥', label: '사용자', grp: '분석' },
  { id: 'payments', ic: '💳', label: '결제', grp: '분석' },
  { id: 'ads', ic: '📺', label: '광고', grp: '분석' },
  { id: 'achv', ic: '🏆', label: '업적', grp: '분석' },
  { id: 'coupons', ic: '🎟', label: '쿠폰', grp: '운영' },
  { id: 'anns', ic: '📢', label: '공지', grp: '운영' },
  { id: 'tickets', ic: '✉', label: '문의 · 환불', grp: '운영' },
  { id: 'settings', ic: '⚙', label: '운영 설정', grp: '운영' },
];
const TITLES: Record<Tab, string> = { overview: '대시보드', users: '사용자', payments: '결제', ads: '광고', achv: '업적', coupons: '쿠폰 관리', anns: '공지 관리', settings: '운영 설정', tickets: '문의 · 환불' };

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

  // 미처리 = 대기(open) + 확인 중(reviewing). 답변완료·환불완료·레거시(replied/resolved)는 처리됨.
  const openTickets = useMemo(() => tickets.filter((t) => { const s = String(t.status ?? 'open'); return s === 'open' || s === 'reviewing'; }).length, [tickets]);

  return (
    <div className="oc-shell">
      <aside className="oc-side">
        <div className="oc-logo" style={{ fontSize: 19, paddingLeft: 6 }}>🏐 운영 콘솔</div>
        <nav className="oc-nav">
          {NAV.map((n, i) => (
            <React.Fragment key={n.id}>
              {n.grp && n.grp !== NAV[i - 1]?.grp ? <div className="oc-navgrp">{n.grp}</div> : null}
              <button className={`oc-navitem${tab === n.id ? ' on' : ''}`} onClick={() => setTab(n.id)}>
                <span className="ic">{n.ic}</span>{n.label}
                {n.id === 'tickets' && openTickets > 0 ? <span className="bdg">{openTickets}</span> : null}
              </button>
            </React.Fragment>
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
        {tab === 'users' && <Users stats={stats} api={api} />}
        {tab === 'payments' && <Payments stats={stats} api={api} />}
        {tab === 'ads' && <Ads api={api} />}
        {tab === 'achv' && <Achievements api={api} />}
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

// 대시보드 = 한눈에 볼 핵심만. 상세(사용자·매출·광고·업적)는 좌측 분석 메뉴로 분리.
function Overview({ stats, setting, openTickets }: { stats: Json | null; setting: Json | null; openTickets: number }) {
  const maint = !!setting?.maintenance;
  const minV = (setting?.minVersion as string) || '—';
  const latV = (setting?.latestVersion as string) || '—';
  const kpi = (stats?.kpi as Json) ?? {};
  const labels = (stats?.labels as string[]) ?? [];
  const series = (stats?.series as Json) ?? {};
  const dau = narr(series.dau), newUsers = narr(series.newUsers);
  return (
    <>
      <div className="oc-grid">
        <Stat ic={maint ? '🔧' : '🟢'} k="서버 상태" v={maint ? '점검 중' : '정상'} s={maint ? '진입 차단' : '서비스 중'} />
        <Stat ic="🟢" k="실시간 접속" v={String(nnum(kpi.active30m))} s="최근 30분" />
        <Stat ic="🔵" k="오늘 활성(DAU)" v={nnum(kpi.dauToday).toLocaleString()} s={`오늘 신규 +${nnum(kpi.newToday)}`} />
        <Stat ic="👥" k="총 가입자" v={nnum(kpi.totalUsers).toLocaleString()} s={`탈퇴 ${nnum(kpi.withdrawn)} · 비활성 ${nnum(kpi.inactive)}`} />
        <Stat ic="✉" k="미처리 문의" v={String(openTickets)} s="답변 대기" />
        <Stat ic="⬆" k="버전 게이트" v={`${minV} / ${latV}`} s="강제 / 최신" />
      </div>
      <div className="oc-charts">
        <LineCard title="일일 활성 사용자 (DAU)" value={`${nnum(kpi.dauToday)} 오늘`} labels={labels} data={dau} color="#19c2ae" />
        <BarsCard title="신규 가입 (최근 14일)" value={`+${nnum(kpi.newToday)} 오늘`} labels={labels} data={newUsers} color="#5b9bff" unit="명" />
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
  const done = s === 'answered' || s === 'replied' || s === 'resolved'; // 레거시 replied/resolved=답변완료 취급
  const cls = s === 'refunded' ? 'ac' : done ? 'gd' : s === 'reviewing' ? 'wn' : 'mut';
  const ko = s === 'refunded' ? '환불완료' : done ? '답변완료' : s === 'reviewing' ? '확인 중' : '대기';
  return <span className={`oc-badge ${cls}`}>{ko}</span>;
}

type Api = (p: string, i?: RequestInit) => Promise<{ status: number; body: Json }>;

// ── 날짜/상태 헬퍼 ──
const pad = (n: number) => String(n).padStart(2, '0');
const fmtD = (iso: unknown): string => { if (!iso) return '—'; const d = new Date(iso as string); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDT = (iso: unknown): string => { if (!iso) return '—'; const d = new Date(iso as string); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ago = (iso: unknown): string => { if (!iso) return '접속 없음'; const ms = Date.now() - new Date(iso as string).getTime(); const dy = Math.floor(ms / 86400000); if (dy <= 0) { const hr = Math.floor(ms / 3600000); return hr <= 0 ? '방금' : `${hr}시간 전`; } return `${dy}일 전`; };
function userStatus(u: Json): { label: string; cls: string } {
  if (u.deletedAt) return { label: '탈퇴', cls: 'r' };
  const ls = u.lastSeenAt ? new Date(u.lastSeenAt as string).getTime() : 0;
  if (!ls || Date.now() - ls > 14 * 86400000) return { label: '비활성', cls: 'y' };
  return { label: '활성', cls: 'g' };
}

// 분석 공용 — 기간 세그먼트 토글
function GranTabs({ gran, set, opts }: { gran: string; set: (g: string) => void; opts: { v: string; l: string }[] }) {
  return <div className="oc-seg">{opts.map((o) => <button key={o.v} className={`oc-segb${gran === o.v ? ' on' : ''}`} onClick={() => set(o.v)}>{o.l}</button>)}</div>;
}

// ── 사용자: 가입일·최근접속·상태 목록 + 상태 필터 + 페이지네이션 ──
function Users({ stats, api }: { stats: Json | null; api: Api }) {
  const kpi = (stats?.kpi as Json) ?? {};
  const labels = (stats?.labels as string[]) ?? [];
  const series = (stats?.series as Json) ?? {};
  const newUsers = narr(series.newUsers), hourly = narr(stats?.hourly);
  const [status, setStatus] = useState('all');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Json[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const LIM = 50;
  useEffect(() => {
    let live = true; setLoading(true);
    api(`/api/admin/users?status=${status}&limit=${LIM}&offset=${offset}`).then((r) => { if (!live) return; setRows((r.body.users as Json[]) ?? []); setTotal(nnum(r.body.total)); setLoading(false); });
    return () => { live = false; };
  }, [api, status, offset]);
  const pick = (s: string) => { setStatus(s); setOffset(0); };
  const FILT = [{ v: 'all', l: '전체' }, { v: 'active', l: '활성' }, { v: 'inactive', l: '비활성' }, { v: 'withdrawn', l: '탈퇴' }];
  return (
    <>
      <div className="oc-grid">
        <Stat ic="👥" k="총 가입자" v={nnum(kpi.totalUsers).toLocaleString()} s={`오늘 신규 +${nnum(kpi.newToday)}`} />
        <Stat ic="🔵" k="오늘 활성(DAU)" v={nnum(kpi.dauToday).toLocaleString()} s="오늘 접속 유저" />
        <Stat ic="🟢" k="실시간 접속" v={String(nnum(kpi.active30m))} s="최근 30분" />
        <Stat ic="💤" k="비활성" v={nnum(kpi.inactive).toLocaleString()} s="14일+ 미접속" />
        <Stat ic="🚪" k="탈퇴" v={nnum(kpi.withdrawn).toLocaleString()} s="계정 삭제" />
      </div>
      <div className="oc-charts">
        <BarsCard title="신규 가입 (최근 14일)" value={`+${nnum(kpi.newToday)} 오늘`} labels={labels} data={newUsers} color="#5b9bff" unit="명" />
        <BarsCard title="시간대별 접속" value="로그인 기준" labels={HOUR_LABELS} data={hourly} color="#9b7bff" unit="" />
      </div>
      <div className="oc-card">
        <div className="oc-cardhead"><h3>사용자 목록 <span className="oc-mut">({total.toLocaleString()})</span></h3><GranTabs gran={status} set={pick} opts={FILT} /></div>
        {loading ? <div className="oc-empty">불러오는 중…</div> : rows.length === 0 ? <div className="oc-empty">해당 조건의 사용자가 없습니다.</div> : (
          <table className="oc-table">
            <thead><tr><th>가입일</th><th>최근 접속</th><th>상태</th><th>로그인</th><th>버전</th><th style={{ textAlign: 'right' }}>다이아</th></tr></thead>
            <tbody>{rows.map((u) => { const st = userStatus(u); return (
              <tr key={u.id as string}>
                <td>{fmtD(u.createdAt)}</td>
                <td>{fmtDT(u.lastSeenAt)} <span className="oc-mut" style={{ fontSize: 11 }}>· {ago(u.lastSeenAt)}</span></td>
                <td><span className={`oc-pill ${st.cls}`}>{st.label}</span></td>
                <td className="oc-mut">{(u.provider as string) || '—'}</td>
                <td className="oc-mut">{(u.appVersion as string) || '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{nnum(u.balance).toLocaleString()}</td>
              </tr>); })}</tbody>
          </table>
        )}
        {total > LIM ? (
          <div className="oc-pager">
            <button className="oc-btn ghost sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIM))}>← 이전</button>
            <span>{offset + 1}–{Math.min(offset + LIM, total)} / {total.toLocaleString()}</span>
            <button className="oc-btn ghost sm" disabled={offset + LIM >= total} onClick={() => setOffset(offset + LIM)}>다음 →</button>
          </div>
        ) : null}
      </div>
    </>
  );
}

// ── 결제: 일/주/월 매출·결제건수·환불 ──
function Payments({ stats, api }: { stats: Json | null; api: Api }) {
  const kpi = (stats?.kpi as Json) ?? {};
  const [gran, setGran] = useState('day');
  const [rev, setRev] = useState<Json | null>(null);
  const [refund, setRefund] = useState<Json | null>(null);
  // 결제/환불 개별 내역 목록(사용자 목록처럼) — kind 필터 + 페이지네이션
  const [kind, setKind] = useState('all');
  const [pOffset, setPOffset] = useState(0);
  const [pRows, setPRows] = useState<Json[]>([]);
  const [pTotal, setPTotal] = useState(0);
  const [pLoading, setPLoading] = useState(true);
  const PLIM = 50;
  useEffect(() => {
    let live = true; setPLoading(true);
    api(`/api/admin/payments?kind=${kind}&limit=${PLIM}&offset=${pOffset}`).then((r) => { if (!live) return; setPRows((r.body.payments as Json[]) ?? []); setPTotal(nnum(r.body.total)); setPLoading(false); });
    return () => { live = false; };
  }, [api, kind, pOffset]);
  const pickKind = (k: string) => { setKind(k); setPOffset(0); };
  const KIND_F = [{ v: 'all', l: '전체' }, { v: 'purchase', l: '구매' }, { v: 'refund', l: '환불' }];
  useEffect(() => {
    let live = true;
    Promise.all([api(`/api/admin/series?metric=revenue&granularity=${gran}`), api(`/api/admin/series?metric=refund&granularity=${gran}`)]).then(([a, b]) => { if (!live) return; setRev(a.body.ok ? a.body : null); setRefund(b.body.ok ? b.body : null); });
    return () => { live = false; };
  }, [api, gran]);
  const labels = (rev?.labels as string[]) ?? [];
  const revenue = narr(rev?.revenue), purchases = narr(rev?.purchases);
  const rlabels = (refund?.labels as string[]) ?? [], rcount = narr(refund?.count), rdia = narr(refund?.diamonds);
  const revTotal = revenue.reduce((a, b) => a + b, 0), buyTotal = purchases.reduce((a, b) => a + b, 0), refTotal = rcount.reduce((a, b) => a + b, 0);
  const GR = [{ v: 'day', l: '일별' }, { v: 'week', l: '주별' }, { v: 'month', l: '월별' }];
  return (
    <>
      <div className="oc-cardhead" style={{ marginBottom: 18 }}><div className="oc-mut" style={{ fontSize: 13 }}>매출 데이터는 결제 검증(#43) 연동 후 채워집니다.</div><GranTabs gran={gran} set={setGran} opts={GR} /></div>
      <div className="oc-grid">
        <Stat ic="₩" k="총 매출" v={`₩${revTotal.toLocaleString()}`} s={`최근 ${labels.length}구간`} />
        <Stat ic="🧾" k="결제 건수" v={buyTotal.toLocaleString()} s="구매 원장" />
        <Stat ic="💳" k="결제 전환율" v={`${nnum(kpi.conversion)}%`} s={`결제자 ${nnum(kpi.payers)}명`} />
        <Stat ic="↩" k="환불 건수" v={refTotal.toLocaleString()} s={`다이아 ${rdia.reduce((a, b) => a + b, 0).toLocaleString()} 회수`} />
      </div>
      <div className="oc-charts">
        <BarsCard title="매출" value={`₩${revTotal.toLocaleString()}`} tag="#43 후" labels={labels} data={revenue} color="#2bd17e" unit="원" />
        <BarsCard title="결제 건수" value={`${buyTotal} 건`} labels={labels} data={purchases} color="#5b9bff" unit="건" />
        <BarsCard title="환불 건수" value={`${refTotal} 건`} labels={rlabels} data={rcount} color="#f05a5a" unit="건" />
        <BarsCard title="환불 다이아" value={`${rdia.reduce((a, b) => a + b, 0).toLocaleString()}`} labels={rlabels} data={rdia} color="#ff8f8f" unit="" />
      </div>
      <div className="oc-card">
        <div className="oc-cardhead"><h3>결제 · 환불 내역 <span className="oc-mut">({pTotal.toLocaleString()})</span></h3><GranTabs gran={kind} set={pickKind} opts={KIND_F} /></div>
        {pLoading ? <div className="oc-empty">불러오는 중…</div> : pRows.length === 0 ? <div className="oc-empty">해당 내역이 없습니다. (결제 원장 이벤트 · #43 연동 후 KRW 금액 표시)</div> : (
          <table className="oc-table">
            <thead><tr><th>시각</th><th>유저</th><th>종류</th><th>상품</th><th style={{ textAlign: 'right' }}>다이아</th><th style={{ textAlign: 'right' }}>잔액</th></tr></thead>
            <tbody>{pRows.map((p) => { const buy = p.reason === 'purchase'; const dv = nnum(p.delta); return (
              <tr key={p.id as string}>
                <td>{fmtDT(p.createdAt)}</td>
                <td className="oc-mut" title={String(p.userId)}>{String(p.userId).slice(0, 8)}…</td>
                <td><span className={`oc-pill ${buy ? 'g' : 'r'}`}>{buy ? '구매' : '환불'}</span></td>
                <td className="oc-mut">{(p.ref as string) || '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: dv >= 0 ? 'var(--ac)' : '#ff8f8f' }}>{dv >= 0 ? '+' : ''}{dv.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }} className="oc-mut">{nnum(p.balanceAfter).toLocaleString()}</td>
              </tr>); })}</tbody>
          </table>
        )}
        {pTotal > PLIM ? (
          <div className="oc-pager">
            <button className="oc-btn ghost sm" disabled={pOffset === 0} onClick={() => setPOffset(Math.max(0, pOffset - PLIM))}>← 이전</button>
            <span>{pOffset + 1}–{Math.min(pOffset + PLIM, pTotal)} / {pTotal.toLocaleString()}</span>
            <button className="oc-btn ghost sm" disabled={pOffset + PLIM >= pTotal} onClick={() => setPOffset(pOffset + PLIM)}>다음 →</button>
          </div>
        ) : null}
      </div>
    </>
  );
}

// ── 광고: 일/주/월/연 시청 횟수·고유 시청자 ──
function Ads({ api }: { api: Api }) {
  const [gran, setGran] = useState('day');
  const [d, setD] = useState<Json | null>(null);
  useEffect(() => { let live = true; api(`/api/admin/series?metric=ad&granularity=${gran}`).then((r) => { if (live) setD(r.body.ok ? r.body : null); }); return () => { live = false; }; }, [api, gran]);
  const labels = (d?.labels as string[]) ?? [], count = narr(d?.count), usersA = narr(d?.users);
  const cTotal = count.reduce((a, b) => a + b, 0), last = count[count.length - 1] ?? 0, lastU = usersA[usersA.length - 1] ?? 0;
  const GR = [{ v: 'day', l: '일별' }, { v: 'week', l: '주별' }, { v: 'month', l: '월별' }, { v: 'year', l: '연별' }];
  return (
    <>
      <div className="oc-cardhead" style={{ marginBottom: 18 }}><div className="oc-mut" style={{ fontSize: 13 }}>광고 1회 시청 = 다이아 +50 (하루 8회 상한).</div><GranTabs gran={gran} set={setGran} opts={GR} /></div>
      <div className="oc-grid">
        <Stat ic="📺" k="총 시청 횟수" v={cTotal.toLocaleString()} s={`최근 ${labels.length}구간 합`} />
        <Stat ic="👁" k="최근 구간 시청" v={String(last)} s={`시청자 ${lastU}명`} />
        <Stat ic="💎" k="지급 다이아" v={(cTotal * 50).toLocaleString()} s="시청 보상 합" />
      </div>
      <div className="oc-charts">
        <BarsCard title="광고 시청 횟수" value={`${cTotal.toLocaleString()} 회`} labels={labels} data={count} color="#f2a93b" unit="회" />
        <LineCard title="고유 시청자" value={`${lastU} 명`} labels={labels} data={usersA} color="#19c2ae" />
      </div>
    </>
  );
}

// 업적 카탈로그(제목·카테고리) — engine/achievements.ts 미러(서버 tsconfig 격리로 import 불가, econ.ts와 동일 정책).
const ACH_CAT: { id: string; t: string; c: string }[] = [
  { id: 'first_title', t: '첫 우승', c: '우승' }, { id: 'titles_3', t: '도전자', c: '우승' }, { id: 'titles_5', t: '명문 구단', c: '우승' }, { id: 'titles_10', t: '불멸의 명가', c: '우승' }, { id: 'titles_15', t: '리그의 지배자', c: '우승' }, { id: 'titles_20', t: '전설의 구단', c: '우승' }, { id: 'back_to_back', t: '왕좌 수성', c: '우승' }, { id: 'three_peat', t: '왕조의 시작', c: '우승' }, { id: 'five_peat', t: '대왕조', c: '우승' },
  { id: 'make_mvp', t: '리그 최고', c: '시상' }, { id: 'mvp_3', t: 'MVP 명가', c: '시상' }, { id: 'mvp_5', t: 'MVP 군단', c: '시상' }, { id: 'mvp_b2b', t: '절대 강자', c: '시상' }, { id: 'make_finals_mvp', t: '결승의 주인공', c: '시상' }, { id: 'make_rookie', t: '미래를 키우다', c: '시상' }, { id: 'rookie_3', t: '신인 명가', c: '시상' }, { id: 'make_improved', t: '성장의 증명', c: '시상' }, { id: 'make_scoring_king', t: '득점 기계', c: '시상' }, { id: 'title_kings_5', t: '타이틀 컬렉터', c: '시상' }, { id: 'title_kings_15', t: '타이틀 수집가', c: '시상' }, { id: 'sweep4_titles', t: '부문 장악', c: '시상' }, { id: 'best7_trio', t: '베스트7 군단', c: '시상' }, { id: 'best7_10', t: '베스트7 단골', c: '시상' }, { id: 'award_sweep', t: '시상식 싹쓸이', c: '시상' }, { id: 'round_mvp_5', t: '라운드의 지배자', c: '시상' },
  { id: 'first_hof', t: '명예의 전당', c: '레전드' }, { id: 'hof_3', t: '레전드의 요람', c: '레전드' }, { id: 'hof_5', t: '레전드 사관학교', c: '레전드' }, { id: 'hof_10', t: '전설의 산실', c: '레전드' }, { id: 'make_legend', t: '헌액 레전드', c: '레전드' }, { id: 'legend_3', t: '불멸의 군단', c: '레전드' }, { id: 'hof_all_pos', t: '다재다능한 명가', c: '레전드' }, { id: 'hof_8000', t: '불세출의 에이스', c: '레전드' }, { id: 'hof_longevity', t: '철인 레전드', c: '레전드' },
  { id: 'league_record', t: '리그를 새로 쓰다', c: '기록' }, { id: 'big_milestone', t: '역사를 넘어서', c: '기록' }, { id: 'big_milestone_5', t: '역사의 산증인', c: '기록' }, { id: 'club_record', t: '구단 신기록', c: '기록' }, { id: 'milestones_20', t: '기록의 보고', c: '기록' },
  { id: 'win_streak_10', t: '파죽지세', c: '서사' }, { id: 'win_streak_15', t: '무적함대', c: '서사' }, { id: 'lose_streak_10', t: '악몽의 시즌', c: '서사' }, { id: 'all_ranks', t: '산전수전', c: '서사' }, { id: 'worst_to_first', t: '최하위의 반란', c: '서사' }, { id: 'last_3peat', t: '암흑기', c: '서사' }, { id: 'runner_up_3', t: '만년 2위', c: '서사' }, { id: 'podium_10', t: '가을 단골', c: '서사' }, { id: 'podium_streak_5', t: '꾸준한 강호', c: '서사' }, { id: 'reverse_sweep', t: '대역전극', c: '서사' }, { id: 'sweep_title', t: '완벽한 대관식', c: '서사' }, { id: 'blown_lead', t: '통한의 준우승', c: '서사' }, { id: 'perfect_season', t: '무패의 전설', c: '서사' }, { id: 'wins_30', t: '압도적 시즌', c: '서사' }, { id: 'wins_20s', t: '강호의 반열', c: '서사' }, { id: 'wins_10s', t: '평범한 한 해', c: '서사' }, { id: 'wins_single', t: '다사다난', c: '서사' }, { id: 'winless_season', t: '굴욕의 시즌', c: '서사' },
  { id: 'first_draft', t: '첫 드래프트', c: '단장' }, { id: 'draft_veteran', t: '드래프트 베테랑', c: '단장' }, { id: 'first_fa', t: '첫 영입', c: '단장' }, { id: 'fa_mogul', t: '영입의 큰손', c: '단장' }, { id: 'first_coach', t: '감독 선임', c: '단장' }, { id: 'coach_collector', t: '명장 편력', c: '단장' }, { id: 'first_staff', t: '프런트 강화', c: '단장' }, { id: 'first_interview', t: '첫 면담', c: '단장' }, { id: 'interview_master', t: '소통의 달인', c: '단장' },
  { id: 'first_point', t: '첫 득점', c: '통산' }, { id: 'first_concede', t: '첫 실점', c: '통산' }, { id: 'first_ace', t: '첫 서브 에이스', c: '통산' }, { id: 'first_set_win', t: '첫 세트 승리', c: '통산' }, { id: 'first_set_loss', t: '첫 세트 패배', c: '통산' }, { id: 'first_match_win', t: '첫 경기 승리', c: '통산' }, { id: 'first_match_loss', t: '첫 경기 패배', c: '통산' }, { id: 'points_100', t: '백 점 돌파', c: '통산' }, { id: 'points_1k', t: '천 점 클럽', c: '통산' }, { id: 'points_10k', t: '만 점의 탑', c: '통산' }, { id: 'points_100k', t: '십만 득점', c: '통산' }, { id: 'points_1m', t: '백만 득점', c: '통산' },
  { id: 'cash_200k', t: '흑자 경영', c: '운영' }, { id: 'cash_500k', t: '탄탄한 곳간', c: '운영' }, { id: 'cash_1m', t: '재벌 구단', c: '운영' }, { id: 'fan_70', t: '지역 명문', c: '운영' }, { id: 'fan_90', t: '국민 구단', c: '운영' }, { id: 'seasons_10', t: '한 세대', c: '운영' }, { id: 'seasons_50', t: '반세기 명가', c: '운영' }, { id: 'seasons_100', t: '백년 구단', c: '운영' },
];
// ── 업적: 카탈로그 + 달성율(원장 ref 기반) ──
function Achievements({ api }: { api: Api }) {
  const [d, setD] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let live = true; setLoading(true); api('/api/admin/achievements').then((r) => { if (live) { setD(r.body.ok ? r.body : null); setLoading(false); } }); return () => { live = false; }; }, [api]);
  const total = nnum(d?.totalUsers);
  const counts = (d?.counts as Record<string, number>) ?? {};
  const cats = Array.from(new Set(ACH_CAT.map((a) => a.c)));
  const unlockedAny = ACH_CAT.filter((a) => (counts[a.id] ?? 0) > 0).length;
  return (
    <>
      <div className="oc-grid">
        <Stat ic="🏆" k="업적 수" v={String(ACH_CAT.length)} s={`${cats.length}개 카테고리`} />
        <Stat ic="👥" k="집계 대상" v={total.toLocaleString()} s="현재 사용자(달성율 분모)" />
        <Stat ic="✅" k="1명+ 달성 업적" v={`${unlockedAny} / ${ACH_CAT.length}`} s="누구든 달성한 업적" />
      </div>
      {loading ? <div className="oc-card"><div className="oc-empty">불러오는 중…</div></div> : cats.map((cat) => (
        <div className="oc-card" key={cat}>
          <div className="oc-cardhead"><h3>{cat}</h3></div>
          {ACH_CAT.filter((a) => a.c === cat).map((a) => {
            const n = counts[a.id] ?? 0;
            const pct = total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
            return (
              <div className="oc-achrow" key={a.id}>
                <div style={{ flex: 1 }}><div className="t">{a.t}</div><div className="d">{a.id}</div></div>
                <div className="meta"><div className="oc-bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></div></div>
                <div className="pct">{pct}%<div className="cnt">{n.toLocaleString()}명</div></div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

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
  const [st, setSt] = useState<'all' | 'pending' | 'open' | 'reviewing' | 'answered'>('pending');
  const [sel, setSel] = useState<Json | null>(null);
  const filtered = tickets.filter((t) => {
    if (cat !== 'all' && String(t.category) !== cat) return false;
    const s = String(t.status ?? 'open');
    const done = s === 'answered' || s === 'replied' || s === 'resolved' || s === 'refunded';
    if (st === 'pending' && !(s === 'open' || s === 'reviewing')) return false; // 미처리 = 대기+확인중
    if (st === 'open' && s !== 'open') return false;
    if (st === 'reviewing' && s !== 'reviewing') return false;
    if (st === 'answered' && !done) return false;
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
          <select className="oc-input" value={st} onChange={(e) => setSt(e.target.value as 'all' | 'pending' | 'open' | 'reviewing' | 'answered')} style={{ ...ss, width: 140 }}>
            <option value="all">전체 상태</option><option value="pending">미처리(대기+확인중)</option><option value="open">대기</option><option value="reviewing">확인 중</option><option value="answered">답변완료</option>
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
  // 답변 저장 시 상태를 함께 지정: reviewing(확인 중 — "확인해보겠습니다") / answered(답변완료 — 원인·해결 안내).
  const saveReply = async (status: 'reviewing' | 'answered') => {
    const r = await api('/api/admin/ticket/reply', { method: 'POST', body: JSON.stringify({ ticketId: t.id, reply, status }) });
    setMsg(r.body.ok ? (status === 'reviewing' ? '확인 중으로 저장됨' : '답변완료로 저장됨') : `실패(${r.status})`);
    reload();
  };
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
        <button className="oc-btn ghost sm" onClick={() => saveReply('reviewing')}>확인 중으로</button>
        <button className="oc-btn blue sm" onClick={() => saveReply('answered')}>답변완료로</button>
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
