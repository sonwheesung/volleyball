// 초기 FA 풀 가드 (TRANSACTION_SYSTEM §5c) — 게임 시작 시드 FA 검증.
//   구조(밴드·포지션·해석·결정론) + 무결성 스윕(teamless 순회) + 밸런스 A/B(N≥10,000, 추정 금지).
//
//   npx tsx tools/_dv_initfa.ts
//
// 왜: "초반 FA 풀이 비어 영입 불가" 해소로 잉여 국내 FA를 시드. 표시 OVR 70~80대(원시 ~60~69).
//   리뷰 필수건 = 구조 검증만으론 부족 → "쓸어담으면 밸런스 깨지나"를 실측(N≥1만). GOLDEN 불변은 _dv_golden이 별도 확인.
import {
  LEAGUE, getPlayer, evolveOnDay, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase,
} from '../data/league';
import { generateInitialFAs, INITIAL_FA_IDS } from '../data/seed';
import { overallRaw, displayOvr, teamOverallRaw } from '../engine/overall';
import { computeStandings } from '../data/standings';
import { simulateMatch } from '../engine/match';
import type { Player, Position } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

resetLeagueBase();

// ── A. 구조 ──────────────────────────────────────────────────────────────
log('A. 구조');
const fas = INITIAL_FA_IDS.map((id) => getPlayer(id)).filter((p): p is Player => !!p);
check('A1 풀 크기 ≥ 8 · 전 id playerMap 해석', fas.length >= 8 && fas.length === INITIAL_FA_IDS.length,
  `${fas.length}/${INITIAL_FA_IDS.length}명`);

const evolvedOk = INITIAL_FA_IDS.every((id) => evolveOnDay(id, 0) !== undefined);
check('A2 전 id evolveOnDay(day0) ≠ undefined', evolvedOk);

const disp = fas.map((p) => displayOvr(overallRaw(p)));
const bandOk = disp.every((d) => d >= 70 && d <= 80);
check('A3 표시 OVR 전원 [70,80]', bandOk, `표시=${disp.join(',')}`);

const posSet = new Set(fas.map((p) => p.position));
const allPos: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
check('A4 포지션 스프레드(5종 전부)', allPos.every((p) => posSet.has(p)), [...posSet].join(','));

const noForeign = fas.every((p) => !p.isForeign);
check('A5 전원 국내(외인 아님)', noForeign);

// A6 teamless — 어떤 팀 로스터에도 없음(GOLDEN 픽스처=팀 로스터 무섭동의 근거)
const rosterIds = new Set(LEAGUE.teams.flatMap((t) => t.players));
const teamless = INITIAL_FA_IDS.every((id) => !rosterIds.has(id));
check('A6 전원 팀 미배정(로스터 밖 → GOLDEN 픽스처 불변)', teamless);

// A7 결정론 — 두 번 생성 = 동일(id·이름·핵심 스탯)
const sig = (ps: Player[]) => ps.map((p) => `${p.id}:${p.name}:${p.position}:${p.skSpike},${p.skBlock},${p.skDig},${p.skReceive},${p.skSet},${p.skServe},${p.focus},${p.consistency}`).join('|');
const det = sig(generateInitialFAs()) === sig(generateInitialFAs());
check('A7 결정론(두 번 생성 동일)', det);

// A8 재로드 생존 — 시즌0 playerBase=null → resetLeagueBase(시드) 후에도 해석
resetLeagueBase();
const survive = INITIAL_FA_IDS.every((id) => evolveOnDay(id, 0) !== undefined);
check('A8 시즌0 재로드(resetLeagueBase) 후 풀 생존', survive);

// ── B. 무결성 스윕 — teamless FA 존재 상태로 시즌0 산출이 crash/NaN 없이 완주 ──
log('B. 무결성 스윕 (teamless 순회 안전)');
let sweepOk = true;
let sweepDetail = '';
try {
  // 전역 LEAGUE.players 순회가 phantom(teamId 없음)에서 안 터지는지 — 대표 경로들 실행
  resetLeagueBase();
  // (a) 팀 전력(로스터 기반) — teamless 무영향이어야
  const ovrs = LEAGUE.teams.map((t) => teamOverallRaw(getEvolvedTeamPlayers(t.id, 0)));
  if (ovrs.some((o) => !Number.isFinite(o))) { sweepOk = false; sweepDetail = 'teamOverallRaw NaN'; }
  // (b) 순위 계산(day0, 결과 없음) — 팀 수 정확히 LEAGUE.teams(teamless 미포함)
  const st = computeStandings(0);
  if (st.length !== LEAGUE.teams.length) { sweepOk = false; sweepDetail = `standings ${st.length}≠${LEAGUE.teams.length}`; }
  // (c) 라운드로빈 1주기 시뮬 — 산출 스코어 유효(NaN·음수 없음)
  const ids = LEAGUE.teams.map((t) => t.id);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const sim = simulateMatch(700000 + i * 10 + j, getEvolvedTeamPlayers(ids[i], 0), getEvolvedTeamPlayers(ids[j], 0),
      { home: coachInfoOf(ids[i]), away: coachInfoOf(ids[j]) });
    if (!Number.isFinite(sim.homeSets) || !Number.isFinite(sim.awaySets) || sim.homeSets + sim.awaySets < 3) {
      sweepOk = false; sweepDetail = `sim ${ids[i]}v${ids[j]} 스코어 이상`;
    }
  }
} catch (e) {
  sweepOk = false; sweepDetail = `throw: ${(e as Error).message}`;
}
check('B1 시즌0 순위·전력·라운드로빈 완주(crash/NaN 0)', sweepOk, sweepDetail);

// ── C. 밸런스 A/B (N≥10,000) — 초기 FA 최대 영입 시 승률 Δ 실측 ──
log('C. 밸런스 A/B (N≥10,000 · 추정 금지)');
resetLeagueBase();
const initFAs = INITIAL_FA_IDS.map((id) => evolveOnDay(id, 0)).filter((p): p is Player => !!p);
const teamOvr = LEAGUE.teams.map((t) => ({ id: t.id, ovr: teamOverallRaw(getEvolvedTeamPlayers(t.id, 0)) }));
teamOvr.sort((a, b) => b.ovr - a.ovr);
const strong = teamOvr[0].id;                       // 최강팀 — 초기 FA가 선발 못 뚫어야(Δ≈0)
const weak = teamOvr[teamOvr.length - 1].id;        // 최약팀 — 업그레이드 신호 기대

/** T가 상대 전원과 M시드씩 붙는 승률. augment=true면 로스터에 초기 FA 합류(감독 buildLineup이 최적 선발). */
function winRate(teamId: string, augment: boolean, seeds: number): { wr: number; n: number } {
  const base = getEvolvedTeamPlayers(teamId, 0);
  const roster = augment ? [...base, ...initFAs] : base;
  const opps = LEAGUE.teams.map((t) => t.id).filter((id) => id !== teamId);
  let win = 0, n = 0;
  for (const opp of opps) {
    const oppPl = getEvolvedTeamPlayers(opp, 0);
    for (let s = 0; s < seeds; s++) {
      const sim = simulateMatch(910000 + s, roster, oppPl, { home: coachInfoOf(teamId), away: coachInfoOf(opp) });
      if (sim.homeSets > sim.awaySets) win++;
      n++;
    }
  }
  return { wr: win / n, n };
}

const SEEDS = 2000; // 6 상대 × 2000 = 12,000경기/조건 (≥1만)
// C0 비공허 오라클: augment=false 두 번 = Δ 정확히 0(같은 입력 → 결정론 승률 동일)
const ctrlA = winRate(weak, false, 300);
const ctrlB = winRate(weak, false, 300);
check('C0 오라클 비공허(무증강 A==B, Δ=0 결정론)', ctrlA.wr === ctrlB.wr, `${ctrlA.wr.toFixed(4)} vs ${ctrlB.wr.toFixed(4)}`);

const weakBase = winRate(weak, false, SEEDS);
const weakAug = winRate(weak, true, SEEDS);
const strongBase = winRate(strong, false, SEEDS);
const strongAug = winRate(strong, true, SEEDS);
const dWeak = weakAug.wr - weakBase.wr;
const dStrong = strongAug.wr - strongBase.wr;

log(`  · 최약팀(${weak}) N=${weakBase.n}: 기본 ${(weakBase.wr * 100).toFixed(1)}% → 증강 ${(weakAug.wr * 100).toFixed(1)}% (Δ ${(dWeak * 100).toFixed(1)}%p)`);
log(`  · 최강팀(${strong}) N=${strongBase.n}: 기본 ${(strongBase.wr * 100).toFixed(1)}% → 증강 ${(strongAug.wr * 100).toFixed(1)}% (Δ ${(dStrong * 100).toFixed(1)}%p)`);

// C1 표본 ≥ 10,000
check('C1 표본 ≥ 10,000/조건', weakBase.n >= 10000 && strongBase.n >= 10000, `N=${weakBase.n}`);
// C2 영입은 해롭지 않음(Δ ≥ -1%p 잡음 허용) — 벤치 옵션이라 최소 0
check('C2 증강이 해롭지 않음(Δ ≥ -1%p)', dWeak >= -0.01 && dStrong >= -0.01);
// C3 밸런스 sanity — 쓸어담기 상한 승률 상승이 게임파괴(+20%p) 아님
check('C3 밸런스 sanity(Δ ≤ +20%p, 게임파괴 아님)', dWeak <= 0.20 && dStrong <= 0.20, `weakΔ=${(dWeak * 100).toFixed(1)}·strongΔ=${(dStrong * 100).toFixed(1)}`);
// C4 강팀 Δ가 약팀 Δ 이하 — 원시 60~69는 약한 포지션만 메움(강팀 선발 못 뚫음)
check('C4 강팀 Δ ≤ 약팀 Δ(뎁스 논리 — 강팀 이득 적음)', dStrong <= dWeak + 0.01, `strong ${(dStrong * 100).toFixed(1)} ≤ weak ${(dWeak * 100).toFixed(1)}`);

log('');
log(fails === 0 ? '✅ PASS — 초기 FA 풀 구조·무결성·밸런스 전건 통과' : `❌ FAIL — ${fails}건`);
process.exit(fails === 0 ? 0 : 1);
