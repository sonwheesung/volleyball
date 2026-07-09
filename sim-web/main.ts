// 배구 엔진 테스트 콘솔 — 경기·관계(선수 심리)·FA·영입(드래프트)을 브라우저에서 직접 시뮬/검증.
// 백엔드 없음 — engine/·data/ 순수 TS를 그대로 번들(RN은 _stubs). 탭마다 우리가 tools/sim*.ts로 보던 엔진을 화면으로.
import { resetLeagueBase, LEAGUE, getTeam, coachInfoOf, getEvolvedTeamPlayers, getPlayer, shortTeamName, SEASON } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { currentSeasonAwards } from '../data/awards';
import { restedOnDay } from '../data/rotation';
import { seasonTxLog, seasonInjuryReport, seasonScandals, setInjuryOverride, clearWhatIf } from '../data/dynamics';
import { buildNewsFeed } from '../data/news';
import { SEVERITY_KO } from '../engine/injury';
import { SCANDAL_KO } from '../engine/scandal';
import type { AwardWinner } from '../types';
import { simulateMatch } from '../engine/match';
import type { BoxLine, BoxSink } from '../engine/rally';
import { teamOverallRaw, overall, displayOvr } from '../engine/overall';
import { buildLineup } from '../engine/lineup';
import { discontentNow, benchCauseOf, expectsPlayOf, buildOwnerFx, teamFanbaseNow } from '../data/owner';
import { settleSeason } from '../engine/finance';
import { prefWeightsOf, isFAEligible, assignFAGrades, askingPrice } from '../engine/faMarket';
import { SIT_CAUSE_KO } from '../engine/owner';
import { marketVal } from '../data/awardSalary';
import { formatMoney, resignOptions } from '../engine/salary';
import { LEAGUE_CAP, isFranchise } from '../engine/cap';
import { leagueProduction } from '../data/production';
import { buildDraftContext } from '../data/draftSetup';
import { aiTargetOf } from '../data/rosterTarget';
import { buildMatchBox } from '../data/matchBox';
import { reconstructRallies } from '../components/courtDirector';
import { situationFeed } from '../components/courtCommentary';
import { matchMvp } from '../data/matchAward';
import { buildMatchBanners, type Banner } from '../data/broadcast';
import { resolveDraft, lotteryRound1, buildDraftOrder, prospectValue, type PickReason } from '../engine/draft';
import { generateDraftClass } from '../data/draftClass';
import { createRng } from '../engine/rng';
import { teamHue } from '../lib/teamColor';
import type { Player } from '../types';

const POS_KO: Record<string, string> = { S: '세터', OH: '아웃사이드', OP: '아포짓', MB: '미들', L: '리베로' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const $ = (id: string) => document.getElementById(id)!;
const pcell = (pos: string) => `<td class="pos pos-${pos}">${pos}</td>`;
const ovrOf = (p: Player) => displayOvr(overall(p));
// 드래프트가치 기준 별(개발 인스펙터 전용 — 게임 화면은 스카우팅 2.0으로 별 제거). engine에서 prospectStars 삭제돼 로컬 정의.
const potStars = (p: Player) => { const v = prospectValue(p); return v >= 81 ? '★★★' : v >= 78 ? '★★' : v >= 75 ? '★' : '·'; };

// 무거운 동기 작업(N회 반복 시뮬 등) — 버튼 비활성 + 로딩 표시 후 **한 프레임 양보(rAF×2)** 하고 실행.
// JS 단일 스레드라 동기 루프는 UI를 막는다 → 페인트를 먼저 시켜야 로딩/비활성이 실제로 보인다(SIM_CONSOLE UI 규칙).
const HEAVY_AT = 100; // 이 횟수 이상이면 로딩 표시(미만은 즉시 — 깜빡임 방지)
function runHeavy(btn: HTMLButtonElement, label: string, work: () => void) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '실행 중…';
  $('out').innerHTML = `<div class="loading"><div class="spinner"></div><p>${esc(label)}</p></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { work(); } finally { btn.disabled = false; btn.textContent = orig; }
  }));
}
const maybeHeavy = (btn: HTMLButtonElement, count: number, label: string, work: () => void) =>
  count >= HEAVY_AT ? runHeavy(btn, label, work) : work();

resetLeagueBase();
const TEAMS = LEAGUE.teams.map((t) => ({ id: t.id, name: getTeam(t.id)?.name ?? t.id }));
const teamSelect = (id: string, cur: string) => `<select id="${id}">` +
  TEAMS.map((t) => `<option value="${t.id}"${t.id === cur ? ' selected' : ''}>${esc(t.name)}</option>`).join('') + `</select>`;

// ─── 탭 프레임워크 ───────────────────────────────────────────────────────
type TabId = 'match' | 'broadcast' | 'champ' | 'lineup' | 'dist' | 'season' | 'morale' | 'aging' | 'salary' | 'finance' | 'fa' | 'draft' | 'draftlive' | 'foreign' | 'tx' | 'injury' | 'news';
const TABS: [TabId, string][] = [['match', '경기'], ['broadcast', '경기 중계 · 현수막'], ['champ', '🏆 우승 화면'], ['lineup', '선발 라인업'], ['dist', '분포 KOVO'], ['season', '시즌'], ['morale', '관계 · 선수 심리'], ['aging', '성장 · 노쇠'], ['salary', '연봉 산정'], ['finance', '재정'], ['fa', 'FA 시장'], ['foreign', '외국인'], ['draft', '영입 · 드래프트'], ['draftlive', '드래프트 라이브'], ['tx', '시즌 중 이동'], ['injury', '부상 · 사고'], ['news', '뉴스']];
let active: TabId = 'match';
const MOUNTS: Record<TabId, () => void> = { match: mountMatch, broadcast: mountBroadcast, champ: mountChamp, lineup: mountLineup, dist: mountDist, season: mountSeason, morale: mountMorale, aging: mountAging, salary: mountSalary, finance: mountFinance, fa: mountFA, draft: mountDraft, draftlive: mountDraftLive, foreign: mountForeign, tx: mountTx, injury: mountInjury, news: mountNews };
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
    const bs: BoxSink = new Map();
    const sim = simulateMatch(M.seed, A, B, { ...opts, box: bs });
    const win = sim.homeSets > sim.awaySets ? M.a : M.b;
    const sets = sim.setScores.map((s, i) => `<span class="setchip"><b>${i + 1}세트</b> ${s.home}:${s.away}</span>`).join('');
    const pts = (l: BoxLine) => l.atkKill + l.blockPt + l.srvAce; // 득점 = 공격+블록+에이스
    const pct = (n: number, d: number) => d > 0 ? `${(n / d * 100).toFixed(1)}%` : '–';
    const z = (n: number) => n === 0 ? `<td class="zero">0</td>` : `<td>${n}</td>`; // 0은 흐리게(네이버 가독성)
    const pill = (pos: string) => `<td><span class="pp pp-${pos}">${pos}</span></td>`;
    const box = (squad: Player[], teamId: string, away: boolean) => {
      const rows = squad.map((p) => ({ p, l: bs.get(p.id)! }))
        .filter((r) => r.l && (r.l.atkAtt > 0 || r.l.srvAtt > 0 || r.l.blockPt > 0 || r.l.digSucc > 0 || r.l.assist > 0))
        .sort((x, y) => pts(y.l) - pts(x.l) || y.l.atkAtt - x.l.atkAtt);
      const T = { pt: 0, ak: 0, aa: 0, bl: 0, ac: 0, dg: 0, as: 0, rg: 0, re: 0, ra: 0, er: 0 }; // 팀 합계
      const eff = (good: number, errc: number, att: number) => att > 0 ? `${((good - errc) / att * 100).toFixed(1)}%` : '–'; // KOVO 리시브 효율=(정확−실패)/시도
      const body = rows.map(({ p, l }) => {
        const err = l.atkErr + l.srvErr;
        const hi = l.atkAtt > 0 && l.atkKill / l.atkAtt >= 0.45;
        const reff = l.recvAtt > 0 ? (l.recvGood - l.recvErr) / l.recvAtt * 100 : 0;
        const rhi = l.recvAtt > 0 && reff >= 45;   // 팀 평균 ~42% 위 = 좋은 리시버(리베로·강 OH) 강조
        T.pt += pts(l); T.ak += l.atkKill; T.aa += l.atkAtt; T.bl += l.blockPt; T.ac += l.srvAce; T.dg += l.digSucc; T.as += l.assist; T.rg += l.recvGood; T.re += l.recvErr; T.ra += l.recvAtt; T.er += err;
        const rcv = l.recvAtt > 0 ? `<td class="rate${rhi ? ' hi' : reff < 0 ? ' er' : ''}" title="정확 ${l.recvGood} · 실패 ${l.recvErr} / 시도 ${l.recvAtt}">${eff(l.recvGood, l.recvErr, l.recvAtt)}</td>` : `<td class="zero">–</td>`;
        return `<tr>${pill(p.position)}<td class="nm">${esc(p.name)}</td><td class="sc">${pts(l)}</td>`
          + `${z(l.atkKill)}${z(l.atkAtt)}<td class="rate${hi ? ' hi' : ''}">${pct(l.atkKill, l.atkAtt)}</td>`
          + `${z(l.blockPt)}${z(l.srvAce)}${z(l.digSucc)}${z(l.assist)}${rcv}`
          + `<td class="${err > 0 ? 'er' : 'zero'}">${err}</td></tr>`;
      }).join('');
      const total = rows.length ? `<tr class="tot"><td></td><td class="l">팀 합계</td><td class="sc">${T.pt}</td>`
        + `<td>${T.ak}</td><td>${T.aa}</td><td class="rate">${pct(T.ak, T.aa)}</td>`
        + `<td>${T.bl}</td><td>${T.ac}</td><td>${T.dg}</td><td>${T.as}</td><td class="rate">${eff(T.rg, T.re, T.ra)}</td><td>${T.er}</td></tr>` : '';
      return `<div class="boxwrap${away ? ' away' : ''}"><h3>${esc(getTeam(teamId)?.name ?? teamId)}</h3><table class="bx"><thead>`
        + `<tr class="grp"><th colspan="3"></th><th class="atkg" colspan="3">공격</th><th colspan="6"></th></tr>`
        + `<tr class="sub"><th>P</th><th class="l">선수</th><th>득점</th><th>성공</th><th>시도</th><th>성공률</th><th>블록</th><th>서브</th><th>디그</th><th>세트</th><th>리시브<br><span class="eff">효율</span></th><th>범실</th></tr>`
        + `</thead><tbody>${body || '<tr><td colspan="12" class="empty">출전 기록 없음</td></tr>'}${total}</tbody></table></div>`;
    };
    $('out').innerHTML = `<div class="scoreboard"><div class="sb-team ${win === M.a ? 'won' : ''}">${esc(getTeam(M.a)?.name ?? M.a)}</div><div class="sb-score">${sim.homeSets} : ${sim.awaySets}</div><div class="sb-team ${win === M.b ? 'won' : ''}">${esc(getTeam(M.b)?.name ?? M.b)}</div></div><div class="setchips">${sets}</div><div class="boxes">${box(A, M.a, false)}${box(B, M.b, true)}</div><p class="hint">공격 <b>성공·시도·성공률</b> · 서브=에이스 · 리시브=<b>효율</b>((정확−실패)/시도, KOVO 공식 · 정확=세터 공격 전개 가능 q≥0.45, 마우스 올리면 정확·실패/시도) · 범실=공격+서브. 실제 스윙 단위 집계(랠리 엔진 직접 기록 — 통계 재구성 아님).</p>`;
  } else maybeHeavy($('m-run') as HTMLButtonElement, M.runs, `${M.runs.toLocaleString()}경기 시뮬레이션 중…`, () => {
    let aw = 0, as = 0, bs = 0; const dist: Record<string, number> = {};
    for (let i = 0; i < M.runs; i++) { const s = simulateMatch(M.seed + i, A, B, opts); if (s.homeSets > s.awaySets) aw++; as += s.homeSets; bs += s.awaySets; const k = `${s.homeSets}:${s.awaySets}`; dist[k] = (dist[k] ?? 0) + 1; }
    const order = ['3:0', '3:1', '3:2', '2:3', '1:3', '0:3'];
    const dr = order.filter((k) => dist[k]).map((k) => `<tr><td>${k}</td><td>${dist[k]}</td><td>${(dist[k] / M.runs * 100).toFixed(1)}%</td></tr>`).join('');
    $('out').innerHTML = `<div class="stat-grid"><div class="stat"><span class="sv">${(aw / M.runs * 100).toFixed(1)}%</span><span class="sl">A 승률 (${aw}/${M.runs})</span></div><div class="stat"><span class="sv">${(as / M.runs).toFixed(2)} : ${(bs / M.runs).toFixed(2)}</span><span class="sl">평균 세트 (A:B)</span></div></div><table class="box dist"><thead><tr><th>세트 스코어</th><th>경기 수</th><th>비율</th></tr></thead><tbody>${dr}</tbody></table><p class="hint">${esc(getTeam(M.a)?.name ?? M.a)}(A) 기준 · 시드 ${M.seed}~${M.seed + M.runs - 1}</p>`;
  });
}

// ═══ 선발 라인업 (경기별 주전 등록 엔진) — what-if 부상 주입 ══════════════
const LU = { team: TEAMS[0].id, day: 60, inj: new Map<string, string>() }; // playerId → teamId(주입한 부상)
const SLOT_KO = ['S · 세터', 'OH · 아웃사이드', 'MB · 미들', 'OP · 아포짓', 'OH · 아웃사이드', 'MB · 미들'];
function applyInj() { // 콘솔 주입 → dynamics 훅(시즌 전체 파급). 시즌아웃(from 0~164).
  setInjuryOverride([...LU.inj].map(([pid, tid]) => ({ playerId: pid, teamId: tid, from: 0, to: 164, severity: 'season' as const, missMatches: 36 })));
}
function toggleInj(pid: string, tid: string) { LU.inj.has(pid) ? LU.inj.delete(pid) : LU.inj.set(pid, tid); applyInj(); runLineup(); }
function mountLineup() {
  $('controls').innerHTML = `<div class="run-row"><label>팀 ${teamSelect('lu-team', LU.team)}</label><label>경기일(day 0~164) <input type="number" id="lu-day" value="${LU.day}" min="0" max="164" /></label><button id="lu-run">선발 라인업 보기 ▶</button><button id="lu-clr" style="background:var(--bad)">what-if 초기화</button></div><p class="hint">경기별 주전 등록 — 그날 출전 가능 명단에서 감독이 짜는 <b>코트 7인(6+리베로)</b>. <b>선수를 클릭하면 시즌아웃 부상을 주입</b>(진짜 엔진 — 시즌·뉴스·생산 탭에도 파급) → 라인업 재구성. 다시 클릭하면 복귀.</p>`;
  ($('lu-team') as HTMLSelectElement).onchange = (e) => { LU.team = (e.target as HTMLSelectElement).value; };
  ($('lu-day') as HTMLInputElement).onchange = (e) => { LU.day = Math.max(0, Math.min(164, +(e.target as HTMLInputElement).value || 0)); };
  $('lu-run').onclick = runLineup;
  $('lu-clr').onclick = () => { LU.inj.clear(); clearWhatIf(); runLineup(); };
}
function runLineup() {
  const rest = restedOnDay(LU.team, LU.day);
  const fullAvail = availableTeamPlayers(LU.team, LU.day); // 그날 출전 가능 — 주입한 부상도 여기 반영(injuredOnDay)
  const healthy = new Set(fullAvail.map((p) => p.id));
  const avail = fullAvail.filter((p) => !rest.has(p.id));
  const lu = buildLineup(avail);
  const starterIds = new Set<string>([...lu.six.map((p) => p.id), ...(lu.libero ? [lu.libero.id] : [])]);
  const clk = (p: Player) => (healthy.has(p.id) || LU.inj.has(p.id)) ? ` data-pid="${p.id}" style="cursor:pointer" title="클릭: 부상 주입/복귀"` : '';
  const courtRows = lu.six.map((p, i) => `<tr${clk(p)}><td style="text-align:left;color:var(--soft)">${SLOT_KO[i]}</td>${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td class="pt">${ovrOf(p)}</td></tr>`).join('')
    + (lu.libero ? `<tr${clk(lu.libero)}><td style="text-align:left;color:var(--soft)">L · 리베로</td>${pcell('L')}<td class="nm">${esc(lu.libero.name)}</td><td class="pt">${ovrOf(lu.libero)}</td></tr>` : '');
  const CAUSE_COL: Record<string, string> = { injured: 'var(--warn)', suspended: 'var(--bad)', rested: 'var(--accent)', ownerBenched: 'var(--bad)', outclassed: 'var(--soft)', starter: 'var(--soft)' };
  const excl = getEvolvedTeamPlayers(LU.team, LU.day).filter((p) => !starterIds.has(p.id))
    .map((p) => {
      const injd = LU.inj.has(p.id);
      const cause = benchCauseOf(p, LU.team, LU.day);
      return { p, reason: injd ? '🚑 부상 (what-if 주입)' : rest.has(p.id) ? '휴식 (#3)' : SIT_CAUSE_KO[cause], col: injd ? 'var(--bad)' : rest.has(p.id) ? 'var(--accent)' : CAUSE_COL[cause] };
    }).sort((a, b) => overall(b.p) - overall(a.p));
  const exclRows = excl.map(({ p, reason, col }) => `<tr${clk(p)}>${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td>${ovrOf(p)}</td><td style="text-align:left;color:${col};font-weight:700">${reason}</td></tr>`).join('');
  const injNote = LU.inj.size ? ` · <b style="color:var(--bad)">what-if 부상 ${LU.inj.size}명 주입 중</b> (시즌·뉴스 탭에도 반영)` : '';
  $('out').innerHTML = `<div class="boxes">
    <div class="boxwrap"><h3>선발 — 코트 7인 (5-1 시스템)</h3><table class="box"><thead><tr><th style="text-align:left">슬롯</th><th>P</th><th>선수</th><th>OVR</th></tr></thead><tbody>${courtRows}</tbody></table>
      <p class="hint" style="margin-top:10px">6인은 로테이션 슬롯 순. 선수 클릭 = 시즌아웃 부상 주입 → 대체 선수 자동 등판(시즌 전체 파급).</p></div>
    <div class="boxwrap"><h3>제외 (${excl.length}명) · 사유</h3><table class="box"><thead><tr><th>P</th><th>선수</th><th>OVR</th><th style="text-align:left">사유</th></tr></thead><tbody>${exclRows || '<tr><td colspan="4" class="empty">전원 출전</td></tr>'}</tbody></table></div>
  </div><p class="hint">${esc(getTeam(LU.team)?.name ?? LU.team)} · day ${LU.day}${injNote}</p>`;
  $('out').querySelectorAll('[data-pid]').forEach((el) => el.addEventListener('click', () => toggleInj(el.getAttribute('data-pid')!, LU.team)));
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
  maybeHeavy($('d-run') as HTMLButtonElement, D.runs, `${D.runs.toLocaleString()}경기 분포 측정 중…`, () => {
  let kill = 0, stuff = 0, ace = 0, err = 0, total = 0;
  for (let i = 0; i < D.runs; i++) {
    const sim = simulateMatch(i + 1, A, B, opts);
    for (const pt of sim.points) { const h = (pt as any).how as string | undefined; if (!h) continue; total++; if (KILL.has(h)) kill++; else if (h === 'stuff') stuff++; else if (h === 'ace') ace++; else if (ERR.has(h)) err++; }
  }
  const row = (label: string, n: number, target: string, col: string) => `<tr><td style="text-align:left;color:${col};font-weight:700">${label}</td><td class="pt">${(n / total * 100).toFixed(1)}%</td><td>${n.toLocaleString()}</td><td style="color:var(--soft)">${target}</td></tr>`;
  $('out').innerHTML = `<table class="box" style="max-width:520px"><thead><tr><th style="text-align:left">득점 유형</th><th>비중</th><th>횟수</th><th>KOVO 목표</th></tr></thead><tbody>
    ${row('공격(킬)', kill, '~56%', 'var(--accent)')}${row('블로킹(스터프)', stuff, '~10%', '#8B7CF0')}${row('서브 에이스', ace, '~6%', 'var(--warn)')}${row('상대 범실', err, '~28%', 'var(--soft)')}</tbody></table>
    <p class="hint">${esc(getTeam(D.a)?.name ?? D.a)} vs ${esc(getTeam(D.b)?.name ?? D.b)} · ${D.runs}경기 · 총 ${total.toLocaleString()}득점</p>`;
  });
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
    // 재계약 3택(나이 적합 연수) — 외인은 트라이아웃 전용이라 제외
    const ro = p.isForeign ? '' : resignOptions(p, mv).map((o) => `${o.label[0]} ${(o.salary / 10000).toFixed(1)}·${o.years}`).join(' / ');
    return `<tr>${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td>${ovrOf(p)}</td><td>${p.age}</td><td>${pts}</td><td>${formatMoney(mv)}</td><td class="pt">${formatMoney(sal)}</td><td style="color:${col};font-weight:700">${(ratio * 100).toFixed(0)}%</td><td style="text-align:left;font-size:11px;color:var(--soft)">${ro}</td><td style="text-align:left">${tag}</td></tr>`;
  }).join('');
  const capCol = total > LEAGUE_CAP ? 'var(--bad)' : 'var(--good)';
  $('out').innerHTML = `<div class="stat-grid"><div class="stat"><span class="sv" style="color:${capCol}">${formatMoney(total)}</span><span class="sl">팀 총연봉 / 캡 ${formatMoney(LEAGUE_CAP)}</span></div></div><table class="box"><thead><tr><th>P</th><th>선수</th><th>OVR</th><th>나이</th><th>시즌득점</th><th>시장가치</th><th>연봉</th><th>연봉/시장</th><th style="text-align:left">재계약 3택(표/후/짧 억·년)</th><th style="text-align:left">비고</th></tr></thead><tbody>${body}</tbody></table><p class="hint">연봉/시장: 빨강 고평가(>115%)·초록 저평가(&lt;85%) · 재계약 3택=표준/후하게/짧게(노장은 후하게도 단기) · ${esc(getTeam(SAL.team)?.name ?? SAL.team)} day ${SAL.day}</p>`;
}

// ═══ 영입 · 드래프트 ═════════════════════════════════════════════════════
function mountDraft() {
  $('controls').innerHTML = `<div class="run-row"><button id="d-run">드래프트 클래스 생성 ▶</button></div><p class="hint">다음 시즌 신인 드래프트 클래스(엔진 생성). OVR·포텐셜(★) 순. 스카우팅 안개는 콘솔에선 전부 공개.</p>`;
  $('d-run').onclick = runDraft;
}

// ───────────────────────── 경기 중계 · 현수막(게이머 리뷰 — 상황중계·MVP·기록 현수막) ─────────────────────────
const BC: { a: string; b: string; seed: number; day: number } = { a: TEAMS[0].id, b: TEAMS[1].id, seed: 1, day: 164 };
const BANNER_EMOJI: Record<string, string> = { record: '📊', triple: '🎀', clinch: '✅', eliminated: '❌' };
const bannerHtml = (b: Banner) => `<div class="bcbanner" style="border-left-color:${b.tint}"><span class="bcicon">${BANNER_EMOJI[b.kind] ?? '•'}</span><span class="bctitle">${esc(b.title)}</span>${b.mine ? '<span class="bcmine">MY</span>' : ''}</div>`;
function mountBroadcast() {
  $('controls').innerHTML = `
    <div class="teams"><div class="team A"><span class="badge">A</span>${teamSelect('bc-a', BC.a)}</div><div class="vs">VS</div><div class="team B"><span class="badge">B</span>${teamSelect('bc-b', BC.b)}</div></div>
    <div class="run-row"><label>시드 <input type="number" id="bc-seed" value="${BC.seed}" style="width:64px" /></label><label>경기일(현수막 누적) <input type="number" id="bc-day" value="${BC.day}" min="0" max="164" style="width:64px" /></label>
      <button id="bc-run">경기 분석 ▶</button><button id="bc-season">시즌 현수막 스캔 ▶</button><button id="bc-sample">현수막 종류 미리보기</button><button id="bc-coin">5세트 코인토스 미리보기</button></div>
    <p class="hint">한 경기의 <b>경기 MVP</b> + <b>상황 인지 중계</b>(세트/매치포인트·듀스·연속) + <b>중계 현수막</b>(기록 경신·트리플 크라운·PO 확정/탈락).
      현수막은 통산 누적이 필요 → 경기일↑(시즌말) 또는 <b>"시즌 현수막 스캔"</b>(전 경기)으로 잘 보입니다.</p>`;
  ($('bc-a') as HTMLSelectElement).onchange = (e) => { BC.a = (e.target as HTMLSelectElement).value; };
  ($('bc-b') as HTMLSelectElement).onchange = (e) => { BC.b = (e.target as HTMLSelectElement).value; };
  ($('bc-seed') as HTMLInputElement).onchange = (e) => { BC.seed = +(e.target as HTMLInputElement).value || 1; };
  ($('bc-day') as HTMLInputElement).onchange = (e) => { BC.day = Math.max(0, Math.min(164, +(e.target as HTMLInputElement).value || 164)); };
  $('bc-run').onclick = runBroadcastMatch;
  $('bc-season').onclick = runBroadcastSeason;
  $('bc-sample').onclick = runBroadcastSamples;
  $('bc-coin').onclick = runCoinTossPreview;
}
function runCoinTossPreview() {
  // 5세트 코인토스 오버레이 미리보기(MATCH_SYSTEM v2.1) — 앱 RN 오버레이의 룩을 HTML로 재현. 양 결과(A/B 서브) 표시.
  const an = getTeam(BC.a)?.name ?? BC.a, bn = getTeam(BC.b)?.name ?? BC.b;
  const panel = (team: string) => `<div class="coin-overlay"><div class="coin-panel">`
    + `<div class="coin-head">🏐 5세트 · 결승</div><div class="coin-emoji">🪙</div>`
    + `<div class="coin-label">코인토스</div><div class="coin-result">▶ ${esc(team)} 서브로 시작</div></div></div>`;
  $('out').innerHTML = `<style>
      .coin-overlay{position:relative;display:flex;align-items:center;justify-content:center;background:rgba(8,12,20,0.62);border-radius:12px;padding:34px 10px;min-height:190px;flex:1;min-width:230px}
      .coin-panel{display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 30px;border-radius:18px;background:rgba(18,24,36,0.96);border:1.5px solid #10B9A6}
      .coin-head{color:#10B9A6;font-size:13px;font-weight:800;letter-spacing:1px}
      .coin-emoji{font-size:52px;animation:coinspin 0.95s cubic-bezier(0.2,0.7,0.3,1) infinite}
      .coin-label{color:#8A94A6;font-size:12px;font-weight:700}
      .coin-result{color:#fff;font-size:16px;font-weight:800}
      @keyframes coinspin{from{transform:perspective(600px) rotateY(0deg)}to{transform:perspective(600px) rotateY(1980deg)}}
    </style>
    <p class="hint">앱 경기 보드에서 <b>5세트(결승 세트) 시작 직전</b> 1회 뜨는 코인토스 오버레이(MATCH_SYSTEM v2.1). 실제는 ~0.8초 회전 후 사라지고 경기 시작. 코인 결과 = 엔진 <code>setFirstServers[4]</code>(보드가 그대로 반영 — 재도출 안 함). 아래는 두 가지 결과(미리보기는 무한 회전).</p>
    <h3 class="bch">🪙 5세트 코인토스 오버레이</h3>
    <div style="display:flex;gap:14px;flex-wrap:wrap">${panel(an)}${panel(bn)}</div>`;
}

// ─── 🏆 우승 화면 ───────────────────────────────────────────────────────────
// 우승 순간 축하 화면 목업 + 블롭 일러스트(SVG). 가운데 선수 = 우승팀 색(lib/teamColor — CLUB_IDENTITY 실제 구단 hue).
const CH = { team: TEAMS[0]?.id ?? '', season: 14 };
const champArt = (primary: string, arm: string, badge: string) => `
  <g opacity="0.92">
    <rect x="60" y="30" width="11" height="11" rx="2" fill="#10B9A6" transform="rotate(20 65 35)"/><rect x="330" y="46" width="11" height="11" rx="2" fill="#FF6B5A" transform="rotate(-15 335 51)"/>
    <rect x="120" y="20" width="9" height="9" rx="2" fill="#F2A93B" transform="rotate(30 124 24)"/><rect x="278" y="24" width="10" height="10" rx="2" fill="#3B82F6" transform="rotate(-25 283 29)"/>
    <circle cx="200" cy="16" r="4" fill="#FF6B5A"/><circle cx="352" cy="116" r="4" fill="#10B9A6"/><circle cx="46" cy="116" r="4" fill="#F2A93B"/>
  </g>
  <g fill="#FFD879"><path d="M200 32 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 z"/><path d="M250 66 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5 z"/><path d="M150 68 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5 z"/></g>
  <g>
    <rect x="190" y="146" width="20" height="14" rx="3" fill="#E0902A"/><rect x="176" y="158" width="48" height="9" rx="4" fill="#C9791C"/>
    <path d="M168 92 h64 v14 a32 26 0 0 1 -64 0 z" fill="url(#cg)"/><path d="M168 92 h64 v6 a32 10 0 0 1 -64 0 z" fill="#FFE49B"/>
    <path d="M168 96 a16 16 0 0 0 -16 16 a8 8 0 0 0 8 0 a10 10 0 0 1 8 -10 z" fill="#E0902A"/><path d="M232 96 a16 16 0 0 1 16 16 a8 8 0 0 1 -8 0 a10 10 0 0 0 -8 -10 z" fill="#E0902A"/>
    <rect x="194" y="116" width="12" height="32" rx="3" fill="#E0902A"/><path d="M200 106 l3 7 7.5 0.6 -5.7 5 1.8 7.3 -6.6 -4 -6.6 4 1.8 -7.3 -5.7 -5 7.5 -0.6 z" fill="#FFF3D0"/>
  </g>
  <ellipse cx="200" cy="296" rx="150" ry="16" fill="#10B9A6" opacity="0.10"/>
  <g><ellipse cx="112" cy="293" rx="34" ry="10" fill="#000" opacity="0.07"/>
    <path d="M96 188 a16 16 0 0 1 -10 -14 a7 7 0 0 1 13 -3 z" fill="#FF8475"/><path d="M128 188 a16 16 0 0 0 10 -14 a7 7 0 0 0 -13 -3 z" fill="#FF8475"/>
    <rect x="86" y="196" width="52" height="92" rx="26" fill="#FF6B5A"/><ellipse cx="100" cy="214" rx="8" ry="11" fill="#fff" opacity="0.35"/></g>
  <g><ellipse cx="288" cy="293" rx="32" ry="9" fill="#000" opacity="0.07"/>
    <path d="M304 192 a15 15 0 0 0 9 -13 a6.5 6.5 0 0 0 -12 -3 z" fill="#F6BC5C"/>
    <rect x="266" y="206" width="48" height="84" rx="24" fill="#F2A93B"/><ellipse cx="279" cy="222" rx="7" ry="10" fill="#fff" opacity="0.35"/></g>
  <g><ellipse cx="200" cy="295" rx="40" ry="11" fill="#000" opacity="0.09"/>
    <path d="M176 174 a18 20 0 0 1 6 -24 l11 7 a10 12 0 0 0 -4 16 z" fill="${arm}"/><path d="M224 174 a18 20 0 0 0 -6 -24 l-11 7 a10 12 0 0 1 4 16 z" fill="${arm}"/>
    <rect x="162" y="168" width="76" height="124" rx="38" fill="${primary}"/><ellipse cx="182" cy="192" rx="11" ry="15" fill="#fff" opacity="0.34"/>
    <circle cx="200" cy="236" r="21" fill="${badge}"/><path d="M200 226 l0 20 M196 228 l4 -2" stroke="#fff" stroke-width="3.6" stroke-linecap="round" fill="none"/></g>
  <g><circle cx="62" cy="262" r="20" fill="#fff" stroke="#D7DEE6" stroke-width="1.5"/>
    <path d="M62 242 a20 20 0 0 1 17 10 M62 282 a20 20 0 0 1 -17 -10 M48 250 a26 26 0 0 0 6 26" stroke="#10B9A6" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>`;
// 우승 화면 전체를 단일 SVG로(목업 + 일러스트) — sim-web 임베드 + PNG 렌더 동일 소스.
function champScreenSvg(): string {
  const name = getTeam(CH.team)?.name ?? CH.team;
  const h = teamHue(CH.team);
  const primary = `hsl(${h},60%,47%)`, arm = `hsl(${h},60%,39%)`, badge = `hsl(${h},52%,31%)`;
  return `<svg viewBox="0 0 380 500" width="100%" style="max-width:360px" xmlns="http://www.w3.org/2000/svg" font-family="'Pretendard',sans-serif">
    <defs>
      <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD879"/><stop offset="1" stop-color="#F2A93B"/></linearGradient>
      <radialGradient id="bgc" cx="50%" cy="0%" r="120%"><stop offset="0" stop-color="hsl(${h},45%,18%)"/><stop offset="0.7" stop-color="#0b1320"/></radialGradient>
    </defs>
    <rect x="0" y="0" width="380" height="500" rx="26" fill="url(#bgc)"/>
    <text x="190" y="34" text-anchor="middle" fill="#FFD879" font-size="12" font-weight="800" letter-spacing="2">🏆 챔피언 결정전 우승</text>
    <g transform="translate(30,46) scale(0.8)">${champArt(primary, arm, badge)}</g>
    <text x="190" y="352" text-anchor="middle" fill="#fff" font-size="27" font-weight="900">${esc(name)}</text>
    <text x="190" y="378" text-anchor="middle" fill="hsl(${h},70%,72%)" font-size="15" font-weight="800">${CH.season + 1}시즌 챔피언</text>
    <text x="190" y="404" text-anchor="middle" fill="#9fb0c4" font-size="12">챔프전 MVP · 서지아  ·  정규리그 1위 → 통합 우승</text>
    <rect x="125" y="424" width="130" height="40" rx="20" fill="#FFD879"/>
    <text x="190" y="449" text-anchor="middle" fill="#3a2a08" font-size="13" font-weight="800">시즌 마무리 →</text>
  </svg>`;
}
// 시상식 MVP 트로피 일러스트(블롭 제거 — 트로피만, AwardIllustration과 동일 마크업). AWARDS_SYSTEM §6.
const trophyArt = () => `
  <g fill="#FFD879"><path d="M100 8 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z"/><path d="M52 36 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z"/><path d="M148 36 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z"/></g>
  <g><rect x="90" y="80" width="20" height="14" rx="3" fill="#E0902A"/><rect x="74" y="92" width="52" height="10" rx="4" fill="#C9791C"/>
    <path d="M68 26 h64 v14 a32 26 0 0 1 -64 0 z" fill="url(#tg)"/><path d="M68 26 h64 v6 a32 10 0 0 1 -64 0 z" fill="#FFE49B"/>
    <path d="M68 30 a16 16 0 0 0 -16 16 a8 8 0 0 0 8 0 a10 10 0 0 1 8 -10 z" fill="#E0902A"/><path d="M132 30 a16 16 0 0 1 16 16 a8 8 0 0 1 -8 0 a10 10 0 0 0 -8 -10 z" fill="#E0902A"/>
    <rect x="94" y="50" width="12" height="32" rx="3" fill="#E0902A"/><path d="M100 40 l3 7 7.5 0.6 -5.7 5 1.8 7.3 -6.6 -4 -6.6 4 1.8 -7.3 -5.7 -5 7.5 -0.6 z" fill="#FFF3D0"/></g>`;
function mvpScreenSvg(): string {
  const name = getTeam(CH.team)?.name ?? CH.team;
  const h = teamHue(CH.team);
  return `<svg viewBox="0 0 240 220" width="100%" style="max-width:220px" xmlns="http://www.w3.org/2000/svg" font-family="'Pretendard',sans-serif">
    <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD879"/><stop offset="1" stop-color="#F2A93B"/></linearGradient>
      <radialGradient id="mbg" cx="50%" cy="0%" r="120%"><stop offset="0" stop-color="hsl(${h},45%,18%)"/><stop offset="0.7" stop-color="#0b1320"/></radialGradient></defs>
    <rect x="0" y="0" width="240" height="220" rx="22" fill="url(#mbg)"/>
    <text x="120" y="30" text-anchor="middle" fill="#FFD879" font-size="11" font-weight="800" letter-spacing="2">🏆 시즌 MVP</text>
    <g transform="translate(20,40)">${trophyArt()}</g>
    <text x="120" y="184" text-anchor="middle" fill="#fff" font-size="20" font-weight="900">서지아</text>
    <text x="120" y="206" text-anchor="middle" fill="hsl(${h},70%,72%)" font-size="12" font-weight="700">${esc(name)}</text>
  </svg>`;
}
function mountChamp() {
  $('controls').innerHTML = `<div class="run-row"><label>우승팀 ${teamSelect('ch-team', CH.team)}</label>
    <label>시즌 <input type="number" id="ch-season" value="${CH.season}" min="0" style="width:56px" /></label>
    <button id="ch-run">우승 화면 ▶</button></div>
    <p class="hint">왼쪽 = 우승 축하 화면(블롭 3인+큰 컵), 오른쪽 = <b>시상식 MVP</b> 목업(트로피만). 카드 배경·시즌 텍스트가 <b>MVP 팀 색</b>(CLUB_IDENTITY 실제 구단 hue). 팀을 바꿔보면 그 구단 시그니처 색이 따라옵니다. 일러스트는 <b>벡터(react-native-svg)</b>라 앱에선 어떤 해상도에서도 선명.</p>`;
  ($('ch-team') as HTMLSelectElement).onchange = (e) => { CH.team = (e.target as HTMLSelectElement).value; runChamp(); };
  ($('ch-season') as HTMLInputElement).onchange = (e) => { CH.season = Math.max(0, +(e.target as HTMLInputElement).value || 0); runChamp(); };
  $('ch-run').onclick = runChamp;
  runChamp();
}
function runChamp() { $('out').innerHTML = `<div style="display:flex;gap:18px;flex-wrap:wrap;justify-content:center;align-items:flex-start">${champScreenSvg()}${mvpScreenSvg()}</div>`; }

function runBroadcastSamples() {
  // 4종 현수막 시각 미리보기 — 통산 기록 경신은 누적이 필요해 실경기 1시즌엔 잘 안 떠 샘플로 보여준다.
  const samp: Banner[] = [
    { kind: 'record', tint: '#3B82F6', icon: 'stats-chart', mine: true, title: '타이샤 통산 4,000점 돌파!' },
    { kind: 'record', tint: '#3B82F6', icon: 'stats-chart', mine: false, title: '브랑카 통산 블로킹 1,000개 돌파!' },
    { kind: 'triple', tint: '#8B5CF6', icon: 'ribbon', mine: false, title: '조지윤 트리플 크라운! 후위공격 4·블로킹 3·서브 4' },
    { kind: 'clinch', tint: '#16B07D', icon: 'checkmark-circle', mine: true, title: '타이드 플레이오프 확정!' },
    { kind: 'eliminated', tint: '#FF6B5A', icon: 'close-circle', mine: false, title: '코메츠 플레이오프 탈락' },
  ];
  $('out').innerHTML = `<p class="hint">앱 경기 보드 하단에 뜨는 <b>중계 현수막</b> 4종(BROADCAST_SYSTEM). MY=내 팀 강조. 통산 기록 경신은 누적이 필요해 실경기 1시즌엔 드물어 샘플로 표시.</p>`
    + `<h3 class="bch">📊 기록 경신 · 🎀 트리플 크라운 · ✅ PO 확정 · ❌ 탈락</h3>` + samp.map(bannerHtml).join('');
}
function runBroadcastMatch() {
  const { a, b, seed, day } = BC;
  const { homeSquad, awaySquad, sim, box } = buildMatchBox(a, b, day, seed);
  const rallies = reconstructRallies(sim);
  const aName = getTeam(a)?.name ?? a, bName = getTeam(b)?.name ?? b;
  const sit: string[] = [];
  for (let i = 0; i < rallies.length; i++) { const f = situationFeed(rallies, i, aName, bName); if (f.pre) sit.push(f.pre); if (f.post) sit.push(f.post); }
  const mvp = matchMvp(box, homeSquad, awaySquad, sim, aName, bName);
  const banners = buildMatchBanners(a, b, day, null);
  const mvpHtml = mvp ? `<div class="bcmvp"><span class="bcmvpbadge">MVP</span> <b>${esc(mvp.name)}</b> ${mvp.points}득점${mvp.blocks ? ` · 블록 ${mvp.blocks}` : ''}${mvp.aces ? ` · 서브 ${mvp.aces}` : ''}${mvp.digs ? ` · 디그 ${mvp.digs}` : ''}<div class="bcrecap">${esc(mvp.line)}</div></div>` : '<div class="empty">MVP 없음</div>';
  const sitHtml = sit.length ? sit.map((s) => `<div class="bcsit">${esc(s)}</div>`).join('') : '<div class="empty">상황 멘트 없음(접전·연속 미발생)</div>';
  const bansHtml = banners.length ? banners.map(bannerHtml).join('') : '<div class="empty">이 경기 현수막 없음(경기일↑ 또는 시즌 스캔으로)</div>';
  $('out').innerHTML = `<div class="stat-grid"><div class="stat"><span class="sv">${esc(aName)} ${sim.homeSets} : ${sim.awaySets} ${esc(bName)}</span><span class="sl">세트 스코어 · 시드 ${seed} · day ${day}</span></div></div>`
    + `<h3 class="bch">🏅 경기 MVP</h3>${mvpHtml}`
    + `<h3 class="bch">📢 중계 현수막 (${banners.length})</h3>${bansHtml}`
    + `<h3 class="bch">🎙 상황 인지 중계 (${sit.length}줄)</h3><div class="bcsitwrap">${sitHtml}</div>`;
}
function runBroadcastSeason() {
  const all: Banner[] = [];
  const cnt: Record<string, number> = { record: 0, triple: 0, clinch: 0, eliminated: 0 };
  for (const f of SEASON) for (const ban of buildMatchBanners(f.homeTeamId, f.awayTeamId, f.dayIndex, null)) { all.push(ban); cnt[ban.kind] = (cnt[ban.kind] ?? 0) + 1; }
  const body = all.slice(0, 150).map(bannerHtml).join('');
  $('out').innerHTML = `<div class="stat-grid"><div class="stat"><span class="sv">${all.length}</span><span class="sl">시즌 전체 현수막</span></div></div>`
    + `<p class="hint">기록 경신 ${cnt.record} · 트리플 크라운 ${cnt.triple} · PO 확정 ${cnt.clinch} · 탈락 ${cnt.eliminated} (현 리그 1시즌 전 경기 스캔, 결정론)</p>`
    + `<div class="bcsitwrap">${body || '<div class="empty">현수막 없음(시즌 초·누적 부족)</div>'}</div>`;
}

// ───────────────────────── 드래프트 라이브(순위 설정 + 한 픽씩 진행 + AI 사유) ─────────────────────────
const REASON_KO: Record<PickReason, { ko: string; cls: string }> = {
  super: { ko: '특급 BPA', cls: 'r-super' }, need: { ko: '포지션 필요', cls: 'r-need' },
  best: { ko: 'OVR+성격', cls: 'r-best' }, wish: { ko: '지명', cls: 'r-wish' },
};
const DL: { ranking: string[]; holes: number; lottery: boolean; seed: number; auto: boolean;
  seq: { teamId: string; player: Player; reason: PickReason; round: number }[]; revealed: number; timer: number } = {
  ranking: [], holes: 2, lottery: false, seed: 1, auto: false, seq: [], revealed: 0, timer: 0,
};
function dlInitRanking() {
  if (DL.ranking.length) return;
  const st = computeStandings(Number.MAX_SAFE_INTEGER);
  DL.ranking = st.length ? st.map((s) => s.teamId) : LEAGUE.teams.map((t) => t.id); // 1위→꼴찌
}
function mountDraftLive() {
  if (DL.timer) { clearInterval(DL.timer); DL.timer = 0; DL.auto = false; }
  dlInitRanking();
  $('controls').innerHTML = `
    <div class="run-row">
      <label>팀당 빈자리(지명권) <input type="number" id="dl-holes" value="${DL.holes}" min="1" max="6" style="width:54px" /></label>
      <label><input type="checkbox" id="dl-lot" ${DL.lottery ? 'checked' : ''} /> 추첨(하위 가중)</label>
      <label>시드 <input type="number" id="dl-seed" value="${DL.seed}" style="width:64px" /></label>
      <button id="dl-run">드래프트 진행 ▶</button>
    </div>
    <p class="hint">각 순위에 팀을 배치(▲▼) → 하위 팀이 앞 순번. <b>추첨 끄면 순위 그대로</b>(결정론), 켜면 하위 가중 추첨.
      AI 픽 사유: <span class="rbadge r-super">특급 BPA</span>(포텐≥88 무조건) · <span class="rbadge r-need">포지션 필요</span>(부족 자리) ·
      <span class="rbadge r-best">OVR+성격</span>(부족 없을 때). 빈자리는 각 팀 최저 OVR을 비워 만든 테스트용.</p>
    <div id="dl-rank" class="dl-rank"></div>`;
  ($('dl-holes') as HTMLInputElement).onchange = (e) => { DL.holes = Math.max(1, Math.min(6, +(e.target as HTMLInputElement).value || 2)); };
  ($('dl-lot') as HTMLInputElement).onchange = (e) => { DL.lottery = (e.target as HTMLInputElement).checked; };
  ($('dl-seed') as HTMLInputElement).onchange = (e) => { DL.seed = +(e.target as HTMLInputElement).value || 1; };
  $('dl-run').onclick = runDraftLive;
  renderRankEditor();
  if (DL.seq.length) renderDLBoard(); else $('out').innerHTML = `<p class="hint">순위를 정하고 "드래프트 진행 ▶"을 눌러줘.</p>`;
}
function renderRankEditor() {
  const rows = DL.ranking.map((tid, i) => `<div class="dl-rrow"><span class="dl-rk">${i + 1}위</span><span class="dl-tm">${esc(getTeam(tid)?.name ?? tid)}</span>`
    + `<button class="dl-mv" data-mv="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>`
    + `<button class="dl-mv" data-mv="dn" data-i="${i}" ${i === DL.ranking.length - 1 ? 'disabled' : ''}>▼</button></div>`).join('');
  $('dl-rank').innerHTML = rows;
  document.querySelectorAll('.dl-mv').forEach((b) => b.addEventListener('click', () => {
    const i = +b.getAttribute('data-i')!; const dir = b.getAttribute('data-mv') === 'up' ? -1 : 1; const j = i + dir;
    if (j < 0 || j >= DL.ranking.length) return;
    [DL.ranking[i], DL.ranking[j]] = [DL.ranking[j], DL.ranking[i]]; renderRankEditor();
  }));
}
function runDraftLive() {
  if (DL.timer) { clearInterval(DL.timer); DL.timer = 0; DL.auto = false; }
  const ctx = buildDraftContext('', {}, {}, [], false, [], 1);
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  // 빈자리 만들기: 각 팀 최저 OVR DL.holes명 제거 → 실제 포지션 부족 생성(테스트용)
  const rosters: Record<string, string[]> = {};
  const holes: Record<string, number> = {};
  for (const tid of DL.ranking) {
    const cur = [...(ctx.rosters[tid] ?? [])].sort((a, b) => overall(ctx.snapshot[a]) - overall(ctx.snapshot[b]));
    rosters[tid] = cur.slice(DL.holes); // 최저 DL.holes명 제외
    holes[tid] = DL.holes;
  }
  const total = DL.holes * DL.ranking.length;
  const cls = generateDraftClass(2, total + 12); // 충분한 클래스(특급 일부 포함)
  const clsById = new Map(cls.map((p) => [p.id, p]));
  const get = (id: string) => ctx.snapshot[id] ?? clsById.get(id);
  const worstFirst = [...DL.ranking].reverse(); // 꼴찌가 앞 순번
  const r1 = DL.lottery ? lotteryRound1(worstFirst, createRng(DL.seed)) : worstFirst;
  const order = buildDraftOrder(r1); // KOVO 4라운드제(FA_SYSTEM §3.0) — 팀당 지명/패스는 resolveDraft가 판정
  const res = resolveDraft(order, cls, rosters, get, '', [], styleOf, undefined, [], aiTargetOf());
  const seen: Record<string, number> = {};
  DL.seq = res.sequence.map((s) => { seen[s.teamId] = (seen[s.teamId] ?? 0) + 1; return { teamId: s.teamId, player: clsById.get(s.playerId)!, reason: s.reason, round: seen[s.teamId] }; });
  DL.revealed = 0;
  renderDLBoard();
}
function renderDLBoard() {
  const total = DL.seq.length;
  const shown = DL.seq.slice(0, DL.revealed);
  const cnt = { super: 0, need: 0, best: 0, wish: 0 } as Record<PickReason, number>;
  for (const s of shown) cnt[s.reason]++;
  const rowHtml = shown.map((s, i) => {
    const p = s.player; const rb = REASON_KO[s.reason]; const last = i === shown.length - 1;
    const why = s.reason === 'need' ? `${rb.ko} (${p.position})` : rb.ko;
    return `<tr class="${last ? 'dl-last' : ''}"><td class="dl-pk">${s.round}R·${i + 1}</td><td class="dl-tn">${esc(shortTeamName(s.teamId))}</td>`
      + `${pcell(p.position)}<td class="nm">${esc(p.name)}</td><td class="pt">${ovrOf(p)}</td><td style="color:var(--warn)">${potStars(p)}</td>`
      + `<td><span class="rbadge ${rb.cls}">${why}</span></td></tr>`;
  }).join('');
  const ctrl = `<div class="run-row" style="margin-bottom:8px">
      <button id="dl-next" ${DL.revealed >= total ? 'disabled' : ''}>다음 픽 ▶</button>
      <button id="dl-auto">${DL.auto ? '⏸ 정지' : '▶ 자동'}</button>
      <button id="dl-all" ${DL.revealed >= total ? 'disabled' : ''}>전체 공개 ⏭</button>
      <button id="dl-rst" style="background:var(--bad)">처음으로</button>
      <span class="dl-prog">${DL.revealed} / ${total} 픽</span></div>`;
  const summary = `<p class="hint">사유: <span class="rbadge r-super">특급 ${cnt.super}</span> <span class="rbadge r-need">필요 ${cnt.need}</span> <span class="rbadge r-best">OVR성격 ${cnt.best}</span>${cnt.wish ? ` <span class="rbadge r-wish">지명 ${cnt.wish}</span>` : ''} · ${DL.lottery ? `추첨(시드 ${DL.seed})` : '순위 그대로'}</p>`;
  $('out').innerHTML = ctrl + `<table class="box dl-tbl"><thead><tr><th>픽</th><th>팀</th><th>P</th><th>선수</th><th>OVR</th><th>포텐</th><th style="text-align:left">사유</th></tr></thead><tbody>${rowHtml || '<tr><td colspan="7" class="empty">다음 픽 ▶ 또는 자동 재생</td></tr>'}</tbody></table>` + summary;
  const step = () => { if (DL.revealed < total) { DL.revealed++; renderDLBoard(); } };
  ($('dl-next') as HTMLButtonElement).onclick = step;
  ($('dl-all') as HTMLButtonElement).onclick = () => { if (DL.timer) { clearInterval(DL.timer); DL.timer = 0; DL.auto = false; } DL.revealed = total; renderDLBoard(); };
  ($('dl-rst') as HTMLButtonElement).onclick = () => { if (DL.timer) { clearInterval(DL.timer); DL.timer = 0; DL.auto = false; } DL.revealed = 0; renderDLBoard(); };
  ($('dl-auto') as HTMLButtonElement).onclick = () => {
    if (DL.auto) { clearInterval(DL.timer); DL.timer = 0; DL.auto = false; renderDLBoard(); return; }
    DL.auto = true; DL.timer = window.setInterval(() => { if (DL.revealed >= total) { clearInterval(DL.timer); DL.timer = 0; DL.auto = false; renderDLBoard(); } else step(); }, 320);
    renderDLBoard();
  };
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
