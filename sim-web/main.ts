// 배구 엔진 테스트 콘솔 — 경기. 시드 리그의 두 팀을 골라 한 경기(박스스코어) 또는 N경기(승률·분포)를
// 브라우저에서 직접 시뮬. 백엔드 없음 — engine/·data/ 순수 TS를 그대로 번들(RN은 스텁).
import { resetLeagueBase, LEAGUE, getTeam, coachInfoOf, shortTeamName } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { attributeProduction } from '../engine/production';
import { teamOverallRaw, displayOvr } from '../engine/overall';
import type { Player } from '../types';

const POS_KO: Record<string, string> = { S: '세터', OH: '아웃사이드', OP: '아포짓', MB: '미들', L: '리베로' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const $ = (id: string) => document.getElementById(id)!;

resetLeagueBase();
const TEAMS = LEAGUE.teams.map((t) => ({ id: t.id, name: getTeam(t.id)?.name ?? t.id }));

interface State { a: string; b: string; seed: number; runs: number; }
const st: State = { a: TEAMS[0].id, b: TEAMS[1].id, seed: 1, runs: 1 };

// ─── 컨트롤 ───────────────────────────────────────────────────────────────
function teamSelect(side: 'a' | 'b'): string {
  const cur = st[side];
  return `<select id="sel-${side}">` + TEAMS.map((t) =>
    `<option value="${t.id}"${t.id === cur ? ' selected' : ''}>${esc(t.name)}</option>`).join('') + `</select>`;
}

function renderControls() {
  $('controls').innerHTML = `
    <div class="teams">
      <div class="team A"><span class="badge">아군 A</span>${teamSelect('a')}<span class="ovr" id="ovr-a"></span></div>
      <div class="vs">VS</div>
      <div class="team B"><span class="badge">상대 B</span>${teamSelect('b')}<span class="ovr" id="ovr-b"></span></div>
    </div>
    <div class="run-row">
      <label>시드 <input type="number" id="seed" value="${st.seed}" min="1" /></label>
      <label>반복 횟수 <input type="number" id="runs" value="${st.runs}" min="1" max="10000" /></label>
      <button id="run">경기 실행 ▶</button>
    </div>
    <p class="hint">반복 1회 → 한 경기 박스스코어 · 반복 2회↑ → 승률·세트 스코어 분포(시드 연속)</p>`;

  ($('sel-a') as HTMLSelectElement).onchange = (e) => { st.a = (e.target as HTMLSelectElement).value; refreshOvr(); };
  ($('sel-b') as HTMLSelectElement).onchange = (e) => { st.b = (e.target as HTMLSelectElement).value; refreshOvr(); };
  ($('seed') as HTMLInputElement).onchange = (e) => { st.seed = Math.max(1, +(e.target as HTMLInputElement).value || 1); };
  ($('runs') as HTMLInputElement).onchange = (e) => { st.runs = Math.max(1, Math.min(10000, +(e.target as HTMLInputElement).value || 1)); };
  ($('run') as HTMLButtonElement).onclick = run;
  refreshOvr();
}

function refreshOvr() {
  $('ovr-a').textContent = 'OVR ' + displayOvr(teamOverallRaw(availableTeamPlayers(st.a, 0)));
  $('ovr-b').textContent = 'OVR ' + displayOvr(teamOverallRaw(availableTeamPlayers(st.b, 0)));
}

// ─── 실행 ────────────────────────────────────────────────────────────────
function run() {
  if (st.a === st.b) { $('out').innerHTML = `<p class="warn">서로 다른 두 팀을 골라주세요.</p>`; return; }
  const A = availableTeamPlayers(st.a, 0), B = availableTeamPlayers(st.b, 0);
  const opts = { home: coachInfoOf(st.a), away: coachInfoOf(st.b) };
  st.runs === 1 ? renderOne(A, B, opts) : renderMany(A, B, opts);
}

function renderOne(A: Player[], B: Player[], opts: any) {
  const sim = simulateMatch(st.seed, A, B, opts);
  const lines = attributeProduction(sim, A, B, st.seed);
  const win = sim.homeSets > sim.awaySets ? st.a : st.b;
  const sets = sim.setScores.map((s, i) => `<span class="setchip"><b>${i + 1}세트</b> ${s.home}:${s.away}</span>`).join('');
  const box = (squad: Player[], teamId: string) => {
    const rows = squad.map((p) => ({ p, l: lines.get(p.id) })).filter((r) => r.l && r.l.matches > 0)
      .sort((x, y) => (y.l!.points - x.l!.points));
    const body = rows.map(({ p, l }) => `<tr>
      <td class="pos pos-${p.position}">${p.position}</td><td class="nm">${esc(p.name)}</td>
      <td class="pt">${l!.points}</td><td>${l!.spikes}</td><td>${l!.blocks}</td><td>${l!.digs}</td><td>${l!.aces}</td><td>${l!.assists}</td><td>${l!.receives}</td>
    </tr>`).join('');
    return `<div class="boxwrap"><h3>${esc(getTeam(teamId)?.name ?? teamId)}</h3>
      <table class="box"><thead><tr><th>P</th><th>선수</th><th>득점</th><th>공격</th><th>블록</th><th>디그</th><th>에이스</th><th>어시</th><th>리시브</th></tr></thead>
      <tbody>${body || '<tr><td colspan="9" class="empty">출전 기록 없음</td></tr>'}</tbody></table></div>`;
  };
  $('out').innerHTML = `
    <div class="scoreboard">
      <div class="sb-team ${win === st.a ? 'won' : ''}">${esc(getTeam(st.a)?.name ?? st.a)}</div>
      <div class="sb-score">${sim.homeSets} : ${sim.awaySets}</div>
      <div class="sb-team ${win === st.b ? 'won' : ''}">${esc(getTeam(st.b)?.name ?? st.b)}</div>
    </div>
    <div class="setchips">${sets}</div>
    <div class="boxes">${box(A, st.a)}${box(B, st.b)}</div>`;
}

function renderMany(A: Player[], B: Player[], opts: any) {
  let aWins = 0, aSets = 0, bSets = 0;
  const dist: Record<string, number> = {};
  for (let i = 0; i < st.runs; i++) {
    const s = simulateMatch(st.seed + i, A, B, opts);
    if (s.homeSets > s.awaySets) aWins++;
    aSets += s.homeSets; bSets += s.awaySets;
    const k = `${s.homeSets}:${s.awaySets}`;
    dist[k] = (dist[k] ?? 0) + 1;
  }
  const wr = (aWins / st.runs * 100).toFixed(1);
  const order = ['3:0', '3:1', '3:2', '2:3', '1:3', '0:3'];
  const distRows = order.filter((k) => dist[k]).map((k) =>
    `<tr><td>${k}</td><td>${dist[k]}</td><td>${(dist[k] / st.runs * 100).toFixed(1)}%</td></tr>`).join('');
  $('out').innerHTML = `
    <div class="stat-grid">
      <div class="stat"><span class="sv">${wr}%</span><span class="sl">A 승률 (${aWins}/${st.runs})</span></div>
      <div class="stat"><span class="sv">${(aSets / st.runs).toFixed(2)} : ${(bSets / st.runs).toFixed(2)}</span><span class="sl">평균 세트 (A:B)</span></div>
    </div>
    <table class="box dist"><thead><tr><th>세트 스코어</th><th>경기 수</th><th>비율</th></tr></thead><tbody>${distRows}</tbody></table>
    <p class="hint">${esc(getTeam(st.a)?.name ?? st.a)}(A) 기준 · 시드 ${st.seed}~${st.seed + st.runs - 1}</p>`;
}

renderControls();
$('out').innerHTML = `<p class="hint">팀을 고르고 '경기 실행'을 눌러줘.</p>`;
