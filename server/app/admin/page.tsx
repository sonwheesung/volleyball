'use client';
// 관리자 대시보드 (BACKEND_SYSTEM §13.15) — 최소 운영 콘솔. ADMIN_TOKEN(localStorage)으로 API 호출.
// 쿠폰 발급/목록 · 공지 발행/목록/삭제 · 운영설정(점검·버전). 인라인 스타일만(외부 스크립트 0 — XSS 표면 최소).
import { useCallback, useEffect, useState } from 'react';

type Json = Record<string, unknown>;

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string>('');
  const [coupons, setCoupons] = useState<Json[]>([]);
  const [anns, setAnns] = useState<Json[]>([]);
  const [setting, setSetting] = useState<Json | null>(null);

  useEffect(() => { setToken(localStorage.getItem('adminToken') ?? ''); }, []);
  const saveToken = (t: string) => { setToken(t); localStorage.setItem('adminToken', t); };

  const api = useCallback(async (path: string, init?: RequestInit): Promise<{ status: number; body: Json }> => {
    const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
    let body: Json = {}; try { body = await res.json(); } catch {}
    return { status: res.status, body };
  }, [token]);

  const refresh = useCallback(async () => {
    const [c, a, s] = await Promise.all([api('/api/admin/coupon'), api('/api/admin/announcement'), api('/api/admin/setting')]);
    if (c.status === 401) { setMsg('❌ 토큰이 유효하지 않습니다(401).'); return; }
    setCoupons((c.body.coupons as Json[]) ?? []);
    setAnns((a.body.announcements as Json[]) ?? []);
    setSetting((s.body.setting as Json) ?? null);
    setMsg('✅ 불러왔습니다.');
  }, [api]);

  // ── 쿠폰 발급 ──
  const [cCode, setCCode] = useState(''); const [cReward, setCReward] = useState('100');
  const [cTarget, setCTarget] = useState(''); const [cEnds, setCEnds] = useState('');
  const issueCoupon = async () => {
    const r = await api('/api/admin/coupon', { method: 'POST', body: JSON.stringify({ code: cCode, rewardDiamonds: Number(cReward), targetUserId: cTarget || null, endsAt: cEnds || null }) });
    setMsg(r.body.ok ? `✅ 쿠폰 발급: ${r.body.code}` : `❌ 발급 실패(${r.status}): ${r.body.reason}`);
    if (r.body.ok) { setCCode(''); refresh(); }
  };

  // ── 공지 발행 ──
  const [aTitle, setATitle] = useState(''); const [aBody, setABody] = useState('');
  const [aEnds, setAEnds] = useState(''); const [aPinned, setAPinned] = useState(false);
  const publishAnn = async () => {
    const r = await api('/api/admin/announcement', { method: 'POST', body: JSON.stringify({ title: aTitle, body: aBody, endsAt: aEnds || null, pinned: aPinned }) });
    setMsg(r.body.ok ? '✅ 공지 발행' : `❌ 발행 실패(${r.status}): ${r.body.reason}`);
    if (r.body.ok) { setATitle(''); setABody(''); refresh(); }
  };
  const deleteAnn = async (id: string) => {
    const r = await api(`/api/admin/announcement?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setMsg(r.body.ok ? '🗑 공지 삭제' : `❌ 삭제 실패(${r.status})`); refresh();
  };

  // ── 운영 설정 ──
  const [minV, setMinV] = useState(''); const [latV, setLatV] = useState('');
  const [maint, setMaint] = useState(false); const [maintT, setMaintT] = useState(''); const [maintB, setMaintB] = useState('');
  useEffect(() => {
    if (!setting) return;
    setMinV((setting.minVersion as string) ?? ''); setLatV((setting.latestVersion as string) ?? '');
    setMaint(!!setting.maintenance); setMaintT((setting.maintenanceTitle as string) ?? ''); setMaintB((setting.maintenanceBody as string) ?? '');
  }, [setting]);
  const saveSetting = async () => {
    const r = await api('/api/admin/setting', { method: 'POST', body: JSON.stringify({ minVersion: minV || null, latestVersion: latV || null, maintenance: maint, maintenanceTitle: maintT || null, maintenanceBody: maintB || null }) });
    setMsg(r.body.ok ? '✅ 설정 저장' : `❌ 저장 실패(${r.status})`); if (r.body.ok) refresh();
  };

  const S = { input: { padding: 8, border: '1px solid #ccc', borderRadius: 6, marginRight: 8, marginBottom: 8 } as const, btn: { padding: '8px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 700 } as const, card: { border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 18 } as const, h2: { fontSize: 17, fontWeight: 800, marginBottom: 10 } as const };

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>🏐 배구명가 관리자</h1>
      <p style={{ color: '#64748b', marginBottom: 16, fontSize: 13 }}>ADMIN_TOKEN으로 보호됩니다. 토큰은 이 브라우저에만 저장됩니다.</p>

      <div style={S.card}>
        <div style={S.h2}>인증</div>
        <input type="password" placeholder="ADMIN_TOKEN" value={token} onChange={(e) => saveToken(e.target.value)} style={{ ...S.input, width: 320 }} />
        <button onClick={refresh} style={S.btn}>불러오기</button>
        {msg ? <p style={{ marginTop: 10, fontSize: 13 }}>{msg}</p> : null}
      </div>

      <div style={S.card}>
        <div style={S.h2}>쿠폰 발급</div>
        <input placeholder="코드(예: LAUNCH100)" value={cCode} onChange={(e) => setCCode(e.target.value)} style={S.input} />
        <input placeholder="다이아" type="number" value={cReward} onChange={(e) => setCReward(e.target.value)} style={{ ...S.input, width: 90 }} />
        <input placeholder="개인 대상 userId(빈칸=전체)" value={cTarget} onChange={(e) => setCTarget(e.target.value)} style={{ ...S.input, width: 260 }} />
        <input placeholder="종료(YYYY-MM-DD, 빈칸=무기한)" value={cEnds} onChange={(e) => setCEnds(e.target.value)} style={{ ...S.input, width: 220 }} />
        <button onClick={issueCoupon} style={S.btn}>발급</button>
        <ul style={{ marginTop: 12, fontSize: 13, lineHeight: 1.7 }}>
          {coupons.map((c) => (
            <li key={String(c.id)}>
              <b>{String(c.code)}</b> · {String(c.rewardDiamonds)}💎 · {c.targetUserId ? '개인' : '전체'} · {c.disabled ? '비활성' : '활성'} · 종료 {c.endsAt ? String(c.endsAt).slice(0, 10) : '무기한'}
            </li>
          ))}
        </ul>
      </div>

      <div style={S.card}>
        <div style={S.h2}>공지 발행</div>
        <input placeholder="제목" value={aTitle} onChange={(e) => setATitle(e.target.value)} style={{ ...S.input, width: 320 }} />
        <input placeholder="종료(YYYY-MM-DD, 빈칸=무기한)" value={aEnds} onChange={(e) => setAEnds(e.target.value)} style={{ ...S.input, width: 220 }} />
        <label style={{ fontSize: 13, marginRight: 8 }}><input type="checkbox" checked={aPinned} onChange={(e) => setAPinned(e.target.checked)} /> 고정</label>
        <br />
        <textarea placeholder="내용" value={aBody} onChange={(e) => setABody(e.target.value)} style={{ ...S.input, width: 560, height: 70 }} />
        <br />
        <button onClick={publishAnn} style={S.btn}>발행</button>
        <ul style={{ marginTop: 12, fontSize: 13, lineHeight: 1.7 }}>
          {anns.map((a) => (
            <li key={String(a.id)}>
              {a.pinned ? '📌 ' : ''}<b>{String(a.title)}</b> · 종료 {a.endsAt ? String(a.endsAt).slice(0, 10) : '무기한'}{' '}
              <button onClick={() => deleteAnn(String(a.id))} style={{ ...S.btn, background: '#dc2626', padding: '2px 8px', fontSize: 12 }}>삭제</button>
            </li>
          ))}
        </ul>
      </div>

      <div style={S.card}>
        <div style={S.h2}>운영 설정(버전 게이트 · 서버 점검)</div>
        <input placeholder="강제 최소버전(minVersion)" value={minV} onChange={(e) => setMinV(e.target.value)} style={S.input} />
        <input placeholder="최신버전(latestVersion)" value={latV} onChange={(e) => setLatV(e.target.value)} style={S.input} />
        <br />
        <label style={{ fontSize: 13, marginRight: 8 }}><input type="checkbox" checked={maint} onChange={(e) => setMaint(e.target.checked)} /> 점검 모드(진입 차단)</label>
        <br />
        <input placeholder="점검 제목" value={maintT} onChange={(e) => setMaintT(e.target.value)} style={{ ...S.input, width: 320 }} />
        <br />
        <textarea placeholder="점검 내용" value={maintB} onChange={(e) => setMaintB(e.target.value)} style={{ ...S.input, width: 560, height: 60 }} />
        <br />
        <button onClick={saveSetting} style={S.btn}>설정 저장</button>
      </div>
    </main>
  );
}
