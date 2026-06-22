// 배구 엔진 테스트 콘솔 — 경기·관계(선수 심리)·FA·영입(드래프트)을 브라우저에서 직접 시뮬/검증.
// 백엔드 없음 — engine/·data/ 순수 TS를 그대로 번들(RN은 _stubs). 탭마다 우리가 tools/sim*.ts로 보던 엔진을 화면으로.
import { resetLeagueBase, LEAGUE, getTeam, coachInfoOf, getEvolvedTeamPlayers } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { attributeProduction } from '../engine/production';
import { teamOverallRaw, overall, displayOvr } from '../engine/overall';
import { discontentNow, expectsPlayOf, buildOwnerFx } from '../data/owner';
import { prefWeightsOf, isFAEligible, assignFAGrades, askingPrice } from '../engine/faMarket';
import { SIT_CAUSE_KO } from '../engine/owner';
import { marketVal } from '../data/awardSalary';
import { formatMoney } from '../engine/salary';
import { buildDraftContext } from '../data/draftSetup';
import type { Player } from '../types';

const POS_KO: Record<string, string> = { S: '세터', OH: '아웃사이드', OP: '아포짓', MB: '미들', L: '리베로' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const $ = (id: string) => document.getElementById(id)!;
const pcell = (pos: string) => `<td class="pos pos-${pos}">${pos}</td>`;
const ovrOf = (p: Player) => displayOvr(overall(p));
const potStars = (p: Player) => { const m = Math.max(...Object.values(p.potential)); return m >= 88 ? '★★★' : m >= 80 ? '★★' : m >= 72 ? '★' : '·'; };

resetLeagueBase();
const TEAMS = LEAGUE.teams.map((t) => ({ id: t.id, name: getTeam(t.id)?.name ?? t.id }));
const teamSelect = (id: string, cur: string) => `<select id="${id}">` +
  TEAMS.map((t) => `<option value="${t.id}"${t.id === cur ? ' selected' : ''}>${esc(t.name)}</option>`).join('') + `</select>`;

// ─── 탭 프레임워크 ───────────────────────────────────────────────────────
type TabId = 'match' | 'morale' | 'fa' | 'draft';
const TABS: [TabId, string][] = [['match', '경기'], ['morale', '관계 · 선수 심리'], ['fa', 'FA 시장'], ['draft', '영입 · 드래프트']];
let active: TabId = 'match';
function mount() {
  $('tabs').innerHTML = TABS.map(([id, l]) => `<span class="tab${id === active ? '' : ' off'}" data-tab="${id}">${l}</span>`).join('');
  document.querySelectorAll('[data-tab]').forEach((e) => e.addEventListener('click', () => { active = e.getAttribute('data-tab') as TabId; mount(); }));
  $('out').innerHTML = `<p class="hint">실행을 눌러줘.</p>`;
  ({ match: mountMatch, morale: mountMorale, fa: mountFA, draft: mountDraft })[active]();
}

// ═══ 경기 ═══════════════════════════════════════════════════════════════
const M = { a: TEAMS[0].id, b: TEAMS[1].id, seed: 1, runs: 1 };
function mountMatch() {
  $('controls').innerHTML = `
    <div class="teams">
      <div class="team A"><span class="badge">아군 A</span>${teamSelect('m-a', M.a)}<span class="ovr" id="m-ovra"></span></div>
      <div class="vs">VS</div>
      <div class="team B"><span class="badge">상대 B</span>${teamSelect('m-b', M.b)}<span class="ovr" id="m-ovrb"></span></div>
    </div>
    <div class="run-row">
      <label>시드 <input type="number" id="m-seed" value="${M.seed}" min="1" /></label>
      <label>반복 횟수 <input type="number" id="m-runs" value="${M.runs}" min="1" max="10000" /></label>
      <button id="m-run">경기 실행 ▶</button>
    </div>
    <p class="hint">반복 1회 → 박스스코어 · 2회↑ → 승률·세트 분포(시드 연속)</p>`;
  const refresh = () => { $('m-ovra').textContent = 'OVR ' + displayOvr(teamOverallRaw(availableTeamPlayers(M.a, 0))); $('m-ovrb').textContent = 'OVR ' + displayOvr(teamOverallRaw(availableTeamPlayers(M.b, 0))); };
  ($('m-a') as HTMLSelectElement).onchange = (e) => { M.a = (e.target as HTMLSelectElement).value; refresh(); };
  ($('m-b') as HTMLSelectElement).onchange = (e) => { M.b = (e.target as HTMLSelectElement).value; refresh(); };
  ($('m-seed') as HTMLInputElement).onchange = (e) => { M.seed = Math.max(1, +(e.target as HTMLInputElement).value || 1); };
  ($('m-runs') as HTMLInputElement).onchange = (e) => { M.runs = Math.max(1, Math.min(10000, +(e.target as HTMLInputElement).value || 1)); };
  $('m-run').onclick = runMatch;
  refresh();
}
function runMatch() {
  if (M.a === M.b) { $('out').innerHTML = `<p class="warn">서로 다른 두 팀을 골라주세요.</p>`; return; }
  const A = availableTeamPlayers(M.a, 0), B = availableTeamPlayers(M.b, 0);
  const opts = { home: coachInfoOf(M.a), away: coachInfoOf(M.b) } as any;
  if (M.runs === 1) {
    const sim = simulateMatch(M.seed, A, B, opts);
    const lines = attributeProduction(sim, A, B, M.seed);
    const win = sim.homeSets > sim.awaySets ? M.a : M.b;
    const sets = sim.setScores.map((s, i) => `<span class="setchip"><b>${i + 1}세트</b> ${s.home}:${s.away}</span>`).join('');
    const box = (squad: Player[], teamId: string) => {
      const rows = squad.map((p) => ({ p, l: lines.get(p.id) })).filter((r) => r.l && r.l.matches > 0).sort((x, y) => y.l!.points - x.l!.points);
      const body = rows.map(({ p, l }) => `<tr>${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td class="pt">${l!.points}</td><td>${l!.spikes}</td><td>${l!.blocks}</td><td>${l!.digs}</td><td>${l!.aces}</td><td>${l!.assists}</td><td>${l!.receives}</td></tr>`).join('');
      return `<div class="boxwrap"><h3>${esc(getTeam(teamId)?.name ?? teamId)}</h3><table class="box"><thead><tr><th>P</th><th>선수</th><th>득점</th><th>공격</th><th>블록</th><th>디그</th><th>에이스</th><th>어시</th><th>리시브</th></tr></thead><tbody>${body || '<tr><td colspan="9" class="empty">출전 기록 없음</td></tr>'}</tbody></table></div>`;
    };
    $('out').innerHTML = `<div class="scoreboard"><div class="sb-team ${win === M.a ? 'won' : ''}">${esc(getTeam(M.a)?.name ?? M.a)}</div><div class="sb-score">${sim.homeSets} : ${sim.awaySets}</div><div class="sb-team ${win === M.b ? 'won' : ''}">${esc(getTeam(M.b)?.name ?? M.b)}</div></div><div class="setchips">${sets}</div><div class="boxes">${box(A, M.a)}${box(B, M.b)}</div>`;
  } else {
    let aw = 0, as = 0, bs = 0; const dist: Record<string, number> = {};
    for (let i = 0; i < M.runs; i++) { const s = simulateMatch(M.seed + i, A, B, opts); if (s.homeSets > s.awaySets) aw++; as += s.homeSets; bs += s.awaySets; const k = `${s.homeSets}:${s.awaySets}`; dist[k] = (dist[k] ?? 0) + 1; }
    const order = ['3:0', '3:1', '3:2', '2:3', '1:3', '0:3'];
    const dr = order.filter((k) => dist[k]).map((k) => `<tr><td>${k}</td><td>${dist[k]}</td><td>${(dist[k] / M.runs * 100).toFixed(1)}%</td></tr>`).join('');
    $('out').innerHTML = `<div class="stat-grid"><div class="stat"><span class="sv">${(aw / M.runs * 100).toFixed(1)}%</span><span class="sl">A 승률 (${aw}/${M.runs})</span></div><div class="stat"><span class="sv">${(as / M.runs).toFixed(2)} : ${(bs / M.runs).toFixed(2)}</span><span class="sl">평균 세트 (A:B)</span></div></div><table class="box dist"><thead><tr><th>세트 스코어</th><th>경기 수</th><th>비율</th></tr></thead><tbody>${dr}</tbody></table><p class="hint">${esc(getTeam(M.a)?.name ?? M.a)}(A) 기준 · 시드 ${M.seed}~${M.seed + M.runs - 1}</p>`;
  }
}

// ═══ 관계 · 선수 심리 ════════════════════════════════════════════════════
const R = { team: TEAMS[0].id, day: 60 };
const MOOD = { discontent: ['😟', '불만', 'var(--bad)'], neutral: ['😐', '무감정', 'var(--soft)'], positive: ['😊', '만족', 'var(--good)'] } as Record<string, [string, string, string]>;
function mountMorale() {
  $('controls').innerHTML = `<div class="run-row"><label>팀 ${teamSelect('r-team', R.team)}</label><label>경기일(day 0~164) <input type="number" id="r-day" value="${R.day}" min="0" max="164" /></label><button id="r-run">선수 마음 보기 ▶</button></div><p class="hint">각 선수가 왜 벤치/출전인지(사유) + 성격(출전 갈망)·주전 기대치에 따른 기분. 만료 예정 선수는 재계약 거부율(시즌 내내 부당 벤치면 ↑→FA 이탈).</p>`;
  ($('r-team') as HTMLSelectElement).onchange = (e) => { R.team = (e.target as HTMLSelectElement).value; };
  ($('r-day') as HTMLInputElement).onchange = (e) => { R.day = Math.max(0, Math.min(164, +(e.target as HTMLInputElement).value || 0)); };
  $('r-run').onclick = runMorale;
}
function runMorale() {
  const fx = buildOwnerFx([], 0, R.team, 50);
  const rows = getEvolvedTeamPlayers(R.team, R.day).map((p) => {
    const m = discontentNow(p, R.team, R.day);
    return { p, m, play: prefWeightsOf(p).play, exp: expectsPlayOf(p, R.team, R.day), refuse: fx.refuseProb[p.id] };
  }).sort((a, b) => (a.m.mood === 'discontent' ? 0 : 1) - (b.m.mood === 'discontent' ? 0 : 1) || overall(b.p) - overall(a.p));
  const body = rows.map(({ p, m, play, exp, refuse }) => {
    const [emo, , col] = MOOD[m.mood];
    return `<tr>${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td>${ovrOf(p)}</td><td style="text-align:left">${SIT_CAUSE_KO[m.cause]}</td><td style="text-align:left;color:${col};font-weight:700">${emo} ${esc(m.label)}</td><td>${play.toFixed(2)}</td><td>${exp.toFixed(2)}</td><td class="pt">${refuse != null ? (refuse * 100).toFixed(0) + '%' : '·'}</td></tr>`;
  }).join('');
  $('out').innerHTML = `<table class="box"><thead><tr><th>P</th><th>선수</th><th>OVR</th><th style="text-align:left">사유</th><th style="text-align:left">기분</th><th>출전갈망</th><th>기대치</th><th>재계약거부</th></tr></thead><tbody>${body}</tbody></table><p class="hint">${esc(getTeam(R.team)?.name ?? R.team)} · day ${R.day} · 재계약거부=만료 예정 선수만</p>`;
}

// ═══ FA 시장 ════════════════════════════════════════════════════════════
function mountFA() {
  $('controls').innerHTML = `<div class="run-row"><button id="fa-run">FA 풀 생성 ▶</button></div><p class="hint">리그 전체에서 이번 오프시즌 FA 자격(경력 6시즌+·계약 만료 임박) 선수 풀 + 등급(A/B/C)·요구 연봉.</p>`;
  $('fa-run').onclick = runFA;
}
function runFA() {
  const pool: { p: Player; team: string }[] = [];
  for (const t of LEAGUE.teams) for (const p of getEvolvedTeamPlayers(t.id, 164)) if (isFAEligible(p)) pool.push({ p, team: t.id });
  pool.sort((a, b) => overall(b.p) - overall(a.p));
  const grades = assignFAGrades(pool.map((x) => x.p));
  const body = pool.map(({ p, team }) => {
    const g = grades.get(p.id) ?? 'C';
    return `<tr><td class="pt">${g}</td>${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td style="text-align:left">${esc(getTeam(team)?.name ?? team)}</td><td>${ovrOf(p)}</td><td>${p.age}</td><td>${formatMoney(askingPrice(marketVal(p), g))}</td></tr>`;
  }).join('');
  $('out').innerHTML = `<table class="box"><thead><tr><th>등급</th><th>P</th><th>선수</th><th style="text-align:left">현 소속</th><th>OVR</th><th>나이</th><th>요구 연봉</th></tr></thead><tbody>${body || '<tr><td colspan="7" class="empty">FA 자격 선수 없음</td></tr>'}</tbody></table><p class="hint">총 ${pool.length}명 · A/B는 보상선수 대상 등급</p>`;
}

// ═══ 영입 · 드래프트 ═════════════════════════════════════════════════════
function mountDraft() {
  $('controls').innerHTML = `<div class="run-row"><button id="d-run">드래프트 클래스 생성 ▶</button></div><p class="hint">다음 시즌 신인 드래프트 클래스(엔진 생성). OVR·포텐셜(★) 순. 스카우팅 안개는 콘솔에선 전부 공개.</p>`;
  $('d-run').onclick = runDraft;
}
function runDraft() {
  const ctx = buildDraftContext('', {}, {}, [], false, [], 1);
  const cls = [...ctx.cls].sort((a, b) => overall(b) - overall(a));
  const body = cls.map((p) => `<tr>${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td>${p.age}</td><td>${p.height}</td><td class="pt">${ovrOf(p)}</td><td style="color:var(--warn);font-weight:700">${potStars(p)}</td></tr>`).join('');
  $('out').innerHTML = `<table class="box"><thead><tr><th>P</th><th>선수</th><th>나이</th><th>키</th><th>OVR</th><th>포텐셜</th></tr></thead><tbody>${body}</tbody></table><p class="hint">총 ${cls.length}명 · ★★★=특급 유망주</p>`;
}

mount();
