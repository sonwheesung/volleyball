'use client';
// 배구명가 운영 콘솔 (BACKEND_SYSTEM §13.15) — 로그인 게이트 + 대시보드(개요·쿠폰·공지·운영설정·문의/환불).
// URL은 /admin 아님(추측 차단, 2026-07-04 사용자 요청) — 실제 보안은 ADMIN_TOKEN(requireAdmin fail-closed §13.15).
// 인라인 스타일 + 내장 <style>(정적 CSS)만 — 외부 스크립트/스타일 0(XSS 표면 최소). 관리자 전용 화면.
import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { AD_REWARD, AD_DAILY_CAP } from '../../lib/econ'; // 다이아 econ 권위(서버) — ×50/하루8 리터럴 금지(engine/diamonds 미러)

type Json = Record<string, unknown>;
// 11섹션 IA(BACKEND_SYSTEM §13.25-D). ①~⑧=분석 그룹 · ⑨=운영 · ⑩⑪=대시보드(overview) 상단.
type Tab = 'overview' | 'users' | 'retention' | 'play' | 'offseason' | 'telemetry' | 'payments' | 'ads' | 'match' | 'players' | 'achv' | 'errors' | 'coupons' | 'anns' | 'patchnotes' | 'devnotes' | 'mail' | 'settings' | 'tickets';

async function apiCall(path: string, token: string, init?: RequestInit): Promise<{ status: number; body: Json }> {
  // 네트워크 자체 실패(서버 다운·타임아웃·오프라인)면 fetch가 throw — 이걸 안 잡으면 호출부의
  //   setBusy(false)·에러표시가 안 돌아 버튼이 영구 로딩에 갇히고 관리자가 무피드백(#46 무피드백 형제).
  //   → { status:0, ok:false, reason:'network' }로 정규화해 호출부 else 경로(errMsg)가 자연히 탄다.
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
  } catch {
    return { status: 0, body: { ok: false, reason: 'network' } };
  }
  let body: Json = {};
  try { body = await res.json(); } catch {}
  // 응답 바디에 ok가 없어도(빈 200/비JSON) HTTP 상태로 성공 여부 판정 — 침묵 실패 방지
  if (body.ok === undefined) body.ok = res.ok;
  return { status: res.status, body };
}

// 서버 reason 코드 → 사람이 읽는 한국어 사유. 라우트들은 { ok:false, reason } (+ status)로 실패를 알린다(§13.15).
const REASON_KO: Record<string, string> = {
  unauthorized: '권한이 없습니다 — 토큰이 만료되었을 수 있으니 다시 로그인하세요',
  'bad-request': '입력값이 올바르지 않습니다 — 필수 항목을 확인하세요',
  duplicate: '이미 같은 코드의 쿠폰이 있습니다 (코드 중복)',
  'no-such-user': '해당 user id의 사용자가 없습니다',
  'has-redemptions': '사용 기록이 있어 삭제할 수 없습니다 — 비활성화하세요',
  'not-found': '대상을 찾을 수 없습니다 (이미 삭제되었을 수 있음)',
  // 지갑 실패는 admin/refund·admin/grant가 **400 + 이 reason**으로 내려준다(§13.21 노이즈 정리 2026-07-24 —
  // 그전엔 500 'error'로 뭉개져 "서버 오류"로 보이고 Sentry 알림까지 울렸다). userId 오타·타 게임 유저가 대부분.
  'wallet:no-user': '해당 사용자의 지갑을 찾을 수 없습니다 — user id를 확인하세요(오타·다른 게임 사용자)',
  'wallet:insufficient': '잔액이 부족해 차감할 수 없습니다',
  error: '서버 오류가 발생했습니다',
  network: '서버에 연결하지 못했습니다 — 네트워크·서버 상태를 확인하세요',
};
// 실패 응답을 사용자에게 노출할 문구로. 서버가 준 reason/error/message를 읽어 사유 + HTTP status를 함께 보여준다(침묵 실패 금지).
function errMsg(r: { status: number; body: Json }, fallback = '요청을 처리하지 못했습니다'): string {
  const raw = (r.body?.reason ?? r.body?.error ?? r.body?.message) as unknown;
  const reason = typeof raw === 'string' ? raw : '';
  const ko = REASON_KO[reason] ?? (reason || fallback);
  return `${ko} (${r.status})`;
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
/* 상태 토글 버튼(예: 사용자 목록 '내부') — 상태가 바뀌어도 **박스가 흔들리지 않아야** 한다.
   흔들림 원인 둘: ① 라벨 글자수('내부' 2자 vs '—' 1자 vs 로딩 '…') ② .ghost에만 있는 1px 테두리(비-ghost는 border:none이라 2px 좁다).
   → min-width 고정 + 두 상태 모두 1px 테두리(활성은 transparent)로 박스를 동일하게. inline-flex로 라벨 광학 중앙.
   ⚠ 테두리는 :not(.ghost)로만 준다 — .oc-btn.ghost보다 뒤에 오는 규칙이라 그냥 border를 쓰면 ghost의 외곽선을 지워버린다(동일 특이도, 후순위 승). */
.oc-btn.toggle{min-width:54px;display:inline-flex;align-items:center;justify-content:center;line-height:1;}
.oc-btn.toggle:not(.ghost){border:1px solid transparent;}
.oc-err{color:var(--dg);font-size:13px;margin-top:12px;} .oc-ok{color:var(--gd);font-size:13px;margin-top:12px;}
.oc-shell{display:grid;grid-template-columns:240px 1fr;min-height:100vh;}
/* sticky+100vh만으론 메뉴가 뷰포트를 넘으면 잘린다(본문 스크롤에 딸려 올라감) — 사이드바 자체를
   독립 스크롤 컨테이너로. overflow-y는 .oc-nav(목록)에 둬서 로고는 상단 고정, 목록만 굴러간다. */
.oc-side{background:var(--panel);border-right:1px solid var(--bd2);padding:20px 14px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow:hidden;}
.oc-nav{display:flex;flex-direction:column;gap:4px;margin-top:22px;flex:1;overflow-y:auto;min-height:0;overscroll-behavior:contain;scrollbar-width:thin;}
.oc-nav::-webkit-scrollbar{width:8px;}
.oc-nav::-webkit-scrollbar-thumb{background:var(--bd2);border-radius:99px;}
.oc-nav::-webkit-scrollbar-track{background:transparent;}
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
.oc-spin{width:32px;height:32px;border:3px solid var(--bd);border-top-color:var(--ac);border-radius:50%;animation:ocspin .7s linear infinite;}
@keyframes ocspin{to{transform:rotate(360deg);}}
.oc-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:72px 0;color:var(--mut);font-size:13px;}
.oc-emptyrow{display:flex;align-items:center;justify-content:center;gap:10px;}
.oc-spin.sm{width:16px;height:16px;border-width:2px;}
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
.oc-modal-f{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:15px 22px;border-top:1px solid var(--bd2);flex-wrap:wrap;}
/* 모달 푸터 버튼 규격 통일 — 모든 모달이 같은 높이·패딩·폰트·정렬(우측). sm이 섞여도 동일하게 정규화. */
.oc-modal-f .oc-btn,.oc-modal-f .oc-btn.sm{min-height:40px;padding:10px 18px;font-size:13.5px;font-weight:800;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;line-height:1;min-width:74px;}
/* 푸터 인라인 오류 문구 — 좌측에 붙고(버튼은 우측 유지) 서버가 준 실패 사유를 노출 */
.oc-modal-msg{margin-right:auto;font-size:12.5px;font-weight:700;line-height:1.45;max-width:60%;}
.oc-modal-msg.err{color:var(--dg);} .oc-modal-msg.ok{color:var(--gd);}
.oc-fld{display:flex;flex-direction:column;gap:7px;} .oc-fld .oc-input{width:100%;}
.oc-frow{display:flex;gap:12px;} .oc-frow .oc-fld{flex:1;}
/* 노트 마크다운 미리보기(DEVNOTES) — 앱과 같은 경량 규칙(제목·리스트·굵게·코드·링크)을 관리자가 예측 */
.oc-mdprev{color:var(--tx);font-size:13.5px;line-height:1.65;}
.oc-mdprev h3{font-size:16px;font-weight:900;margin:14px 0 7px;} .oc-mdprev h3:first-child{margin-top:0;}
.oc-mdprev h4{font-size:14px;font-weight:800;margin:12px 0 6px;color:var(--tx);}
.oc-mdprev p{margin:0 0 9px;} .oc-mdprev ul{margin:0 0 9px;padding-left:20px;} .oc-mdprev li{margin:2px 0;}
.oc-mdprev strong{font-weight:800;color:#fff;} .oc-mdprev a{color:var(--ac2);text-decoration:underline;}
.oc-mdprev code{background:var(--bd2);border-radius:5px;padding:1px 6px;font-size:12px;font-family:ui-monospace,monospace;color:var(--ac);}
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
/* ⑪ 메인 KPI 카드행 — 최상단 큰 카드. 실값=밝게, 외부-sync=흐리게+배지 */
.oc-kpirow{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px;}
.oc-kpi{background:linear-gradient(160deg,var(--card) 0%,var(--card2) 100%);border:1px solid var(--bd);border-radius:14px;padding:16px 16px 15px;position:relative;}
.oc-kpi.ext{opacity:.62;} .oc-kpi .kk{color:var(--mut);font-size:12px;font-weight:700;letter-spacing:.2px;}
.oc-kpi .kv{font-size:26px;font-weight:900;margin-top:7px;letter-spacing:-.6px;} .oc-kpi.ext .kv{color:var(--mut);font-weight:800;}
.oc-kpi .ks{color:var(--mut);font-size:11px;margin-top:3px;}
.oc-kpi .kbadge{position:absolute;top:11px;right:11px;font-size:9.5px;font-weight:800;color:var(--vi);background:rgba(155,123,255,.16);border-radius:6px;padding:2px 6px;letter-spacing:.2px;}
/* ⑩ 운영 알림 */
.oc-alerts{display:flex;flex-direction:column;gap:10px;margin-bottom:20px;}
.oc-alert{display:flex;align-items:center;gap:13px;border-radius:13px;padding:14px 16px;border:1px solid;}
.oc-alert.warn{background:rgba(242,169,59,.10);border-color:rgba(242,169,59,.4);} .oc-alert.crit{background:rgba(255,107,90,.11);border-color:rgba(255,107,90,.45);}
.oc-alert .ai{font-size:20px;} .oc-alert .al{font-weight:800;font-size:14px;} .oc-alert .ad{color:var(--mut);font-size:12.5px;margin-top:2px;}
.oc-alert .ad b{color:var(--tx);} .oc-alert .apct{margin-left:auto;font-weight:900;font-size:16px;}
.oc-alert.warn .apct{color:var(--wn);} .oc-alert.crit .apct{color:var(--dg);}
.oc-alert-ok{display:flex;align-items:center;gap:10px;color:var(--gd);font-size:13.5px;font-weight:700;background:rgba(43,209,126,.09);border:1px solid rgba(43,209,126,.28);border-radius:13px;padding:13px 16px;margin-bottom:20px;}
/* 미구현 섹션 placeholder */
.oc-ph{text-align:center;padding:34px 20px;} .oc-ph .phi{font-size:34px;} .oc-ph .pht{font-size:16px;font-weight:800;margin-top:12px;}
.oc-ph .phbadge{display:inline-block;margin-top:10px;font-size:11.5px;font-weight:800;color:var(--vi);background:rgba(155,123,255,.15);border-radius:999px;padding:4px 13px;}
.oc-ph .phlist{list-style:none;padding:0;margin:18px auto 0;max-width:440px;text-align:left;display:flex;flex-direction:column;gap:8px;}
.oc-ph .phlist li{color:var(--mut);font-size:13px;padding-left:20px;position:relative;line-height:1.5;}
.oc-ph .phlist li:before{content:"○";position:absolute;left:0;color:var(--bd);}
.oc-tag2{font-size:11px;font-weight:700;color:var(--vi);background:rgba(155,123,255,.14);border-radius:6px;padding:2px 8px;margin-left:8px;}
/* ── 반응형(모바일) — 좁은 화면(≤768px)에서만 사이드바를 드로어로, 그리드/패딩/고정폭 축소. 데스크톱은 불변. ── */
.oc-topleft{display:flex;align-items:center;gap:12px;min-width:0;}
.oc-burger{display:none;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;border:1px solid var(--bd);background:var(--panel);color:var(--tx);font-size:19px;line-height:1;cursor:pointer;flex-shrink:0;}
.oc-burger:hover{background:var(--bd2);}
.oc-scrim{position:fixed;inset:0;background:rgba(3,6,11,.62);z-index:55;backdrop-filter:blur(2px);}
@media(max-width:768px){
  .oc-shell{grid-template-columns:1fr;}
  .oc-side{position:fixed;top:0;left:0;z-index:60;width:266px;max-width:84vw;height:100vh;overflow-y:auto;transform:translateX(-100%);transition:transform .22s cubic-bezier(.2,.8,.2,1);box-shadow:0 0 44px rgba(0,0,0,.6);}
  .oc-side.open{transform:none;}
  .oc-main{padding:16px 14px;}
  .oc-burger{display:inline-flex;}
  .oc-top{gap:12px;margin-bottom:18px;} .oc-h1{font-size:19px;} .oc-crumb{font-size:12px;}
  .oc-grid{grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:10px;margin-bottom:18px;}
  .oc-kpirow{grid-template-columns:repeat(auto-fit,minmax(126px,1fr));gap:10px;}
  .oc-card{padding:15px 13px;overflow-x:auto;}
  .oc-stat{padding:14px;} .oc-stat .v{font-size:23px;} .oc-kpi .kv{font-size:22px;}
  .oc-frow{flex-direction:column;gap:10px;}
  .oc-achrow{gap:10px;} .oc-achrow .meta{width:96px;}
  .oc-modal-bd{padding:22px 12px 30px;} .oc-dl-row{gap:12px;}
  .oc-seg{display:flex;width:100%;} .oc-segb{flex:1;text-align:center;}
}
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
  { id: 'users', ic: '①', label: '사용자 현황', grp: '분석' },
  { id: 'retention', ic: '②', label: '리텐션', grp: '분석' },
  { id: 'play', ic: '③', label: '플레이', grp: '분석' },
  { id: 'offseason', ic: '④', label: '오프시즌', grp: '분석' },
  { id: 'telemetry', ic: '🎛', label: '행동 텔레메트리', grp: '분석' },
  { id: 'payments', ic: '⑤', label: 'BM · 수익화', grp: '분석' },
  { id: 'ads', ic: '⑥', label: '광고', grp: '분석' },
  { id: 'match', ic: '⑦', label: '경기 데이터', grp: '분석' },
  { id: 'players', ic: '⑧', label: '선수 데이터', grp: '분석' },
  { id: 'achv', ic: '🏆', label: '업적', grp: '분석' },
  { id: 'errors', ic: '⑨', label: '오류 모니터링', grp: '운영' },
  { id: 'coupons', ic: '🎟', label: '쿠폰', grp: '운영' },
  { id: 'anns', ic: '📢', label: '공지', grp: '운영' },
  { id: 'patchnotes', ic: '📋', label: '패치노트', grp: '운영' },
  { id: 'devnotes', ic: '📝', label: '개발자노트', grp: '운영' },
  { id: 'mail', ic: '📬', label: '우편', grp: '운영' },
  { id: 'tickets', ic: '✉', label: '문의 · 환불', grp: '운영' },
  { id: 'settings', ic: '⚙', label: '운영 설정', grp: '운영' },
];
const TITLES: Record<Tab, string> = { overview: '대시보드', users: '① 사용자 현황', retention: '② 리텐션 코호트', play: '③ 플레이', offseason: '④ 오프시즌 funnel', telemetry: '행동 텔레메트리', payments: '⑤ BM · 수익화', ads: '⑥ 광고', match: '⑦ 경기 데이터', players: '⑧ 선수 데이터', achv: '업적', errors: '⑨ 오류 모니터링', coupons: '쿠폰 관리', anns: '공지 관리', patchnotes: '패치노트', devnotes: '개발자 노트', mail: '우편 관리', settings: '운영 설정', tickets: '문의 · 환불' };

// 메뉴 ↔ URL 동기화(?tab=<id>) — 새로고침·북마크·뒤로가기로 특정 메뉴 진입(2026-08-04 사용자 요청).
// 유효하지 않은/없는 값은 overview로. SSR 안전(window 가드 — 클라 컴포넌트지만 초기 렌더는 서버).
const TAB_IDS = new Set<Tab>(NAV.map((n) => n.id));
const isTab = (v: string | null): v is Tab => !!v && TAB_IDS.has(v as Tab);
function tabFromUrl(): Tab {
  if (typeof window === 'undefined') return 'overview';
  const v = new URLSearchParams(window.location.search).get('tab');
  return isTab(v) ? v : 'overview';
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [navOpen, setNavOpen] = useState(false); // 모바일 드로어(≤768px). 데스크톱은 CSS로 사이드바 상시 노출 — 이 값 무관.
  const [coupons, setCoupons] = useState<Json[]>([]);
  const [anns, setAnns] = useState<Json[]>([]);
  const [devnotes, setDevnotes] = useState<Json[]>([]);
  const [setting, setSetting] = useState<Json | null>(null);
  const [tickets, setTickets] = useState<Json[]>([]);
  const [stats, setStats] = useState<Json | null>(null);
  const [toast, setToast] = useState('');
  const [booting, setBooting] = useState(true); // 최초 대시보드 로드 — 완료 전 콘텐츠 영역에 로딩 화면(빈 대시보드 깜빡임 방지)

  // 탭 ↔ URL 동기화. 초기값은 SSR 안전을 위해 'overview' 고정 → 마운트 후 URL에서 읽어 맞춘다(하이드레이션 불일치 방지,
  //   대시보드는 authed 게이트 뒤라 overview가 화면에 깜빡이지 않음). 브라우저 뒤로/앞으로(popstate)도 탭에 반영.
  useEffect(() => {
    setTab(tabFromUrl());
    const onPop = () => setTab(tabFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // 메뉴 클릭 = 탭 전환 + URL 갱신(pushState → 뒤로가기로 이전 메뉴 복귀). 모바일 드로어도 닫는다.
  const selectTab = useCallback((id: Tab) => {
    setTab(id);
    setNavOpen(false);
    const u = new URL(window.location.href);
    u.searchParams.set('tab', id);
    window.history.pushState({ tab: id }, '', u);
  }, []);

  const api = useCallback((p: string, init?: RequestInit) => apiCall(p, token, init), [token]);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    // 새로고침(reload)은 booting을 다시 true로 안 만들어 기존 데이터 유지하며 조용히 갱신(깜빡임 방지) — 최초 1회만 로딩 화면.
    const [c, a, dn, s, tk, st] = await Promise.all([api('/api/admin/coupon'), api('/api/admin/announcement'), api('/api/admin/devnote'), api('/api/admin/setting'), api('/api/admin/ticket'), api('/api/admin/stats')]);
    setCoupons((c.body.coupons as Json[]) ?? []);
    setAnns((a.body.announcements as Json[]) ?? []);
    setDevnotes((dn.body.devnotes as Json[]) ?? []);
    setSetting((s.body.setting as Json) ?? null);
    setTickets((tk.body.tickets as Json[]) ?? []);
    setStats(st.body.ok ? st.body : null);
    setBooting(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // 미처리 = 대기(open) + 확인 중(reviewing). 답변완료·환불완료·레거시(replied/resolved)는 처리됨.
  const openTickets = useMemo(() => tickets.filter((t) => { const s = String(t.status ?? 'open'); return s === 'open' || s === 'reviewing'; }).length, [tickets]);

  return (
    <div className="oc-shell">
      {navOpen ? <div className="oc-scrim" onClick={() => setNavOpen(false)} /> : null}
      <aside className={`oc-side${navOpen ? ' open' : ''}`}>
        <div className="oc-logo" style={{ fontSize: 19, paddingLeft: 6 }}>🏐 운영 콘솔</div>
        <nav className="oc-nav">
          {NAV.map((n, i) => (
            <React.Fragment key={n.id}>
              {n.grp && n.grp !== NAV[i - 1]?.grp ? <div className="oc-navgrp">{n.grp}</div> : null}
              <button className={`oc-navitem${tab === n.id ? ' on' : ''}`} onClick={() => selectTab(n.id)}>
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
          <div className="oc-topleft">
            <button className="oc-burger" onClick={() => setNavOpen(true)} aria-label="메뉴 열기">☰</button>
            <div>
              <div className="oc-h1">{TITLES[tab]}</div>
              <div className="oc-crumb">배구명가 · 운영</div>
            </div>
          </div>
          <button className="oc-btn ghost sm" onClick={() => { load(); flash('새로고침됨'); }}>↻ 새로고침</button>
        </div>

        {booting ? <Loading label="운영 데이터를 불러오는 중…" /> : <>
        {tab === 'overview' && <Overview stats={stats} setting={setting} openTickets={openTickets} />}
        {tab === 'users' && <Users stats={stats} api={api} />}
        {tab === 'retention' && <RetentionTab stats={stats} />}
        {tab === 'play' && <PlayTab api={api} />}
        {tab === 'offseason' && <OffseasonTab api={api} />}
        {tab === 'telemetry' && <TelemetryPanel api={api} />}
        {tab === 'payments' && <Payments stats={stats} api={api} flash={flash} />}
        {tab === 'ads' && <Ads api={api} />}
        {tab === 'match' && <MatchTab api={api} />}
        {tab === 'players' && <PlayersTab api={api} />}
        {tab === 'achv' && <Achievements api={api} />}
        {tab === 'errors' && <Errors api={api} />}
        {tab === 'coupons' && <Coupons coupons={coupons} api={api} reload={load} flash={flash} />}
        {tab === 'anns' && <Anns anns={anns} api={api} reload={load} flash={flash} />}
        {tab === 'patchnotes' && <Devnotes kind="patch" devnotes={devnotes} api={api} reload={load} flash={flash} />}
        {tab === 'devnotes' && <Devnotes kind="note" devnotes={devnotes} api={api} reload={load} flash={flash} />}
        {tab === 'mail' && <MailPanel api={api} flash={flash} />}
        {tab === 'settings' && <Settings setting={setting} api={api} reload={load} flash={flash} />}
        {tab === 'tickets' && <Tickets tickets={tickets} api={api} reload={load} flash={flash} />}
        </>}
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

// 공용 버튼 — 모든 모달 푸터가 이 컴포넌트만 쓴다(규격 통일: primary 강조 · danger 빨강 · ghost 중립).
// 크기/패딩/높이/폰트/정렬은 .oc-modal-f 규칙이 강제 → 배열만 넘기면 일관된 푸터가 된다.
function Btn({ variant = 'primary', onClick, disabled, children, style }: { variant?: 'primary' | 'danger' | 'ghost'; onClick?: () => void; disabled?: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
  const cls = variant === 'danger' ? 'oc-btn red' : variant === 'ghost' ? 'oc-btn ghost' : 'oc-btn';
  return <button className={cls} onClick={onClick} disabled={disabled} style={style}>{children}</button>;
}
// 모달 푸터 인라인 메시지(실패 사유 노출 — 좌측). 성공은 상단 토스트, 실패는 모달 유지 + 여기 표기.
function FooterMsg({ msg }: { msg: string }) { return msg ? <span className="oc-modal-msg err">{msg}</span> : null; }
// 탭/화면 단위 로딩 표시(스피너). 리스트 내부 인라인 로딩은 LoadingRow.
function Loading({ label = '불러오는 중…' }: { label?: string }) { return <div className="oc-loading"><div className="oc-spin" /><div>{label}</div></div>; }
// 테이블/리스트 자리의 인라인 로딩(작은 스피너 + 텍스트) — oc-empty 자리에 그대로 대체.
function LoadingRow({ label = '불러오는 중…' }: { label?: string }) { return <div className="oc-empty oc-emptyrow"><div className="oc-spin sm" />{label}</div>; }

const nnum = (v: unknown): number => (typeof v === 'number' ? v : 0);
const narr = (v: unknown): number[] => (Array.isArray(v) ? (v as number[]) : []);
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => String(i));
function axisLabels(labels: string[]): string[] {
  if (labels.length <= 6) return labels;
  const step = Math.max(1, Math.floor(labels.length / 4));
  return labels.filter((_, i) => i % step === 0 || i === labels.length - 1);
}

// CSV 다운로드(클라 생성 — 서버 라우트 불필요, 이미 받은 표 데이터를 내보냄). BOM으로 엑셀 한글 깨짐 방지.
function downloadCsv(name: string, headers: string[], rows: (string | number)[][]): void {
  const esc = (v: string | number): string => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}
function CsvBtn({ onClick }: { onClick: () => void }) { return <button className="oc-btn ghost sm" onClick={onClick}>⭳ CSV</button>; }
// ② 리텐션 탭 — D1/D3/D7/D14/D30 **근사**(stats route, createdAt·lastSeenAt 기반, 2026-07-31). 정밀 설치일 코호트 매트릭스는 GA4/BigQuery 후.
function RetentionTab({ stats }: { stats: Json | null }) {
  const kpi = (stats?.kpi as Json) ?? {};
  const rows: { k: string; day: string; v: unknown }[] = [
    { k: 'D1', day: '가입 +1일', v: kpi.d1 }, { k: 'D3', day: '가입 +3일', v: kpi.d3 }, { k: 'D7', day: '가입 +7일', v: kpi.d7 },
    { k: 'D14', day: '가입 +14일', v: kpi.d14 }, { k: 'D30', day: '가입 +30일', v: kpi.d30 },
  ];
  const anyReal = rows.some((r) => typeof r.v === 'number');
  return (
    <>
      <div className="oc-card">
        <div className="oc-mut" style={{ fontSize: 13, lineHeight: 1.6 }}>
          리텐션 <span className="oc-tag2">근사 · lastSeenAt 기준</span> — Dk = 가입 후 k일+ 지난 유저 중 <b>마지막 접속이 (가입일+k일) 이후</b>인 비율("아직 살아있나"). lastSeenAt은 마지막 접속만 주므로 <b>정밀 코호트 매트릭스가 아니다</b>(분모 0이면 표본 부족). 결정론 격리(시드/리플레이 무관).
        </div>
      </div>
      <div className="oc-kpirow">
        {rows.map((r) => typeof r.v === 'number'
          ? <div className="oc-kpi" key={r.k} title={`${r.day} 이후 접속 유저 비율(근사)`}><div className="kk">{r.k} <span style={{ fontSize: 9, color: 'var(--mut)' }}>근사</span></div><div className="kv">{r.v}%</div><div className="ks">{r.day} · lastSeenAt</div></div>
          : <div className="oc-kpi ext" key={r.k} title="가입 후 k일+ 지난 유저가 아직 없어 표본 부족(집계 대상 0)."><span className="kbadge">표본 부족</span><div className="kk">{r.k}</div><div className="kv">—</div><div className="ks">{r.day} 경과 유저 0</div></div>)}
      </div>
      {!anyReal && <div className="oc-card"><div className="oc-empty">아직 가입 후 경과일이 쌓인 유저가 없어 리텐션을 계산할 표본이 없습니다 (가입 후 최소 1일 경과 필요).</div></div>}
      <div className="oc-card">
        <div className="oc-mut" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          <span className="oc-tag2">GA4/BigQuery 후</span> <b>정밀 설치일 코호트 매트릭스</b>(설치 코호트별 D1~D30 잔존을 격자로 — "3월 설치군의 D7은?")는 <b>app_open 이벤트</b>가 필요해 GA4/BigQuery 연동 후 표시됩니다. 위는 lastSeenAt 하나로 만드는 <b>단일 근사</b>라 코호트 세분·재방문 빈도는 담지 못합니다.
        </div>
      </div>
    </>
  );
}
// ③ 플레이 탭 — §13.27 season_telemetry 행동 실데이터(2026-07-31). 신 파이프 없음: /api/admin/telemetry가 이미 집계하는
//   개입/타임아웃/교체/지휘모드 행동만 렌더. "시즌 완료율 funnel"은 시즌 시작/이탈 이벤트가 없어 여전히 EAS-후.
function PlayTab({ api }: { api: Api }) {
  const [d, setD] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let live = true; setLoading(true); api('/api/admin/telemetry').then((r) => { if (live) { setD(r.body.ok ? r.body : null); setLoading(false); } }); return () => { live = false; }; }, [api]);
  const agg = (d?.agg as Json) ?? {};
  const reports = nnum(agg.reports);
  const distinct = nnum(d?.distinctUsers);
  const manual = nnum(agg.avgSubsManual), pinch = nnum(agg.avgSubsPinch);
  if (loading) return <Loading />;
  if (!d) return <div className="oc-card"><div className="oc-empty">플레이 데이터를 불러오지 못했습니다 (서버·권한 확인).</div></div>;
  return (
    <>
      <div className="oc-card">
        <div className="oc-mut" style={{ fontSize: 13, lineHeight: 1.6 }}>
          시즌 종료 시 유저의 경기 운영 행동 <span className="oc-tag2">자체-롤업(season_telemetry) · 비식별</span> — 개입·타임아웃·교체·지휘모드. 결정론 격리(시드/리플레이 무관).
        </div>
      </div>
      {reports === 0 ? <div className="oc-card"><div className="oc-empty">아직 수집된 플레이 텔레메트리가 없습니다 (시즌 종료 시 수집 · 서버 배포 후).</div></div> : (
        <div className="oc-grid">
          <Stat ic="📊" k="시즌 리포트 수" v={reports.toLocaleString()} s={`고유 유저 ${distinct.toLocaleString()}명`} />
          <Stat ic="🎮" k="지휘모드 채택률" v={`${nnum(agg.coachModeRate)}%`} s="경기 직접 지휘 on 비율" />
          <Stat ic="✋" k="개입 1회+ 비율" v={`${nnum(agg.interveneRate)}%`} s="자동 관전 아닌 시즌 비율" />
          <Stat ic="🔁" k="평균 개입 수" v={String(nnum(agg.avgInterventions))} s={`타임아웃 ${nnum(agg.avgTimeouts)}`} />
          <Stat ic="🔀" k="평균 교체 (수동/핀치)" v={`${manual} / ${pinch}`} s={`핀치 비중 ${manual + pinch > 0 ? Math.round((pinch / (manual + pinch)) * 100) : 0}%`} />
          <Stat ic="📋" k="평균 선발/벤치 지시" v={String(nnum(agg.avgLineupChanges))} s="구단주 직접 라인업" />
        </div>
      )}
      <div className="oc-card">
        <div className="oc-mut" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          <span className="oc-tag2">EAS 계측 후</span> <b>시즌 진행률 funnel</b>(1·3·5·10시즌 완료율·세션 길이)은 <b>시즌 시작/이탈 이벤트</b>(season_start·app_open engagement)가 필요해 EAS 계측 후 표시됩니다. 위는 시즌 종료 시점 파생 <b>경기 운영 행동량</b>만.
        </div>
      </div>
    </>
  );
}
// ④ 오프시즌 탭 — §13.27 season_telemetry 실데이터 재배선(2026-07-31). 신 파이프 없음:
//   /api/admin/telemetry가 이미 집계하는 오프시즌 행동(전지훈련·방출·제명·훈련방향)만 필터·렌더.
//   ※ "단계 도달/이탈 funnel"(tryout→FA→draft 진입률)은 season_telemetry에 단계 진입 이벤트가 없어 여전히 EAS-후.
function OffseasonTab({ api }: { api: Api }) {
  const [d, setD] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let live = true; setLoading(true); api('/api/admin/telemetry').then((r) => { if (live) { setD(r.body.ok ? r.body : null); setLoading(false); } }); return () => { live = false; }; }, [api]);
  const agg = (d?.agg as Json) ?? {};
  const distinct = nnum(d?.distinctUsers);
  const reports = nnum(agg.reports);
  const topFocus = (agg.topFocus as { code: string; n: number }[]) ?? [];
  // 전지훈련 원장 즉시 집계(다이아 지출 발생 즉시 — 텔레메트리 랙 없음). 텔레메트리 게이트와 무관하게 표시.
  const campUsers = nnum(agg.campLedgerUsers);
  const campEvents = nnum(agg.campLedgerEvents);
  const campDiamonds = nnum(agg.campDiamonds);

  if (loading) return <Loading />;
  if (!d) return <div className="oc-card"><div className="oc-empty">오프시즌 데이터를 불러오지 못했습니다 (서버·권한 확인).</div></div>;

  return (
    <>
      <div className="oc-card">
        <div className="oc-mut" style={{ fontSize: 13, lineHeight: 1.6 }}>
          시즌 종료 시 유저가 남긴 오프시즌 운영 행동 <span className="oc-tag2">자체-롤업(season_telemetry) · 비식별</span> — 전지훈련·방출·제명·훈련 방향. 결정론 격리(시드/리플레이 무관).
        </div>
      </div>
      {/* 전지훈련 즉시 집계 — 다이아 원장(reason='camp') 권위. 텔레메트리(시즌종료)와 달리 지출 즉시 반영. */}
      <div className="oc-card">
        <div className="oc-cardhead"><h3>전지훈련 (다이아 원장 · 즉시)</h3><span className="oc-tag2">wallet_ledger · 랙 없음</span></div>
        <div className="oc-grid">
          <Stat ic="🏕️" k="전지훈련 유저 수" v={campUsers.toLocaleString()} s="reason=camp 고유 유저" />
          <Stat ic="🔁" k="전지훈련 총 횟수" v={campEvents.toLocaleString()} s="선수당 오프시즌 1회 = 연인원" />
          <Stat ic="💎" k="소모 다이아 합" v={campDiamonds.toLocaleString()} s="전지훈련 다이아 지출" />
        </div>
        <div className="oc-mut" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
          전지훈련은 다이아 지출이라 <b>발생 즉시</b> 원장에 기록됩니다. 아래 텔레메트리 지표(campCount)는 <b>시즌을 끝내야</b> 전송돼 한 시즌 늦습니다 — 0이어도 위 원장이 실제 활동입니다.
        </div>
      </div>
      {reports === 0 ? <div className="oc-card"><div className="oc-empty">아직 수집된 오프시즌 텔레메트리가 없습니다 (시즌 종료 시 수집 · 서버 배포 후). 전지훈련 실활동은 위 <b>다이아 원장</b> 카드 참고.</div></div> : (
        <>
          <div className="oc-grid">
            <Stat ic="📊" k="시즌 리포트 수" v={reports.toLocaleString()} s={`고유 유저 ${distinct.toLocaleString()}명`} />
            <Stat ic="💎" k="유저당 평균 전지훈련" v={campUsers > 0 ? (campEvents / campUsers).toFixed(1) : '0'} s={`전지훈련 유저 ${campUsers}명 기준(원장·즉시)`} />
            <Stat ic="🚪" k="평균 방출 수" v={String(nnum(agg.avgReleases))} s="시즌당 방출(releases)" />
            <Stat ic="🛑" k="평균 제명 수" v={String(nnum(agg.avgExpels))} s="시즌당 제명(expels)" />
          </div>
          {topFocus.length > 0 && (
            <div className="oc-card">
              <div className="oc-cardhead"><h3>훈련 방향 분포 (상위)</h3><CsvBtn onClick={() => downloadCsv('offseason-focus.csv', ['훈련방향코드', '시즌 수'], topFocus.map((f) => [f.code, f.n]))} /></div>
              {topFocus.map((f) => { const max = Math.max(1, ...topFocus.map((x) => x.n)); const pct = Math.round((f.n / max) * 100); return (
                <div className="oc-achrow" key={f.code}>
                  <div style={{ flex: 1 }}><div className="t">{f.code}</div><div className="d">primary|secondary 훈련id</div></div>
                  <div className="meta"><div className="oc-bar"><i style={{ width: `${pct}%` }} /></div></div>
                  <div className="pct">{f.n}<div className="cnt">시즌</div></div>
                </div>
              ); })}
            </div>
          )}
        </>
      )}
      <div className="oc-card">
        <div className="oc-mut" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          <span className="oc-tag2">EAS 계측 후</span> <b>단계별 도달/이탈 funnel</b>(외국인 트라이아웃 → FA 센터 → 드래프트 진입률·이탈률)은 <b>단계 진입 이벤트</b>(foreign_tryout_open·fa_open·draft_open)가 필요해 EAS 계측 후 표시됩니다. 위는 세이브 파생 <b>행동량</b>(전지훈련·방출·제명·훈련방향)만.
        </div>
      </div>
    </>
  );
}
// ⑦ 경기 탭 — §13.27 season_telemetry(2026-07-31). v1 payload로 최종순위/우승률 즉시, v2 유입 후 승/패·세트.
function MatchTab({ api }: { api: Api }) {
  const [d, setD] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let live = true; setLoading(true); api('/api/admin/telemetry').then((r) => { if (live) { setD(r.body.ok ? r.body : null); setLoading(false); } }); return () => { live = false; }; }, [api]);
  const agg = (d?.agg as Json) ?? {};
  const reports = nnum(agg.reports);
  const rankDist = (agg.rankDist as { rank: number; n: number }[]) ?? [];
  const matchReports = nnum(agg.matchReports); // v2 승패 보유 리포트 수(0이면 정직 노트)
  if (loading) return <Loading />;
  if (!d) return <div className="oc-card"><div className="oc-empty">경기 데이터를 불러오지 못했습니다 (서버·권한 확인).</div></div>;
  return (
    <>
      <div className="oc-card">
        <div className="oc-mut" style={{ fontSize: 13, lineHeight: 1.6 }}>
          시즌 종료 시점 내 팀 경기 성적 <span className="oc-tag2">자체-롤업(season_telemetry) · 비식별</span> — 최종순위·우승·정규시즌 전적. 결정론 격리(시드/리플레이 무관).
        </div>
      </div>
      {reports === 0 ? <div className="oc-card"><div className="oc-empty">아직 수집된 경기 텔레메트리가 없습니다 (시즌 종료 시 수집 · 서버 배포 후).</div></div> : (
        <>
          <div className="oc-grid">
            <Stat ic="📊" k="시즌 리포트 수" v={reports.toLocaleString()} s={`v2 승패 리포트 ${matchReports.toLocaleString()}`} />
            <Stat ic="🏆" k="우승률" v={`${nnum(agg.championRate)}%`} s="시즌 리포트 중 우승 비율" />
            <Stat ic="📈" k="평균 최종순위" v={`${nnum(agg.avgFinalRank)}위`} s="내 팀 정규 최종순위 평균" />
          </div>
          {rankDist.length > 0 && (
            <div className="oc-card">
              <div className="oc-cardhead"><h3>최종순위 분포</h3><CsvBtn onClick={() => downloadCsv('match-rankdist.csv', ['최종순위', '시즌 수'], rankDist.map((r) => [r.rank, r.n]))} /></div>
              {rankDist.map((r) => { const max = Math.max(1, ...rankDist.map((x) => x.n)); const pct = Math.round((r.n / max) * 100); return (
                <div className="oc-achrow" key={r.rank}>
                  <div style={{ flex: 1 }}><div className="t">{r.rank}위</div></div>
                  <div className="meta"><div className="oc-bar"><i style={{ width: `${pct}%` }} /></div></div>
                  <div className="pct">{r.n}<div className="cnt">시즌</div></div>
                </div>
              ); })}
            </div>
          )}
          {matchReports > 0 ? (
            <div className="oc-grid">
              <Stat ic="✅" k="정규시즌 승률" v={`${nnum(agg.winRate)}%`} s="합산 승/(승+패)" />
              <Stat ic="⚔" k="평균 승 / 패" v={`${nnum(agg.avgWins)} / ${nnum(agg.avgLosses)}`} s={`v2 리포트 ${matchReports.toLocaleString()}개`} />
              <Stat ic="🏐" k="평균 세트 (획득/실)" v={`${nnum(agg.avgSetsWon)} / ${nnum(agg.avgSetsLost)}`} s="정규시즌 세트 전적" />
            </div>
          ) : (
            <div className="oc-card"><div className="oc-mut" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              <span className="oc-tag2">payload v2</span> <b>상세 승/패·세트</b>는 <b>다음 빌드부터</b> 수집됩니다(앱 OTA + 테스터 시즌 종료 후 유입). 현재 리포트는 순위·우승만 담은 v1이라 승패 카드는 아직 비어 있습니다. 평균 경기시간(durationMs)은 track 이벤트가 필요해 EAS 계측 후.
            </div></div>
          )}
        </>
      )}
    </>
  );
}
// ⑧ 선수 탭 — §13.27 payload v2 로스터 구성(2026-07-31). v2 유입 전엔 안내. 개별 선수 이름·id 전송 0(집계 정수만).
function PlayersTab({ api }: { api: Api }) {
  const [d, setD] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let live = true; setLoading(true); api('/api/admin/telemetry').then((r) => { if (live) { setD(r.body.ok ? r.body : null); setLoading(false); } }); return () => { live = false; }; }, [api]);
  const agg = (d?.agg as Json) ?? {};
  const rosterReports = nnum(agg.rosterReports); // v2 로스터 보유 리포트 수(0이면 안내)
  if (loading) return <Loading />;
  if (!d) return <div className="oc-card"><div className="oc-empty">선수 데이터를 불러오지 못했습니다 (서버·권한 확인).</div></div>;
  return (
    <>
      <div className="oc-card">
        <div className="oc-mut" style={{ fontSize: 13, lineHeight: 1.6 }}>
          시즌 종료 시점 내 팀 로스터 구성 <span className="oc-tag2">자체-롤업(season_telemetry) v2 · 비식별</span> — 집계 정수만(선수 이름·id 전송 0). 결정론 격리(시드/리플레이 무관).
        </div>
      </div>
      {rosterReports > 0 ? (
        <div className="oc-grid">
          <Stat ic="📊" k="v2 리포트 수" v={rosterReports.toLocaleString()} s="로스터 구성 담은 리포트" />
          <Stat ic="👥" k="평균 로스터 인원" v={String(nnum(agg.avgRosterSize))} s="시즌종료 명단 크기" />
          <Stat ic="🎂" k="평균 나이" v={`${nnum(agg.avgRosterAge)}세`} s="로스터 평균 연령" />
          <Stat ic="⭐" k="평균 OVR" v={String(nnum(agg.avgRosterOvr))} s="로스터 평균 종합능력" />
          <Stat ic="🌍" k="평균 외국인 수" v={String(nnum(agg.avgForeignCount))} s="로스터 내 외국인 보유" />
          <Stat ic="👋" k="시즌당 은퇴 수" v={String(nnum(agg.avgRetirements))} s="내 팀 은퇴 선수" />
        </div>
      ) : (
        <div className="oc-card"><div className="oc-mut" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          <span className="oc-tag2">payload v2</span> 로스터 구성(평균 인원·나이·OVR·외국인·은퇴)은 <b>다음 빌드부터</b> 수집됩니다(앱 OTA + 테스터 시즌 종료 후 유입). 최다 영입 외국인·포지션 분포 등 세부는 track 이벤트가 필요해 EAS 계측 후.
        </div></div>
      )}
    </>
  );
}

// 내부(운영자·QA) 계정 제외 고지 — BACKEND §13.30 C. **"숨김"이 아니라 "제외 + 고지"**:
//   숫자가 조용히 달라지는 게 가장 위험하므로, 제외했다는 사실과 **제외가 닿지 않는 지표**를 항상 화면에 남긴다.
//   제외 0명이면 렌더하지 않는다(노이즈).
function InternalNotice({ stats }: { stats: Json | null }) {
  const info = (stats?.internal as Json) ?? {};
  const n = nnum(info.excluded);
  if (info.included) {
    return <div className="oc-mut" style={{ fontSize: 12, marginBottom: 12 }}>⚠ <b>내부 계정 포함</b> 모드 — 아래 수치에 운영자·QA 계정이 섞여 있습니다.</div>;
  }
  if (n <= 0) return null;
  return (
    <div className="oc-mut" style={{ fontSize: 12, marginBottom: 12 }}>
      내부 계정 <b>{n}명 제외</b>됨 (운영자·QA — 사용자 목록에서 지정).
      {' '}<span title="userId 없는 사전 롤업이거나 가명화돼 조인이 불가능해 제외가 적용되지 않는 지표입니다(§13.30 E).">
        단 <b>매출·행동 텔레메트리·업적·시계열(series)</b>에는 제외가 적용되지 않습니다.
      </span>
    </div>
  );
}

// ⑪ 메인 KPI 카드행 — 한 화면 즉시 파악. 가능분(서버/원장)=실값 · 미가용은 "—"+지표별 실블로커 배지.
//   MAU·WAU는 lastSeenAt 기반 실값(DAU와 동일 규약, 2026-07-31 하트비트 후). 리텐션/플레이=EAS 후, ARPU류=#43 결제 후.
function MainKpi({ kpi }: { kpi: Json }) {
  const real: { k: string; v: string; s?: string }[] = [
    { k: 'DAU (근사)', v: nnum(kpi.dauToday).toLocaleString(), s: 'lastSeenAt 기준' },
    { k: 'WAU', v: nnum(kpi.wau).toLocaleString(), s: '최근 7일' },
    { k: 'MAU', v: nnum(kpi.mau).toLocaleString(), s: '최근 30일' },
    { k: '총 가입', v: nnum(kpi.totalUsers).toLocaleString(), s: `신규 +${nnum(kpi.newToday)}` },
    { k: '결제 전환율', v: `${nnum(kpi.conversion)}%`, s: `결제자 ${nnum(kpi.payers)}명` },
    { k: '오늘 매출', v: `₩${nnum(kpi.revenueToday).toLocaleString()}`, s: '#43 연동 후 실값' },
  ];
  // 리텐션 D1/D7/D30 — 근사 실값(kpi.dN이 number면 실값, null이면 표본 부족). lastSeenAt 기반 근사(정밀 코호트는 EAS 후 ② 리텐션 탭).
  const ret: { k: string; v: unknown }[] = [
    { k: 'D1', v: kpi.d1 }, { k: 'D7', v: kpi.d7 }, { k: 'D30', v: kpi.d30 },
  ];
  // 미가용 KPI — 지표별 실제 블로커로 라벨(뭉뚱그린 "EAS 후" 금지).
  const ext: { k: string; blocker: string; hint: string }[] = [
    { k: '평균 플레이', blocker: 'EAS 계측 후', hint: '세션 길이·플레이 이벤트 필요(Firebase engagement)' },
    { k: 'ARPU', blocker: '#43 결제 후', hint: '결제 원장 필요 — 유료 결제(#43) 연동 후' },
    { k: 'ARPPU', blocker: '#43 결제 후', hint: '결제 원장 필요 — 유료 결제(#43) 연동 후' },
    { k: '월매출', blocker: '#43 결제 후', hint: '결제 원장 필요 — 유료 결제(#43) 연동 후' },
  ];
  return (
    <div className="oc-kpirow">
      {real.map((r) => <div className="oc-kpi" key={r.k}><div className="kk">{r.k}</div><div className="kv">{r.v}</div>{r.s ? <div className="ks">{r.s}</div> : null}</div>)}
      {ret.map((r) => typeof r.v === 'number'
        ? <div className="oc-kpi" key={r.k} title="가입 코호트 재접속 근사 — lastSeenAt이 (가입일+k일) 이후인 비율. 정밀 코호트 아님(EAS 후 ② 리텐션 탭)."><div className="kk">{r.k} <span style={{ fontSize: 9, color: 'var(--mut)' }}>근사</span></div><div className="kv">{r.v}%</div><div className="ks">근사 · lastSeenAt 기준</div></div>
        : <div className="oc-kpi ext" key={r.k} title="가입 후 k일+ 지난 유저가 아직 없어 표본 부족(집계 대상 0)."><span className="kbadge">표본 부족</span><div className="kk">{r.k}</div><div className="kv">—</div><div className="ks">가입 후 경과 유저 0</div></div>)}
      {ext.map((e) => <div className="oc-kpi ext" key={e.k} title={e.hint}><span className="kbadge">{e.blocker}</span><div className="kk">{e.k}</div><div className="kv">—</div><div className="ks">{e.blocker.includes('결제') ? '결제-연동' : '외부-sync'}</div></div>)}
    </div>
  );
}

// ⑩ 운영 알림 — 전일 대비 임계 초과(서버 stats.alerts 판정). 없으면 정상. Discord push는 Cron 배치(§13.25-E).
function Alerts({ alerts }: { alerts: Json[] }) {
  if (!alerts.length) return <div className="oc-alert-ok">✓ 이상 징후 없음 — 신규가입·서버오류 전일 대비 정상 범위</div>;
  return (
    <div className="oc-alerts">
      {alerts.map((a, i) => {
        const crit = a.severity === 'crit';
        return (
          <div className={`oc-alert ${crit ? 'crit' : 'warn'}`} key={i}>
            <span className="ai">{crit ? '🔴' : '🟠'}</span>
            <div><div className="al">{String(a.label)}</div><div className="ad">전일 <b>{String(a.cur)}</b> · 기준일 {String(a.prev)}</div></div>
            <span className="apct">{nnum(a.deltaPct) > 0 ? '+' : ''}{nnum(a.deltaPct)}%</span>
          </div>
        );
      })}
    </div>
  );
}

// 대시보드 = ⑪ 메인 KPI + ⑩ 운영 알림 + 핵심 그래프. 상세(①~⑨)는 좌측 메뉴로 분리("대시보드에 다 넣지 마라" §13.25-D).
function Overview({ stats, setting, openTickets }: { stats: Json | null; setting: Json | null; openTickets: number }) {
  const maint = !!setting?.maintenance;
  const minV = (setting?.minVersion as string) || '—';
  const latV = (setting?.latestVersion as string) || '—';
  const kpi = (stats?.kpi as Json) ?? {};
  const alerts = (stats?.alerts as Json[]) ?? [];
  const labels = (stats?.labels as string[]) ?? [];
  const series = (stats?.series as Json) ?? {};
  const dau = narr(series.dau), newUsers = narr(series.newUsers);
  return (
    <>
      <InternalNotice stats={stats} />
      <MainKpi kpi={kpi} />
      <Alerts alerts={alerts} />
      <div className="oc-grid">
        <Stat ic={maint ? '🔧' : '🟢'} k="서버 상태" v={maint ? '점검 중' : '정상'} s={maint ? '진입 차단' : '서비스 중'} />
        <Stat ic="🟢" k="실시간 접속" v={String(nnum(kpi.active30m))} s="최근 30분" />
        <Stat ic="✉" k="미처리 문의" v={String(openTickets)} s="답변 대기" />
        <Stat ic="⚠" k="오늘 결제오류" v={String(nnum(kpi.errToday))} s="머니패스 실패" />
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
  // 가입 시계열 일/주/월 토글(series metric=signups) — 부팅 시 stats의 14일 막대는 폴백.
  const [gran, setGran] = useState('day');
  const [su, setSu] = useState<Json | null>(null);
  useEffect(() => { let live = true; api(`/api/admin/series?metric=signups&granularity=${gran}`).then((r) => { if (live) setSu(r.body.ok ? r.body : null); }); return () => { live = false; }; }, [api, gran]);
  const suLabels = su ? ((su.labels as string[]) ?? []) : labels, suCount = su ? narr(su.count) : newUsers;
  useEffect(() => {
    let live = true; setLoading(true);
    api(`/api/admin/users?status=${status}&limit=${LIM}&offset=${offset}`).then((r) => { if (!live) return; setRows((r.body.users as Json[]) ?? []); setTotal(nnum(r.body.total)); setLoading(false); });
    return () => { live = false; };
  }, [api, status, offset]);
  const pick = (s: string) => { setStatus(s); setOffset(0); };
  // 내부(운영자·QA) 계정 표시 토글 — BACKEND §13.30. 켜면 이 계정이 관리자 통계에서 빠진다(재화·게임플레이엔 무영향).
  //   낙관적 반영 금지: 서버 응답을 받은 뒤에만 행을 갱신한다(집계 축이 화면과 어긋나면 판독을 그르친다).
  const [busyId, setBusyId] = useState<string | null>(null);
  const toggleInternal = async (id: string, next: boolean) => {
    setBusyId(id);
    const r = await api('/api/admin/users', { method: 'PATCH', body: JSON.stringify({ userId: id, internal: next }) });
    setBusyId(null);
    if (!r.body.ok) return;
    setRows((prev) => prev.map((u) => (u.id === id ? { ...u, internal: next } : u)));
  };
  const FILT = [{ v: 'all', l: '전체' }, { v: 'active', l: '활성' }, { v: 'inactive', l: '비활성' }, { v: 'withdrawn', l: '탈퇴' }];
  const GR = [{ v: 'day', l: '일별' }, { v: 'week', l: '주별' }, { v: 'month', l: '월별' }];
  const exportUsers = () => downloadCsv(`users-${status}.csv`, ['가입일', '최근접속', '상태', '로그인', '버전', '다이아'],
    rows.map((u) => [fmtD(u.createdAt), fmtDT(u.lastSeenAt), userStatus(u).label, String(u.provider ?? ''), String(u.appVersion ?? ''), nnum(u.balance)]));
  const exportSignups = () => downloadCsv(`signups-${gran}.csv`, ['구간', '가입 수'], suLabels.map((l, i) => [l, suCount[i] ?? 0]));
  return (
    <>
      <InternalNotice stats={stats} />
      <div className="oc-grid">
        <Stat ic="👥" k="총 가입자" v={nnum(kpi.totalUsers).toLocaleString()} s={`오늘 신규 +${nnum(kpi.newToday)}`} />
        <Stat ic="🔵" k="오늘 활성(DAU)" v={nnum(kpi.dauToday).toLocaleString()} s="오늘 접속 유저" />
        <Stat ic="🟢" k="실시간 접속" v={String(nnum(kpi.active30m))} s="최근 30분" />
        <Stat ic="💤" k="비활성" v={nnum(kpi.inactive).toLocaleString()} s="14일+ 미접속" />
        <Stat ic="🚪" k="탈퇴" v={nnum(kpi.withdrawn).toLocaleString()} s="계정 삭제" />
      </div>
      <div className="oc-cardhead" style={{ marginBottom: 14 }}>
        <div className="oc-mut" style={{ fontSize: 13 }}>가입 추이 <span className="oc-tag2">자체-롤업</span> · 설치/DAU·WAU·MAU는 EAS 계측 후(GA4)</div>
        <div className="oc-row" style={{ gap: 8 }}><GranTabs gran={gran} set={setGran} opts={GR} /><CsvBtn onClick={exportSignups} /></div>
      </div>
      <div className="oc-charts">
        <BarsCard title="신규 가입" value={`${suCount.reduce((a, b) => a + b, 0).toLocaleString()} 합`} labels={suLabels} data={suCount} color="#5b9bff" unit="명" />
        <BarsCard title="시간대별 접속" value="로그인 기준" labels={HOUR_LABELS} data={hourly} color="#9b7bff" unit="" />
      </div>
      <div className="oc-card">
        <div className="oc-cardhead"><h3>사용자 목록 <span className="oc-mut">({total.toLocaleString()})</span></h3><div className="oc-row" style={{ gap: 8 }}><GranTabs gran={status} set={pick} opts={FILT} /><CsvBtn onClick={exportUsers} /></div></div>
        {loading ? <LoadingRow /> : rows.length === 0 ? <div className="oc-empty">해당 조건의 사용자가 없습니다.</div> : (
          <table className="oc-table">
            <thead><tr><th>가입일</th><th>최근 접속</th><th>상태</th><th>로그인</th><th>버전</th><th style={{ textAlign: 'right' }}>다이아</th><th style={{ textAlign: 'center' }}>내부</th></tr></thead>
            <tbody>{rows.map((u) => { const st = userStatus(u); const isInt = !!u.internal; const id = u.id as string; return (
              <tr key={id}>
                <td>{fmtD(u.createdAt)}</td>
                <td>{fmtDT(u.lastSeenAt)} <span className="oc-mut" style={{ fontSize: 11 }}>· {ago(u.lastSeenAt)}</span></td>
                <td><span className={`oc-pill ${st.cls}`}>{st.label}</span></td>
                <td className="oc-mut">{(u.provider as string) || '—'}</td>
                <td className="oc-mut">{(u.appVersion as string) || '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{nnum(u.balance).toLocaleString()}</td>
                <td style={{ textAlign: 'center' }}>
                  <button
                    className={`oc-btn ${isInt ? '' : 'ghost'} sm toggle`}
                    disabled={busyId === id}
                    title={isInt ? '통계에서 제외 중 — 눌러서 실유저로 되돌립니다' : '운영자·QA 계정으로 표시해 통계에서 제외합니다'}
                    onClick={() => toggleInternal(id, !isInt)}
                  >{busyId === id ? '…' : isInt ? '내부' : '—'}</button>
                </td>
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
function Payments({ stats, api, flash }: { stats: Json | null; api: Api; flash: (m: string) => void }) {
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
  // ⑤ 상품별 다이아 지급(원장 파생 [자체-롤업]) — /api/admin/bm
  const [bm, setBm] = useState<Json | null>(null);
  useEffect(() => { let live = true; api(`/api/admin/bm?granularity=${gran}`).then((r) => { if (live) setBm(r.body.ok ? r.body : null); }); return () => { live = false; }; }, [api, gran]);
  const products = (bm?.products as Json[]) ?? [];
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
        <div className="oc-cardhead">
          <h3>상품별 다이아 지급 <span className="oc-tag2">자체-롤업(원장)</span></h3>
          <CsvBtn onClick={() => downloadCsv(`bm-products-${gran}.csv`, ['상품(productId)', '지급 건수', '다이아 합', '결제자'], products.map((p) => [String(p.productId), nnum(p.grants), nnum(p.diamonds), nnum(p.payers)]))} />
        </div>
        {products.length === 0 ? <div className="oc-empty">결제 원장(reason=purchase)이 없습니다. 결제(#43) 발생 시 상품별로 집계됩니다.</div> : (
          <table className="oc-table">
            <thead><tr><th>상품 (productId)</th><th style={{ textAlign: 'right' }}>지급 건수</th><th style={{ textAlign: 'right' }}>다이아 합</th><th style={{ textAlign: 'right' }}>결제자</th></tr></thead>
            <tbody>{products.map((p, i) => (
              <tr key={i}><td style={{ fontWeight: 700 }}>{String(p.productId)}</td><td style={{ textAlign: 'right' }}>{nnum(p.grants).toLocaleString()}</td><td style={{ textAlign: 'right', color: 'var(--ac)' }}>{nnum(p.diamonds).toLocaleString()}</td><td style={{ textAlign: 'right' }} className="oc-mut">{nnum(p.payers).toLocaleString()}</td></tr>
            ))}</tbody>
          </table>
        )}
        <div className="oc-mut" style={{ fontSize: 12.5, marginTop: 12, lineHeight: 1.6 }}>
          <span className="oc-tag2">외부-sync</span> ARPU · ARPPU · 상품별 <b>매출액(KRW)</b> · 상품별 구매율은 <b>RevenueCat 연동(#43) 후</b> 표시됩니다. 위 표는 원장 파생(다이아 지급 건수)만.
        </div>
      </div>
      <div className="oc-card">
        <div className="oc-cardhead"><h3>결제 · 환불 내역 <span className="oc-mut">({pTotal.toLocaleString()})</span></h3><div className="oc-row" style={{ gap: 8 }}><GranTabs gran={kind} set={pickKind} opts={KIND_F} /><CsvBtn onClick={() => downloadCsv(`payments-${kind}.csv`, ['시각', '유저', '종류', '상품', '다이아', '잔액'], pRows.map((p) => [fmtDT(p.createdAt), String(p.userId), p.reason === 'purchase' ? '구매' : '환불', String(p.ref ?? ''), nnum(p.delta), nnum(p.balanceAfter)]))} /></div></div>
        {pLoading ? <LoadingRow /> : pRows.length === 0 ? <div className="oc-empty">해당 내역이 없습니다. (결제 원장 이벤트 · #43 연동 후 KRW 금액 표시)</div> : (
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
      <UserLedger api={api} />
      <ManualAdjust api={api} flash={flash} />
      <PaymentEventsTable api={api} />
    </>
  );
}

// ── 유저 원장 조회 (P2-c §13.26) — userId·reason·기간 필터 + 합계. 백업 보상(camp 차감 합) 콘솔 완결 ──
const LEDGER_REASONS = [
  { v: 'all', l: '전체' }, { v: 'purchase', l: '구매' }, { v: 'refund', l: '환불' }, { v: 'camp', l: '전지훈련' },
  { v: 'adjust', l: '수동조정' }, { v: 'ad', l: '광고' }, { v: 'achievement', l: '업적' }, { v: 'coupon', l: '쿠폰' }, { v: 'welcome', l: '환영' },
];
const REASON_KO_LEDGER: Record<string, string> = { purchase: '구매', refund: '환불', camp: '전지훈련', adjust: '수동조정', ad: '광고', achievement: '업적', coupon: '쿠폰', welcome: '환영' };
function UserLedger({ api }: { api: Api }) {
  const [uid, setUid] = useState('');
  const [reason, setReason] = useState('all');
  const [since, setSince] = useState(''); // YYYY-MM-DD
  const [rows, setRows] = useState<Json[] | null>(null);
  const [sum, setSum] = useState(0);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const lookup = async () => {
    if (!uid.trim()) { setMsg('userId를 입력하세요'); return; }
    setBusy(true); setMsg('');
    const qs = new URLSearchParams({ reason, userId: uid.trim(), limit: '100' });
    if (since.trim()) qs.set('since', since.trim());
    const r = await api(`/api/admin/payments?${qs.toString()}`);
    setBusy(false);
    if (r.body.ok) { setRows((r.body.payments as Json[]) ?? []); setSum(nnum(r.body.sum)); setTotal(nnum(r.body.total)); }
    else { setRows(null); setMsg(`조회 실패 — ${errMsg(r)}`); }
  };
  return (
    <div className="oc-card">
      <div className="oc-cardhead"><h3>유저 원장 조회 <span className="oc-tag2">§13.26 백업 보상</span></h3></div>
      <div className="oc-mut" style={{ fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 }}>userId·사유·기간(이후)으로 원장을 조회하고 <b>합계</b>를 냅니다. 세이브 백업 복원 보상 = 백업 시점 <b>이후 전지훈련(camp) 차감 합</b>을 개인 쿠폰으로 동액 재지급(§13.14).</div>
      <div className="oc-row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="oc-fld" style={{ flex: 1, minWidth: 220 }}><label className="oc-label">userId</label><input className="oc-input" placeholder="uuid" value={uid} onChange={(e) => setUid(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} /></div>
        <div className="oc-fld" style={{ width: 130 }}><label className="oc-label">사유</label><select className="oc-input" value={reason} onChange={(e) => setReason(e.target.value)}>{LEDGER_REASONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></div>
        <div className="oc-fld" style={{ width: 150 }}><label className="oc-label">이후(since)</label><input className="oc-input" type="date" value={since} onChange={(e) => setSince(e.target.value)} /></div>
        {/* min-width: '조회'→'조회 중…' 로 바뀔 때 버튼이 커지며 옆 요소를 밀지 않게(가장 긴 라벨 기준 고정). */}
        <button className="oc-btn" style={{ minWidth: 96 }} onClick={lookup} disabled={busy}>{busy ? '조회 중…' : '조회'}</button>
      </div>
      {msg ? <div style={{ fontSize: 12.5, color: 'var(--dg)', fontWeight: 700, marginTop: 8 }}>{msg}</div> : null}
      {rows ? (
        <>
          <div className="oc-row" style={{ gap: 16, margin: '12px 0', flexWrap: 'wrap' }}>
            <span className="oc-mut">건수 <b style={{ color: 'var(--tx)' }}>{total.toLocaleString()}</b></span>
            <span className="oc-mut">합계 <b style={{ color: sum >= 0 ? 'var(--ac)' : '#ff8f8f' }}>{sum >= 0 ? '+' : ''}{sum.toLocaleString()} 💎</b></span>
            {reason === 'camp' ? <span className="oc-mut" style={{ fontSize: 12 }}>(camp 차감 합 = 보상 쿠폰 금액 = {Math.abs(sum).toLocaleString()}💎)</span> : null}
          </div>
          {rows.length === 0 ? <div className="oc-empty">해당 조건의 원장이 없습니다.</div> : (
            <table className="oc-table">
              <thead><tr><th>시각</th><th>사유</th><th>메모/상품</th><th style={{ textAlign: 'right' }}>다이아</th><th style={{ textAlign: 'right' }}>잔액</th></tr></thead>
              <tbody>{rows.map((p) => { const dv = nnum(p.delta); return (
                <tr key={p.id as string}>
                  <td>{fmtDT(p.createdAt)}</td>
                  <td>{REASON_KO_LEDGER[String(p.reason)] ?? String(p.reason)}</td>
                  <td className="oc-mut">{(p.ref as string) || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: dv >= 0 ? 'var(--ac)' : '#ff8f8f' }}>{dv >= 0 ? '+' : ''}{dv.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }} className="oc-mut">{nnum(p.balanceAfter).toLocaleString()}</td>
                </tr>); })}</tbody>
            </table>
          )}
        </>
      ) : null}
    </div>
  );
}

// ── 수동 지갑 조정 (P2-b §13.17) — 티켓 없는 회수/지급. 음수=회수(admin/refund)·양수=지급(admin/grant) ──
function ManualAdjust({ api, flash }: { api: Api; flash: (m: string) => void }) {
  const [uid, setUid] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [key, setKey] = useState(() => `manual:${(globalThis.crypto?.randomUUID?.() ?? String(Date.now()))}`); // 폼당 1회 생성(더블클릭 이중적용 차단)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const submit = async () => {
    const amt = Math.floor(Number(amount));
    if (!uid.trim()) { setMsg('userId를 입력하세요'); return; }
    if (!Number.isFinite(amt) || amt === 0) { setMsg('금액을 입력하세요 (음수=회수 / 양수=지급)'); return; }
    if (!note.trim()) { setMsg('사유 메모는 필수입니다(감사기록)'); return; }
    setBusy(true); setMsg('');
    // 부호 분기: 음수→회수(admin/refund, amount>0으로 절대값), 양수→지급(admin/grant).
    const path = amt < 0 ? '/api/admin/refund' : '/api/admin/grant';
    const body = JSON.stringify({ userId: uid.trim(), amount: Math.abs(amt), note: note.trim(), key });
    const r = await api(path, { method: 'POST', body });
    setBusy(false);
    if (r.body.ok && r.body.applied) {
      flash(`${amt < 0 ? '회수' : '지급'} 반영됨 · 잔액 ${nnum(r.body.balance).toLocaleString()}💎`);
      setKey(`manual:${(globalThis.crypto?.randomUUID?.() ?? String(Date.now()))}`); // 다음 조정용 새 키
      setAmount(''); setNote('');
    } else if (r.body.ok) {
      // applied:false = 같은 멱등키가 이미 처리됨(더블클릭). 초록으로 뭉개지 말고 경고.
      setMsg(`이미 처리된 조정입니다(같은 요청 재클릭). 현재 잔액 ${nnum(r.body.balance).toLocaleString()}💎`);
    } else setMsg(`실패 — ${errMsg(r)}`);
  };
  const amtNum = Math.floor(Number(amount));
  const dir = Number.isFinite(amtNum) && amtNum !== 0 ? (amtNum < 0 ? '회수(−)' : '지급(+)') : '';
  return (
    <div className="oc-card">
      <div className="oc-cardhead"><h3>수동 지갑 조정 <span className="oc-tag2">티켓 없는 회수/지급</span></h3></div>
      <div className="oc-mut" style={{ fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 }}>디스코드 <b>익명 환불 유실</b>(refund.anonymous.dropped §13.18 B1)처럼 티켓이 없는 케이스용. <b>음수=회수</b>(스토어 환불 확정분) · <b>양수=지급</b>(굿윌·보상). 사유는 원장 5년 보존.</div>
      <div className="oc-row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="oc-fld" style={{ flex: 1, minWidth: 200 }}><label className="oc-label">userId</label><input className="oc-input" placeholder="uuid" value={uid} onChange={(e) => setUid(e.target.value)} /></div>
        <div className="oc-fld" style={{ width: 130 }}><label className="oc-label">금액 {dir ? <span style={{ color: amtNum < 0 ? '#ff8f8f' : 'var(--ac)' }}>{dir}</span> : '(±)'}</label><input className="oc-input" type="number" placeholder="예: -700" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      </div>
      <div className="oc-fld" style={{ marginTop: 8 }}><label className="oc-label">사유 메모 (감사기록)</label><input className="oc-input" placeholder="예: 익명환불 dropped txn GPA.xxx 회수" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="oc-row" style={{ gap: 10, marginTop: 10, alignItems: 'center' }}>
        {/* min-width: '지급 실행'↔'회수 실행'↔'처리 중…' 3상태 폭이 달라 옆 메시지가 밀리던 것 고정. */}
        <button className={`oc-btn${amtNum < 0 ? ' red' : ''}`} style={{ minWidth: 116 }} onClick={submit} disabled={busy}>{busy ? '처리 중…' : amtNum < 0 ? '회수 실행' : '지급 실행'}</button>
        {msg ? <span style={{ fontSize: 12.5, color: 'var(--dg)', fontWeight: 700 }}>{msg}</span> : null}
      </div>
    </div>
  );
}

// ── 결제 이벤트 퍼널 표 (P2-d §13.22) — 최근 N건, source/fail 필터. 진단용 표 하나(과한 대시보드 금지) ──
const EV_SOURCES = [{ v: '', l: '전체' }, { v: 'webhook', l: '웹훅' }, { v: 'confirm', l: 'confirm' }, { v: 'client', l: '클라' }, { v: 'admin', l: '수동' }];
function PaymentEventsTable({ api }: { api: Api }) {
  const [source, setSource] = useState('');
  const [onlyFail, setOnlyFail] = useState(false);
  const [rows, setRows] = useState<Json[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true; setLoading(true);
    const qs = new URLSearchParams({ limit: '50' });
    if (source) qs.set('source', source);
    if (onlyFail) qs.set('fail', '1');
    api(`/api/admin/payment-events?${qs.toString()}`).then((r) => { if (!live) return; setRows((r.body.events as Json[]) ?? []); setTotal(nnum(r.body.total)); setLoading(false); });
    return () => { live = false; };
  }, [api, source, onlyFail]);
  return (
    <div className="oc-card">
      <div className="oc-cardhead">
        <h3>결제 이벤트 <span className="oc-mut">({total.toLocaleString()})</span></h3>
        <div className="oc-row" style={{ gap: 8 }}>
          <GranTabs gran={source} set={setSource} opts={EV_SOURCES} />
          <button className={`oc-btn ghost sm${onlyFail ? ' on' : ''}`} onClick={() => setOnlyFail((f) => !f)} style={onlyFail ? { borderColor: 'var(--dg)', color: 'var(--dg)' } : undefined}>실패만</button>
        </div>
      </div>
      <div className="oc-mut" style={{ fontSize: 12.5, marginBottom: 10 }}>결제 생애주기 진단(§13.22). "돈 내고 0개"·dropped·수동조정을 단계로 추적. 한 결제 상세는 API <code>?txn=&lt;storeTxnId&gt;</code>.</div>
      {loading ? <LoadingRow /> : rows.length === 0 ? <div className="oc-empty">해당 조건의 이벤트가 없습니다.</div> : (
        <div style={{ overflowX: 'auto' }}>
        <table className="oc-table" style={{ minWidth: 860 }}>
          <thead><tr><th>시각</th><th>소스</th><th>환경</th><th>타입</th><th>단계</th><th>결과</th><th>유저</th><th>상품 / 가격</th><th style={{ textAlign: 'right' }}>다이아</th></tr></thead>
          <tbody>{rows.map((e) => { const ok = e.ok !== false; const dv = e.diamondsDelta == null ? null : nnum(e.diamondsDelta);
            const env = e.environment ? String(e.environment).toUpperCase() : null; const sandbox = env === 'SANDBOX';
            const price = e.price == null ? null : nnum(e.price); const cur = e.currency ? String(e.currency) : '';
            return (
            <tr key={e.id as string}>
              <td>{fmtDT(e.createdAt)}</td>
              <td className="oc-mut">{String(e.source)}</td>
              <td>{env ? <span className="oc-badge" style={sandbox ? { background: 'rgba(242,169,59,0.16)', color: '#f2a93b' } : { background: 'rgba(25,194,174,0.14)', color: 'var(--ac)' }}>{sandbox ? 'SANDBOX' : env === 'PRODUCTION' ? 'PROD' : env}</span> : <span className="oc-mut">—</span>}</td>
              <td className="oc-mut" style={{ fontSize: 12 }} title={String(e.eventType ?? '')}>{e.eventType ? String(e.eventType) : '—'}</td>
              <td style={{ fontWeight: 600 }}>{String(e.stage)}</td>
              <td><span className={`oc-pill ${ok ? 'g' : 'r'}`}>{String(e.outcome ?? (ok ? 'ok' : 'fail'))}</span>{e.reasonCode ? <span className="oc-mut" style={{ fontSize: 11, marginLeft: 6 }}>{String(e.reasonCode)}</span> : null}</td>
              <td className="oc-mut" title={String(e.userId ?? '')}>{e.userId ? String(e.userId).slice(0, 8) + '…' : '—'}</td>
              <td className="oc-mut" style={{ fontSize: 12 }} title={String(e.productId ?? '')}>{e.productId ? <span>{String(e.productId)}</span> : <span className="oc-mut">—</span>}{price != null ? <span style={{ marginLeft: 6, color: 'var(--fg)' }}>{price.toLocaleString()}{cur ? ` ${cur}` : ''}</span> : null}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: dv == null ? 'var(--mut)' : dv >= 0 ? 'var(--ac)' : '#ff8f8f' }}>{dv == null ? '—' : (dv >= 0 ? '+' : '') + dv.toLocaleString()}</td>
            </tr>); })}</tbody>
        </table>
        </div>
      )}
    </div>
  );
}

// ── 광고: 일/주/월/연 시청 횟수·고유 시청자 ──
function Ads({ api }: { api: Api }) {
  const [gran, setGran] = useState('day');
  const [d, setD] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let live = true; setLoading(true); api(`/api/admin/series?metric=ad&granularity=${gran}`).then((r) => { if (live) { setD(r.body.ok ? r.body : null); setLoading(false); } }); return () => { live = false; }; }, [api, gran]);
  if (loading) return <Loading />;
  const labels = (d?.labels as string[]) ?? [], count = narr(d?.count), usersA = narr(d?.users);
  const cTotal = count.reduce((a, b) => a + b, 0), last = count[count.length - 1] ?? 0, lastU = usersA[usersA.length - 1] ?? 0;
  const GR = [{ v: 'day', l: '일별' }, { v: 'week', l: '주별' }, { v: 'month', l: '월별' }, { v: 'year', l: '연별' }];
  return (
    <>
      <div className="oc-cardhead" style={{ marginBottom: 18 }}><div className="oc-mut" style={{ fontSize: 13 }}>보상광고 시청 <span className="oc-tag2">자체-롤업(원장 reason=ad)</span> · 1회 = 다이아 +{AD_REWARD} (하루 {AD_DAILY_CAP}회 상한)</div><div className="oc-row" style={{ gap: 8 }}><GranTabs gran={gran} set={setGran} opts={GR} /><CsvBtn onClick={() => downloadCsv(`ads-${gran}.csv`, ['구간', '시청 횟수', '고유 시청자'], labels.map((l, i) => [l, count[i] ?? 0, usersA[i] ?? 0]))} /></div></div>
      <div className="oc-grid">
        <Stat ic="📺" k="총 시청 횟수" v={cTotal.toLocaleString()} s={`최근 ${labels.length}구간 합`} />
        <Stat ic="👁" k="최근 구간 시청" v={String(last)} s={`시청자 ${lastU}명`} />
        <Stat ic="💎" k="지급 다이아" v={(cTotal * AD_REWARD).toLocaleString()} s="시청 보상 합" />
      </div>
      <div className="oc-charts">
        <BarsCard title="광고 시청 횟수" value={`${cTotal.toLocaleString()} 회`} labels={labels} data={count} color="#f2a93b" unit="회" />
        <LineCard title="고유 시청자" value={`${lastU} 명`} labels={labels} data={usersA} color="#19c2ae" />
      </div>
      <div className="oc-card">
        <div className="oc-mut" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          <span className="oc-tag2">외부-sync</span> 노출 수 · 시청완료율 · <b>eCPM</b> · 광고 <b>수익</b>은 <b>AdMob API 연동 후</b> 표시됩니다(EAS). 위는 원장 파생(시청 횟수·보상 다이아)만.
        </div>
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
// ── 행동 텔레메트리(BACKEND_SYSTEM §13.27): 시즌 종료 구단주 운영 행동 — 전체 집계 + 사용자별 시즌 추이 ──
//   원천: season_telemetry(비식별 카운트 jsonb). track() SDK 없이 세이브 파생([자체-롤업]). 결정론 격리 유지.
type TeleSeason = { season: number; createdAt: string; payload: Record<string, unknown> };
type TeleUser = { userId: string; name: string | null; provider: string | null; seasons: TeleSeason[] };
function TelemetryPanel({ api }: { api: Api }) {
  const [d, setD] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null); // 선택 유저 id
  useEffect(() => { let live = true; setLoading(true); api('/api/admin/telemetry').then((r) => { if (live) { setD(r.body.ok ? r.body : null); setLoading(false); } }); return () => { live = false; }; }, [api]);
  const agg = (d?.agg as Json) ?? {};
  const users = useMemo(() => ((d?.users as TeleUser[]) ?? []), [d]);
  const distinct = nnum(d?.distinctUsers);
  const selUser = useMemo(() => users.find((u) => u.userId === sel) ?? null, [users, sel]);
  const topFocus = (agg.topFocus as { code: string; n: number }[]) ?? [];

  if (loading) return <Loading />;
  if (!d) return <div className="oc-card"><div className="oc-empty">텔레메트리 데이터를 불러오지 못했습니다 (서버·권한 확인).</div></div>;

  return (
    <>
      <div className="oc-card">
        <div className="oc-mut" style={{ fontSize: 13, lineHeight: 1.6 }}>
          시즌 종료 시 유저가 남긴 운영 행동 요약 <span className="oc-tag2">자체-롤업 · 비식별</span> — 개입·방출·전지훈련·지휘모드. 결정론 격리(시드/리플레이 무관).
        </div>
      </div>
      <div className="oc-grid">
        <Stat ic="📊" k="시즌 리포트 수" v={nnum(agg.reports).toLocaleString()} s={`고유 유저 ${distinct.toLocaleString()}명`} />
        <Stat ic="🏆" k="우승률" v={`${nnum(agg.championRate)}%`} s={`평균 순위 ${nnum(agg.avgFinalRank)}위`} />
        <Stat ic="🎮" k="지휘모드 사용률" v={`${nnum(agg.coachModeRate)}%`} s="경기 직접 지휘 on 비율" />
        <Stat ic="🔁" k="평균 개입 수" v={String(nnum(agg.avgInterventions))} s={`타임아웃 ${nnum(agg.avgTimeouts)} · 교체 수동 ${nnum(agg.avgSubsManual)}·핀치 ${nnum(agg.avgSubsPinch)}`} />
        <Stat ic="🚪" k="평균 방출 수" v={String(nnum(agg.avgReleases))} s={`선발/벤치 지시 ${nnum(agg.avgLineupChanges)} · 제명 ${nnum(agg.avgExpels)}`} />
        <Stat ic="💎" k="유저당 평균 전지훈련" v={nnum(agg.campLedgerUsers) > 0 ? (nnum(agg.campLedgerEvents) / nnum(agg.campLedgerUsers)).toFixed(1) : '0'} s={`전지훈련 유저 ${nnum(agg.campLedgerUsers)}명 기준(원장·즉시)`} />
      </div>
      {topFocus.length > 0 && (
        <div className="oc-card">
          <div className="oc-cardhead"><h3>훈련 방향 분포 (상위)</h3><CsvBtn onClick={() => downloadCsv('telemetry-focus.csv', ['훈련방향코드', '시즌 수'], topFocus.map((f) => [f.code, f.n]))} /></div>
          {topFocus.map((f) => { const max = Math.max(1, ...topFocus.map((x) => x.n)); const pct = Math.round((f.n / max) * 100); return (
            <div className="oc-achrow" key={f.code}>
              <div style={{ flex: 1 }}><div className="t">{f.code}</div><div className="d">primary|secondary 훈련id</div></div>
              <div className="meta"><div className="oc-bar"><i style={{ width: `${pct}%` }} /></div></div>
              <div className="pct">{f.n}<div className="cnt">시즌</div></div>
            </div>
          ); })}
        </div>
      )}

      <div className="oc-card">
        <div className="oc-cardhead">
          <h3>사용자별 (리포트 많은 순 · {users.length}명)</h3>
          <CsvBtn onClick={() => downloadCsv('telemetry-users.csv', ['userId', 'provider', '시즌 리포트 수', '최근 시즌'], users.map((u) => [u.userId, u.provider ?? '', u.seasons.length, u.seasons.length ? u.seasons[u.seasons.length - 1].season + 1 : 0]))} />
        </div>
        {users.length === 0 ? <div className="oc-empty">아직 수집된 텔레메트리가 없습니다 (시즌 종료 시 수집 · 서버 배포 후).</div> : (
          <table className="oc-table">
            <thead><tr><th>유저</th><th>provider</th><th>시즌 수</th><th>최근 시즌</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className="clk" onClick={() => setSel(u.userId)}>
                  <td>{u.name || <span className="oc-mut">{u.userId.slice(0, 8)}…</span>}</td>
                  <td><span className="oc-badge mut">{u.provider ?? '—'}</span></td>
                  <td>{u.seasons.length}</td>
                  <td>{u.seasons.length ? `${u.seasons[u.seasons.length - 1].season + 1}시즌` : '—'}</td>
                  <td style={{ textAlign: 'right' }}><span className="oc-mut" style={{ fontSize: 12 }}>추이 보기 ›</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selUser && (
        <Modal title={selUser.name || `${selUser.userId.slice(0, 8)}…`} sub={`시즌별 운영 행동 추이 · ${selUser.seasons.length}개 시즌 · ${selUser.provider ?? ''}`} wide onClose={() => setSel(null)}
          footer={<><CsvBtn onClick={() => downloadCsv(`telemetry-${selUser.userId.slice(0, 8)}.csv`, ['시즌', '순위', '우승', '개입', '타임아웃', '수동교체', '핀치교체', '선발벤치', '방출', '제명', '전지훈련', '지휘모드', '훈련방향'], selUser.seasons.map((s) => { const p = s.payload; const sub = (p.subs as Record<string, unknown>) ?? {}; return [s.season + 1, nnum(p.finalRank) || '', p.champion ? '우승' : '', nnum(p.interventions), nnum(p.timeouts), nnum(sub.manual), nnum(sub.pinch), nnum(p.lineupChanges), nnum(p.releases), nnum(p.expels), nnum(p.campCount), p.coachMode ? 'on' : 'off', String(p.trainingFocus ?? '')]; }))} /><Btn variant="ghost" onClick={() => setSel(null)}>닫기</Btn></>}>
          <div style={{ overflowX: 'auto' }}>
            <table className="oc-table" style={{ minWidth: 640 }}>
              <thead><tr><th>시즌</th><th>순위</th><th>개입</th><th>TO</th><th>교체(수동/핀치)</th><th>선발벤치</th><th>방출</th><th>제명</th><th>전훈</th><th>지휘</th></tr></thead>
              <tbody>
                {selUser.seasons.map((s) => { const p = s.payload; const sub = (p.subs as Record<string, unknown>) ?? {}; return (
                  <tr key={s.season}>
                    <td>{s.season + 1}시즌 {p.champion ? <span className="oc-badge gd">우승</span> : null}</td>
                    <td>{nnum(p.finalRank) ? `${nnum(p.finalRank)}위` : '—'}</td>
                    <td>{nnum(p.interventions)}</td>
                    <td>{nnum(p.timeouts)}</td>
                    <td>{nnum(sub.manual)} / {nnum(sub.pinch)}</td>
                    <td>{nnum(p.lineupChanges)}</td>
                    <td>{nnum(p.releases)}</td>
                    <td>{nnum(p.expels)}</td>
                    <td>{nnum(p.campCount)}</td>
                    <td>{p.coachMode ? <span className="oc-badge ac">직접</span> : <span className="oc-badge mut">자동</span>}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── 업적: 카탈로그 + **보상 수령율**(원장 ref 기반) ──
//   ⚠ 이건 "달성율"이 아니다. 분자는 `wallet_ledger reason='achievement'`(= 유저가 **보상 버튼을 눌러 받은** 것)이고,
//   달성 여부 자체는 로컬 세이브에만 있어 서버가 모른다. 즉 **달성했지만 미수령이면 0으로 잡힌다.**
//   실사례(2026-08-08): 경기 1회면 달성되는 통산 업적 6개가 며칠간 0%였다가, 유저가 수동으로 찾아 들어가
//   수령하자 그 순간 6건이 한꺼번에 집계됐다. 낮은 수치를 "아무도 못 깼다"로 읽으면 오진이다 —
//   **"보상 받는 길을 못 찾았다"** 일 수 있고, 실제로 마이페이지 탭 배지가 통산 업적을 못 잡는 버그가 있었다.
//   진짜 달성율을 보려면 세이브의 달성 상태를 텔레메트리에 실어야 한다(미구현 — 시즌 완주자만 잡히는 한계도 함께).
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
        <Stat ic="👥" k="집계 대상" v={total.toLocaleString()} s="현재 사용자(수령율 분모)" />
        <Stat ic="✅" k="1명+ 수령 업적" v={`${unlockedAny} / ${ACH_CAT.length}`} s="누구든 보상을 받은 업적" />
      </div>
      <div className="oc-mut" style={{ fontSize: 12.5, marginTop: 12, marginBottom: 4, lineHeight: 1.6 }}>
        <span className="oc-tag2">자체-롤업(원장)</span> 아래는 <b>보상 수령율</b>입니다 — <b>달성율이 아닙니다.</b>{' '}
        분자는 원장 적립(<code>reason=&apos;achievement&apos;</code>) = 유저가 <b>보상 버튼을 눌러 받은</b> 건수이고,
        달성 여부 자체는 로컬 세이브에만 있어 서버가 알 수 없습니다. <b>달성했지만 미수령이면 0%로 보입니다.</b>{' '}
        낮은 수치를 &quot;아무도 못 깼다&quot;로 읽지 마세요 — <b>보상 받는 길을 못 찾은 것</b>일 수 있습니다.
      </div>
      {loading ? <div className="oc-card"><LoadingRow /></div> : cats.map((cat) => (
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

// ── ⑨ 오류 모니터링: 서버 머니패스 오류(purchaseEvent ok=false) 실데이터 + Sentry/Crashlytics [외부-sync] 골격 ──
function Errors({ api }: { api: Api }) {
  const [d, setD] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let live = true; setLoading(true); api('/api/admin/errors?limit=50').then((r) => { if (live) { setD(r.body.ok ? r.body : null); setLoading(false); } }); return () => { live = false; }; }, [api]);
  const byReason = (d?.byReason as Json[]) ?? [];
  const recent = (d?.recent as Json[]) ?? [];
  const sentry = (d?.sentry as Json) ?? {};
  const sentryOn = !!sentry.configured;
  return (
    <>
      <div className="oc-grid">
        <Stat ic="⚠" k="결제 오류(누적)" v={nnum(d?.total).toLocaleString()} s="purchaseEvent 실패" />
        <Stat ic="🔴" k="오늘 오류" v={nnum(d?.today).toLocaleString()} s="머니패스 실패" />
        <Stat ic="🐞" k="Sentry(API·서버)" v={sentryOn ? '연결됨' : '미설정'} s={sentryOn ? 'pull 연동 후' : 'EAS/키 후'} />
        <Stat ic="📱" k="Crashlytics(앱)" v="—" s="EAS 후 [외부-sync]" />
      </div>
      <div className="oc-card">
        <div className="oc-cardhead"><h3>결제 오류 사유별 <span className="oc-tag2">자체-롤업(서버 로그)</span></h3>
          <CsvBtn onClick={() => downloadCsv('errors-byreason.csv', ['사유(reasonCode)', '건수'], byReason.map((b) => [String(b.reasonCode), nnum(b.n)]))} />
        </div>
        {loading ? <LoadingRow /> : byReason.length === 0 ? <div className="oc-empty">결제 오류가 없습니다. (결제 실패/거부/에러 시 여기 집계)</div> : (
          <table className="oc-table">
            <thead><tr><th>사유 (reasonCode)</th><th style={{ textAlign: 'right' }}>건수</th></tr></thead>
            <tbody>{byReason.map((b, i) => <tr key={i}><td>{String(b.reasonCode)}</td><td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--dg)' }}>{nnum(b.n).toLocaleString()}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      <div className="oc-card">
        <div className="oc-cardhead"><h3>최근 오류 로그 <span className="oc-mut">(최신 {recent.length})</span></h3></div>
        {loading ? <LoadingRow /> : recent.length === 0 ? <div className="oc-empty">최근 오류 로그가 없습니다.</div> : (
          <table className="oc-table">
            <thead><tr><th>시각</th><th>단계</th><th>사유</th><th>상품</th><th>유저</th></tr></thead>
            <tbody>{recent.map((r, i) => (
              <tr key={i}>
                <td className="oc-mut">{fmtDT(r.createdAt)}</td>
                <td className="oc-mut" title={`${String(r.source ?? '')} · ${String(r.outcome ?? '')}`}>{String(r.stage ?? '—')}</td>
                <td><span className="oc-badge dg">{String(r.reasonCode ?? r.outcome ?? '—')}</span>{r.errorMessage ? <span className="oc-mut" style={{ fontSize: 11, marginLeft: 6 }} title={String(r.errorMessage)}>{String(r.errorMessage).slice(0, 40)}</span> : null}</td>
                <td className="oc-mut">{String(r.productId ?? '—')}</td>
                <td className="oc-mut">{String(r.userId ?? '—')}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="oc-card">
        <div className="oc-mut" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          <span className="oc-tag2">외부-sync</span> <b>Sentry</b>(API 실패·서버 오류 상세·최근 이슈)는 {sentryOn ? <>연결됨 — {String(sentry.note ?? '')}</> : <>SENTRY_API_TOKEN 미설정 시 스킵(화면 안 막음). EAS/키 연동 후 pull</>}. <b>Crashlytics</b>(앱 크래시)·로딩/네트워크/로그인 실패는 <b>EAS 계측 후</b> track() 수신으로 집계.
        </div>
      </div>
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
  const [err, setErr] = useState(''); // 실패 사유 인라인 노출(모달 유지). 성공은 상단 토스트.
  const [code, setCode] = useState(coupon ? String(coupon.code) : '');
  const [reward, setReward] = useState(coupon ? String(coupon.rewardDiamonds) : '100');
  const [mode, setMode] = useState<'all' | 'user'>(coupon?.targetUserId ? 'user' : 'all');
  const [target, setTarget] = useState(coupon?.targetUserId ? String(coupon.targetUserId) : '');
  const [ends, setEnds] = useState(coupon?.endsAt ? String(coupon.endsAt).slice(0, 10) : '');
  const [disabled, setDisabled] = useState(!!coupon?.disabled);
  // 사용 내역(누가·언제 썼나) — 기존 쿠폰 상세 열 때 로드
  const [redemptions, setRedemptions] = useState<Json[] | null>(null);
  useEffect(() => {
    if (!coupon) return;
    let live = true;
    api(`/api/admin/coupon/redemptions?couponId=${encodeURIComponent(String(coupon.id))}`).then((r) => { if (live) setRedemptions((r.body.redemptions as Json[]) ?? []); });
    return () => { live = false; };
  }, [api, coupon]);
  const save = async () => {
    setBusy(true); setErr('');
    const target2 = mode === 'user' ? (target.trim() || null) : null;
    const r = isNew
      ? await api('/api/admin/coupon', { method: 'POST', body: JSON.stringify({ code, rewardDiamonds: Number(reward), targetUserId: target2, endsAt: ends || null }) })
      : await api('/api/admin/coupon', { method: 'PATCH', body: JSON.stringify({ id: coupon!.id, rewardDiamonds: Number(reward), endsAt: ends || null, disabled, targetUserId: target2 }) });
    setBusy(false);
    if (r.body.ok) { flash(isNew ? `쿠폰이 발급되었습니다: ${r.body.code}` : '쿠폰이 수정되었습니다'); reload(); onClose(); }
    else setErr(`${isNew ? '발급' : '수정'} 실패 — ${errMsg(r)}`);
  };
  const del = async () => {
    if (!window.confirm(`쿠폰 "${String(coupon!.code)}"을(를) 삭제할까요?`)) return;
    setBusy(true); setErr('');
    const r = await api(`/api/admin/coupon?id=${encodeURIComponent(String(coupon!.id))}`, { method: 'DELETE' });
    setBusy(false);
    if (r.body.ok) { flash('쿠폰이 삭제되었습니다'); reload(); onClose(); }
    else setErr(`삭제 실패 — ${errMsg(r)}`);
  };
  const invalid = isNew ? (!code.trim() || (mode === 'user' && !target.trim())) : false;

  if (!editMode && coupon) return (
    <Modal title={String(coupon.code)} sub="쿠폰 상세" onClose={onClose}
      footer={<><FooterMsg msg={err} /><Btn onClick={() => { setErr(''); setEditMode(true); }} disabled={busy}>수정</Btn><Btn variant="danger" onClick={del} disabled={busy}>삭제</Btn><Btn variant="ghost" onClick={onClose} disabled={busy}>닫기</Btn></>}>
      <div className="oc-dl">
        <div className="oc-dl-row"><span className="oc-dl-k">코드</span><span className="oc-dl-v mono">{String(coupon.code)}</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">보상</span><span className="oc-dl-v">{String(coupon.rewardDiamonds)} 💎</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">대상</span><span className="oc-dl-v">{coupon.targetUserId ? <>{'개인 '}<span className="mono" style={{ fontSize: 12.5 }}>{String(coupon.targetUserId)}</span></> : <span className="oc-badge mut">전체</span>}</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">상태</span><span className="oc-dl-v">{coupon.disabled ? <span className="oc-badge dg">비활성</span> : <span className="oc-badge gd">활성</span>}</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">종료일</span><span className="oc-dl-v">{coupon.endsAt ? String(coupon.endsAt).slice(0, 10) : '무기한'}</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">생성일</span><span className="oc-dl-v">{coupon.createdAt ? String(coupon.createdAt).slice(0, 19).replace('T', ' ') : '—'}</span></div>
        <div className="oc-dl-row"><span className="oc-dl-k">사용 횟수</span><span className="oc-dl-v">{redemptions == null ? '불러오는 중…' : `${redemptions.length}회`}</span></div>
      </div>
      {redemptions && redemptions.length > 0 ? (
        <div className="oc-dl-block">
          <div className="oc-dl-k" style={{ marginBottom: 8 }}>사용자 내역 (누가·언제)</div>
          <table className="oc-table">
            <thead><tr><th>사용자</th><th>로그인</th><th style={{ textAlign: 'right' }}>사용 시각</th></tr></thead>
            <tbody>{redemptions.map((r, i) => (
              <tr key={i}>
                <td className="oc-mut" title={String(r.userId)}>{r.name ? String(r.name) : String(r.userId).slice(0, 8) + '…'}</td>
                <td className="oc-mut">{String(r.provider ?? '—')}</td>
                <td className="oc-mut" style={{ textAlign: 'right' }}>{String(r.redeemedAt).slice(0, 19).replace('T', ' ')}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : redemptions && redemptions.length === 0 ? (
        <div className="oc-mut" style={{ fontSize: 13, marginTop: 2 }}>아직 아무도 사용하지 않았습니다.</div>
      ) : null}
    </Modal>
  );

  return (
    <Modal title={isNew ? '쿠폰 발급' : '쿠폰 수정'} sub={isNew ? '새 쿠폰을 만듭니다' : String(coupon!.code)} onClose={onClose}
      footer={<><FooterMsg msg={err} /><Btn variant="ghost" onClick={isNew ? onClose : () => { setErr(''); setEditMode(false); }} disabled={busy}>취소</Btn><Btn onClick={save} disabled={invalid || busy}>{busy ? '처리 중…' : isNew ? '발급' : '저장'}</Btn></>}>
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
  const [err, setErr] = useState(''); // 실패 사유 인라인 노출(모달 유지)
  const [title, setTitle] = useState(ann ? String(ann.title ?? '') : '');
  const [body, setBody] = useState(ann ? String(ann.body ?? '') : '');
  const [ends, setEnds] = useState(ann?.endsAt ? String(ann.endsAt).slice(0, 10) : '');
  const [pinned, setPinned] = useState(!!ann?.pinned);
  const save = async () => {
    setBusy(true); setErr('');
    const r = isNew
      ? await api('/api/admin/announcement', { method: 'POST', body: JSON.stringify({ title, body, endsAt: ends || null, pinned }) })
      : await api('/api/admin/announcement', { method: 'PATCH', body: JSON.stringify({ id: ann!.id, title, body, endsAt: ends || null, pinned }) });
    setBusy(false);
    if (r.body.ok) { flash(isNew ? '공지가 발행되었습니다' : '공지가 수정되었습니다'); reload(); onClose(); }
    else setErr(`${isNew ? '발행' : '수정'} 실패 — ${errMsg(r)}`);
  };
  const del = async () => {
    if (!window.confirm(`공지 "${String(ann!.title)}"을(를) 삭제할까요?`)) return;
    setBusy(true); setErr('');
    const r = await api(`/api/admin/announcement?id=${encodeURIComponent(String(ann!.id))}`, { method: 'DELETE' });
    setBusy(false);
    if (r.body.ok) { flash('공지가 삭제되었습니다'); reload(); onClose(); } else setErr(`삭제 실패 — ${errMsg(r)}`);
  };

  if (!editMode && ann) return (
    <Modal title={String(ann.title)} sub="공지 상세" onClose={onClose}
      footer={<><FooterMsg msg={err} /><Btn onClick={() => { setErr(''); setEditMode(true); }} disabled={busy}>수정</Btn><Btn variant="danger" onClick={del} disabled={busy}>삭제</Btn><Btn variant="ghost" onClick={onClose} disabled={busy}>닫기</Btn></>}>
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
      footer={<><FooterMsg msg={err} /><Btn variant="ghost" onClick={isNew ? onClose : () => { setErr(''); setEditMode(false); }} disabled={busy}>취소</Btn><Btn onClick={save} disabled={!title.trim() || !body.trim() || busy}>{busy ? '처리 중…' : isNew ? '발행' : '저장'}</Btn></>}>
      <div className="oc-fld"><label className="oc-label">제목</label><input className="oc-input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="oc-fld"><label className="oc-label">내용</label><textarea className="oc-input" value={body} onChange={(e) => setBody(e.target.value)} style={{ height: 100 }} /></div>
      <div className="oc-frow">
        <div className="oc-fld"><label className="oc-label">종료일 (빈칸=무기한)</label><input className="oc-input" placeholder="YYYY-MM-DD" value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
        <div className="oc-fld"><label className="oc-label">상단 고정</label><label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44, fontSize: 14 }}><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> 고정</label></div>
      </div>
    </Modal>
  );
}

// ── 개발자 노트/패치노트(DEVNOTES_SYSTEM §4.3) ── 운영 그룹 "노트" 탭. 목록(초안 포함) → 행 클릭 마크다운 에디터 모달.
// 경량 마크다운 렌더러 — 앱과 같은 단순 규칙: 제목(#/##)·리스트(-)·**굵게**·`코드`·[링크](url). dangerouslySetInnerHTML 미사용(XSS 안전).
function mdInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(`[^`]+`)/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('[')) { const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!; nodes.push(<a key={`${keyBase}-${i}`} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>); }
    else if (tok.startsWith('**')) nodes.push(<strong key={`${keyBase}-${i}`}>{tok.slice(2, -2)}</strong>);
    else nodes.push(<code key={`${keyBase}-${i}`}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length; i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
function Markdown({ src }: { src: string }) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let list: string[] | null = null; let bk = 0;
  const flushList = () => { if (list) { const items = list; const key = bk++; blocks.push(<ul key={`ul-${key}`}>{items.map((it, i) => <li key={i}>{mdInline(it, `li-${key}-${i}`)}</li>)}</ul>); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^##\s+/.test(line)) { flushList(); const k = bk++; blocks.push(<h4 key={`h-${k}`}>{mdInline(line.replace(/^##\s+/, ''), `h4-${k}`)}</h4>); }
    else if (/^#\s+/.test(line)) { flushList(); const k = bk++; blocks.push(<h3 key={`h-${k}`}>{mdInline(line.replace(/^#\s+/, ''), `h3-${k}`)}</h3>); }
    else if (/^-\s+/.test(line)) { (list ??= []).push(line.replace(/^-\s+/, '')); }
    else if (line.trim() === '') { flushList(); }
    else { flushList(); const k = bk++; blocks.push(<p key={`p-${k}`}>{mdInline(line, `p-${k}`)}</p>); }
  }
  flushList();
  return <div className="oc-mdprev">{blocks.length ? blocks : <span className="oc-mut">미리보기가 여기 표시됩니다.</span>}</div>;
}

// kind별 별도 탭(정정 2026-08-01) — 패치노트 탭(kind='patch')·개발자노트 탭(kind='note')이 각각 자기 kind만
// 목록·에디터. "＋ 새 글"은 그 kind로 고정 생성(종류 드롭다운 제거). devnotes prop은 전체를 받아 여기서 필터.
function Devnotes({ kind, devnotes, api, reload, flash }: { kind: 'patch' | 'note'; devnotes: Json[]; api: Api; reload: () => void; flash: (m: string) => void }) {
  const [modal, setModal] = useState<null | 'new' | Json>(null);
  const scoped = devnotes.filter((d) => (d.kind === 'patch' ? 'patch' : 'note') === kind);
  const label = kind === 'patch' ? '패치노트' : '개발자 노트';
  return (
    <div className="oc-card">
      <div className="oc-cardhead"><h3>{label} <span className="oc-mut">({scoped.length})</span></h3><button className="oc-btn sm" onClick={() => setModal('new')}>＋ 새 {label}</button></div>
      {scoped.length === 0 ? <div className="oc-empty">작성된 {label}가 없습니다. 우측 상단 “＋ 새 {label}”로 만드세요.</div> : (
        <table className="oc-table">
          <thead><tr><th>제목</th>{kind === 'patch' ? <th>버전</th> : null}<th>상태</th><th>게시일</th></tr></thead>
          <tbody>
            {scoped.map((d) => (
              <tr key={String(d.id)} className="clk" onClick={() => setModal(d)}>
                <td style={{ fontWeight: 700 }}>{String(d.title)}</td>
                {kind === 'patch' ? <td className="oc-mut">{d.appVersion ? `v${String(d.appVersion)}` : '—'}</td> : null}
                <td>{d.status === 'published' ? <span className="oc-badge gd">게시</span> : <span className="oc-badge wn">초안</span>}</td>
                <td className="oc-mut">{d.publishedAt ? String(d.publishedAt).slice(0, 10) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modal ? <DevnoteModal kind={kind} note={modal === 'new' ? null : modal} api={api} reload={reload} flash={flash} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function DevnoteModal({ kind, note, api, reload, flash, onClose }: { kind: 'patch' | 'note'; note: Json | null; api: Api; reload: () => void; flash: (m: string) => void; onClose: () => void }) {
  const isNew = !note;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // kind는 탭에서 고정(드롭다운 제거) — 새 글은 prop, 기존 글은 이미 그 kind로 필터된 행이라 prop과 일치.
  const [title, setTitle] = useState(note ? String(note.title ?? '') : '');
  const [body, setBody] = useState(note ? String(note.body ?? '') : '');
  const [appVersion, setAppVersion] = useState(note?.appVersion ? String(note.appVersion) : '');
  const [status, setStatus] = useState<'draft' | 'published'>(note?.status === 'published' ? 'published' : 'draft');
  // patch면 appVersion 필수(서버 검증과 동일 — 저장 전 클라 게이트로 UX 개선). note면 appVersion 무시.
  const valid = !!title.trim() && !!body.trim() && (kind !== 'patch' || !!appVersion.trim());
  const save = async () => {
    setBusy(true); setErr('');
    const payload = { kind, title, body, appVersion: kind === 'patch' ? appVersion : null, status };
    // 낙관적 반영 금지 — 서버 응답 후 reload(공지·쿠폰 관례).
    const r = isNew
      ? await api('/api/admin/devnote', { method: 'POST', body: JSON.stringify(payload) })
      : await api('/api/admin/devnote', { method: 'PATCH', body: JSON.stringify({ id: note!.id, ...payload }) });
    setBusy(false);
    if (r.body.ok) { flash(isNew ? '저장되었습니다' : '수정되었습니다'); reload(); onClose(); }
    else setErr(`${isNew ? '저장' : '수정'} 실패 — ${errMsg(r)}`);
  };
  const del = async () => {
    if (!window.confirm(`"${String(note!.title)}"을(를) 삭제할까요?`)) return;
    setBusy(true); setErr('');
    const r = await api(`/api/admin/devnote?id=${encodeURIComponent(String(note!.id))}`, { method: 'DELETE' });
    setBusy(false);
    if (r.body.ok) { flash('삭제되었습니다'); reload(); onClose(); } else setErr(`삭제 실패 — ${errMsg(r)}`);
  };
  return (
    <Modal wide title={isNew ? `새 ${kind === 'patch' ? '패치노트' : '개발자 노트'}` : String(note!.title)} sub={isNew ? `${kind === 'patch' ? '패치노트' : '개발자 노트'} 작성` : status === 'published' ? '게시됨(공개)' : '초안(비공개)'} onClose={onClose}
      footer={<><FooterMsg msg={err} />{!isNew ? <Btn variant="danger" onClick={del} disabled={busy}>삭제</Btn> : null}<Btn variant="ghost" onClick={onClose} disabled={busy}>취소</Btn><Btn onClick={save} disabled={!valid || busy}>{busy ? '처리 중…' : status === 'published' ? '저장 + 게시' : '초안 저장'}</Btn></>}>
      <div className="oc-frow">
        {kind === 'patch' ? <div className="oc-fld"><label className="oc-label">앱 버전 (필수)</label><input className="oc-input" placeholder="0.4.0" value={appVersion} onChange={(e) => setAppVersion(e.target.value)} /></div> : null}
        <div className="oc-fld"><label className="oc-label">상태</label><select className="oc-input" value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}><option value="draft">초안 (비공개)</option><option value="published">게시 (공개)</option></select></div>
      </div>
      <div className="oc-fld"><label className="oc-label">제목</label><input className="oc-input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="oc-fld"><label className="oc-label">본문 (마크다운) — 좌: 작성 · 우: 미리보기</label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
          <textarea className="oc-input" value={body} onChange={(e) => setBody(e.target.value)} placeholder={'# 제목\n- 항목\n**굵게** · `코드` · [링크](https://…)'} style={{ height: 320, flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.55, resize: 'vertical' }} />
          <div style={{ flex: 1, overflowY: 'auto', height: 320, border: '1px solid var(--bd)', borderRadius: 10, padding: '11px 15px', background: 'var(--card2)' }}><Markdown src={body} /></div>
        </div>
      </div>
    </Modal>
  );
}

// ── 우편(MAILBOX_SYSTEM §7 · DIAMOND_PASS §2.4 admin) — 개별/브로드캐스트 발송·이력·회수. admin/mail API 배선.
//   일일 패스 우편(sender system:pass)은 스케줄러 전용이라 이 폼·이력에 없음(listAdminMail이 제외).
function mailStatusBadge(m: Json) {
  if (m.recalledAt) return <span className="oc-badge dg">회수됨</span>;
  if (m.claimedAt) return <span className="oc-badge gd">수령됨</span>;
  if (m.expiresAt && new Date(m.expiresAt as string).getTime() < Date.now()) return <span className="oc-badge mut">만료</span>;
  if (m.readAt) return <span className="oc-badge ac">읽음</span>;
  return <span className="oc-badge wn">미수령</span>;
}

function MailPanel({ api, flash }: { api: Api; flash: (m: string) => void }) {
  const [rows, setRows] = useState<Json[] | null>(null);
  const [userFilter, setUserFilter] = useState('');
  const [modal, setModal] = useState(false);
  const [busyId, setBusyId] = useState('');
  const load = useCallback(async (uid?: string) => {
    setRows(null);
    const q = uid && uid.trim() ? `?userId=${encodeURIComponent(uid.trim())}` : '';
    const r = await api(`/api/admin/mail${q}`);
    setRows((r.body.mails as Json[]) ?? []);
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const recall = async (m: Json) => {
    if (!window.confirm(`우편 "${String(m.title)}"을(를) 회수할까요? (수령 전 우편만 회수됩니다)`)) return;
    setBusyId(String(m.id));
    const r = await api(`/api/admin/mail?id=${encodeURIComponent(String(m.id))}`, { method: 'DELETE' });
    setBusyId('');
    if (r.body.ok) { flash('우편을 회수했습니다'); load(userFilter); }
    else flash(`회수 실패 — ${errMsg(r)}`);
  };

  return (
    <div className="oc-card">
      <div className="oc-cardhead"><h3>우편 발송 이력 <span className="oc-mut">({rows?.length ?? 0})</span></h3>
        <button className="oc-btn sm" onClick={() => setModal(true)}>＋ 우편 발송</button>
      </div>
      <div className="oc-row" style={{ marginBottom: 14 }}>
        <input className="oc-input" style={{ maxWidth: 340 }} placeholder="user id로 필터 (빈칸=전체 발송분)" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(userFilter); }} />
        <button className="oc-btn ghost sm" onClick={() => load(userFilter)}>조회</button>
        {userFilter ? <button className="oc-btn ghost sm" onClick={() => { setUserFilter(''); load(); }}>초기화</button> : null}
      </div>
      {rows == null ? <LoadingRow /> : rows.length === 0 ? <div className="oc-empty">발송한 우편이 없습니다. 우측 상단 “＋ 우편 발송”으로 보내세요. (다이아 패스 일일 우편은 스케줄러 전용이라 여기 없음)</div> : (
        <table className="oc-table">
          <thead><tr><th>시각</th><th>대상</th><th>제목</th><th>첨부</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {rows.map((m) => {
              const canRecall = !m.claimedAt && !m.recalledAt;
              return (
                <tr key={String(m.id)}>
                  <td className="oc-mut">{fmtDT(m.createdAt)}</td>
                  <td className="oc-mut" title={String(m.userId)}>{String(m.userId).slice(0, 8)}…</td>
                  <td style={{ fontWeight: 700 }}>{String(m.title)}</td>
                  <td>{m.attachType === 'pass' ? <span className="oc-badge ac">🎫 패스</span> : <span className="oc-badge gd">💎 {String(m.attachAmount ?? 0)}</span>}</td>
                  <td>{mailStatusBadge(m)}</td>
                  <td style={{ textAlign: 'right' }}>{canRecall ? <button className="oc-btn ghost sm toggle" style={{ borderColor: 'var(--dg)', color: 'var(--dg)' }} disabled={busyId === String(m.id)} onClick={() => recall(m)}>{busyId === String(m.id) ? '…' : '회수'}</button> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {modal ? <MailModal api={api} flash={flash} onClose={() => setModal(false)} onSent={() => { setModal(false); load(userFilter); }} /> : null}
    </div>
  );
}

function MailModal({ api, flash, onClose, onSent }: { api: Api; flash: (m: string) => void; onClose: () => void; onSent: () => void }) {
  const [target, setTarget] = useState<'user' | 'broadcast'>('user');
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attachType, setAttachType] = useState<'diamonds' | 'pass'>('diamonds');
  const [amount, setAmount] = useState('500');
  const [expires, setExpires] = useState(''); // 빈칸=기본(다이아 30 / 패스 60)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 발송 멱등키 — 폼-오픈 시 1회 생성(더블클릭 이중발송 봉인, MAILBOX R1). 서버가 아니라 클라가 생성해야 재시도 dedup.
  const [idemKey] = useState(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `ops-${Date.now()}-${Math.random().toString(36).slice(2)}`));

  const isBroadcast = target === 'broadcast';
  const attachPass = !isBroadcast && attachType === 'pass'; // 브로드캐스트는 다이아만(Q4)
  const invalid = !title.trim() || !body.trim() || (target === 'user' && !userId.trim()) || (!attachPass && (!(Number(amount) > 0)));

  const submit = async () => {
    setBusy(true); setErr('');
    const payload: Record<string, unknown> = {
      title: title.trim(), body: body.trim(), idemKey,
      attachType: isBroadcast ? 'diamonds' : attachType,
      expiresInDays: expires.trim() ? Number(expires) : null,
    };
    if (isBroadcast) { payload.target = 'broadcast'; payload.attachAmount = Number(amount); }
    else { payload.userId = userId.trim(); payload.attachAmount = attachType === 'pass' ? null : Number(amount); }
    const r = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify(payload) });
    setBusy(false);
    if (r.body.ok) {
      flash(r.body.deduped ? '이미 보낸 우편입니다(중복 방지)' : isBroadcast ? '전체 우편을 발송했습니다' : '우편을 발송했습니다');
      onSent();
    } else setErr(`발송 실패 — ${errMsg(r)}`);
  };

  return (
    <Modal title="우편 발송" sub="개별 유저 또는 전체(브로드캐스트)" onClose={onClose}
      footer={<><FooterMsg msg={err} /><Btn variant="ghost" onClick={onClose} disabled={busy}>취소</Btn><Btn onClick={submit} disabled={invalid || busy}>{busy ? '발송 중…' : '발송'}</Btn></>}>
      <div className="oc-frow">
        <div className="oc-fld"><label className="oc-label">대상</label>
          <select className="oc-input" value={target} onChange={(e) => setTarget(e.target.value as 'user' | 'broadcast')}>
            <option value="user">개별 유저</option>
            <option value="broadcast">전체(브로드캐스트)</option>
          </select>
        </div>
        {!isBroadcast ? (
          <div className="oc-fld"><label className="oc-label">첨부 종류</label>
            <select className="oc-input" value={attachType} onChange={(e) => setAttachType(e.target.value as 'diamonds' | 'pass')}>
              <option value="diamonds">다이아</option>
              <option value="pass">다이아 패스(28일 1개)</option>
            </select>
          </div>
        ) : null}
      </div>
      {!isBroadcast ? <div className="oc-fld"><label className="oc-label">대상 user id</label><input className="oc-input" placeholder="userId" value={userId} onChange={(e) => setUserId(e.target.value)} /></div> : null}
      {isBroadcast ? <div className="oc-mut" style={{ fontSize: 12, marginTop: -2 }}>전체 발송은 다이아만 가능합니다(Q4). 대상 = 발송 시점 이전 가입자(cutoff).</div> : null}
      {!attachPass ? (
        <div className="oc-frow">
          <div className="oc-fld"><label className="oc-label">다이아 수량</label><input className="oc-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="oc-fld"><label className="oc-label">보관일 (빈칸=기본 30일)</label><input className="oc-input" type="number" placeholder="30" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
        </div>
      ) : (
        <div className="oc-fld"><label className="oc-label">보관일 (빈칸=패스 기본 60일)</label><input className="oc-input" type="number" placeholder="60" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
      )}
      <div className="oc-fld"><label className="oc-label">제목</label><input className="oc-input" placeholder="운영 보상 안내" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="oc-fld"><label className="oc-label">본문</label><textarea className="oc-input" rows={4} placeholder="내용을 입력하세요" value={body} onChange={(e) => setBody(e.target.value)} /></div>
      {attachPass ? <div className="oc-mut" style={{ fontSize: 12 }}>다이아 패스 첨부: 수령 시 28일 패스 1개가 지급되고 1일차 우편이 즉시 도착합니다.</div> : null}
    </Modal>
  );
}

function Settings({ setting, api, reload, flash }: { setting: Json | null; api: (p: string, i?: RequestInit) => Promise<{ status: number; body: Json }>; reload: () => void; flash: (m: string) => void }) {
  const [minV, setMinV] = useState(''); const [latV, setLatV] = useState('');
  const [androidUrl, setAndroidUrl] = useState(''); const [iosUrl, setIosUrl] = useState('');
  const [maint, setMaint] = useState(false); const [maintT, setMaintT] = useState(''); const [maintB, setMaintB] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    if (!setting) return;
    setMinV((setting.minVersion as string) ?? ''); setLatV((setting.latestVersion as string) ?? '');
    setAndroidUrl((setting.androidStoreUrl as string) ?? ''); setIosUrl((setting.iosStoreUrl as string) ?? '');
    setMaint(!!setting.maintenance); setMaintT((setting.maintenanceTitle as string) ?? ''); setMaintB((setting.maintenanceBody as string) ?? '');
  }, [setting]);
  const save = async () => {
    // 전역 차단 작업(점검 on·강제최소버전 상향)은 오조작 시 전체 서비스 중단 → 확인 게이트(쿠폰/공지 삭제와 동일 결, #46 감사)
    const wasMaint = !!setting?.maintenance;
    if (maint && !wasMaint && !window.confirm('점검 모드를 켜면 모든 유저의 진입이 차단됩니다. 저장할까요?')) return;
    const prevMin = (setting?.minVersion as string) ?? '';
    if (minV && minV !== prevMin && !window.confirm(`강제 최소버전을 "${minV}"로 올립니다. 미만 버전 유저는 강제 업데이트 벽에 갇힙니다. 저장할까요?`)) return;
    setBusy(true); setErr('');
    const r = await api('/api/admin/setting', { method: 'POST', body: JSON.stringify({ minVersion: minV || null, latestVersion: latV || null, androidStoreUrl: androidUrl || null, iosStoreUrl: iosUrl || null, maintenance: maint, maintenanceTitle: maintT || null, maintenanceBody: maintB || null }) });
    setBusy(false);
    if (r.body.ok) { flash('설정이 저장되었습니다'); reload(); } else setErr(`저장 실패 — ${errMsg(r)}`);
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
      <div className="oc-row" style={{ alignItems: 'center', gap: 12 }}>
        <Btn onClick={save} disabled={busy}>{busy ? '저장 중…' : '설정 저장'}</Btn>
        {err ? <span className="oc-modal-msg err" style={{ margin: 0, maxWidth: 'none' }}>{err}</span> : null}
      </div>
    </>
  );
}

function Tickets({ tickets, api, reload, flash }: { tickets: Json[]; api: Api; reload: () => void; flash: (m: string) => void }) {
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
      {sel ? <TicketModal t={sel} api={api} reload={reload} flash={flash} onClose={() => setSel(null)} /> : null}
    </div>
  );
}

function TicketModal({ t, api, reload, flash, onClose }: { t: Json; api: Api; reload: () => void; flash: (m: string) => void; onClose: () => void }) {
  // 상태는 select로 선택(기본값=현재 상태). 바꿔도 즉시 적용 X — [저장]을 눌러야만 반영(관리자 UX 원칙: 모든 수정은 저장 버튼).
  const curStatus = (() => { const s = String(t.status ?? 'open'); return s === 'replied' || s === 'resolved' ? 'answered' : s; })();
  const origReply = (t.reply as string) ?? '';
  const [status, setStatus] = useState(curStatus);
  const [reply, setReply] = useState(origReply);
  const [amount, setAmount] = useState('');
  const [snap, setSnap] = useState('');
  const [msg, setMsg] = useState(''); // 인라인 에러/검증 전용(성공은 상단 토스트로)
  const [busy, setBusy] = useState(false);
  const dirty = status !== curStatus || reply !== origReply;
  // 답변+상태 함께 저장(단일 저장 버튼). 성공 시 토스트 + 모달 닫기 + 목록 갱신. 실패 시 인라인 에러(모달 유지).
  const saveReply = async () => {
    setBusy(true); setMsg('');
    const r = await api('/api/admin/ticket/reply', { method: 'POST', body: JSON.stringify({ ticketId: t.id, reply, status }) });
    setBusy(false);
    if (r.body.ok) { flash(reply !== origReply ? '답변이 저장되었습니다' : '상태가 변경되었습니다'); reload(); onClose(); }
    else setMsg(`저장 실패 — ${errMsg(r)}`);
  };
  const doRefund = async () => {
    const amt = Math.floor(Number(amount));
    if (!amt || amt <= 0) { setMsg('환불 다이아를 입력하세요'); return; }
    const note = reply.trim() || '환불 처리';
    setBusy(true); setMsg('');
    const r = await api('/api/admin/refund', { method: 'POST', body: JSON.stringify({ userId: t.userId, amount: amt, note, ticketId: t.id, key: `refund:ticket:${t.id}` }) });
    setBusy(false);
    // applied:false = 이 티켓은 이미 환불됨(멱등키 티켓당 고정) — 금액을 바꿔 다시 눌러도 추가 차감 안 됨.
    //   초록 성공 토스트로 뭉개면 "정정 반영됐다"고 오인(#46 감사) → 경고로 분기.
    if (r.body.ok && r.body.applied) { flash(`환불이 반영되었습니다 · 잔액 ${r.body.balance}💎`); reload(); onClose(); }
    else if (r.body.ok) { setMsg(`이 티켓은 이미 환불되었습니다(추가 환불 불가). 현재 잔액 ${r.body.balance}💎`); reload(); }
    else setMsg(`환불 실패 — ${errMsg(r)}`);
  };
  const viewSnap = async () => { const r = await api(`/api/admin/ticket/snapshot?ticketId=${t.id}`); setSnap(r.body.snapshot ? JSON.stringify(r.body.snapshot, null, 2) : '(진단 스냅샷 없음)'); };
  return (
    <Modal wide title="문의 상세" sub={`${CAT[String(t.category)] ?? String(t.category)} · ${String(t.displayName ?? t.userId)}`} onClose={onClose}
      footer={<><Btn onClick={saveReply} disabled={!dirty || busy}>{busy ? '처리 중…' : '저장'}</Btn><Btn variant="ghost" onClick={onClose} disabled={busy}>닫기</Btn></>}>
      <div className="oc-row" style={{ gap: 8 }}>
        <span className="oc-badge ac">{CAT[String(t.category)] ?? String(t.category)}</span>
        <StatusBadge s={String(t.status)} />
        <b>{String(t.displayName ?? t.userId)}</b>
        <span className="oc-mut">잔액 {String(t.balance)}💎</span>
      </div>
      <div className="oc-mut">기기 {String(t.platform ?? t.userPlatform ?? '?')} {String(t.osVersion ?? '')} · 앱 {String(t.appVersion ?? '')} · {String(t.createdAt).slice(0, 19).replace('T', ' ')}</div>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, background: 'var(--card2)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14, lineHeight: 1.6 }}>{String(t.content)}</div>
      <div className="oc-fld"><label className="oc-label">답변 / 환불 사유 (감사기록에 남음)</label><textarea className="oc-input" value={reply} onChange={(e) => setReply(e.target.value)} style={{ height: 70 }} /></div>
      <div className="oc-row" style={{ alignItems: 'flex-end' }}>
        <div className="oc-fld" style={{ maxWidth: 150 }}>
          <label className="oc-label">상태</label>
          <select className="oc-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">대기</option>
            <option value="reviewing">확인 중</option>
            <option value="answered">답변완료</option>
            {curStatus === 'refunded' ? <option value="refunded">환불완료</option> : null}
          </select>
        </div>
        {String(t.category) === 'refund' ? (
          <>
            <input className="oc-input" placeholder="환불 💎" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} />
            <Btn variant="danger" onClick={doRefund} disabled={busy}>환불(회수)</Btn>
          </>
        ) : null}
        <Btn variant="ghost" onClick={viewSnap} disabled={busy}>진단 스냅샷</Btn>
        {msg ? <span style={{ fontSize: 12.5, color: 'var(--dg)', fontWeight: 700 }}>{msg}</span> : null}
      </div>
      {snap ? <pre className="oc-pre">{snap}</pre> : null}
    </Modal>
  );
}
