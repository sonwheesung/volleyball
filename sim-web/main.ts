// 배구 엔진 테스트 콘솔 — 경기·관계(선수 심리)·FA·영입(드래프트)을 브라우저에서 직접 시뮬/검증.
// 백엔드 없음 — engine/·data/ 순수 TS를 그대로 번들(RN은 _stubs). 탭마다 우리가 tools/sim*.ts로 보던 엔진을 화면으로.
import { resetLeagueBase, LEAGUE, getTeam, coachInfoOf, getEvolvedTeamPlayers, getPlayer, shortTeamName, SEASON } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { currentSeasonAwards } from '../data/awards';
import { restedOnDay } from '../data/rotation';
import { seasonTxLog, seasonInjuryReport, seasonScandals } from '../data/dynamics';
import { buildNewsFeed } from '../data/news';
import { SEVERITY_KO } from '../engine/injury';
import { SCANDAL_KO } from '../engine/scandal';
import type { AwardWinner } from '../types';
import { simulateMatch } from '../engine/match';
import { attributeProduction } from '../engine/production';
import { teamOverallRaw, overall, displayOvr } from '../engine/overall';
import { buildLineup } from '../engine/lineup';
import { discontentNow, benchCauseOf, expectsPlayOf, buildOwnerFx, teamFanbaseNow } from '../data/owner';
import { settleSeason } from '../engine/finance';
import { prefWeightsOf, isFAEligible, assignFAGrades, askingPrice } from '../engine/faMarket';
import { SIT_CAUSE_KO } from '../engine/owner';
import { marketVal } from '../data/awardSalary';
import { formatMoney } from '../engine/salary';
import { LEAGUE_CAP, isFranchise } from '../engine/cap';
import { leagueProduction } from '../data/production';
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
type TabId = 'match' | 'lineup' | 'dist' | 'season' | 'morale' | 'aging' | 'salary' | 'finance' | 'fa' | 'draft' | 'foreign' | 'tx' | 'injury' | 'news';
const TABS: [TabId, string][] = [['match', '경기'], ['lineup', '선발 라인업'], ['dist', '분포 KOVO'], ['season', '시즌'], ['morale', '관계 · 선수 심리'], ['aging', '성장 · 노쇠'], ['salary', '연봉 산정'], ['finance', '재정'], ['fa', 'FA 시장'], ['foreign', '외국인'], ['draft', '영입 · 드래프트'], ['tx', '시즌 중 이동'], ['injury', '부상 · 사고'], ['news', '뉴스']];
let active: TabId = 'match';
const MOUNTS: Record<TabId, () => void> = { match: mountMatch, lineup: mountLineup, dist: mountDist, season: mountSeason, morale: mountMorale, aging: mountAging, salary: mountSalary, finance: mountFinance, fa: mountFA, draft: mountDraft, foreign: mountForeign, tx: mountTx, injury: mountInjury, news: mountNews };
function mount() {
  $('tabs').innerHTML = TABS.map(([id, l]) => `<span class="tab${id === active ? '' : ' off'}" data-tab="${id}">${l}</span>`).join('');
  document.querySelectorAll('[data-tab]').forEach((e) => e.addEventListener('click', () => { active = e.getAttribute('data-tab') as TabId; mount(); }));
  $('out').innerHTML = `<p class="hint">실행을 눌러줘.</p>`;
  MOUNTS[active]();
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

// ═══ 선발 라인업 (경기별 주전 등록 엔진) ════════════════════════════════
const LU = { team: TEAMS[0].id, day: 60 };
const SLOT_KO = ['S · 세터', 'OH · 아웃사이드', 'MB · 미들', 'OP · 아포짓', 'OH · 아웃사이드', 'MB · 미들'];
function mountLineup() {
  $('controls').innerHTML = `<div class="run-row"><label>팀 ${teamSelect('lu-team', LU.team)}</label><label>경기일(day 0~164) <input type="number" id="lu-day" value="${LU.day}" min="0" max="164" /></label><button id="lu-run">선발 라인업 보기 ▶</button></div><p class="hint">경기별 주전 등록 — 그날 출전 가능 명단(부상·징계·벤치 제외)에서 감독이 짜는 <b>코트 7인(6+리베로)</b> + 순위 굳으면 휴식. 제외 선수는 사유와 함께. 실제 경기/순위/생산과 동일 라인업.</p>`;
  ($('lu-team') as HTMLSelectElement).onchange = (e) => { LU.team = (e.target as HTMLSelectElement).value; };
  ($('lu-day') as HTMLInputElement).onchange = (e) => { LU.day = Math.max(0, Math.min(164, +(e.target as HTMLInputElement).value || 0)); };
  $('lu-run').onclick = runLineup;
}
function runLineup() {
  const rest = restedOnDay(LU.team, LU.day);
  const avail = availableTeamPlayers(LU.team, LU.day).filter((p) => !rest.has(p.id));
  const lu = buildLineup(avail);
  const starterIds = new Set<string>([...lu.six.map((p) => p.id), ...(lu.libero ? [lu.libero.id] : [])]);
  const courtRows = lu.six.map((p, i) => `<tr><td style="text-align:left;color:var(--soft)">${SLOT_KO[i]}</td>${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td class="pt">${ovrOf(p)}</td></tr>`).join('')
    + (lu.libero ? `<tr><td style="text-align:left;color:var(--soft)">L · 리베로</td>${pcell('L')}<td class="nm">${esc(lu.libero.name)}</td><td class="pt">${ovrOf(lu.libero)}</td></tr>` : '');
  const CAUSE_COL: Record<string, string> = { injured: 'var(--warn)', suspended: 'var(--bad)', rested: 'var(--accent)', ownerBenched: 'var(--bad)', outclassed: 'var(--soft)', starter: 'var(--soft)' };
  const excl = getEvolvedTeamPlayers(LU.team, LU.day).filter((p) => !starterIds.has(p.id))
    .map((p) => ({ p, cause: benchCauseOf(p, LU.team, LU.day) }))
    .sort((a, b) => overall(b.p) - overall(a.p));
  const exclRows = excl.map(({ p, cause }) => `<tr>${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td>${ovrOf(p)}</td><td style="text-align:left;color:${CAUSE_COL[cause]};font-weight:700">${SIT_CAUSE_KO[cause]}</td></tr>`).join('');
  $('out').innerHTML = `<div class="boxes">
    <div class="boxwrap"><h3>선발 — 코트 7인 (5-1 시스템)</h3><table class="box"><thead><tr><th style="text-align:left">슬롯</th><th>P</th><th>선수</th><th>OVR</th></tr></thead><tbody>${courtRows}</tbody></table>
      <p class="hint" style="margin-top:10px">6인은 로테이션 슬롯 순(전위 2·3·4 / 후위 1·5·6). 후위 미들은 경기 중 리베로와 교체.</p></div>
    <div class="boxwrap"><h3>제외 (${excl.length}명) · 사유</h3><table class="box"><thead><tr><th>P</th><th>선수</th><th>OVR</th><th style="text-align:left">사유</th></tr></thead><tbody>${exclRows || '<tr><td colspan="4" class="empty">전원 출전</td></tr>'}</tbody></table></div>
  </div><p class="hint">${esc(getTeam(LU.team)?.name ?? LU.team)} · day ${LU.day} · 부상=🚑 / 휴식=로드매니지먼트(#3) / 구단주 벤치=지시 / 주전 경쟁 밀림=실력</p>`;
}

// ═══ 분포 KOVO ═══════════════════════════════════════════════════════════
const D = { a: TEAMS[0].id, b: TEAMS[1].id, runs: 200 };
const KILL = new Set(['kill', 'blockout', 'tip', 'cap']);
const ERR = new Set(['serveErr', 'recvErr', 'fault', 'miscErr', 'atkErr']);
function mountDist() {
  $('controls').innerHTML = `<div class="teams"><div class="team A"><span class="badge">A</span>${teamSelect('d-a', D.a)}</div><div class="vs">VS</div><div class="team B"><span class="badge">B</span>${teamSelect('d-b', D.b)}</div></div><div class="run-row"><label>경기 수 <input type="number" id="d-runs" value="${D.runs}" min="10" max="20000" /></label><button id="d-run">분포 측정 ▶</button></div><p class="hint">N경기의 모든 득점을 종결 방식으로 분류 → 킬·블로킹·에이스·범실 비중이 실제 KOVO(킬~56%·블록~10%·에이스~6%)에 수렴하는지.</p>`;
  ($('d-a') as HTMLSelectElement).onchange = (e) => { D.a = (e.target as HTMLSelectElement).value; };
  ($('d-b') as HTMLSelectElement).onchange = (e) => { D.b = (e.target as HTMLSelectElement).value; };
  ($('d-runs') as HTMLInputElement).onchange = (e) => { D.runs = Math.max(10, Math.min(20000, +(e.target as HTMLInputElement).value || 200)); };
  $('d-run').onclick = runDist;
}
function runDist() {
  if (D.a === D.b) { $('out').innerHTML = `<p class="warn">서로 다른 두 팀을 골라주세요.</p>`; return; }
  const A = availableTeamPlayers(D.a, 0), B = availableTeamPlayers(D.b, 0);
  const opts = { home: coachInfoOf(D.a), away: coachInfoOf(D.b) } as any;
  let kill = 0, stuff = 0, ace = 0, err = 0, total = 0;
  for (let i = 0; i < D.runs; i++) {
    const sim = simulateMatch(i + 1, A, B, opts);
    for (const pt of sim.points) { const h = (pt as any).how as string | undefined; if (!h) continue; total++; if (KILL.has(h)) kill++; else if (h === 'stuff') stuff++; else if (h === 'ace') ace++; else if (ERR.has(h)) err++; }
  }
  const row = (label: string, n: number, target: string, col: string) => `<tr><td style="text-align:left;color:${col};font-weight:700">${label}</td><td class="pt">${(n / total * 100).toFixed(1)}%</td><td>${n.toLocaleString()}</td><td style="color:var(--soft)">${target}</td></tr>`;
  $('out').innerHTML = `<table class="box" style="max-width:520px"><thead><tr><th style="text-align:left">득점 유형</th><th>비중</th><th>횟수</th><th>KOVO 목표</th></tr></thead><tbody>
    ${row('공격(킬)', kill, '~56%', 'var(--accent)')}${row('블로킹(스터프)', stuff, '~10%', '#8B7CF0')}${row('서브 에이스', ace, '~6%', 'var(--warn)')}${row('상대 범실', err, '~28%', 'var(--soft)')}</tbody></table>
    <p class="hint">${esc(getTeam(D.a)?.name ?? D.a)} vs ${esc(getTeam(D.b)?.name ?? D.b)} · ${D.runs}경기 · 총 ${total.toLocaleString()}득점</p>`;
}

// ═══ 재정 ════════════════════════════════════════════════════════════════
function mountFinance() {
  $('controls').innerHTML = `<div class="run-row"><button id="fi-run">재정 정산 보기 ▶</button></div><p class="hint">시즌 정산(settleSeason) — 모기업 지원·성적 보너스·관중 입장·굿즈 수입 − 연봉·운영비. 전 구단 비교. (스태프비·시작 잔고는 콘솔 기본값)</p>`;
  $('fi-run').onclick = runFinance;
}
function runFinance() {
  const standings = computeStandings(164);
  const champ = buildPlayoffs(0).championId;
  const rows = standings.map((s, i) => {
    const fb = teamFanbaseNow(s.teamId, 164, 50, []);
    const payroll = getEvolvedTeamPlayers(s.teamId, 164).reduce((sum, p) => sum + p.contract.salary, 0);
    const fin = settleSeason({ teamId: s.teamId, rank: i + 1, teamCount: standings.length, champion: s.teamId === champ, runnerUp: i === 1, winRate: s.wins / Math.max(1, s.played), fan: 50, fanTotal: fb.total, playerFansTotal: fb.playerFansTotal, payroll, staff: 0, cashBefore: 50000 });
    return { team: s.teamId, rank: i + 1, fin };
  });
  const body = rows.map(({ team, rank, fin }) => `<tr><td>${rank}</td><td class="nm" style="text-align:left">${team === champ ? '🏆 ' : ''}${esc(getTeam(team)?.name ?? team)}</td><td>${formatMoney(fin.sponsor + fin.bonus)}</td><td>${formatMoney(fin.gate)}</td><td>${formatMoney(fin.merch)}</td><td class="pt">${formatMoney(fin.income)}</td><td>${formatMoney(fin.payroll)}</td><td style="color:${fin.net >= 0 ? 'var(--good)' : 'var(--bad)'};font-weight:700">${fin.net >= 0 ? '+' : ''}${formatMoney(fin.net)}</td></tr>`).join('');
  $('out').innerHTML = `<table class="box"><thead><tr><th>#</th><th style="text-align:left">팀</th><th>모기업</th><th>관중</th><th>굿즈</th><th>총수입</th><th>연봉</th><th>순익</th></tr></thead><tbody>${body}</tbody></table><p class="hint">모기업=기본 지원+성적 보너스 · 관중=입장수입 · 적자는 모기업이 보전(파산 없음)</p>`;
}

// ═══ 시즌 ════════════════════════════════════════════════════════════════
function mountSeason() {
  $('controls').innerHTML = `<div class="run-row"><button id="se-run">시즌 진행 결과 ▶</button></div><p class="hint">현재 리그(1시즌)를 끝까지 자동 시뮬한 최종 순위·우승·시상(MVP·신인상·기록왕)·주전 휴식(#3). 결정론 — 관전/생산과 동일.</p>`;
  $('se-run').onclick = runSeason;
}
function runSeason() {
  const standings = computeStandings(164);
  const champ = buildPlayoffs(0).championId;
  const aw = currentSeasonAwards(0);
  let restGames = 0;
  for (const d of [...new Set(SEASON.map((f) => f.dayIndex))]) for (const t of LEAGUE.teams) if (restedOnDay(t.id, d).size) restGames++;
  const awName = (w: AwardWinner | null) => w ? `${esc(getPlayer(w.playerId)?.name ?? '?')} <span style="color:var(--soft)">${esc(shortTeamName(w.teamId))}</span>` : '—';
  const standRows = standings.map((s, i) => `<tr><td>${i + 1}</td><td class="nm" style="text-align:left">${s.teamId === champ ? '🏆 ' : ''}${esc(getTeam(s.teamId)?.name ?? s.teamId)}</td><td>${s.played}</td><td class="pt">${s.wins}</td><td>${s.losses}</td><td>${s.points}</td><td style="color:${s.setDiff >= 0 ? 'var(--good)' : 'var(--bad)'}">${s.setDiff > 0 ? '+' : ''}${s.setDiff}</td></tr>`).join('');
  const awardRows = [['정규 MVP', aw.mvp], ['챔프전 MVP', aw.finalsMvp], ['신인상', aw.rookie], ['기량발전상', aw.mostImproved], ['득점왕', aw.titles.scoring], ['블로킹왕', aw.titles.block], ['디그왕', aw.titles.dig], ['세트왕', aw.titles.set]]
    .map(([label, w]) => `<tr><td style="color:var(--soft);text-align:left">${label}</td><td class="nm" style="text-align:left">${awName(w as AwardWinner | null)}</td></tr>`).join('');
  $('out').innerHTML = `
    <div class="boxes">
      <div class="boxwrap"><h3>최종 순위</h3><table class="box"><thead><tr><th>#</th><th style="text-align:left">팀</th><th>경기</th><th>승</th><th>패</th><th>승점</th><th>세트±</th></tr></thead><tbody>${standRows}</tbody></table></div>
      <div class="boxwrap"><h3>시상식</h3><table class="box"><tbody>${awardRows}</tbody></table>
        <p class="hint" style="margin-top:12px">🛋️ 로드매니지먼트(#3): 시즌 동안 주전 휴식 <b>${restGames}</b> 팀-경기 (순위 굳은 팀이 노장·주력 안배)</p></div>
    </div>`;
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

// ═══ 성장 · 노쇠 ═════════════════════════════════════════════════════════
const AGE = { team: TEAMS[0].id };
function mountAging() {
  $('controls').innerHTML = `<div class="run-row"><label>팀 ${teamSelect('a-team', AGE.team)}</label><button id="a-run">성장·노쇠 보기 ▶</button></div><p class="hint">각 선수가 커리어 곡선 어디쯤인지 — 나이 vs 전성기(peakAge)로 성장기/전성기/노쇠기, 잠재력(★) 헤드룸. 미들은 전성기 짧고 노쇠 빠름.</p>`;
  ($('a-team') as HTMLSelectElement).onchange = (e) => { AGE.team = (e.target as HTMLSelectElement).value; };
  $('a-run').onclick = runAging;
}
function runAging() {
  const rows = getEvolvedTeamPlayers(AGE.team, 0).sort((a, b) => a.age - b.age);
  const body = rows.map((p) => {
    const d = p.age - p.peakAge;
    const [phase, col] = d <= -2 ? ['↑ 성장기', 'var(--good)'] : d <= 1 ? ['★ 전성기', 'var(--accent)'] : ['↓ 노쇠기', 'var(--bad)'];
    const headroom = Math.max(0, Math.round(displayOvr(Math.max(...Object.values(p.potential))) - ovrOf(p)));
    return `<tr>${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td>${p.age}</td><td class="pt">${ovrOf(p)}</td><td>${p.peakAge}</td><td style="color:${col};font-weight:700">${phase}</td><td style="color:var(--warn)">${potStars(p)}</td><td>${headroom > 0 ? '+' + headroom : '—'}</td></tr>`;
  }).join('');
  $('out').innerHTML = `<table class="box"><thead><tr><th>P</th><th>선수</th><th>나이</th><th>OVR</th><th>전성기</th><th>단계</th><th>잠재</th><th>성장여력</th></tr></thead><tbody>${body}</tbody></table><p class="hint">${esc(getTeam(AGE.team)?.name ?? AGE.team)} · 성장여력=잠재 OVR−현재 OVR · 노쇠기 선수는 신체 스탯부터 하락</p>`;
}

// ═══ 연봉 산정 ═══════════════════════════════════════════════════════════
const SAL = { team: TEAMS[0].id, day: 164 };
function mountSalary() {
  $('controls').innerHTML = `<div class="run-row"><label>팀 ${teamSelect('s-team', SAL.team)}</label><label>경기일(생산 반영) <input type="number" id="s-day" value="${SAL.day}" min="0" max="164" /></label><button id="s-run">연봉 산정 보기 ▶</button></div><p class="hint">시장가치 = 능력(OVR)×나이(서비스)×포지션×<b>시즌 생산</b>×수상 프리미엄. 연봉/시장가로 고평가·저평가 판정. 팀 총연봉 vs 샐러리캡(35억).</p>`;
  ($('s-team') as HTMLSelectElement).onchange = (e) => { SAL.team = (e.target as HTMLSelectElement).value; };
  ($('s-day') as HTMLInputElement).onchange = (e) => { SAL.day = Math.max(0, Math.min(164, +(e.target as HTMLInputElement).value || 0)); };
  $('s-run').onclick = runSalary;
}
function runSalary() {
  const prodMap = leagueProduction(SAL.day);
  const rows = getEvolvedTeamPlayers(SAL.team, SAL.day).map((p) => {
    const prod = prodMap.get(p.id);
    const mv = marketVal(p, prod);
    const ratio = p.contract.salary / Math.max(1, mv);
    return { p, pts: prod?.points ?? 0, mv, sal: p.contract.salary, ratio };
  }).sort((a, b) => b.sal - a.sal);
  const total = rows.reduce((s, r) => s + r.sal, 0);
  const body = rows.map(({ p, pts, mv, sal, ratio }) => {
    const col = ratio > 1.15 ? 'var(--bad)' : ratio < 0.85 ? 'var(--good)' : 'var(--soft)';
    const tag = isFranchise(p) ? '<span style="color:var(--accent);font-weight:700">프랜차이즈</span>' : p.isForeign ? '<span style="color:var(--bad)">외인</span>' : (p.career.seasons <= 1 ? '<span style="color:var(--soft)">신인</span>' : '');
    return `<tr>${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td>${ovrOf(p)}</td><td>${p.age}</td><td>${pts}</td><td>${formatMoney(mv)}</td><td class="pt">${formatMoney(sal)}</td><td style="color:${col};font-weight:700">${(ratio * 100).toFixed(0)}%</td><td style="text-align:left">${tag}</td></tr>`;
  }).join('');
  const capCol = total > LEAGUE_CAP ? 'var(--bad)' : 'var(--good)';
  $('out').innerHTML = `<div class="stat-grid"><div class="stat"><span class="sv" style="color:${capCol}">${formatMoney(total)}</span><span class="sl">팀 총연봉 / 캡 ${formatMoney(LEAGUE_CAP)}</span></div></div><table class="box"><thead><tr><th>P</th><th>선수</th><th>OVR</th><th>나이</th><th>시즌득점</th><th>시장가치</th><th>연봉</th><th>연봉/시장</th><th style="text-align:left">비고</th></tr></thead><tbody>${body}</tbody></table><p class="hint">연봉/시장: 빨강 고평가(>115%)·초록 저평가(&lt;85%) · ${esc(getTeam(SAL.team)?.name ?? SAL.team)} day ${SAL.day}</p>`;
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

// ═══ 외국인 트라이아웃 ═══════════════════════════════════════════════════
function mountForeign() {
  $('controls').innerHTML = `<div class="run-row"><button id="fo-run">트라이아웃 풀 생성 ▶</button></div><p class="hint">외국인(아포짓 위주)·아시아쿼터 트라이아웃 풀 — 매 오프시즌 유입(1년 계약). OVR 순.</p>`;
  $('fo-run').onclick = runForeign;
}
function runForeign() {
  const ctx = buildDraftContext('', {}, {}, [], false, [], 1);
  const pool = (ids: string[]) => ids.map((id) => ctx.snapshot[id]).filter((p): p is Player => !!p).sort((a, b) => overall(b) - overall(a));
  const tbl = (players: Player[], title: string) => `<div class="boxwrap"><h3>${title} (${players.length}명)</h3><table class="box"><thead><tr><th>P</th><th>선수</th><th style="text-align:left">국적</th><th>나이</th><th>OVR</th></tr></thead><tbody>${players.map((p) => `<tr>${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td style="text-align:left">${esc(p.nationality ?? '외국')}</td><td>${p.age}</td><td class="pt">${ovrOf(p)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">풀 없음</td></tr>'}</tbody></table></div>`;
  $('out').innerHTML = `<div class="boxes">${tbl(pool(ctx.tryout.poolIds), '외국인 트라이아웃')}${tbl(pool(ctx.asianTryout.poolIds), '아시아쿼터')}</div>`;
}

// ═══ 시즌 중 이동 ════════════════════════════════════════════════════════
function mountTx() {
  $('controls').innerHTML = `<div class="run-row"><button id="tx-run">시즌 중 이동 보기 ▶</button></div><p class="hint">시즌 진행 중 전 구단 AI의 방출→FA 영입(부상 구멍 긴급 수혈, 캡·정원 적용). 날짜순.</p>`;
  $('tx-run').onclick = runTx;
}
function runTx() {
  const log = seasonTxLog().slice().sort((a, b) => a.day - b.day);
  const body = log.map((t) => `<tr><td>${t.day}일</td><td style="text-align:left">${esc(getTeam(t.teamId)?.name ?? t.teamId)}</td><td class="nm">${esc(getPlayer(t.playerId)?.name ?? t.playerId)}</td><td style="color:${t.kind === 'sign' ? 'var(--good)' : 'var(--bad)'};font-weight:700">${t.kind === 'sign' ? '영입' : '방출'}</td></tr>`).join('');
  $('out').innerHTML = `<table class="box" style="max-width:560px"><thead><tr><th>날짜</th><th style="text-align:left">구단</th><th>선수</th><th>이동</th></tr></thead><tbody>${body || '<tr><td colspan="4" class="empty">시즌 중 이동 없음</td></tr>'}</tbody></table><p class="hint">총 ${log.length}건</p>`;
}

// ═══ 부상 · 사고 ═════════════════════════════════════════════════════════
function mountInjury() {
  $('controls').innerHTML = `<div class="run-row"><button id="in-run">부상·사고 보기 ▶</button></div><p class="hint">시즌 부상(경미~시즌아웃, 동시 상한 3)·사건사고(SNS·음주운전 등 출장정지). 결장 경기수 포함.</p>`;
  $('in-run').onclick = runInjury;
}
function runInjury() {
  const inj = seasonInjuryReport().slice().sort((a, b) => a.from - b.from);
  const sc = seasonScandals().slice().sort((a, b) => a.from - b.from);
  const injBody = inj.map((s) => `<tr><td>${s.from}일</td><td style="text-align:left">${esc(getTeam(s.teamId)?.name ?? s.teamId)}</td><td class="nm">${esc(getPlayer(s.playerId)?.name ?? s.playerId)}</td><td style="color:var(--warn)">${SEVERITY_KO[s.severity]}</td><td>${s.missMatches}경기</td></tr>`).join('');
  const scBody = sc.map((s) => `<tr><td>${s.from}일</td><td style="text-align:left">${esc(getTeam(s.teamId)?.name ?? s.teamId)}</td><td class="nm">${esc(getPlayer(s.playerId)?.name ?? s.playerId)}</td><td style="color:var(--bad)">${SCANDAL_KO[s.kind]}</td><td>${s.missMatches}경기</td></tr>`).join('');
  $('out').innerHTML = `<div class="boxes"><div class="boxwrap"><h3>부상 (${inj.length}건)</h3><table class="box"><thead><tr><th>발생</th><th style="text-align:left">팀</th><th>선수</th><th>정도</th><th>결장</th></tr></thead><tbody>${injBody || '<tr><td colspan="5" class="empty">없음</td></tr>'}</tbody></table></div><div class="boxwrap"><h3>사건·사고 (${sc.length}건)</h3><table class="box"><thead><tr><th>발생</th><th style="text-align:left">팀</th><th>선수</th><th>사안</th><th>정지</th></tr></thead><tbody>${scBody || '<tr><td colspan="5" class="empty">없음</td></tr>'}</tbody></table></div></div>`;
}

// ═══ 뉴스 ════════════════════════════════════════════════════════════════
function mountNews() {
  $('controls').innerHTML = `<div class="run-row"><button id="ne-run">뉴스 피드 보기 ▶</button></div><p class="hint">시즌 실시간 기사(데뷔·트리플크라운·연승·순위 등). 누적 서사(우승·시상·명전)는 시즌이 쌓여야 — 콘솔은 1시즌이라 실시간 위주.</p>`;
  $('ne-run').onclick = runNews;
}
function runNews() {
  const feed = buildNewsFeed([], [], [], 0, [], [], 164, '', []);
  const KIND: Record<string, string> = { champion: '우승', award: '시상', milestone: '기록', hof: '명전', injury: '부상', scandal: '사건', owner: '구단', streak: '연승연패', standing: '순위', match: '경기', debut: '데뷔', transfer: '이적' };
  const body = feed.slice(0, 60).map((n) => `<div style="padding:10px 0;border-bottom:1px solid var(--alt)"><div style="font-weight:700">${n.big ? '★ ' : ''}${esc(n.headline)} <span style="color:var(--soft);font-weight:400;font-size:12px">· ${KIND[n.kind] ?? n.kind}</span></div>${n.body ? `<div style="color:var(--soft);font-size:12.5px;margin-top:3px">${esc(n.body)}</div>` : ''}</div>`).join('');
  $('out').innerHTML = `${body || '<p class="hint">기사 없음</p>'}<p class="hint">총 ${feed.length}건 (상위 60 표시)</p>`;
}

mount();
