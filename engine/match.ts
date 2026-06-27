// 세트/경기 진행 (CLAUDE.md 4.4, MATCH_SYSTEM 7·8장).
// 1~4세트 25점, 5세트 15점, 모두 듀스(2점차). 5세트 3선승. 랠리포인트제.
// 매 세트 서브권 시작 팀 교대. 사이드아웃 시 회전(1.1) + 기세 갱신(7.2) + 타임아웃(7.4).
// playRally를 돌려 SimResult(간이 시뮬과 동일 계약)를 출력 → 드롭인 교체 가능.

import type { Player, Side, CoachStyle, SubPolicy } from '../types';
import type { SimResult, PointLog, SubEvent, TimeoutEvent, TimeoutCourtStam } from './simMatch';
import type { Ratings } from './ratings';
import { createRng, strSeed } from './rng';
import { deriveRatings } from './ratings';
import { buildLineup } from './lineup';
import { playRally, momFactor, STAM_REGEN_BASE, type RallyTeam, type Edge, type RallyStats, type PosStats, type BoxSink } from './rally';
import type { RallyEvent } from './events';
import { rotate, serverIndex, frontRow, backRow } from './rotation';

// 경기 시뮬 결과 버전 — rally/match/simMatch/ratings 등 *경기 결과를 바꾸는* 엔진 변경 시 +1.
// REALTIME_SIM Phase2(G3): simCache는 이 버전을 태깅·게이트해, 엔진 재튜닝(앱 업데이트) 후 저장된 옛-엔진
// 순위를 폐기하고 새 엔진으로 재계산한다 → 저장 순위 ↔ 과거경기 보드 재생 일관성 보장.
export const ENGINE_VERSION = 1;

// 작전 교체 (MATCH_SYSTEM 1.3b)
const SUBS_PER_SET = 6;          // 세트당 정규 교체 횟수(리베로 교체는 별도)
const PINCH_SERVE_GAP = 12;      // 핀치 서버: 벤치-선발 서브 레이팅 차 임계
const BLOCK_SUB_GAP = 12;        // 블로킹 강화: 벤치-전위 블록 레이팅 차 임계
const DEF_SUB_GAP = 12;          // 수비 강화: 벤치-후위 리시브 레이팅 차 임계
const DEFAULT_POLICY: SubPolicy = { pinchServer: true, blockSub: true, defSub: true };

export function targetPoints(setNo: number): number {
  return setNo >= 5 ? 15 : 25;
}

export function isSetOver(home: number, away: number, setNo: number): boolean {
  const target = targetPoints(setNo);
  return (home >= target || away >= target) && Math.abs(home - away) >= 2;
}

const START_MOMENTUM = 50;
const TIMEOUTS_PER_SET = 2;
// 감독 성향별 타임아웃 호출 임계(상대 연속득점 수). 수비형은 일찍, 공격형은 늦게(아낀다)
const TO_THRESHOLD: Record<CoachStyle, number> = { defense: 3, balanced: 4, attack: 5 };
const TIMEOUT_REST = 0.04; // 타임아웃 휴식 회복(7.1·7.4) — 양 팀 모두 쉰다(차이는 기세 수렴이 만듦)
const TIRED_STAM = 0.5;    // 코트에 이 미만으로 퍼진 선수가 있으면 감독이 타임아웃을 한 박자 일찍 부른다

export interface CoachInfo { style: CoachStyle; charisma: number }
export interface MatchOpts {
  edge?: Edge; home?: CoachInfo; away?: CoachInfo; stats?: RallyStats; trace?: string[]; pos?: PosStats;
  homePolicy?: SubPolicy; awayPolicy?: SubPolicy; // 작전 교체 방침(미지정 시 기본)
  events?: RallyEvent[]; // 공간 텔레메트리 싱크(있으면 랠리별 독립 srng로 좌표 이벤트 누적; 승패 불변)
  box?: BoxSink; // 선수별 박스스코어 싱크(있으면 스윙 단위 귀속 누적; 승패 불변·rng 무관)
  boxTimeline?: BoxSink[]; // 점수별 누적 박스 스냅샷(있으면 매 득점 후 클론 push) — 관전 보드 실시간 기록용. points[k]와 1:1. 클론만 → 승패·rng 무관
  touches?: boolean;       // 켜면 매 point에 터치 순서(누가 서브/리시브/세트/공격/디그)를 PointLog.touches로 — 보드 재생용. rng 무관·승패 불변
}

const DEFAULT_COACH: CoachInfo = { style: 'balanced', charisma: 50 };
// 박스 스냅샷용 얕은 클론(BoxLine은 number 필드만) — 타임라인이 시점별 누적을 독립 보존
const cloneBox = (b: BoxSink): BoxSink => { const m: BoxSink = new Map(); for (const [k, v] of b) m.set(k, { ...v }); return m; };

/**
 * 풀 랠리 체인 경기 시뮬 — 양 팀 로스터(코트 선발 자동 구성) + 시드 → SimResult.
 * 결정론: 같은 (seed, 선수 스탯, 감독) = 같은 경기.
 */
export function simulateMatch(
  seed: number,
  homePlayers: Player[],
  awayPlayers: Player[],
  opts: MatchOpts = {},
): SimResult {
  const rng = createRng(seed >>> 0);
  // 박스 누적 대상: 호출자가 준 box, 없고 타임라인만 원하면 내부 box.
  const accBox: BoxSink | undefined = opts.box ?? (opts.boxTimeline ? new Map() : undefined);
  // 리시브 귀속용 별도 rng — **항상 생성**(메인 rng 불간섭). 서브 리시버 선택을 box 유무와 무관하게
  // 결정론으로 만들어 recvId가 sim.points에 항상 같게 실린다(box 유무 바이트 동일 보존).
  const boxRng = createRng((seed ^ 0x6d2b79f5) >>> 0);
  // 디그 귀속용 별도 rng — **항상 생성**(메인·boxRng 불간섭). 디그 성공 귀속자(box digSucc·touches)를
  // 후위 수비수 가중 분산으로 고르되 승패·recvId 무영향(전용 스트림). 2026-06-24 디그 귀속 현실화 결정.
  const digRng = createRng((seed ^ 0x9e3779b9) >>> 0);
  // 5세트 코인토스용 별도 rng(메인 rng 불간섭) — FIVB/KOVO는 결승 세트 첫 서브를 새 코인토스로 정한다(v2.1).
  // 1~4세트는 홀짝 교대 유지, 5세트만 50/50. 전용 스트림이라 메인 랠리 스트림·1~4세트 결과 바이트 동일.
  const cointossRng = createRng((seed ^ 0x517cc1b7) >>> 0);
  let rallyNo = 0; // 공간 텔레메트리: 랠리별 독립 srng 시드용(메인 rng 불간섭)
  const edge: Edge = opts.edge ?? { home: 1, away: 1 };
  const hc = opts.home ?? DEFAULT_COACH;
  const ac = opts.away ?? DEFAULT_COACH;

  const homeLineup = buildLineup(homePlayers);
  const awayLineup = buildLineup(awayPlayers);

  // 능력치 캐시 (경기당 1회 산출)
  const cache = new Map<string, Ratings>();
  const R = (p: Player): Ratings => {
    let r = cache.get(p.id);
    if (!r) { r = deriveRatings(p); cache.set(p.id, r); }
    return r;
  };

  // 코트 인원(선발+리베로) 체력 — 경기 내내 누적, 랠리/세트 사이 회복(7.1)
  const onCourt = (lu: typeof homeLineup) => [...lu.six, ...(lu.libero ? [lu.libero] : [])];
  const homeStam = new Map<string, number>();
  const awayStam = new Map<string, number>();
  for (const p of onCourt(homeLineup)) homeStam.set(p.id, 1);
  for (const p of onCourt(awayLineup)) awayStam.set(p.id, 1);

  const home: RallyTeam = { six: homeLineup.six, libero: homeLineup.libero, rotation: 0, momentum: START_MOMENTUM, stam: homeStam, injured: new Set(), style: hc.style };
  const away: RallyTeam = { six: awayLineup.six, libero: awayLineup.libero, rotation: 0, momentum: START_MOMENTUM, stam: awayStam, injured: new Set(), style: ac.style };
  const teamOf = (s: Side) => (s === 'home' ? home : away);
  const charismaOf = (s: Side) => (s === 'home' ? hc.charisma : ac.charisma);
  const policyOf = (s: Side) => (s === 'home' ? (opts.homePolicy ?? DEFAULT_POLICY) : (opts.awayPolicy ?? DEFAULT_POLICY));

  // 벤치 역할별 스페셜리스트(선발·리베로 제외) — 서브/블록/수비 최고 1명씩. 경기 중 고정.
  const benchSpecialists = (players: Player[], lu: ReturnType<typeof buildLineup>) => {
    const onIds = new Set(lu.six.map((p) => p.id));
    if (lu.libero) onIds.add(lu.libero.id);
    const pool = players.filter((p) => !onIds.has(p.id) && p.position !== 'L');
    const best = (score: (p: Player) => number): Player | null =>
      pool.length ? pool.reduce((b, p) => (score(p) > score(b) ? p : b)) : null;
    // 수비 교체는 OH만 — 리시브 라인(리베로+OH)에 실제로 합류해야 교체가 유효(receivers() 참조)
    const bestOH = (score: (p: Player) => number): Player | null => {
      const ohs = pool.filter((p) => p.position === 'OH');
      return ohs.length ? ohs.reduce((b, p) => (score(p) > score(b) ? p : b)) : null;
    };
    return {
      server: best((p) => R(p).serve),
      blocker: best((p) => R(p).block),
      defender: bestOH((p) => R(p).receive + R(p).dig),
    };
  };
  const bench = { home: benchSpecialists(homePlayers, homeLineup), away: benchSpecialists(awayPlayers, awayLineup) };
  const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

  // 랠리 사이 회복 — 체젠(staminaRegen) 높을수록 빨리 회복.
  // tracked = 체력을 추적하는 전원(선발+리베로+투입된 교체) — 교체 선수도 회복되게.
  const tracked: Record<Side, Player[]> = { home: [...onCourt(homeLineup)], away: [...onCourt(awayLineup)] };
  const recover = (side: Side, m: Map<string, number>, scale: number) => {
    for (const p of tracked[side]) {
      m.set(p.id, Math.min(1, (m.get(p.id) ?? 1) + scale * (0.4 + p.staminaRegen / 100)));
    }
  };

  const points: PointLog[] = [];
  const setScores: { home: number; away: number }[] = [];
  const setFirstServers: Side[] = []; // 세트별 첫 서브 팀(보드·production이 재도출 않게 진실을 실어 보냄) — 5세트 코인토스 포함
  const subUse: Record<string, number> = {}; // 교체 출전 선수 id → 출전 랠리 수(출전 성장 XP용)
  const subEvents: SubEvent[] = [];           // 교체 연출 로그(보드용, 순수 가산 — 승패 무영향)
  const timeoutEvents: TimeoutEvent[] = [];   // 타임아웃 로그(보드용, 순수 가산 — 승패 무영향)
  let homeSets = 0;
  let awaySets = 0;
  let setNo = 1;
  const SET_CARRY = 16; // 세트 간 "흐름" — 직전 세트 승자의 시작 기세 우위(KOVO 세트 분포 정렬)
  let lastSetWinner: Side | null = null;

  while (homeSets < 3 && awaySets < 3) {
    let h = 0;
    let a = 0;

    // 세트 시작: 기세 리셋 + 흐름 carryover — 완전 독립 세트 금지(3-0이 늘고 3-2가 줄어 현실 분포로)
    const carry = lastSetWinner === null ? 0 : SET_CARRY * (lastSetWinner === 'home' ? 1 : -1);
    home.momentum = START_MOMENTUM + carry;
    away.momentum = START_MOMENTUM - carry;
    home.rotation = 0;
    away.rotation = 0;
    recover('home', homeStam, 0.12);
    recover('away', awayStam, 0.12);
    const timeouts = { home: TIMEOUTS_PER_SET, away: TIMEOUTS_PER_SET };
    // 1~4세트: 홀수=홈·짝수=원정 교대. 5세트(결승): 코인토스(실제 배구 규칙, v2.1).
    let serving: Side = setNo >= 5 ? (cointossRng.next() < 0.5 ? 'home' : 'away') : (setNo % 2 === 1 ? 'home' : 'away');
    setFirstServers.push(serving); // 이 세트 첫 서브 팀을 기록(소비자가 재도출 않게)

    let lastScorer: Side | null = null;
    let streak = 0;

    // 작전 교체 상태(세트 단위): 예산 + 활성 교체(slotIdx → 원선발·종류)
    const subBudget = { home: SUBS_PER_SET, away: SUBS_PER_SET };
    type SubKind = 'pinch' | 'block' | 'def';
    const activeSubs: Record<Side, Map<number, { orig: Player; kind: SubKind }>> = { home: new Map(), away: new Map() };
    const subIn = (side: Side, slot: number, player: Player | null, kind: SubKind): void => {
      if (!player) return;
      const st = teamOf(side);
      if (activeSubs[side].has(slot) || subBudget[side] < 2) return;
      // 이미 코트에 있으면 불가 — 같은 벤치 스페셜리스트가 두 슬롯에 중복 투입되는 것 방지
      if (st.six.some((p) => p.id === player.id)) return;
      const outP = st.six[slot];
      activeSubs[side].set(slot, { orig: outP, kind });
      st.six[slot] = player;
      if (!st.stam.has(player.id)) { st.stam.set(player.id, 1); tracked[side].push(player); }
      subBudget[side] -= 1; // IN
      subEvents.push({ point: points.length, setNo, side, slot, inId: player.id, outId: outP.id, kind, enter: true });
    };
    const subOut = (side: Side, slot: number): void => {
      const st = teamOf(side);
      const rec = activeSubs[side].get(slot);
      if (!rec) return;
      const outP = st.six[slot];
      st.six[slot] = rec.orig;
      activeSubs[side].delete(slot);
      subBudget[side] -= 1; // OUT (왕복 2회)
      subEvents.push({ point: points.length, setNo, side, slot, inId: rec.orig.id, outId: outP.id, kind: rec.kind, enter: false });
    };

    while (!isSetOver(h, a, setNo)) {
      // ── 작전 교체 평가 (1.3b) — 결정론(상태 기반, RNG 무관) ──
      // 1) 복원: 슬롯이 더는 조건에 안 맞으면 OUT
      for (const side of ['home', 'away'] as Side[]) {
        const inFront = (slot: number) => frontRow(teamOf(side).rotation).includes(slot);
        for (const [slot, rec] of [...activeSubs[side]]) {
          if (rec.kind === 'pinch' && side !== serving) subOut(side, slot);   // 서브권 상실
          else if (rec.kind === 'block' && !inFront(slot)) subOut(side, slot); // 블로커 후위行
          else if (rec.kind === 'def' && inFront(slot)) subOut(side, slot);    // 수비수 전위行
        }
      }
      // 2a) 핀치 서버 — 서브 측 약한 서버 차례
      {
        const sv = serving; const st = teamOf(sv); const slot = serverIndex(st.rotation);
        // 세터는 핀치 서버로 빼지 않는다(코트에 세터 유지 → 공격 운영 보존). 현실 코치 행동.
        if (policyOf(sv).pinchServer && bench[sv].server && !activeSubs[sv].has(slot)
          && st.six[slot].position !== 'S'
          && R(bench[sv].server!).serve - R(st.six[slot]).serve >= PINCH_SERVE_GAP) {
          subIn(sv, slot, bench[sv].server, 'pinch');
        }
      }
      // 2b) 블로킹 강화 — 막판 접전, 전위 약한 블로커
      const crunch = Math.max(h, a) >= targetPoints(setNo) - 4 && Math.abs(h - a) <= 2;
      if (crunch) for (const side of ['home', 'away'] as Side[]) {
        const st = teamOf(side);
        if (!policyOf(side).blockSub || !bench[side].blocker) continue;
        let weakSlot = -1, weakBlk = Infinity;
        for (const slot of frontRow(st.rotation)) { if (st.six[slot].position === 'S') continue; const b = R(st.six[slot]).block; if (b < weakBlk) { weakBlk = b; weakSlot = slot; } }
        if (weakSlot >= 0 && R(bench[side].blocker!).block - weakBlk >= BLOCK_SUB_GAP) subIn(side, weakSlot, bench[side].blocker, 'block');
      }
      // 2c) 수비 강화 — 받는 측 후위 약한 리시버(MB 제외, MB는 리베로가 커버)
      {
        const rs = other(serving); const st = teamOf(rs);
        if (policyOf(rs).defSub && bench[rs].defender) {
          let weakSlot = -1, weakRcv = Infinity;
          for (const slot of backRow(st.rotation)) { const p = st.six[slot]; if (p.position === 'MB' || p.position === 'S') continue; const rc = R(p).receive; if (rc < weakRcv) { weakRcv = rc; weakSlot = slot; } }
          if (weakSlot >= 0 && R(bench[rs].defender!).receive - weakRcv >= DEF_SUB_GAP) subIn(rs, weakSlot, bench[rs].defender, 'def');
        }
      }
      // 교체 출전 기록(이 랠리에 코트에 선 교체 선수) — 출전 성장 XP용(경기 결과엔 무영향)
      for (const side of ['home', 'away'] as Side[]) {
        for (const slot of activeSubs[side].keys()) {
          const id = teamOf(side).six[slot].id;
          subUse[id] = (subUse[id] ?? 0) + 1;
        }
      }
      if (opts.trace) opts.trace.push(`[${h}:${a}] 서브권 ${serving === 'home' ? '홈' : '원정'} (로테이션 H${home.rotation}/A${away.rotation})`);
      const tele = opts.events ? { events: opts.events, srng: createRng(strSeed(`${seed}:r:${rallyNo}`)), rallyNo } : undefined;
      rallyNo++;
      // 종반 추격(7.2 확장): 이미 1~2점차 접전 종반일 때 쫓는 팀이 이를 악문다 — 동점 도달↑(듀스의
      // 재료, KOVO 12~18% 정렬). 접전 한정이라 고무줄 효과 최소(스윕·실력 표현은 carry가 담당).
      const lead = h - a;
      const chasing: Side | null =
        Math.max(h, a) >= targetPoints(setNo) - 4 && Math.abs(lead) >= 1 && Math.abs(lead) <= 2
          ? (lead > 0 ? 'away' : 'home') : null;
      const touches = opts.touches ? [] : undefined; // 켜면 이 점의 터치 순서를 엔진이 기록(가산·중립). 안 켜면 undefined → playRally가 no-op
      const { winner, how, byId, recvId, setId } = playRally(serving, home, away, R, rng, edge, opts.stats, opts.trace, opts.pos, tele, crunch, chasing, accBox, boxRng, touches, digRng);
      if (opts.stats && winner !== serving) opts.stats.sideouts++;
      if (winner === 'home') h++; else a++;
      points.push({ setNo, home: h, away: a, scorer: winner, how, byId, recvId, setId, touches });
      if (opts.boxTimeline) opts.boxTimeline.push(cloneBox(accBox!)); // 이 득점까지의 누적 스냅샷(points와 1:1)

      // 기세 갱신 (연속 득점 가속, 7.2)
      streak = winner === lastScorer ? streak + 1 : 1;
      lastScorer = winner;
      const delta = 4 + 1.2 * Math.min(streak, 6);
      teamOf(winner).momentum = Math.min(100, teamOf(winner).momentum + delta);
      const loserSide: Side = winner === 'home' ? 'away' : 'home';
      teamOf(loserSide).momentum = Math.max(0, teamOf(loserSide).momentum - delta);

      // 사이드아웃: 서브권 없던 팀이 득점 → 서브권 획득 + 회전(1.1)
      if (winner !== serving) {
        teamOf(winner).rotation = rotate(teamOf(winner).rotation);
        serving = winner;
      }

      // 타임아웃 (7.4/8장): 상대 연속득점이 임계 도달 + 잔여 보유 → 지는 팀 감독 호출.
      // 양 팀 기세를 50으로 수렴(폭 = 호출 감독 카리스마). 좋은 흐름일 때 부르면 손해.
      // 코트 선수들이 지쳐 보이면(평균 체력 < TIRED_STAM) 한 박자 일찍 끊는다 — 한숨 돌리기(7.1).
      {
        const stamMap = loserSide === 'home' ? homeStam : awayStam;
        const lt = teamOf(loserSide);
        const courtPs = [...lt.six, ...(lt.libero ? [lt.libero] : [])];
        const minStam = courtPs.reduce((sm, p) => Math.min(sm, stamMap.get(p.id) ?? 1), 1);
        const tired = minStam < TIRED_STAM; // 주포가 퍼졌다 — 평균은 세터·리베로가 가려서 못 본다
        const th = Math.max(2, TO_THRESHOLD[lt.style] - (tired ? 1 : 0));
        if (!isSetOver(h, a, setNo) && streak >= th && timeouts[loserSide] > 0) {
          timeouts[loserSide]--;
          // 보드 연출 로그(순수 가산) — 회복·기세 수렴 전 스냅샷(지친 코트가 타임아웃을 부른 이유)
          const courtStam = (st: typeof home, m: Map<string, number>): TimeoutCourtStam[] =>
            [...st.six, ...(st.libero ? [st.libero] : [])].map((p) => ({ id: p.id, stam: m.get(p.id) ?? 1 }));
          timeoutEvents.push({
            point: points.length - 1, setNo, side: loserSide, home: h, away: a, streak,
            stamHome: courtStam(home, homeStam), stamAway: courtStam(away, awayStam),
            momHome: home.momentum, momAway: away.momentum,
          });
          if (opts.trace) opts.trace.push(`타임아웃 — ${loserSide === 'home' ? '홈' : '원정'} (연속실점 ${streak}${tired ? '·코트 지침' : ''}) [${h}:${a}]`);
          const pull = (charismaOf(loserSide) / 100) * 0.6;
          home.momentum += (50 - home.momentum) * pull;
          away.momentum += (50 - away.momentum) * pull;
          streak = 0;
          lastScorer = null;
          recover('home', homeStam, TIMEOUT_REST); // 타임아웃 = 쉬는 시간(7.1) — 양 팀 회복
          recover('away', awayStam, TIMEOUT_REST);
        }
      }

      // 랠리 사이 체력 회복(7.1) — 교체 투입 선수 포함(tracked)
      recover('home', homeStam, STAM_REGEN_BASE);
      recover('away', awayStam, STAM_REGEN_BASE);
    }

    // 세트 종료: 활성 교체 전부 원복(다음 세트 라인업 초기화) — 보드도 다음 세트 시작 랠리에서 원복
    for (const side of ['home', 'away'] as Side[]) {
      for (const [slot, rec] of activeSubs[side]) {
        const outP = teamOf(side).six[slot];
        teamOf(side).six[slot] = rec.orig;
        subEvents.push({ point: points.length, setNo, side, slot, inId: rec.orig.id, outId: outP.id, kind: rec.kind, enter: false });
      }
      activeSubs[side].clear();
    }

    setScores.push({ home: h, away: a });
    if (h > a) homeSets++; else awaySets++;
    lastSetWinner = h > a ? 'home' : 'away';
    setNo++;
  }

  return { homeSets, awaySets, setScores, points, subUse, subEvents, timeouts: timeoutEvents, setFirstServers };
}

// momFactor 재노출(테스트/튜닝용)
export { momFactor };
