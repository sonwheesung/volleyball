// 세트/경기 진행 (CLAUDE.md 4.4, MATCH_SYSTEM 7·8장).
// 1~4세트 25점, 5세트 15점, 모두 듀스(2점차). 5세트 3선승. 랠리포인트제.
// 매 세트 서브권 시작 팀 교대. 사이드아웃 시 회전(1.1) + 기세 갱신(7.2) + 타임아웃(7.4).
// playRally를 돌려 SimResult(간이 시뮬과 동일 계약)를 출력 → 드롭인 교체 가능.

import type { Player, Side, CoachStyle, SubPolicy, Position } from '../types';
import type { SimResult, PointLog, SubEvent, TimeoutEvent, TimeoutCourtStam, SubKind, MatchIntervention } from './simMatch';
import type { Ratings } from './ratings';
import { createRng, strSeed } from './rng';
import { deriveRatings } from './ratings';
import { buildLineup } from './lineup';
import { playRally, momFactor, STAM_REGEN_BASE, type RallyTeam, type Edge, type RallyStats, type PosStats, type BoxSink } from './rally';
import type { RallyEvent } from './events';
import { rotate, serverIndex, frontRow, backRow } from './rotation';

// 경기 시뮬 결과 버전 — rally/match/simMatch/ratings 등 *경기 결과를 바꾸는* 엔진 변경 시 +1.
// (dyn 재생을 바꾸는 시즌 계층 규칙 변경도 포함 — 캐시가 dyn을 함께 영속하므로, v3.)
// REALTIME_SIM Phase2(G3): simCache는 이 버전을 태깅·게이트해, 엔진 재튜닝(앱 업데이트) 후 저장된 옛-엔진
// 순위를 폐기하고 새 엔진으로 재계산한다 → 저장 순위 ↔ 과거경기 보드 재생 일관성 보장.
export const ENGINE_VERSION = 8; // 8(2026-07-07): ① 피로 교체(1.3e) — 지친 주전(비세터·비접전, 체력<0.35)을 같은 포지션 벤치로 잠시 교체(합리 코치 게이트·히스테리시스·예산≥4, 결정론·rng 미소비) → six[] 변동 → 결과 변동. ② TTO 회복 재튜닝 TIMEOUT_REST(0.04)→TTO_REST(0.03, 테크니컬 타임아웃만 — 스윕으로 0.03만이 체력밴드·피로교체밴드 둘 다 통과) — TTO 세트당 2회 자동 발화로 회복 과다(피로 곡선 붕괴) 교정 → 체력·경기 결과 변동. 둘 다 저장 캐시 무효화. 7(2026-07-07): ① 포지션 폴트 받는 팀만 판정(FIVB 2025-2028 7.4·KOVO 25-26, rally.ts) — rng 소비 2→1회/서브 → 랠리 스트림 이동 → 결과 변동. ② KOVO 테크니컬 타임아웃(1~4세트 8·16점 자동 휴식 — recover+기세수렴, rng 미소비) → 체력·기세 변동 → 경기 결과 변동. 둘 다 저장 캐시 무효화. 6(2026-07-07): subIn(전술 교체)이 injured Set을 배제 — 이중부상 벤치교체 선수를 전술 교체로 재투입하던 잠복버그 차단(1.3d) → 드문 경우 six[] 변동 → 결과 변동 → 저장 캐시 무효화. 5(2026-07-07): 경기 내 부상 교체(1.3d) — maybeInjure에 심각도 게이트(rng 1회 추가 소비) + 중상 시 코트 선수 실제 교체 → 랠리 스트림·경기 결과 변동 → 저장 캐시 무효화
// 4(2026-07-06): 서브 에이스 개인기장 공식화 — 리시브범실 실점을 서버 box.srvAce에도 기장(FIVB indirect ace) → production aces/points·서브왕·skServe XP 변동 → 저장 캐시 무효화. 유형 분포·밸런스·서브 확률·승패 불변(box는 메인 rng 무관)
// 3(2026-07-02): AI 자기방출 재영입 금지(TRANSACTION 0장 ⑥) — dyn(시즌 중 거래) 재생 변동 → 저장 캐시 무효화
// 2(2026-06-28): 체력 튜닝(회복 0.009→0.005·세트사이 0.12→0.035) — 경기 결과 변동 → 저장 캐시 무효화

// 작전 교체 (MATCH_SYSTEM 1.3b)
const SUBS_PER_SET = 6;          // 세트당 정규 교체 횟수(리베로 교체는 별도)
const PINCH_SERVE_GAP = 12;      // 핀치 서버: 벤치-선발 서브 레이팅 차 임계
const BLOCK_SUB_GAP = 12;        // 블로킹 강화: 벤치-전위 블록 레이팅 차 임계
const DEF_SUB_GAP = 12;          // 수비 강화: 벤치-후위 리시브 레이팅 차 임계
// 피로 교체(1.3e): 지친 주전(비세터)을 같은 포지션 벤치로 잠시 뺐다 다음 세트 복귀.
const REST_THRESHOLD = 0.35;     // 이 미만으로 지친 주전만 대상(0..1)
const REST_MIN_BUDGET = 4;       // 피로 교체는 예산 ≥4일 때만(핀치 예산을 굶기지 않게 — 일반 교체 subIn 내부 ≥2보다 높은 문턱)
const REST_HYST = 0.3;           // 히스테리시스: 벤치 체력 − 주전 체력 이 값 이상이어야(살짝 지친 걸로 반복 스와핑 방지)
const DEFAULT_POLICY: SubPolicy = { pinchServer: true, blockSub: true, defSub: true, restSub: true };

export function targetPoints(setNo: number): number {
  return setNo >= 5 ? 15 : 25;
}

export function isSetOver(home: number, away: number, setNo: number): boolean {
  const target = targetPoints(setNo);
  return (home >= target || away >= target) && Math.abs(home - away) >= 2;
}

/** 경기 승리에 필요한 세트 수(5세트 3선승, CLAUDE.md 4.4). 세트 규칙 정본 — simMatch(간이)도 공유. */
export const SETS_TO_WIN = 3;

const START_MOMENTUM = 50;
const TIMEOUTS_PER_SET = 2;
// 감독 성향별 타임아웃 호출 임계(상대 연속득점 수). 수비형은 일찍, 공격형은 늦게(아낀다)
const TO_THRESHOLD: Record<CoachStyle, number> = { defense: 3, balanced: 4, attack: 5 };
const TIMEOUT_REST = 0.04; // 타임아웃 휴식 회복(7.1·7.4) — 양 팀 모두 쉰다(차이는 기세 수렴이 만듦)
// KOVO 테크니컬 타임아웃(7.4b): 1~4세트 리드팀 8·16점 첫 도달 시 자동 60초 휴식. TTO는 감독이 부른 게
// 아니라 공식 자동 휴식이라 카리스마 무관 → 중립 고정 수렴폭(코치 타임아웃 charisma 50 상당 = 0.5×0.6). rng 미소비.
const TTO_THRESHOLDS = [8, 16] as const; // 1~4세트 자동 TTO 발화 점수(리드팀 max(h,a) 기준)
const TTO_PULL = 0.3;      // 테크니컬 타임아웃 기세 수렴폭(중립 고정)
// TTO 회복폭(7.4b, 2026-07-07). 코치 TIMEOUT_REST(0.04)와 **의도적으로 다르다**: TTO는 세트당 2회(8·16점) 자동
// 발화라 0.04를 그대로 쓰면 세트 내 회복 과다(피로 곡선 붕괴 — 5세트 코트 평균 83.1%>82% 밴드). 60초/30초 현실
// 회복비를 깨고 TTO만 낮춰 세트 내 총 휴식을 줄인다(정밀 튜닝한 피로 곡선이 설계 기둥). 코치 타임아웃은 0.04 유지.
// 스윕(N=3000): 0.02→피로교체율 0.634 폭주 FAIL / 0.03→체력 81.5%·교체율 0.453 둘 다 PASS(유일) / 0.035+→체력 밴드 초과.
const TTO_REST = 0.03;
const SET_REST = 0.035;    // 세트 사이 회복(2026-06-28 튜닝 — 세트 누적 피로)
const TIRED_STAM = 0.5;    // 코트에 이 미만으로 퍼진 선수가 있으면 감독이 타임아웃을 한 박자 일찍 부른다

export interface CoachInfo { style: CoachStyle; charisma: number }
export interface MatchOpts {
  edge?: Edge; home?: CoachInfo; away?: CoachInfo; stats?: RallyStats; trace?: string[]; pos?: PosStats;
  homePolicy?: SubPolicy; awayPolicy?: SubPolicy; // 작전 교체 방침(미지정 시 기본)
  events?: RallyEvent[]; // 공간 텔레메트리 싱크(있으면 랠리별 독립 srng로 좌표 이벤트 누적; 승패 불변)
  box?: BoxSink; // 선수별 박스스코어 싱크(있으면 스윙 단위 귀속 누적; 승패 불변·rng 무관)
  boxTimeline?: BoxSink[]; // 점수별 누적 박스 스냅샷(있으면 매 득점 후 클론 push) — 관전 보드 실시간 기록용. points[k]와 1:1. 클론만 → 승패·rng 무관
  touches?: boolean;       // 켜면 매 point에 터치 순서(누가 서브/리시브/세트/공격/디그)를 PointLog.touches로 — 보드 재생용. rng 무관·승패 불변
  // 계측 전용 훅(§7.1) — 매 타임아웃/TTO 순간에 stam 맵을 순수 관측(rng 미소비·결과 불변·기본 off). simStamCurve가
  // 선발6+리베로의 생리 체력(코트 구성과 분리)을 세트별로 뽑는 데 쓴다. stam은 사이드별 id→잔량, courtIds는 그 순간 코트 6인.
  stamProbe?: (setNo: number, stam: Record<Side, Map<string, number>>, courtIds: Record<Side, string[]>) => void;
  // 플레이어 개입 로그(비면 완전 무동작=바이트 동일). 루프 최상단에서 좌표 매칭 적용. MATCH_INTERVENTION_SYSTEM.
  interventions?: MatchIntervention[];
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

  const home: RallyTeam = { six: homeLineup.six, libero: homeLineup.libero, rotation: 0, momentum: START_MOMENTUM, stam: homeStam, injured: new Set(), style: hc.style, pendingSevere: [] };
  const away: RallyTeam = { six: awayLineup.six, libero: awayLineup.libero, rotation: 0, momentum: START_MOMENTUM, stam: awayStam, injured: new Set(), style: ac.style, pendingSevere: [] };
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
  // 경기 내 부상 교체(1.3d) — 세트 넘어 지속(작전 교체 activeSubs와 달리 세트 단위 리셋 없음). slot→{out:부상선수, in:교체선수}.
  // 작전 교체 복원 루프·세트말 원복은 activeSubs만 훑으므로 이 슬롯을 절대 되돌리지 않는다(부상 선수 영구 복귀 불가).
  const injuryReplaced: Record<Side, Map<number, { out: Player; in: Player }>> = { home: new Map(), away: new Map() };
  // 부상 교체 후보 점수 — 슬롯 역할 주 스탯(결정론 픽, rng 없음). 세터는 세터로 유지(setterOf 폴백 방지).
  const roleScore: Record<Position, (r: Ratings) => number> = {
    S: (r) => r.set, OH: (r) => r.spike + r.receive, OP: (r) => r.spike, MB: (r) => r.block + r.spike, L: (r) => r.dig + r.receive,
  };
  // 부상 교체 선수 선정 — 벤치에서 injured·현재 코트·리베로·이전 부상 교체 제외, **포지션 매치 우선**, 결정론(레이팅 최고).
  //   없으면 null(폴백: 부상 선수 코트 유지 ×0.5, 몰수·크래시 없음).
  const pickInjuryReplacement = (side: Side, injuredP: Player): Player | null => {
    const st = teamOf(side);
    const players = side === 'home' ? homePlayers : awayPlayers;
    const excluded = new Set<string>(st.six.map((p) => p.id));
    if (st.libero) excluded.add(st.libero.id);
    for (const id of st.injured) excluded.add(id);
    for (const rec of injuryReplaced[side].values()) excluded.add(rec.in.id);
    const pool = players.filter((p) => !excluded.has(p.id) && p.position !== 'L');
    if (!pool.length) return null;
    const samePos = pool.filter((p) => p.position === injuredP.position);
    const cand = samePos.length ? samePos : pool; // 포지션 매치 우선(특히 세터↔세터)
    const score = roleScore[injuredP.position];
    return cand.reduce((b, p) => (score(R(p)) > score(R(b)) ? p : b));
  };
  let homeSets = 0;
  let awaySets = 0;
  let setNo = 1;
  const SET_CARRY = 16; // 세트 간 "흐름" — 직전 세트 승자의 시작 기세 우위(KOVO 세트 분포 정렬)
  let lastSetWinner: Side | null = null;

  while (homeSets < SETS_TO_WIN && awaySets < SETS_TO_WIN) {
    let h = 0;
    let a = 0;

    // 세트 시작: 기세 리셋 + 흐름 carryover — 완전 독립 세트 금지(3-0이 늘고 3-2가 줄어 현실 분포로)
    const carry = lastSetWinner === null ? 0 : SET_CARRY * (lastSetWinner === 'home' ? 1 : -1);
    home.momentum = START_MOMENTUM + carry;
    away.momentum = START_MOMENTUM - carry;
    home.rotation = 0;
    away.rotation = 0;
    recover('home', homeStam, SET_REST);
    recover('away', awayStam, SET_REST);
    const timeouts = { home: TIMEOUTS_PER_SET, away: TIMEOUTS_PER_SET };
    // 1~4세트: 홀수=홈·짝수=원정 교대. 5세트(결승): 코인토스(실제 배구 규칙, v2.1).
    let serving: Side = setNo >= 5 ? (cointossRng.next() < 0.5 ? 'home' : 'away') : (setNo % 2 === 1 ? 'home' : 'away');
    setFirstServers.push(serving); // 이 세트 첫 서브 팀을 기록(소비자가 재도출 않게)

    let lastScorer: Side | null = null;
    let streak = 0;
    const ttoFired = new Set<number>(); // 이 세트에 이미 발화한 테크니컬 타임아웃 임계(8·16) — 세트당 임계별 1회(7.4b)

    // 작전 교체 상태(세트 단위): 예산 + 활성 교체(slotIdx → 원선발·종류)
    const subBudget = { home: SUBS_PER_SET, away: SUBS_PER_SET };
    // 작전/피로 교체만 activeSubs에 들어간다(injury는 injuryReplaced로 분리 — 세트말 원복 안 함). = 정본 SubKind − 'injury'.
    type TacticalSubKind = Exclude<SubKind, 'injury'>;
    const activeSubs: Record<Side, Map<number, { orig: Player; kind: TacticalSubKind }>> = { home: new Map(), away: new Map() };
    // FIVB 교체 규칙(세트 단위 리셋) — ① 교체선수는 세트당 1회만 진입(재진입 금지) ② 선발은 세트당 1왕복만(나갔다 돌아온 뒤 재이탈 금지).
    //   구현 누락으로 같은 스페셜리스트가 예산(6) 남는 한 핑퐁 투입되던 버그 수정(2026-07-01). checkSubs 규칙검사로 박제.
    const usedSubIn: Record<Side, Set<string>> = { home: new Set(), away: new Set() };       // 이 세트에 이미 투입된 교체선수 id
    const usedStarterOut: Record<Side, Set<string>> = { home: new Set(), away: new Set() };  // 이 세트에 이미 교체 아웃된 선발 id
    const subIn = (side: Side, slot: number, player: Player | null, kind: TacticalSubKind): void => {
      if (!player) return;
      const st = teamOf(side);
      if (injuryReplaced[side].has(slot)) return; // 부상 교체 슬롯은 작전 교체 대상 제외 — 부상 교체 선수를 영구 유지(1.3d)
      if (activeSubs[side].has(slot) || subBudget[side] < 2) return;
      // 이미 코트에 있으면 불가 — 같은 벤치 스페셜리스트가 두 슬롯에 중복 투입되는 것 방지
      if (st.six.some((p) => p.id === player.id)) return;
      if (st.injured.has(player.id)) return; // 부상 선수는 어떤 교체로도 코트 복귀 불가(1.3d) — benchSpecialists가 경기 시작 고정이라 이중부상 벤치교체 선수를 재투입하던 잠복버그 차단(subIn·injuryReplaced 이중 차단)
      if (usedSubIn[side].has(player.id)) return; // FIVB: 교체선수는 세트당 1회만 진입(재진입 금지)
      const outP = st.six[slot];
      if (usedStarterOut[side].has(outP.id)) return; // FIVB: 선발은 세트당 1왕복만(돌아온 선발 재이탈 금지)
      usedSubIn[side].add(player.id);
      usedStarterOut[side].add(outP.id);
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
      // ── 플레이어 개입 적용 (MATCH_INTERVENTION_SYSTEM §3) — 비면 완전 무동작(바이트 동일). ──
      //   주입 지점 = 랠리 루프 최상단, 직전 기록 점수 (setNo,h,a)를 좌표로. 좌표 정확 매칭만 적용.
      //   AI 자동 교체·타임아웃은 그대로 유지(끄지 않음) — 개입은 순수 가산(forward-only/additive).
      //   교체는 subIn 그대로 재사용(FIVB 예산·재진입·부상·중복 가드 전부 상속). 타임아웃은 감독 임계 무시 강제 호출.
      if (opts.interventions?.length) {
        for (const iv of opts.interventions) {
          if (iv.at.setNo !== setNo || iv.at.h !== h || iv.at.a !== a) continue;
          if (iv.kind === 'sub') {
            const st = teamOf(iv.side);
            const slot = st.six.findIndex((p) => p.id === iv.outId);
            if (slot < 0) continue; // 코트에 없음(방어)
            const inP = (iv.side === 'home' ? homePlayers : awayPlayers).find((p) => p.id === iv.inId);
            if (!inP) continue;     // 벤치에 없음(방어)
            subIn(iv.side, slot, inP, 'manual'); // FIVB 가드 전부 상속(no-op 자동 처리)
          } else {
            // 타임아웃 — 감독 자동 경로와 별개(임계·streak 무시 강제). 기존 타임아웃 블록의 효과를 그대로 복제.
            if (timeouts[iv.side] <= 0) continue; // 세트 한도 소진 시 no-op
            timeouts[iv.side]--;
            const courtStam = (st: typeof home, m: Map<string, number>): TimeoutCourtStam[] =>
              [...st.six, ...(st.libero ? [st.libero] : [])].map((p) => ({ id: p.id, stam: m.get(p.id) ?? 1 }));
            timeoutEvents.push({
              point: points.length > 0 ? points.length - 1 : 0, setNo, side: iv.side, home: h, away: a, streak,
              stamHome: courtStam(home, homeStam), stamAway: courtStam(away, awayStam),
              momHome: home.momentum, momAway: away.momentum,
            });
            const pull = (charismaOf(iv.side) / 100) * 0.6;
            home.momentum += (50 - home.momentum) * pull;
            away.momentum += (50 - away.momentum) * pull;
            streak = 0;
            lastScorer = null;
            recover('home', homeStam, TIMEOUT_REST);
            recover('away', awayStam, TIMEOUT_REST);
          }
        }
      }
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
      // 접전 종반 판정 — 피로 교체(안 뺌)·블로킹 강화(뺌)·랠리(추격) 공용. 여기서 한 번 산출.
      const crunch = Math.max(h, a) >= targetPoints(setNo) - 4 && Math.abs(h - a) <= 2;
      // 2·피로 교체 (1.3e) — **핀치보다 먼저** 평가. 지친 주전(비세터·비접전)을 같은 포지션 벤치로 잠시 쉬게.
      //   결정론(상태 기반·rng 미소비). 예산 ≥4 요구(핀치를 굶기지 않게) + 합리 코치 게이트(가짜 드라마 방지).
      //   subIn 경유 → FIVB 가드(예산·재진입·부상배제·슬롯락) 상속. 세트 중 복원 없음 → 세트말 net-zero 원복(다음 세트 복귀).
      //   공유 풀 주의: bench.defender(벤치 최고 OH)와 피로 교체 픽이 같은 선수인 경우가 잦다 — 먼저 발동한 쪽이
      //   세트당 1회 진입(usedSubIn)을 소비한다(결정론적 희소성, 허용).
      // eff = 체력·부상 효율(rally.ts eff 로컬 복제: 0.70+0.30×체력, 부상 ×0.5) — 벤치 유효산출≥주전이어야 발동.
      const effLocal = (st: typeof home, p: Player, stamFrac: number): number => {
        const s = 0.70 + 0.30 * stamFrac;
        return st.injured.has(p.id) ? s * 0.5 : s;
      };
      for (const side of ['home', 'away'] as Side[]) {
        if (!policyOf(side).restSub) continue;
        if (subBudget[side] < REST_MIN_BUDGET) continue; // 핀치 예산 보존(≥4)
        if (crunch) continue;                            // 접전 종반엔 지친 에이스도 코트에 둔다(관전 신뢰성)
        const st = teamOf(side);
        const players = side === 'home' ? homePlayers : awayPlayers;
        const onIds = new Set(st.six.map((p) => p.id));
        if (st.libero) onIds.add(st.libero.id);
        for (let slot = 0; slot < 6; slot++) {
          const starter = st.six[slot];
          if (starter.position === 'S') continue;               // 세터는 절대 안 뺀다(5-1 무결성)
          if (activeSubs[side].has(slot) || injuryReplaced[side].has(slot)) continue; // 이미 교체/부상 슬롯
          const starterStam = st.stam.get(starter.id) ?? 1;
          if (starterStam >= REST_THRESHOLD) continue;          // 아직 안 지침
          // 같은 포지션 벤치 최고(엄격) — 코트/부상/이미투입 제외. 없으면 교체 안 함(리시브 라인 축소 방지 — load-bearing:
          // receivers()가 position==='OH'로 W라인을 만들므로 타 포지션 대체는 리시브 라인을 조용히 줄인다).
          let best: Player | null = null, bestScore = -Infinity;
          for (const p of players) {
            if (p.position !== starter.position) continue;
            if (onIds.has(p.id) || st.injured.has(p.id) || usedSubIn[side].has(p.id)) continue;
            const sc = roleScore[p.position](R(p));
            if (sc > bestScore) { bestScore = sc; best = p; }
          }
          if (!best) continue;
          const benchStam = st.stam.get(best.id) ?? 1;          // 핀치 서브 뛴 벤치는 쌩쌩하지 않다
          if (benchStam - starterStam < REST_HYST) continue;    // 히스테리시스
          // 합리 코치 게이트: 벤치 유효산출 ≥ 주전 유효산출일 때만(85 스타 vs 60 벤치면 지쳐도 스타 유지 — 탈진은 서사)
          const starterOut = roleScore[starter.position](R(starter)) * effLocal(st, starter, starterStam);
          const benchOut = roleScore[best.position](R(best)) * effLocal(st, best, benchStam);
          if (benchOut < starterOut) continue;
          subIn(side, slot, best, 'rest');
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
      // 2b) 블로킹 강화 — 막판 접전, 전위 약한 블로커 (crunch는 위에서 산출)
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

      // ── 경기 내 부상 교체 (1.3d) — 중상(pendingSevere)만 실제 코트 교체. FIVB 예외적 교체(예산·재진입 밖) ──
      //   rng 미소비(결정론 픽) — 심각도 판정은 이미 랠리 중 maybeInjure가 소비. 교체 못 하면(벤치 소진) 부상 선수 코트 유지(×0.5).
      for (const side of ['home', 'away'] as Side[]) {
        const st = teamOf(side);
        const pend = st.pendingSevere;
        while (pend && pend.length) {
          const injId = pend.shift()!;
          const slot = st.six.findIndex((p) => p.id === injId);
          if (slot < 0) continue; // 이미 코트에 없음(방어) — 리베로는 공격 안 하므로 pendingSevere에 애초에 없음
          const injuredP = st.six[slot];
          const replacement = pickInjuryReplacement(side, injuredP);
          if (!replacement) continue; // 폴백: 벤치 소진 → 부상 선수 코트 유지(×0.5), 몰수·크래시 없음
          activeSubs[side].delete(slot); // 부상 슬롯이 작전 교체 중이면 그 항목 삭제 → 복원 루프/세트말이 못 되돌림(작전 orig 부활 방지)
          st.six[slot] = replacement;
          injuryReplaced[side].set(slot, { out: injuredP, in: replacement });
          if (!st.stam.has(replacement.id)) { st.stam.set(replacement.id, 1); tracked[side].push(replacement); }
          subEvents.push({ point: points.length, setNo, side, slot, inId: replacement.id, outId: injuredP.id, kind: 'injury', enter: true });
        }
      }

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
          // 계측 훅(§7.1, 회복 전) — 선발6+리베로 생리 체력 관측용. rng 미소비·결과 불변.
          opts.stamProbe?.(setNo, { home: homeStam, away: awayStam }, { home: home.six.map((p) => p.id), away: away.six.map((p) => p.id) });
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

      // ── 테크니컬 타임아웃 (7.4b, KOVO) — 1~4세트 리드팀 8·16점 첫 도달 시 자동 휴식. rng 미소비(고정 점수 트리거) ──
      //   코치 타임아웃과 동일 효과(recover+기세 수렴+streak 리셋)지만 감독 호출이 아니라 자동이라 팀 타임아웃 예산 무차감.
      //   5세트는 미발생(8점 코트체인지는 코트 추상화 — 시뮬 무영향).
      if (setNo <= 4 && !isSetOver(h, a, setNo)) {
        const leadScore = Math.max(h, a);
        for (const thr of TTO_THRESHOLDS) {
          if (ttoFired.has(thr) || leadScore < thr) continue;
          ttoFired.add(thr); // 세트당 임계별 1회(점수는 1점씩 → 첫 도달 = 정확히 thr 순간)
          const leadSide: Side = h >= a ? 'home' : 'away'; // 리드팀(임계 도달자) — 첫 도달 순간이라 동점 아님
          const courtStamSnap = (st: typeof home, m: Map<string, number>): TimeoutCourtStam[] =>
            [...st.six, ...(st.libero ? [st.libero] : [])].map((p) => ({ id: p.id, stam: m.get(p.id) ?? 1 }));
          timeoutEvents.push({
            point: points.length - 1, setNo, side: leadSide, home: h, away: a, streak,
            stamHome: courtStamSnap(home, homeStam), stamAway: courtStamSnap(away, awayStam),
            momHome: home.momentum, momAway: away.momentum, technical: true,
          });
          opts.stamProbe?.(setNo, { home: homeStam, away: awayStam }, { home: home.six.map((p) => p.id), away: away.six.map((p) => p.id) });
          if (opts.trace) opts.trace.push(`테크니컬 타임아웃 (${thr}점 도달) [${h}:${a}]`);
          // 기세 50 수렴(중립 고정폭) + streak 리셋 + 양 팀 휴식 회복 — 코치 타임아웃과 동일. 팀 예산 timeouts[]는 건드리지 않음.
          home.momentum += (50 - home.momentum) * TTO_PULL;
          away.momentum += (50 - away.momentum) * TTO_PULL;
          streak = 0;
          lastScorer = null;
          recover('home', homeStam, TTO_REST); // TTO 전용 회복폭(0.03) — 코치 TIMEOUT_REST(0.04)와 의도적 상이(7.4b·피로 곡선 보존)
          recover('away', awayStam, TTO_REST);
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
