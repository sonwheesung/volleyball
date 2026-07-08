// 시즌 롤오버 (다중 시즌 — 백년 운영). 순수 함수.
// 한 시즌치 성장/노쇠를 누적 → 나이 +1 → 계약 -1(만료 시 자동 재계약).
// 시즌 경계에서 1회 호출해 다음 시즌의 base 스냅샷을 만든다.

import type { Contract, Player, TrainableStat } from '../types';
import { evolvePlayer, type FocusInput } from './progression';
import { type StaffEffects, NO_EFFECTS } from './staff';
import { FIRST_FA_SEASONS } from './faMarket';
import { clampSalary, LEAGUE_CAP } from './cap';
import { capContractYears } from './retire';
import { marketValue } from './salary';
import { createRng, strSeed } from './rng';
import { TRAINABLE_STATS } from './training';
import { SEASON_DAYS } from './calendar';

export const SEASON_LENGTH = SEASON_DAYS; // 한 시즌 캘린더 일수(진화량 기준) — 단일 출처(engine/calendar)
const RENEW_YEARS = 2;

// ── 돌파(Breakthrough, TRAINING 9장) ── 어린 선수가 한 시즌에 갑자기 확 크는 희귀 이벤트.
//  결정론(id + 경력시즌). 성장 여지(헤드룸) 큰 스탯에 한 번에 큰 덩어리를 꽂는다(포텐 상한 보존).
const BREAKTHROUGH_AGE = 23;     // 이 나이 이하만(영건)
const BREAKTHROUGH_RATE = 0.05;  // 자격 선수 중 시즌당 발생률
const BREAKTHROUGH_HEADROOM = 12; // 전체 헤드룸 합 하한(성장 여지 없으면 무의미)

/** 돌파 적용(없으면 원본 반환). grown = 이번 시즌 정상 성장까지 끝난 선수. */
export function maybeBreakthrough(grown: Player): Player {
  if (grown.age > BREAKTHROUGH_AGE) return grown;
  const head = (s: TrainableStat) => Math.max(0, (grown.potential[s] ?? 0) - (grown[s] as number));
  const total = TRAINABLE_STATS.reduce((a, s) => a + head(s), 0);
  if (total < BREAKTHROUGH_HEADROOM) return grown;
  const rng = createRng(strSeed(`breakthrough:${grown.id}:${grown.career.seasons}`));
  if (rng.next() >= BREAKTHROUGH_RATE) return grown;
  // 헤드룸 큰 상위 4스탯에 헤드룸 60%(+3~+6)씩 — 포텐 상한 보존. "확 크는" 체감 + 절제(밸런스)
  const top = [...TRAINABLE_STATS].sort((a, b) => head(b) - head(a)).slice(0, 4);
  const next = { ...grown } as Player & Record<string, number>;
  for (const s of top) {
    const room = head(s);
    if (room <= 0) continue;
    next[s] = (grown[s] as number) + Math.min(room, Math.max(3, Math.round(room * 0.6)), 6);
  }
  return next;
}

/** 시장가치로 재계약된 계약(자동연장·잔류). 개인 연봉 상한(프랜차이즈 예외) 적용.
 *  medOvr = 리그 국내 OVR 중앙값(시대 앵커, SALARY 2장 2026-07-02) — buildOffseason이 계산해 전달. */
export function renewedContract(p: Player, medOvr: number): Contract {
  // 정년 캡: p.age = 롤오버된 나이(=계약 첫 시즌 나이) → 39세까지만(RETIRE_AGE−age). 노장 다년계약 캡누수 차단.
  const yrs = capContractYears(p.age, RENEW_YEARS);
  return { salary: clampSalary(marketValue(p, medOvr), p), years: yrs, remaining: yrs, signedAtAge: p.age };
}

/** 한 선수의 시즌 롤오버. medOvr = 시대 앵커(영건 자동연장 연봉용). override = 시즌 중 재계약된 계약(있으면 우선).
 *  effects = 전문 코치 효과(STAFF). lostDays = 출장정지 결장일(훈련 생략 — 성장 정체·노장 하락, OWNER_SYSTEM 4.6) */
export function rolloverPlayer(base: Player, focus: FocusInput, medOvr: number, override?: Contract, effects: StaffEffects = NO_EFFECTS, lostDays = 0): Player {
  // 1) 시즌치 성장/노쇠 누적 — 전문 코치 효과(속도·포텐 상한·노쇠 지연)를 영구 반영. 정지일은 훈련 생략.
  //    + 어린 선수 희귀 돌파(갑자기 확 큼, TRAINING 9장)
  const grown = maybeBreakthrough(evolvePlayer(base, focus, SEASON_LENGTH, effects, lostDays));
  // 2) 나이 +1
  const aged: Player = { ...grown, age: grown.age + 1 };
  // 3) 경력 +1 (FA 자격 기준)
  const career = { ...aged.career, seasons: aged.career.seasons + 1 };
  // 4) 계약: 잔여 -1. 만료 시 — FA 자격자면 미계약(FA), 아니면 자동연장(영건 보유)
  //    override(시즌 중 재계약)는 정상 계약일 때만 사용 — 음수/0/NaN 연봉·비정상 연수는 무시하고 base로
  //    (심층 방어: 손상 세이브·버그성 override가 payroll 음수→캡 무력화하는 것 차단. EC-TX-04)
  const okOverride = override && Number.isFinite(override.salary) && override.salary > 0 && override.salary <= LEAGUE_CAP
    && Number.isFinite(override.remaining) && override.remaining >= 1;
  const cur = okOverride ? override! : aged.contract;
  const remaining = cur.remaining - 1;
  let contract: Contract;
  if (remaining > 0) contract = { ...cur, remaining };
  else if (career.seasons >= FIRST_FA_SEASONS) contract = { ...cur, remaining: 0 }; // FA 공시
  else contract = renewedContract(aged, medOvr); // 영건 자동연장
  // 현 구단 근속 +1 (이적 시 store 에서 0으로 리셋)
  const clubTenure = (aged.clubTenure ?? 0) + 1;
  return { ...aged, contract, career, clubTenure };
}

/** 리그 전체 롤오버 → 다음 시즌 base 스냅샷. medOvr = 시대 앵커(호출부가 medianOvr로 계산). */
export function rolloverLeague(
  players: Player[],
  focusOf: (p: Player) => FocusInput, // 상수 방침 또는 날짜별 해석기(A4 — 시즌 중 방침 변경 세그먼트 반영)
  medOvr: number,
  overrides: Record<string, Contract>,
  effectsOf?: (p: Player) => StaffEffects,
  lostDaysOf?: (p: Player) => number, // 출장정지 결장일(훈련 생략) — 미지정이면 0(기존과 동일)
): Record<string, Player> {
  const out: Record<string, Player> = {};
  for (const p of players) out[p.id] = rolloverPlayer(p, focusOf(p), medOvr, overrides[p.id], effectsOf?.(p), lostDaysOf?.(p) ?? 0);
  return out;
}
