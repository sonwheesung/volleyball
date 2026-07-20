// 리그 데이터 — 시드로 생성하되, 로스터·선수 상태는 세이브로 가변(다중 시즌·FA·드래프트).
// playerMap = 전역 선수 레지스트리(시드 + 시즌 스냅샷 + 신규 생성).
// rosters    = 팀 구성(가변). 시드 기본값에서 은퇴/영입/드래프트로 바뀐다.
// 시즌 내 진화는 스냅샷에서 currentDay 만큼 리플레이.

import type { AssistantCoach, Coach, CoachSpecialty, CoachType, CoachStyle, Fixture, FocusSeg, Player, Scout, Team, TrainingFocus, TrainingId } from '../types';
import type { CoachInfo } from '../engine/match';
import { generateLeague } from './seed';
import { genForeignName, genAsianIdentity } from './names';
import { generateSeason } from '../engine/season';
import { evolvePlayer, evolveSpan, initialEvoRngState, type FocusResolver } from '../engine/progression';
import { SEASON_DAYS } from '../engine/calendar';
import { rollTraits } from '../engine/traits';
import { createRng, strSeed } from '../engine/rng';
import { STAFF_BUDGET, COACH_SLOTS, staffEffects, scoutReveal, assistantSalary, scoutSalary, coachTypeFor, deriveHeadAxes, type StaffEffects, NO_EFFECTS } from '../engine/staff';
import { interimRenown } from '../engine/reputation';
import { recordBump } from './spliceLog';

const LEAGUE_SEED = 20251018;
const SEASON_SEED = 777;
const DEFAULT_FOCUS: TrainingFocus = { primary: [4, 6], secondary: [1, 10, 12] };

export let LEAGUE = generateLeague(LEAGUE_SEED);
export let SEASON: Fixture[] = generateSeason(LEAGUE.teams.map((t) => t.id), SEASON_SEED);

const teamMap = new Map(LEAGUE.teams.map((t) => [t.id, t]));
const playerMap = new Map<string, Player>(LEAGUE.players.map((p) => [p.id, p]));
// 감독 풀은 생애주기로 순환(STAFF_SYSTEM 6) — LEAGUE.coaches는 시드(불변), 풀은 가변 스냅샷
let coachPool: Coach[] = [...LEAGUE.coaches];
let assistantPool: AssistantCoach[] = [...LEAGUE.assistants];
const coachMap = new Map(coachPool.map((c) => [c.id, c]));
let assistantMap = new Map(assistantPool.map((a) => [a.id, a]));
let scoutMap = new Map(LEAGUE.scouts.map((s) => [s.id, s]));
const fixtureMap = new Map(SEASON.map((f) => [f.id, f]));

// 시드 스태프 원본 스냅샷(pristine) — 풀 복원의 단일 진실. hireAssistant(`a.teamId=teamId`)·assignCoach(`c.teamId=...`)가
// 스태프 객체를 **in-place 변이**하는데, resetLeagueBase가 `[...LEAGUE.x]`(얕은 복사=변이된 참조)로 복원하면 teamId가
// 안 돌아와 다음 게임의 영입 가드(`a.teamId!==null`)에 걸린다 → 새 게임이 스타팅 코치 0 + in-process 진화 비결정
// (REALTIME_SIM §3 Phase0, edge-swarm/engine-verify 연계 발견 2026-06-27). 매 복원 시 이 스냅샷의 새 클론을 쓴다.
let seedCoaches: Coach[] = LEAGUE.coaches.map((c) => ({ ...c }));
let seedAssistants: AssistantCoach[] = LEAGUE.assistants.map((a) => ({ ...a }));
let seedScouts: Scout[] = LEAGUE.scouts.map((s) => ({ ...s }));

// ─── 스태프 계약(STAFF_SYSTEM) — 단장이 영입한 감독/코치/스카우터 ───
let headCoachOverride: Record<string, string> = {};                 // teamId → 영입 감독 id(시드 감독 대체, **현재**)
let teamAssistantIds: Record<string, string[]> = {};                // teamId → 영입 코치 ids
let teamScoutIds: Record<string, string[]> = {};                    // teamId → 영입 스카우터 ids

// ─── 감독 부임 타임라인(축3, REALTIME_SIM §7.2 정정) — coachInfoOf/coachDefaultFocus를 **day-aware**로 만들어
//   시즌 중 감독 영입을 forward-only(부임일 이전 경기·성장은 이전 감독)로 만든다. 없으면(빈 타임라인) coachInfoOf가
//   현재 감독(headCoachOverride)으로 폴백 = **소급**(=day0 백필 = 구세이브·정상게임 byte 불변). 세그먼트는 시즌 중
//   영입에서만 쌓이고, 소급/전체 무효화 이벤트(assignCoach·fireCoach·commitStaff·reset·reseed)에서 비워진다(=day0 붕괴). ───
type CoachSeg = { fromDay: number; coachId: string | null }; // coachId=null → 시드/공석 복귀
let headCoachTimeline: Record<string, CoachSeg[]> = {};

/** 시즌 중 감독 부임 세그먼트 추가(fromDay>0). 첫 세그먼트면 부임 전 현 감독을 day0 baseline으로 먼저 심어
 *  부임일 이전이 시드로 새는 것 방지(경질 후 대행이 day0..부임일을 지킨 경우 등). 반드시 headCoachOverride 갱신 **전** 호출. */
function pushCoachSeg(teamId: string, fromDay: number, coachId: string | null): void {
  const d = Math.max(0, Math.floor(fromDay));
  let segs = headCoachTimeline[teamId] ?? [];
  // 부임 전 감독을 day0 baseline으로 보존 — **id를 명시**(시드 감독 포함). null로 두면 영입 시 시드 감독이 teamId=null로
  //   분리돼 teamHeadCoachOn의 "시드-잔류" 폴백이 깨져 부임 이전이 DEFAULT_FOCUS로 새는 버그(발견 2026-07-11 _dv_splice G).
  if (!segs.length && d > 0) segs = [{ fromDay: 0, coachId: teamHeadCoach(teamId)?.id ?? null }];
  segs = segs.filter((s) => s.fromDay < d);
  segs.push({ fromDay: d, coachId });
  headCoachTimeline[teamId] = segs;
}

// ─── 가변 로스터 + 캐시 ───
const seedRosters = (): Record<string, string[]> =>
  Object.fromEntries(LEAGUE.teams.map((t) => [t.id, [...t.players]]));

let rosters: Record<string, string[]> = seedRosters();
let playerFocus = new Map<string, FocusResolver>(); // 선수 → 소속팀 날짜별 방침 해석기(A4 타임라인)
let playerEffects = new Map<string, StaffEffects>(); // 선수 → 소속팀 전문코치 종합 효과
// 축1(evoOneCache 콘텐츠 시그니처) — 선수별 진화 입력 서명. base는 참조동일로, focus/effects는 이 문자열로 판정.
//   focusOf(base)·effectsOf(base)와 **정확히 대응**해야 함(누락=stale). rebuildFocus에서 팀 서명을 소속 선수에 배포.
let playerFocusSig = new Map<string, string>();     // 선수 → 소속팀 방침 서명(focusTimeline + 감독 타임라인 focus)
let playerEffectsSig = new Map<string, string>();   // 선수 → 소속팀 스태프효과 서명
const SENT_FOCUS_SIG = '__FA_default__';            // 로스터 밖(FA) — focusOf=()=>DEFAULT_FOCUS 대응(팀 서명과 불충돌)
const SENT_EFFECTS_SIG = '__FA_noeff__';            // 로스터 밖(FA) — effectsOf=NO_EFFECTS 대응

/** 팀의 날짜별 방침 리졸버를 **결정론 직렬화**한 서명 — teamFocusResolver가 쓰는 입력 전부(훈련 오버라이드
 *  세그먼트 + 감독 타임라인의 그날 기본 focus)를 담는다. 감독 변경 경계와 day0에서만 focus가 바뀌므로 그 경계들의
 *  유효 focus를 직렬화하면 리졸버 전체가 결정된다. */
function teamFocusSig(teamId: string): string {
  const focus = JSON.stringify(focusTimeline[teamId] ?? []);
  const cs = headCoachTimeline[teamId] ?? [];
  const boundaries = [0, ...cs.map((s) => s.fromDay)]; // day0 + 각 감독 변경일
  const coach = boundaries.map((d) => `${d}:${JSON.stringify(coachDefaultFocusOn(teamId, d))}`).join(',');
  return `${focus}#${coach}`;
}
// 단장이 고른 팀별 훈련 방향 **타임라인**(A4, 2026-07-08 — "바꾼 날부터 적용"). 없으면 감독 기본.
//   구 `focusOverride: Record<string, TrainingFocus>`(단일 오버라이드=day0부터 소급)를 세그먼트 타임라인으로 교체.
let focusTimeline: Record<string, FocusSeg[]> = {};
let evoCache: { day: number; map: Map<string, Player> } | null = null;
let _baseVersion = 0; // 선수/로스터 베이스가 바뀔 때마다 증가(파생 캐시 무효화용)
export const baseVersion = (): number => _baseVersion;
// 캐시 영속 복원(REALTIME_SIM Phase1) — 저장된 simCache 키와 맞추려 재로드 시 카운터를 복원. evoCache는 무효화
// (저장된 건 standings/production 계산결과뿐 — 진화 캐시는 필요 시 재빌드). _gt 검증에서만 호출되도록 신중히.
export const setBaseVersion = (n: number): void => { _baseVersion = n; evoCache = null; };

/** 팀 감독 기본 방침(오버라이드 없을 때 폴백, **현재** 감독) */
const coachDefaultFocus = (teamId: string): TrainingFocus =>
  teamHeadCoach(teamId)?.trainingFocus ?? DEFAULT_FOCUS;

/** 팀 감독 기본 방침 — **day 시점** 감독(축3 forward-only). 타임라인 없으면 현재 감독(=소급, byte 불변). */
const coachDefaultFocusOn = (teamId: string, day: number): TrainingFocus =>
  teamHeadCoachOn(teamId, day)?.trainingFocus ?? DEFAULT_FOCUS;

/** 팀의 **현재(최신)** 훈련 방향 — 타임라인 마지막 세그먼트 우선(단장 오버라이드), 없으면 감독 기본.
 *  표시·AI 등 "지금 방침"이 필요한 곳용. 진화(성장 리플레이)는 날짜별이라 teamFocusResolver를 쓴다. */
function teamFocus(teamId: string): TrainingFocus {
  const segs = focusTimeline[teamId];
  if (segs && segs.length) return segs[segs.length - 1].focus ?? coachDefaultFocus(teamId);
  return coachDefaultFocus(teamId);
}

/** 팀의 **날짜별** 훈련 방향 해석기(A4) — 진화 리플레이가 "그날의 방침"으로 성장시키게. fromDay ≤ day 인 마지막
 *  세그먼트의 focus(null이면 감독 기본으로 복귀). 세그먼트가 없으면(AI 팀 등) 매일 감독 기본. */
function teamFocusResolver(teamId: string): FocusResolver {
  const segs = focusTimeline[teamId];
  const cs = headCoachTimeline[teamId];
  const hasCoachTl = !!(cs && cs.length);
  // 훈련 오버라이드도, 감독 타임라인도 없으면 상수 방침(현재 감독 기본) — 기존과 byte 동일(빠른 경로).
  if ((!segs || !segs.length) && !hasCoachTl) { const def = coachDefaultFocus(teamId); return () => def; }
  const sorted = segs && segs.length ? [...segs].sort((a, b) => a.fromDay - b.fromDay) : null;
  return (day: number): TrainingFocus => {
    let f: TrainingFocus | null = null;
    if (sorted) for (const s of sorted) { if (s.fromDay <= day) f = s.focus; else break; }
    return f ?? coachDefaultFocusOn(teamId, day); // 감독 기본은 그날의 감독(축3)
  };
}

/** 팀 현재 감독 — 영입/배정 오버라이드 우선. 없으면 시드 감독으로 폴백하되,
 *  그 시드 감독이 아직 이 팀 소속(teamId 일치)일 때만 — 경질·이적·은퇴한 감독 부활 방지(STAFF_SYSTEM 6). */
function teamHeadCoach(teamId: string): Coach | undefined {
  const ov = headCoachOverride[teamId];
  if (ov && coachMap.has(ov)) return coachMap.get(ov);
  const seed = coachMap.get(teamMap.get(teamId)?.coachId ?? '');
  return seed && seed.teamId === teamId ? seed : undefined; // 떠난 시드 감독은 폴백 안 함(공석→기본 감독)
}

/** 팀 감독 — **day 시점**(축3 forward-only). 부임 타임라인이 있으면 그날 유효 세그먼트의 감독,
 *  타임라인 없으면 현재 감독(teamHeadCoach)으로 폴백(=소급 = 정상게임·구세이브 byte 불변). */
function teamHeadCoachOn(teamId: string, day: number): Coach | undefined {
  const segs = headCoachTimeline[teamId];
  if (!segs || !segs.length) return teamHeadCoach(teamId);
  let cid: string | null | undefined;
  for (const s of segs) { if (s.fromDay <= day) cid = s.coachId; else break; } // 세그먼트는 fromDay 오름차순 유지
  if (cid && coachMap.has(cid)) return coachMap.get(cid);
  // cid=null(시드/공석/부임 이전) → 시드 감독(아직 그 팀 소속일 때만)
  const seed = coachMap.get(teamMap.get(teamId)?.coachId ?? '');
  return seed && seed.teamId === teamId ? seed : undefined;
}

// ─── AI 팀 기본 스태프(STAFF_SYSTEM 7) — 전엔 AI가 시드 감독뿐, 코치·스카우터 0이라 성장·스카우팅
//   일방 불리. AI 팀에 결정론 기본 스태프(코치 2 + 스카우터 1) 지급. 전용 id(`ai-*`)라 플레이어
//   영입 풀과 분리 → 단일 소속 불변식 유지(영입 불가). 플레이어는 슬롯 3 + 상위 풀로 능가(단장 우위 레버). ───
let myTeamStaff = ''; // 플레이어 팀 — 이 팀만 영입 스태프 사용, 나머지는 AI 기본
/** 플레이어 팀 등록(스토어/시뮬). 이 팀은 단장이 영입한 스태프를, 나머지 팀은 AI 기본 스태프를 쓴다. */
export function setMyTeamStaff(teamId: string): void { myTeamStaff = teamId; }

const AI_SPECIALTIES: CoachSpecialty[] = ['attack', 'defense', 'setter', 'stamina', 'mental'];
const aiAsstCache = new Map<string, AssistantCoach[]>();
const aiScoutCache = new Map<string, Scout[]>();
/** AI 로스터적합 성향 픽 (STAFF §8.1 phase④) — 팀 로스터 나이 프로필에 맞는 성향 선택("메타"가 아니라 팀 상황 전략).
 *  어린 팀=육성/회복/클러치 · 노장 팀=즉전/노쇠억제/안정 · 중간=완성. NO_FITPICK env면 랜덤(A/B 베이스라인). */
function aiFitType(teamId: string, sp: CoachSpecialty, seedId: string): CoachType {
  if (typeof process !== 'undefined' && process.env && process.env.NO_FITPICK) return coachTypeFor(seedId, sp)!;
  const ages = (rosters[teamId] ?? []).map((id) => playerMap.get(id)?.age).filter((a): a is number => a != null);
  const avg = ages.length ? ages.reduce((s, a) => s + a, 0) / ages.length : 26;
  const young = avg < 25.5, old = avg >= 27.5;
  if (sp === 'stamina') return old ? 'antiaging' : 'recovery';
  if (sp === 'mental') return old ? 'stable' : 'clutch';
  return young ? 'developer' : old ? 'winnow' : 'finisher'; // 기량계
}
function aiTeamAssistants(teamId: string): AssistantCoach[] {
  const hit = aiAsstCache.get(teamId); if (hit) return hit;
  const rng = createRng(strSeed(`aistaff:${teamId}`));
  const sp = [...AI_SPECIALTIES];
  for (let i = sp.length - 1; i > 0; i--) { const j = rng.int(0, i); [sp[i], sp[j]] = [sp[j], sp[i]]; }
  const list: AssistantCoach[] = sp.slice(0, 2).map((s, i) => {
    const rating = 52 + rng.int(0, 22); // 52~74 기본기 — 플레이어 상위(최대 92) 영입에 밀린다
    const id = `ai-ac-${teamId}-${i}`;
    return { id, name: '전임 코치', age: 45 + rng.int(0, 15), specialty: s, type: aiFitType(teamId, s, id), rating, salary: assistantSalary(rating), teamId };
  });
  aiAsstCache.set(teamId, list); return list;
}
function aiTeamScouts(teamId: string): Scout[] {
  const hit = aiScoutCache.get(teamId); if (hit) return hit;
  const rng = createRng(strSeed(`aiscout:${teamId}`));
  const scouting = 50 + rng.int(0, 25); // 50~75 기본 안목
  const list: Scout[] = [{ id: `ai-sc-${teamId}`, name: '구단 스카우터', age: 45 + rng.int(0, 15), scouting, salary: scoutSalary(scouting), teamId }];
  aiScoutCache.set(teamId, list); return list;
}

/** 팀 보조코치 목록 — 플레이어 팀은 영입분, AI 팀은 기본 스태프 */
function teamAssistantsOf(teamId: string): AssistantCoach[] {
  if (teamId !== myTeamStaff) return aiTeamAssistants(teamId);
  return (teamAssistantIds[teamId] ?? []).map((id) => assistantMap.get(id)).filter((a): a is AssistantCoach => !!a);
}
/** 팀 스카우터 목록 — 플레이어 팀은 영입분, AI 팀은 기본 스카우터 */
function teamScoutsOf(teamId: string): Scout[] {
  if (teamId !== myTeamStaff) return aiTeamScouts(teamId);
  return (teamScoutIds[teamId] ?? []).map((id) => scoutMap.get(id)).filter((s): s is Scout => !!s);
}

function rebuildFocus(): void {
  playerFocus = new Map();
  playerEffects = new Map();
  playerFocusSig = new Map();     // 서명도 매 리빌드마다 새로 — 로스터를 떠난 선수의 stale 서명 제거(FA→센티넬로 폴백)
  playerEffectsSig = new Map();
  for (const t of LEAGUE.teams) {
    const resolver = teamFocusResolver(t.id); // 날짜별 방침(A4 타임라인) — 팀 전원 공유
    const effects = staffEffects(teamAssistantsOf(t.id));
    const fsig = teamFocusSig(t.id);          // 축1: 팀 방침 서명(진화 입력 대응)
    const esig = JSON.stringify(effects);      // 축1: 팀 스태프효과 서명
    for (const pid of rosters[t.id] ?? []) {
      playerFocus.set(pid, resolver); playerEffects.set(pid, effects);
      playerFocusSig.set(pid, fsig); playerEffectsSig.set(pid, esig);
    }
  }
}
rebuildFocus();

/** 팀 훈련 방향 **타임라인** 통째 설정(A4) — 스토어가 소유한 focusLog를 데이터층에 주입(setOwnerContext 패턴).
 *  진화 캐시 무효화 → 즉시 반영. baseVersion++ 은 유지(변경 시 그날 이후 진화가 달라짐).
 *  minAffectedDay(REALTIME_SIM §7) = 새 세그먼트 fromDay — 순위·생산 캐시는 그 이전 행을 스플라이스 재사용한다
 *  (스토어가 fromDay를 넘김). 단 진화 메모(evoOneCache)는 세대키가 baseVersion에 결합돼 여전히 전체 리셋(§7.2 유보). */
export function setFocusTimeline(teamId: string, segments: FocusSeg[], minAffectedDay = 0): void {
  const clean = segments.filter((s): s is FocusSeg => !!s && Number.isFinite(s.fromDay));
  if (clean.length) focusTimeline[teamId] = [...clean].sort((a, b) => a.fromDay - b.fromDay);
  else delete focusTimeline[teamId];
  rebuildFocus();
  evoCache = null;
  _baseVersion++;
  recordBump(minAffectedDay); // 순위·생산 스플라이스(§7): 새 세그먼트 fromDay 이전 행 재사용. evoOneCache는 base++로 전체 리셋(§7.2 유보)
}

/** 단장 훈련 방향 설정(null=감독 기본 복원) — **day0부터 상수 방침**(단일 세그먼트) 호환 경로.
 *  시뮬 도구·가드·구경로용. 스토어의 "바꾼 날부터"는 setFocusTimeline(타임라인)을 쓴다. */
export function setFocusOverride(teamId: string, focus: TrainingFocus | null): void {
  setFocusTimeline(teamId, focus ? [{ fromDay: 0, focus }] : []);
}

/** 팀의 현재(최신) 단장 오버라이드 방침 — 없으면 null(감독 기본과 구분). 표시·가드용. */
export const getFocusOverride = (teamId: string): TrainingFocus | null => {
  const segs = focusTimeline[teamId];
  return segs && segs.length ? (segs[segs.length - 1].focus ?? null) : null;
};

export const getTeam = (id: string): Team | undefined => teamMap.get(id);
/** 팀명 짧은 표기 — "도시 팀명"에서 팀명(마지막 어절)만. 마커·좁은 칸용 */
export const shortTeamName = (id: string): string => {
  const n = getTeam(id)?.name ?? id;
  return n.split(' ').slice(-1)[0] || n;
};
export const getPlayer = (id: string): Player | undefined => playerMap.get(id);

/** 떠난 외국인·아시아쿼터 이름 복원 — 활동 풀에서 사라진 선수(시상식·연표 기록에 playerId만 남음)의 이름을
 *  id 결정론으로 재구성한다(makePlayer가 `genForeignName(id)`/`genAsianIdentity(id)`로 이름을 붙임 — 순수 함수라
 *  언제든 동일 복원. dedup 재배정은 드문 동명 충돌 시에만이라 표시상 무시 가능). 국내 선수는 대상 아님(null →
 *  호출부가 HOF·raw id로 폴백). 버그: fgn-s1-6 같은 원시 ID/공백 노출(2026-07-11 테스터). */
export function reconstructForeignName(id: string): string | null {
  if (id.startsWith('fgn-')) return genForeignName(id);
  if (id.startsWith('asn-')) return genAsianIdentity(id).name;
  return null;
}
export const getCoach = (id: string): Coach | undefined => coachMap.get(id);
export const getFixture = (id: string): Fixture | undefined => fixtureMap.get(id);

export const teamPlayerIds = (teamId: string): string[] => rosters[teamId] ?? [];

export const getTeamPlayers = (teamId: string): Player[] =>
  teamPlayerIds(teamId)
    .map((pid) => playerMap.get(pid))
    .filter((p): p is Player => !!p);

export const getTeamCoach = (teamId: string): Coach | undefined => teamHeadCoach(teamId);

/** 경기 엔진용 감독 정보(성향·카리스마) — MATCH_SYSTEM 8장. 영입 감독 반영.
 *  day 주면 **그날의 감독**(축3 forward-only, 부임 이전 경기는 이전 감독). 생략하면 현재 감독(포스트시즌·표시·도구용). */
export const coachInfoOf = (teamId: string, day?: number): CoachInfo | undefined => {
  const c = day === undefined ? teamHeadCoach(teamId) : teamHeadCoachOn(teamId, day);
  return c ? { style: c.style, matchOps: c.matchOps } : undefined;
};

// ─── 스태프 시장·계약(STAFF_SYSTEM) ───
const isCoachHired = (id: string) => Object.values(headCoachOverride).includes(id);
const isAsstHired = (id: string) => Object.values(teamAssistantIds).some((a) => a.includes(id));
const isScoutHired = (id: string) => Object.values(teamScoutIds).some((a) => a.includes(id));

/** 영입 가능한 프리 감독(teamId=null, 미계약). teamId 주면 그 팀에서 경질된 감독은 제외(다시 안 옴 — STAFF_SYSTEM 6.4) */
export const availableCoaches = (teamId?: string): Coach[] =>
  coachPool.filter((c) => c.teamId === null && !isCoachHired(c.id)
    && !(teamId !== undefined && (c.firedFrom ?? []).includes(teamId)));
export const availableAssistants = (): AssistantCoach[] => assistantPool.filter((a) => !isAsstHired(a.id));

/** 감독 생애주기 반영 — 풀(감독+코치)을 통째 교체하고 맵 재구성(STAFF_SYSTEM 6, 오프시즌 호출) */
export function commitCoachPool(coaches: Coach[], assistants: AssistantCoach[]): void {
  coachPool = coaches;
  assistantPool = assistants;
  coachMap.clear();
  for (const c of coachPool) coachMap.set(c.id, c);
  assistantMap = new Map(assistantPool.map((a) => [a.id, a]));
}
export const currentCoachPool = (): { coaches: Coach[]; assistants: AssistantCoach[] } => ({ coaches: coachPool, assistants: assistantPool });
export const availableScouts = (): Scout[] => LEAGUE.scouts.filter((s) => !isScoutHired(s.id));

export const teamAssistants = (teamId: string): AssistantCoach[] => teamAssistantsOf(teamId);
export const teamScouts = (teamId: string): Scout[] => teamScoutsOf(teamId);

/** 팀 스태프 연봉 지출 합(만원) — 현 감독 + 코치 + 스카우터 */
export function staffSpend(teamId: string): number {
  const head = teamHeadCoach(teamId)?.salary ?? 0;
  const ac = teamAssistantsOf(teamId).reduce((s, a) => s + a.salary, 0);
  const sc = teamScoutsOf(teamId).reduce((s, x) => s + x.salary, 0);
  return head + ac + sc;
}
export const staffBudget = (): number => STAFF_BUDGET;
export const staffBudgetLeft = (teamId: string): number => STAFF_BUDGET - staffSpend(teamId);

/** 드래프트 유망주 공개도 0~1 (스카우터 기반) */
export const teamScoutReveal = (teamId: string): number =>
  // 진단 전용(밸런스 A/B 3번째 팔): FORCE_REVEAL=1이면 전 팀 공개도 1 → 스카우팅 비대칭 제거, 새 타게팅만 격리 측정.
  (typeof process !== 'undefined' && process.env && process.env.FORCE_REVEAL) ? 1 : scoutReveal(teamScoutsOf(teamId));

function invalidateStaff(affectsTraining: boolean, minAffectedDay = 0): void {
  // baseVersion(전 시즌 결과/생산 캐시 키)은 *시뮬에 영향을 주는* 스태프 변경에서만 올린다.
  // 스카우터(드래프트 표시만)·감독 재계약(계약만)은 경기 결과가 byte 동일 → 무효화하면
  // 같은 숫자를 1.7s 재시뮬하는 순수 낭비 프리즈였다(검증: A/B 결과 동일, baseVersion 키 캐시는
  // 전부 진화/경기 시뮬용뿐 — 스카우팅 공개도는 baseVersion 무관). 2026-06-24 교정.
  // minAffectedDay(축3): 시즌 중 감독 영입은 부임일 접미만 무효화(forward-only, 순위·생산 스플라이스). 기본 0=소급(전체).
  if (affectsTraining) { rebuildFocus(); evoCache = null; _baseVersion++; recordBump(minAffectedDay); }
}

/** 감독 영입(시드 감독 대체). 예산 초과면 거부(false).
 *  hireDay(축3, 기본 0): 부임일. 0이면 소급(day0부터 = 구경로·도구 byte 불변), >0이면 forward-only(부임 이전 경기는 이전 감독). */
/** 감독 계약(신규 영입·재계약) 연수 — UI 표시("N년 계약")와 엔진 배정이 같은 상수(UI_RULES UV-11). */
export const STAFF_CONTRACT_YEARS = 3;

export function hireHeadCoach(teamId: string, coachId: string, hireDay = 0): boolean {
  const c = coachMap.get(coachId);
  if (!c || (c.teamId !== null) || isCoachHired(coachId)) return false;
  if ((c.firedFrom ?? []).includes(teamId)) return false; // 그 팀에서 경질된 감독은 다시 영입 불가(STAFF_SYSTEM 6.4)
  const newSpend = staffSpend(teamId) - (teamHeadCoach(teamId)?.salary ?? 0) + c.salary;
  if (newSpend > STAFF_BUDGET) return false;
  if (hireDay > 0) pushCoachSeg(teamId, hireDay, coachId); // 축3: headCoachOverride 갱신 **전**(부임 전 감독을 baseline으로)
  else headCoachTimeline[teamId] = []; // day0 영입=소급 → 타임라인 붕괴(현재 감독 = day0)
  const prev = headCoachOverride[teamId];
  if (prev?.startsWith('acting_')) {
    coachPool = coachPool.filter((x) => x.id !== prev); // 대행은 영입 목록에서 제거
    if (hireDay <= 0) coachMap.delete(prev); // 소급이면 과거 세그먼트가 대행을 참조 안 함 → 맵에서도 제거. forward면 [0,hireDay) 세그먼트가 참조 → 맵 유지(coachInfoOf 해석용)
  }
  else if (prev) { const pc = coachMap.get(prev); if (pc) { pc.teamId = null; pc.contractYears = undefined; } } // 기존 감독 FA로
  else { const seed = teamHeadCoach(teamId); if (seed && seed.id !== coachId) { seed.teamId = null; seed.contractYears = undefined; } } // 오버라이드 없던(시드 감독) 교체 — 떠나는 시드 감독을 FA로(teamId 고아 점유 방지)
  headCoachOverride[teamId] = coachId;
  c.teamId = teamId; c.contractYears = STAFF_CONTRACT_YEARS; // 단일 진실 + 계약 연수
  invalidateStaff(true, hireDay); // 성향·훈련선호 바뀜 — 부임일 접미만(forward-only)
  return true;
}
/** 생애주기 재배정 — 예산·검증 없이 감독을 팀에 배정(AI 자동 선임, STAFF_SYSTEM 6). null=배정 해제(기본 감독). */
export function assignCoach(teamId: string, coachId: string | null): void {
  const prev = headCoachOverride[teamId]; if (prev && prev !== coachId) { const pc = coachMap.get(prev); if (pc) { pc.teamId = null; pc.contractYears = undefined; } }
  if (coachId === null) delete headCoachOverride[teamId];
  else { headCoachOverride[teamId] = coachId; const c = coachMap.get(coachId); if (c) c.teamId = teamId; }
  delete headCoachTimeline[teamId]; // 소급 배정(오프시즌 AI 재배정 등, recordBump 0) → 타임라인 붕괴(day0부터 새 감독)
  invalidateStaff(true);
}

/** 시즌 중 감독 경질 — 현 감독을 FA로 내보내고(그 팀 영구 배제), 전문 코치 중 최고 역량을
 *  감독 대행(acting)으로 임시 승격. 코치 없으면 공석(기본 감독). 새 감독 영입 시 대행 해제(STAFF_SYSTEM 6.4). */
export function fireCoach(teamId: string): { acting: string | null } {
  const cur = teamHeadCoach(teamId);
  if (cur && !cur.id.startsWith('acting_')) { cur.teamId = null; cur.contractYears = undefined; cur.firedFrom = [...(cur.firedFrom ?? []), teamId]; }
  delete headCoachOverride[teamId];
  delete headCoachTimeline[teamId]; // 경질=소급(recordBump 0, 현행 유지) → 타임라인 붕괴(대행/공석이 day0부터)
  // 전문 코치 중 최고 역량을 대행으로 캐스팅(임시 Coach — 새 감독 영입 시 제거)
  const best = teamAssistantsOf(teamId).sort((a, b) => b.rating - a.rating)[0];
  if (best) {
    const style: CoachStyle = best.specialty === 'attack' ? 'attack' : best.specialty === 'defense' ? 'defense' : 'balanced';
    const acting: Coach = {
      id: `acting_${teamId}`, name: `${best.name} (대행)`, age: best.age,
      matchOps: Math.round(best.rating * 0.7), ...deriveHeadAxes(`acting_${teamId}`), renown: interimRenown(`acting_${teamId}`), style, archetype: '감독 대행', // 대행 페널티 ×0.7(§6.4·§9.4) — 경기 운영에 승계
      trainingFocus: DEFAULT_FOCUS, salary: 0, teamId, contractYears: 0,
    };
    coachPool = [...coachPool.filter((c) => c.id !== acting.id), acting];
    coachMap.set(acting.id, acting);
    headCoachOverride[teamId] = acting.id;
    invalidateStaff(true);
    return { acting: best.name };
  }
  invalidateStaff(true);
  return { acting: null };
}

/** 내 팀 감독 재계약 — 현 감독 계약을 3년 연장. 만료 임박/만료 시 플레이어가 호출(STAFF_SYSTEM 6). */
export function resignTeamCoach(teamId: string, newSalary?: number): boolean {
  const c = teamHeadCoach(teamId);
  if (!c) return false;
  c.contractYears = STAFF_CONTRACT_YEARS;
  if (typeof newSalary === 'number' && Number.isFinite(newSalary)) c.salary = newSalary; // 명성 반영 요구 연봉으로 갱신(STAFF §9.4 — 계약 시점 재산정)
  invalidateStaff(false); // 효과 불변(계약만)
  return true;
}

/** 감독 방출(놓아주기, STAFF §9.4) — 계약 만료 감독을 FA 풀로 내보낸다(경질과 달리 firedFrom 없음 = 재영입 가능).
 *  경질(fireCoach)은 시즌 중 대행 전환이지만, 놓아주기는 만료 시 명시 방출(관심 구단으로 이동 가능 — Phase C). */
export function releaseTeamCoach(teamId: string): boolean {
  const c = teamHeadCoach(teamId);
  if (!c || c.id.startsWith('acting_')) return false;
  c.teamId = null; c.contractYears = undefined; // FA 풀로(firedFrom 미기록 — 방출은 경질 아님)
  delete headCoachOverride[teamId];
  delete headCoachTimeline[teamId];
  invalidateStaff(true);
  return true;
}

/** 죽은 계약 정리 — 풀에서 사라진(은퇴·승격) 감독/코치를 팀 영입 기록에서 제거(STAFF_SYSTEM 6).
 *  생애주기 후 호출. 반환 = 정리된 영입 상태(스토어 영속용). */
export function reconcileStaff(): { head: Record<string, string>; asst: Record<string, string[]>; scout: Record<string, string[]> } {
  for (const tid of Object.keys(headCoachOverride)) if (!coachMap.has(headCoachOverride[tid])) delete headCoachOverride[tid];
  for (const tid of Object.keys(teamAssistantIds)) teamAssistantIds[tid] = teamAssistantIds[tid].filter((id) => assistantMap.has(id));
  headCoachTimeline = {}; // 오프시즌 경계(축3): 지난 시즌 중 영입 세그먼트를 붕괴 — 다음 시즌은 현재 감독이 day0부터
  invalidateStaff(true);
  return getStaffState();
}
export const coachSlots = (): number => COACH_SLOTS;
export function hireAssistant(teamId: string, id: string): boolean {
  const a = assistantMap.get(id);
  if (!a || isAsstHired(id) || a.teamId !== null) return false; // FA(teamId=null)만 영입 가능
  if ((teamAssistantIds[teamId]?.length ?? 0) >= COACH_SLOTS) return false; // 슬롯 초과
  if (staffSpend(teamId) + a.salary > STAFF_BUDGET) return false;
  teamAssistantIds[teamId] = [...(teamAssistantIds[teamId] ?? []), id];
  a.teamId = teamId; // 단일 진실: 고용되면 teamId 설정(생애주기 승격·FA 풀에서 제외)
  invalidateStaff(true); // 코치 효과 바뀜
  return true;
}
export function releaseAssistant(teamId: string, id: string): void {
  teamAssistantIds[teamId] = (teamAssistantIds[teamId] ?? []).filter((x) => x !== id);
  const a = assistantMap.get(id); if (a) a.teamId = null; // FA 풀로 복귀
  invalidateStaff(true);
}
export function hireScout(teamId: string, id: string): boolean {
  const s = scoutMap.get(id);
  if (!s || isScoutHired(id)) return false;
  if ((teamScoutIds[teamId]?.length ?? 0) >= COACH_SLOTS) return false; // 슬롯 상한(코치와 일관 — 무한 영입 방지)
  if (staffSpend(teamId) + s.salary > STAFF_BUDGET) return false;
  teamScoutIds[teamId] = [...(teamScoutIds[teamId] ?? []), id];
  invalidateStaff(false); // 드래프트 표시만 — 훈련 무관
  return true;
}
export function releaseScout(teamId: string, id: string): void {
  teamScoutIds[teamId] = (teamScoutIds[teamId] ?? []).filter((x) => x !== id);
  invalidateStaff(false);
}

/** 세이브 동기화 — 스토어에서 영입 상태 주입.
 *  timeline(축3, 가법): 감독 부임 타임라인 복원. 없으면(구세이브) 빈 타임라인 → coachInfoOf가 현재 감독 소급(day0 백필과
 *  동일 = 과거 byte 불변). 신세이브는 저장된 타임라인으로 forward-only(시즌 중 영입) 재현이 재로드 후에도 유지된다. */
export function commitStaff(head: Record<string, string>, asst: Record<string, string[]>, scout: Record<string, string[]>, timeline?: Record<string, CoachSeg[]>): void {
  headCoachOverride = { ...head };
  teamAssistantIds = { ...asst };
  teamScoutIds = { ...scout };
  headCoachTimeline = {};
  if (timeline) for (const t of Object.keys(timeline)) { const segs = (timeline[t] ?? []).filter((s) => s && Number.isFinite(s.fromDay)); if (segs.length) headCoachTimeline[t] = [...segs].sort((a, b) => a.fromDay - b.fromDay); }
  rebuildFocus(); evoCache = null; clearEvoOne(); _baseVersion++; recordBump(0);
}

// ─── 격리 실행용 스냅샷/복원 (영입 무결성 감사 등 — 라이브 세이브를 건드리지 않고 시뮬) ───
const jclone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export interface LeagueSnapshot {
  rosters: Record<string, string[]>;
  players: Player[];                 // 참조 보관(감사는 새 객체로 덮어쓰므로 원본 불변)
  coaches: Coach[]; assistants: AssistantCoach[];
  head: Record<string, string>; asst: Record<string, string[]>; scout: Record<string, string[]>;
  focus: Record<string, FocusSeg[]>; // 훈련 방침 타임라인(A4)
  coachTl: Record<string, CoachSeg[]>; // 감독 부임 타임라인(축3) — 격리 감사가 라이브 forward-only 상태를 보존
  myTeamStaff: string;
}

/** 현재 가변 리그 상태를 통째로 캡처 — restoreLeagueState 로 원복. 감독은 in-place 변형되므로 깊은 복제. */
export function snapshotLeagueState(): LeagueSnapshot {
  return {
    rosters: jclone(rosters),
    players: [...playerMap.values()],
    coaches: coachPool.map((c) => ({ ...c, firedFrom: c.firedFrom ? [...c.firedFrom] : undefined, trainingFocus: jclone(c.trainingFocus) })),
    assistants: assistantPool.map((a) => ({ ...a })),
    head: { ...headCoachOverride }, asst: jclone(teamAssistantIds), scout: jclone(teamScoutIds),
    focus: jclone(focusTimeline),
    coachTl: jclone(headCoachTimeline),
    myTeamStaff,
  };
}

/** 스냅샷으로 리그 상태 원복(감사 종료 후 라이브 세이브 복귀). 신선한 복제로 주입해 이후 변형이 스냅샷을 오염시키지 않게. */
export function restoreLeagueState(s: LeagueSnapshot): void {
  playerMap.clear();
  for (const p of s.players) playerMap.set(p.id, p);
  rosters = jclone(s.rosters);
  commitCoachPool(s.coaches.map((c) => ({ ...c, firedFrom: c.firedFrom ? [...c.firedFrom] : undefined })), s.assistants.map((a) => ({ ...a })));
  headCoachOverride = { ...s.head };
  teamAssistantIds = jclone(s.asst);
  teamScoutIds = jclone(s.scout);
  focusTimeline = jclone(s.focus);
  headCoachTimeline = s.coachTl ? jclone(s.coachTl) : {}; // 축3: 라이브 감독 타임라인 복원(구 스냅샷=없음→{})
  myTeamStaff = s.myTeamStaff;
  rebuildFocus(); evoCache = null; clearEvoOne(); _baseVersion++; recordBump(0);
}
export const getStaffState = () => ({ head: { ...headCoachOverride }, asst: { ...teamAssistantIds }, scout: { ...teamScoutIds } });

/** 감독 부임 타임라인(축3) — 세이브 영속용(partialize가 저장 시점 라이브 상태를 읽음). 시즌 중 영입이 없으면 대개 {}. */
export const getCoachTimeline = (): Record<string, CoachSeg[]> => {
  const out: Record<string, CoachSeg[]> = {};
  for (const t of Object.keys(headCoachTimeline)) { const segs = headCoachTimeline[t]; if (segs && segs.length) out[t] = segs.map((s) => ({ ...s })); }
  return out;
};

/** 시작 기본 스태프(ONBOARDING 6) — 플레이어 팀이 영입 스태프 0이면 FA 풀에서 **중위권** 전문코치 1 +
 *  스카우터 1을 결정론(역량 정렬 후 중앙값)으로 자동 영입(예산·슬롯 내). 이미 있으면 무시(멱등).
 *  AI 팀은 별도 기본 스태프(`aiTeam*`)를 쓰므로 여기 무관 — 플레이어만 0→기본으로 끌어올린다.
 *  이후 단장이 방출·상위 교체 가능(슬롯 3 + 상위 풀로 능가하는 레버는 유지). 반환 = 영속용 staff 상태. */
export function grantStartingStaff(teamId: string): { head: Record<string, string>; asst: Record<string, string[]>; scout: Record<string, string[]> } {
  if ((teamAssistantIds[teamId]?.length ?? 0) === 0) {
    const fa = availableAssistants().slice().sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id));
    const pick = fa[Math.floor(fa.length / 2)];
    if (pick) hireAssistant(teamId, pick.id);
  }
  if ((teamScoutIds[teamId]?.length ?? 0) === 0) {
    const fa = availableScouts().slice().sort((a, b) => a.scouting - b.scouting || a.id.localeCompare(b.id));
    const pick = fa[Math.floor(fa.length / 2)];
    if (pick) hireScout(teamId, pick.id);
  }
  return getStaffState();
}

/** 선수 → 소속팀 **날짜별** 훈련방침 해석기 (롤오버/진화 성장 방향, A4 타임라인).
 *  로스터 밖(FA 등)은 상수 감독기본(DEFAULT_FOCUS) 해석기 — 기존 단일 focus와 바이트 동일. */
export const focusOf = (p: Player): FocusResolver => playerFocus.get(p.id) ?? (() => DEFAULT_FOCUS);

/** 선수 → 소속팀 전문코치 종합 효과 (롤오버 영구 성장에 반영) */
export const effectsOf = (p: Player): StaffEffects => playerEffects.get(p.id) ?? NO_EFFECTS;

// ─── 세이브 동기화 (레지스트리/로스터) ───

/** 현재 활성(로스터 등록) 선수들 — 롤오버 대상 */
export const currentBasePlayers = (): Player[] => {
  const out: Player[] = [];
  for (const ids of Object.values(rosters)) {
    for (const id of ids) {
      const p = playerMap.get(id);
      if (p) out.push(p);
    }
  }
  return out;
};

/** 선수 상태 스냅샷을 레지스트리에 반영(신규 id 포함). 구세이브 호환: 특성 없으면 id 시드로 보정 */
export function commitPlayerBase(snapshot: Record<string, Player>): void {
  for (const id of Object.keys(snapshot)) {
    const p = snapshot[id];
    playerMap.set(id, p.traits ? p : { ...p, traits: rollTraits(id) });
  }
  evoCache = null;
  clearEvoOne(); // 축1: 시즌 경계 base 교체 → 메모 비움(메모리 바운드). 참조검사가 정확성은 보장하나 여기서 정리
  _baseVersion++;
  recordBump(0); // 선수 베이스 스냅샷 반영 = 전 시즌 진화/경기 소급 변경 가능 → 전체 무효화
}

/** 가변 로스터 반영 */
export function commitRosters(next: Record<string, string[]>): void {
  rosters = next;
  rebuildFocus();
  evoCache = null;
  clearEvoOne(); // 축1: 로스터 교체 → 메모 비움(메모리 바운드)
  _baseVersion++;
  recordBump(0); // 로스터 통째 교체 = 전 시즌 소급 → 전체 무효화
}

export const currentRosters = (): Record<string, string[]> => rosters;
export const defaultRosters = seedRosters;

/** 세이브 초기화 시 시드 상태로 복원 */
export function resetLeagueBase(): void {
  for (const p of LEAGUE.players) playerMap.set(p.id, p);
  rosters = seedRosters();
  // pristine 클론으로 복원 — in-place 변이(teamId)된 참조가 아니라 시드 원본을 되살린다(결정론·새게임 스타팅스태프 일관)
  commitCoachPool(seedCoaches.map((c) => ({ ...c })), seedAssistants.map((a) => ({ ...a })));
  scoutMap = new Map(seedScouts.map((s) => [s.id, { ...s }]));
  focusTimeline = {};
  headCoachOverride = {};
  headCoachTimeline = {};
  teamAssistantIds = {};
  teamScoutIds = {};
  rebuildFocus();
  evoCache = null;
  clearEvoOne();
  _baseVersion++;
  recordBump(0); // 세이브 초기화 = 전체
}

/**
 * 시뮬 전용: 리그/시즌을 새 시드로 통째로 재생성(독립 유니버스).
 * 앱/세이브 경로는 사용하지 않는다 — `tools/simLeague.ts` 다중 유니버스 통계용.
 */
export function reseedLeague(leagueSeed: number, seasonSeed: number): void {
  LEAGUE = generateLeague(leagueSeed);
  SEASON = generateSeason(LEAGUE.teams.map((t) => t.id), seasonSeed);
  teamMap.clear();
  for (const t of LEAGUE.teams) teamMap.set(t.id, t);
  playerMap.clear();
  for (const p of LEAGUE.players) playerMap.set(p.id, p);
  // 새 유니버스 — 시드 스태프 스냅샷도 pristine으로 갱신(resetLeagueBase 복원의 단일 진실)
  seedCoaches = LEAGUE.coaches.map((c) => ({ ...c }));
  seedAssistants = LEAGUE.assistants.map((a) => ({ ...a }));
  seedScouts = LEAGUE.scouts.map((s) => ({ ...s }));
  commitCoachPool(seedCoaches.map((c) => ({ ...c })), seedAssistants.map((a) => ({ ...a })));
  scoutMap = new Map(seedScouts.map((s) => [s.id, { ...s }]));
  fixtureMap.clear();
  for (const f of SEASON) fixtureMap.set(f.id, f);
  rosters = seedRosters();
  focusTimeline = {};
  headCoachOverride = {};
  headCoachTimeline = {};
  teamAssistantIds = {};
  teamScoutIds = {};
  aiAsstCache.clear(); aiScoutCache.clear(); // 새 유니버스 — AI 기본 스태프 캐시 무효화
  rebuildFocus();
  evoCache = null;
  clearEvoOne();
  _baseVersion++;
  recordBump(0); // 새 유니버스 = 전체
}

// ─── 진화(성장/노쇠) 적용 선수 — currentDay 기준, 날짜별 캐시 ───

export function evolvedPlayers(day: number): Map<string, Player> {
  day = Math.min(day, SEASON_DAYS); // 포스트시즌 동결(§5): currentDay>164여도 진화는 정규 종료(164)로 클램프 — 플옵 기간 훈련/노쇠 없음
  if (evoCache && evoCache.day === day) return evoCache.map;
  const map = new Map<string, Player>();
  for (const team of LEAGUE.teams) {
    const resolver = teamFocusResolver(team.id); // 날짜별 방침(A4 — "바꾼 날부터" 세그먼트 반영)
    const effects = staffEffects(teamAssistantsOf(team.id)); // 전문 코치 효과(속도·포텐·노쇠)
    for (const pid of rosters[team.id] ?? []) {
      const base = playerMap.get(pid);
      if (base) map.set(pid, evolvePlayer(base, resolver, day, effects));
    }
  }
  evoCache = { day, map };
  return map;
}

export const getEvolvedPlayer = (id: string, day: number): Player | undefined =>
  evolvedPlayers(day).get(id);

// 임의 선수(로스터 외 FA 포함)를 day까지 진화 — 날짜 인지 명단(dynamics)용.
// 축1(콘텐츠 시그니처 캐싱, REALTIME_SIM §7.2 정정): 구현은 baseVersion 단일 세대키로 **전체 clear**였다 —
//   어떤 bump(감독 영입 등)든 6/7팀이 안 바뀌는데도 헛계산(폰 ~11s의 86%). 이제 엔트리마다 **선수별 진화 입력
//   서명**을 저장하고, 입력이 그대로면 baseVersion이 올라도 자동 재사용(self-healing). 서명 =
//   base(참조동일) + 팀 focus 서명 + 팀 effects 서명. 이 셋이 evolvePlayer(base, focusOf, day, effectsOf) 입력과 대응.
//   evolvePlayer 순수함수·결정론 핵심은 미변 — 캐시 키 정밀도만 상향(§7.2가 유보했던 건 "날짜범위 분리", 이건 "팀/콘텐츠 분리").
// 메모리 바운드: 시즌 경계(commitPlayerBase/commitRosters/reset/reseed/restore)에서 clearEvoOne()로 비운다 —
//   시즌 중 액션(영입·훈련·거래·벤치)은 안 비워 재사용 유지(축1 이득), 크기 ≈ 선수수 × 조회날짜(1시즌분) bounded.
const evoOneCache = new Map<string, { base: Player; fsig: string; esig: string; player: Player }>();
// §7.9 진화 점진 캐시(c1) — evolveOnDay forward-sweep 재개용 체크포인트. evolvePlayer의 은닉상태는 정확히
//   Player(xp 포함) + per-player RNG 스트림 위치(rngState=rng.state())뿐 — 둘을 저장하면 byte-동일 재개 가능(리뷰 검증).
//   per-id **최원거리 day 하나만** 유지(R4). 콜드 O(day)를 O(Δday)로 → dynamics.compute 전진 패스의 준이차 제거.
//   clearEvoOne(시즌 경계)에서 evoOneCache와 함께 비운다(메모리 바운드·서명 정확성은 참조/서명 검사가 보장).
type EvoCkpt = { day: number; player: Player; rngState: number; base: Player; fsig: string; esig: string };
const evoCheckpoint = new Map<string, EvoCkpt>();
function clearEvoOne(): void { evoOneCache.clear(); evoCheckpoint.clear(); }
// A/B 측정·회귀 방어 레버(§7.9) — 셋되면 재개 폴백(항상 base 콜드). NO_FITPICK 등과 동일 패턴.
const noEvoResume = (): boolean => typeof process !== 'undefined' && !!process.env && !!process.env.NO_EVORESUME;
export function evolveOnDay(id: string, day: number): Player | undefined {
  day = Math.min(day, SEASON_DAYS); // 포스트시즌 동결(§5) — evolvedPlayers와 동일 클램프
  const base = playerMap.get(id);
  if (!base) return undefined;
  const fsig = playerFocusSig.get(id) ?? SENT_FOCUS_SIG;   // 로스터 밖(FA)=센티넬(focusOf=()=>DEFAULT_FOCUS 대응)
  const esig = playerEffectsSig.get(id) ?? SENT_EFFECTS_SIG;
  const k = `${id}:${day}`;
  const hit = evoOneCache.get(k);
  if (hit && hit.base === base && hit.fsig === fsig && hit.esig === esig) return hit.player; // 정확일치 fast-path → 재사용

  // §7.9 점진 재개: 체크포인트가 현재 서명과 일치하고 요청일 ≥ 체크포인트일이면 그 지점부터 evolveSpan(Δday).
  //   evolveOnDay는 skip=0(출장정지 프런트로드 없음)이라 evolveSpan(skip=0). 서명 불일치/역행이면 base 콜드 폴백(R2).
  const cp = evoCheckpoint.get(id);
  const sameSig = !!cp && cp.base === base && cp.fsig === fsig && cp.esig === esig;
  let ev: Player, endRng: number;
  if (sameSig && !noEvoResume() && day >= cp!.day) {
    const r = evolveSpan(cp!.player, cp!.rngState, focusOf(base), effectsOf(base), 0, cp!.day, day);
    ev = r.player; endRng = r.rngState;
  } else {
    const r = evolveSpan(base, initialEvoRngState(id), focusOf(base), effectsOf(base), 0, 0, day); // == evolvePlayer(base, …, day)
    ev = r.player; endRng = r.rngState;
  }
  evoOneCache.set(k, { base, fsig, esig, player: ev });
  // 체크포인트는 최원거리 day만 유지(R4) — 서명이 같고 이번 day가 더 과거면 그대로, 아니면(전진/서명변경) 현재 값으로 교체.
  if (!(sameSig && day < cp!.day)) evoCheckpoint.set(id, { day, player: ev, rngState: endRng, base, fsig, esig });
  return ev;
}

export const getEvolvedTeamPlayers = (teamId: string, day: number): Player[] => {
  const m = evolvedPlayers(day);
  return teamPlayerIds(teamId)
    .map((pid) => m.get(pid))
    .filter((p): p is Player => !!p);
};
