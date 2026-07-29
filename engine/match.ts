// 세트/경기 진행 (CLAUDE.md 4.4, MATCH_SYSTEM 7·8장).
// 1~4세트 25점, 5세트 15점, 모두 듀스(2점차). 5세트 3선승. 랠리포인트제.
// 매 세트 서브권 시작 팀 교대. 사이드아웃 시 회전(1.1) + 기세 갱신(7.2) + 타임아웃(7.4).
// playRally를 돌려 SimResult(간이 시뮬과 동일 계약)를 출력 → 드롭인 교체 가능.

import type { Player, Side, CoachStyle, SubPolicy, Position, Trait } from '../types';
import type { SimResult, PointLog, SubEvent, TimeoutEvent, TimeoutCourtStam, SubKind, MatchIntervention, ReactiveEvent } from './simMatch';
import type { Ratings } from './ratings';
import { createRng, strSeed } from './rng';
import { deriveRatings } from './ratings';
import { buildLineup } from './lineup';
import { playRally, momFactor, STAM_REGEN_BASE, type RallyTeam, type Edge, type RallyStats, type PosStats, type BoxSink } from './rally';
import type { RallyEvent } from './events';
import { rotate, serverIndex, frontRow, backRow } from './rotation';
import { staminaRegenTraitMult, tickReactiveBuffs } from './traits';

// 경기 시뮬 결과 버전 — rally/match/simMatch/ratings 등 *경기 결과를 바꾸는* 엔진 변경 시 +1.
// (dyn 재생을 바꾸는 시즌 계층 규칙 변경도 포함 — 캐시가 dyn을 함께 영속하므로, v3.)
// REALTIME_SIM Phase2(G3): simCache는 이 버전을 태깅·게이트해, 엔진 재튜닝(앱 업데이트) 후 저장된 옛-엔진
// 순위를 폐기하고 새 엔진으로 재계산한다 → 저장 순위 ↔ 과거경기 보드 재생 일관성 보장.
export const ENGINE_VERSION = 19; // 19(2026-07-29, MATCH §7.1 피로 곡선 극화 — 사용자 "5세트 30%대까지 될만하게"): 랠리회복 STAM_REGEN_BASE 0.005→0.0015·세트간 SET_REST 0.035→0.012·소모 HOP_COST 0.024→0.026 로 체력 곡선을 완만(5세트 코트 선발 ~80%)→극화(선발 ~39.7%·주공격수 ~30%대)로. 폭주하는 자동 피로교체는 **삭제가 아니라 문턱 재스케일**(REST_THRESHOLD 0.35→0.15, 독립리뷰 반영 — 삭제 시 감독 방치 장면·뎁스 무의미 자멸) + 크런치 제외·합리게이트·eff 하한 0.70 유지로 접전 에이스는 코트에서 그라인드 노출·감독은 유능. 양팀 대칭이라 승패 밸런스 불변, KOVO 분포 전부 보존(simKovo reps40 N≈1680 전 지표 ✓). 체력이 랠리 eff(0.70+0.30×stam)에 곱해져 전 경기 결과 변동 → 저장 캐시 무효화+골든 재생성. simStamCurve 밴드 재정의(set5 33~47%·하락≥30%p·피로교체 1.5~4.5/경기). 18(2026-07-28, MATCH §7.4b TTO 비활성화): 테크니컬 타임아웃을 TTO_ENABLED=false로 게이트(KOVO 로컬룰 폐지 정황+사용자 요청, 코드·상수·테스트는 보존 — 부활 시 true 한 글자). TTO 세트당 2회 자동 회복(recover+기세수렴+streak리셋)이 빠져 체력/기세·경기 결과 변동 → 저장 캐시 무효화+골든 재생성. 밸런스(체력밴드·KOVO분포·parity)는 simStamCurve/simKovo 실측으로 확인. 17(2026-07-27, TRAIT_SYSTEM §6.4 상태형 Phase 3): 상태형 특성 5종(뒷심/초반집중/역전의명수/살얼음/5세트의여왕) 추가 — 반응형 activeBuffs 없이 clutch식으로 **현재 랠리 국면**(현재 세트 home/away 점수·setNo)을 StateCtx로 playRally에 넘겨 stateSkillMult(traits, ctx, isHome)이 조건 충족 동안만 상시 배수(closer max≥20·fastStart max≤10·comeback/thinIce 내 점수<상대·tiebreaker setNo===5, ±3% closerMul 1.03 등)를 venue와 같은 층(serve/receive/set/spike/block/dig)에 한 겹 곱. **연출 없음**(reactiveEvents 미발행 — 조용한 국면 보정). **미부여·조건 미충족 선수 완전 무영향(stateSkillMult=1배 → 바이트 동일)**·ctx는 경기 입력(점수/세트) 파생(rng 무소비). 단 POOL에 5종(closer/comeback/fastStart/tiebreaker w=4·thinIce w=2) 추가로 시드 리그 rollTraits 분포가 바뀌어 seeded-league 골든 변동 → 범프(골든 재생성은 메인). 16(2026-07-27, TRAIT_SYSTEM §6.5 경기 맥락 상시형 Phase 2d): 안방호랑이/원정형 2종 추가 — venueSkillMult(traits, isHome)이 홈/원정 고정 배수(±3%, venueBonus 1.03/venuePenalty 0.97)를 rally.ts 산출 지점(serve/receive/set/spike/block/dig)에 reactiveSkillMult과 같은 층으로 한 겹 곱. RallyTeam.isHome(fixture 홈=true, match.ts가 설정)로 판정. **미부여 선수 완전 무영향(venueSkillMult=1배 → 바이트 동일)**·home/away는 경기 입력에서 결정(rng 무소비). 기존 홈 어드밴티지 edge(팀 승수)와 방향 같으나 per-player 소폭 별개 레이어(이중계산 겹침 허용, §6.5). 단 POOL에 homeTiger/awayWarrior(각 w=5) 추가로 시드 리그 rollTraits 분포가 바뀌어 seeded-league 골든 변동 → 범프(골든 재생성은 메인). 15(2026-07-27, TRAIT_SYSTEM §6.3 반응형 Phase 2b): 이벤트 발동형 반응형 4종(낯가림/핀치서버/대타승부사/에이스기세) 추가 — 낯가림=교체 투입 시 전 스킬↓(조커 상극), 핀치서버=서브 슬롯 교체 투입 시 서브↑, 대타승부사=교체 후 첫 공격 스파이크↑(RallyTeam.clutchArmed 플래그, 1랠리), 에이스기세=서브 에이스 후 서브↑. 전부 reactiveSkillMult 곱셈 한 겹(미부여=1배)·rng 무소비. **미부여 선수는 완전 무영향(activeBuffs 빈 맵·clutchArmed 빈 집합 → 바이트 동일)**. 단 POOL에 4종 추가로 시드 리그 rollTraits 분포가 바뀌어 seeded-league 골든 변동 → 범프(골든 재생성은 메인). 14(2026-07-27, TRAIT_SYSTEM §6.3 반응형 Phase 2a): 반응형 특성 3종(조커/유리멘탈/오뚝이) 도입 — 경기 중 사건(교체 투입·블로킹 당함·범실)→임시 버프(RallyTeam.activeBuffs, 5랠리·타임아웃/세트끝 해제)가 rally.ts 스킬/집중 산출을 소폭 보정. **반응형 특성 미부여 선수는 완전 무영향(activeBuffs 빈 맵 → reactiveSkillMult 1배·reactiveFocusAdj 0 → 바이트 동일 — 가드 _dv_reactive (a))**. 단 POOL에 joker/bounce/fragile 추가로 시드 리그 선수의 rollTraits 분포가 바뀌어 seeded-league 골든이 변동 → 저장 순위/생산 재계산 일관성 위해 범프(골든 재생성은 메인). 13(2026-07-22, ROTATION_MORALE F 신인 등용): PO 탈락 확정 팀이 잔여 경기에 신인(career.seasons===0)을 선발 승격 — buildLineup에 force 인자(homeForce/awayForce) 추가로 six[] 구성 변동 → 랠리 결과 변동. **무등용(AI·미탈락) 경기는 바이트 동일**(force 미주입=빈 셋, buildLineup OVR 정렬 불변 — 골든 해시 드리프트 0 실측, 버전 태그만 갱신). v11 U23 라인업 에지와 동형(라인업 변동→결과 변동→캐시 무효화). 탈락 팀 경기만 결과 변동 → 그런 세이브의 저장 순위/생산 재계산 일관성 위해 범프(standings/production 재생이 promotedOnDay 주입). 12(2026-07-21, 감사A P0 FIVB 세트당 6교체): subIn 예산 예약 회계 교정 — 활성 복원형(pinch/block/def)의 미래 subOut(무조건 −1)까지 예약(subBudget ≥ pendingRestores + (복원형?2:1))해 세트당 총 교체 ≤6 보장. **무개입(AI) 경기는 바이트 동일**(pendingRestores 계수가 구 `<2`와 동일값인 구간에서만 AI가 subIn — N=2571 subEvents 지문 불변 실측, KOVO 분포·parity·승패 불변). 개입(구단주 수동 IN이 복원형 2+ 활성 창에 낀 드문 경우)만 결과 변동 → 그런 세이브의 저장 순위 재계산 일관성 위해 범프(standings 재생이 interventionsFor 주입). 11(2026-07-20, STAFF §9.6-D 스태프3.0 Phase D): 감독 능력 3축 실효과 훅 2종이 경기 결과를 바꾼다 — ① 육성 철학(dvPhilosophy) U23 라인업 에지(engine/lineup buildLineup — 근소차 U23 우선권, 역전 금지) → 감독 자동 라인업 six[] 변동. ② 리더십(leadership) 경기감각 하락 완화(data/dynamics formOf — FORM_MAX_PENALTY 축소) → 벤치 복귀자 sk* 평가 변동. 둘 다 team별 coachInfoOf 파생(결정론·rng 미소비), dvPhilosophy≤50·leadership 무주입이면 에지 0(byte-동일). 양 팀 라인업·폼 변동 → 랠리 결과 변동 → 저장 캐시 무효화(KOVO 분포·parity 불변 실측). 10(2026-07-15): 리베로 후위 수비 참여 소모(MATCH §7.1, rally.ts LIBERO_DEFENSE_COST=0.16) — 리베로가 큰 소모(공격/서브/블록) 없이 회복만 쌓여 타임아웃 체력 상시 ~100%(실측 L 3세트+ 98.5%·≥99% 55.7%)이던 것을 매 랠리 균일 소모로 교정(→ 3세트+ 89.8%·≥99% 21.6%). 양 팀 리베로 stam 변동 → 랠리 eff·경기 결과 변동 → 저장 캐시 무효화(타 포지션 Δ≤0.2%p·KOVO 분포 불변). 9(2026-07-15): ① manualSide(내 팀 정규시즌 "구단주 직접" 설정) — 지정 사이드는 감독 자동 타임아웃·작전 4종 결정 스킵(복원·TTO·부상·세트말원복 유지) → 그 사이드 결과 변동(미지정=바이트 동일). ② F2 FIVB 15.6.1 — subIn이 IN 후보의 usedStarterOut(이미 아웃된 선발) 신분 거부(나간 선발 타슬롯 재진입 차단) → 드문 경우 six[] 변동. 둘 다 저장 캐시 무효화. 8(2026-07-07): ① 피로 교체(1.3e) — 지친 주전(비세터·비접전, 체력<0.35)을 같은 포지션 벤치로 잠시 교체(합리 코치 게이트·히스테리시스·예산≥4, 결정론·rng 미소비) → six[] 변동 → 결과 변동. ② TTO 회복 재튜닝 TIMEOUT_REST(0.04)→TTO_REST(0.03, 테크니컬 타임아웃만 — 스윕으로 0.03만이 체력밴드·피로교체밴드 둘 다 통과) — TTO 세트당 2회 자동 발화로 회복 과다(피로 곡선 붕괴) 교정 → 체력·경기 결과 변동. 둘 다 저장 캐시 무효화. 7(2026-07-07): ① 포지션 폴트 받는 팀만 판정(FIVB 2025-2028 7.4·KOVO 25-26, rally.ts) — rng 소비 2→1회/서브 → 랠리 스트림 이동 → 결과 변동. ② KOVO 테크니컬 타임아웃(1~4세트 8·16점 자동 휴식 — recover+기세수렴, rng 미소비) → 체력·기세 변동 → 경기 결과 변동. 둘 다 저장 캐시 무효화. 6(2026-07-07): subIn(전술 교체)이 injured Set을 배제 — 이중부상 벤치교체 선수를 전술 교체로 재투입하던 잠복버그 차단(1.3d) → 드문 경우 six[] 변동 → 결과 변동 → 저장 캐시 무효화. 5(2026-07-07): 경기 내 부상 교체(1.3d) — maybeInjure에 심각도 게이트(rng 1회 추가 소비) + 중상 시 코트 선수 실제 교체 → 랠리 스트림·경기 결과 변동 → 저장 캐시 무효화
// 4(2026-07-06): 서브 에이스 개인기장 공식화 — 리시브범실 실점을 서버 box.srvAce에도 기장(FIVB indirect ace) → production aces/points·서브왕·skServe XP 변동 → 저장 캐시 무효화. 유형 분포·밸런스·서브 확률·승패 불변(box는 메인 rng 무관)
// 3(2026-07-02): AI 자기방출 재영입 금지(TRANSACTION 0장 ⑥) — dyn(시즌 중 거래) 재생 변동 → 저장 캐시 무효화
// 2(2026-06-28): 체력 튜닝(회복 0.009→0.005·세트사이 0.12→0.035) — 경기 결과 변동 → 저장 캐시 무효화

// 작전 교체 (MATCH_SYSTEM 1.3b)
export const SUBS_PER_SET = 6;   // 세트당 정규 교체 횟수(리베로 교체는 별도) — 개입 시트 잔여 예산 표시가 import(UI_RULES UV-7)
const PINCH_SERVE_GAP = 12;      // 핀치 서버: 벤치-선발 서브 레이팅 차 임계
const BLOCK_SUB_GAP = 12;        // 블로킹 강화: 벤치-전위 블록 레이팅 차 임계
const DEF_SUB_GAP = 12;          // 수비 강화: 벤치-후위 리시브 레이팅 차 임계
// 피로 교체(1.3e): 지친 주전(비세터)을 같은 포지션 벤치로 잠시 뺐다 다음 세트 복귀.
// ⚙ REST_THRESHOLD·REST_HYST: 프로덕션 고정 리터럴 + 튜닝/가드 env 시임(DV_ 패턴, 미설정 시 리터럴 — 결정론 무영향).
//   피로 곡선 재튜닝(2026-07-29)에서 "자동 피로교체 대폭 완화"(지친 주전 코트 잔류→화면에 체력 하락 노출)를 스윕하는 축.
const REST_THRESHOLD = process.env.DV_RESTTH != null ? Number(process.env.DV_RESTTH) : 0.15;     // 이 미만으로 지친 주전만 대상(0..1) — 2026-07-29 피로 극화에 맞춰 0.35→0.15 재스케일(독립리뷰: 삭제 아닌 재튜닝. 감독은 정말 퍼진 선수만 쉬고, 크런치 제외로 접전 에이스는 코트에 남아 그라인드 노출)
const REST_MIN_BUDGET = 4;       // 피로 교체는 예산 ≥4일 때만(핀치 예산을 굶기지 않게 — 일반 교체 subIn 내부 ≥2보다 높은 문턱)
const REST_HYST = process.env.DV_RESTHYST != null ? Number(process.env.DV_RESTHYST) : 0.3;           // 히스테리시스: 벤치 체력 − 주전 체력 이 값 이상이어야(살짝 지친 걸로 반복 스와핑 방지)
const DEFAULT_POLICY: SubPolicy = { pinchServer: true, blockSub: true, defSub: true, restSub: true };
// 반응형 특성(TRAIT_SYSTEM §6.3, Phase 2a) — 발동 후 지속 랠리 수. 타임아웃/세트끝에도 해제. 가드 _dv_reactive (g)가 활성 창 길이 대조에 import.
export const REACTIVE_DURATION = 5;

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
export const TIMEOUTS_PER_SET = 2; // 세트당 팀 작전 타임아웃(테크니컬 TTO는 예산 무차감) — 개입 시트 잔여 표시가 import(UI_RULES UV-7)
// 감독 성향별 타임아웃 호출 임계(상대 연속득점 수). 수비형은 일찍, 공격형은 늦게(아낀다)
const TO_THRESHOLD: Record<CoachStyle, number> = { defense: 3, balanced: 4, attack: 5 };
const TIMEOUT_REST = 0.04; // 타임아웃 휴식 회복(7.1·7.4) — 양 팀 모두 쉰다(차이는 기세 수렴이 만듦)
// KOVO 테크니컬 타임아웃(7.4b): 1~4세트 리드팀 8·16점 첫 도달 시 자동 60초 휴식. TTO는 감독이 부른 게
// 아니라 공식 자동 휴식이라 경기운영 무관 → 중립 고정 수렴폭(코치 타임아웃 matchOps 50 상당 = 0.5×0.6). rng 미소비.
// TTO 비활성화 스위치(2026-07-28 사용자) — KOVO가 로컬룰 TTO를 없앤 정황(2025-26 중간랠리·그린카드 폐지 등
// FIVB 정렬 흐름) + 사용자 확인 요청. **삭제가 아니라 게이트**: 나중에 부활하면 이 값만 true로 돌리면 원상복구
// (아래 발화 블록·상수·보드 모달·테스트 전부 보존). false면 TTO 미발화 → 체력/기세에 TTO 회복분이 빠져 결과가
// 바뀌므로 ENGINE_VERSION 범프 + 골든 재베이스라인 동반. 밸런스 영향은 simStamCurve/simKovo 실측으로 확인.
export const TTO_ENABLED = false;
const TTO_THRESHOLDS = [8, 16] as const; // 1~4세트 자동 TTO 발화 점수(리드팀 max(h,a) 기준)
const TTO_PULL = 0.3;      // 테크니컬 타임아웃 기세 수렴폭(중립 고정)
// TTO 회복폭(7.4b, 2026-07-07). 코치 TIMEOUT_REST(0.04)와 **의도적으로 다르다**: TTO는 세트당 2회(8·16점) 자동
// 발화라 0.04를 그대로 쓰면 세트 내 회복 과다(피로 곡선 붕괴 — 5세트 코트 평균 83.1%>82% 밴드). 60초/30초 현실
// 회복비를 깨고 TTO만 낮춰 세트 내 총 휴식을 줄인다(정밀 튜닝한 피로 곡선이 설계 기둥). 코치 타임아웃은 0.04 유지.
// 스윕(N=3000): 0.02→피로교체율 0.634 폭주 FAIL / 0.03→체력 81.5%·교체율 0.453 둘 다 PASS(유일) / 0.035+→체력 밴드 초과.
const TTO_REST = 0.03;
// ⚙ 프로덕션 고정 리터럴 + 튜닝/가드 env 시임(DV_ 패턴, 미설정 시 리터럴 — 결정론 무영향). 피로 곡선 재튜닝 스윕용(2026-07-29).
const SET_REST = process.env.DV_SETREST != null ? Number(process.env.DV_SETREST) : 0.012;    // 세트 사이 회복(2026-07-29 피로 극화 0.035→0.012 — 세트 누적 피로 강화)
const TIRED_STAM = 0.5;    // 코트에 이 미만으로 퍼진 선수가 있으면 감독이 타임아웃을 한 박자 일찍 부른다

export interface CoachInfo { style: CoachStyle; matchOps: number; dvPhilosophy?: number } // matchOps = 경기 운영(구 charisma 이관, STAFF §9.1 ①). dvPhilosophy = 육성 철학(§9.6-D U23 라인업 에지, 생략=neutral)
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
  // 완전 수동 사이드(내 팀 정규시즌 "구단주 직접" 설정 파생) — 이 사이드는 감독 자동 타임아웃(연속실점 임계)·자동 작전교체
  //   4종(rest/pinch/block/def) **결정**을 내리지 않는다(구단주 완전 수동). TTO(리그 자동)·부상 교체·복원 루프·세트말
  //   원복·개입 적용(§3)은 그대로 유지. 미지정(undefined)이면 스킵 판정이 전부 거짓 → 바이트 동일. MATCH_INTERVENTION_SYSTEM §4.1.
  manualSide?: Side;
  // 강제 선발(ROTATION_MORALE F 신인 등용) — 각 사이드에서 buildLineup에 넘길 force 셋. 지정 id는 OVR 무관 six[] 진입.
  //   미지정(undefined)이면 buildLineup 기본 빈 셋 → byte-동일(AI·무등용 경기 불변). 탈락 확정 팀 경기에만 데이터 계층이 주입.
  homeForce?: ReadonlySet<string>;
  awayForce?: ReadonlySet<string>;
}

const DEFAULT_COACH: CoachInfo = { style: 'balanced', matchOps: 50 };
// 박스 스냅샷용 얕은 클론(BoxLine은 number 필드만) — 타임라인이 시점별 누적을 독립 보존
const cloneBox = (b: BoxSink): BoxSink => { const m: BoxSink = new Map(); for (const [k, v] of b) m.set(k, { ...v }); return m; };

// 디버그 카운터(가드 전용, §7.8 (d)) — simulateMatch 호출 수 관측. 풀시즌 리플레이(standings/production/playoffs)가
//   전부 이 함수를 통과하므로, endSeason의 "풀시뮬 0회"를 여기서 센다. simMatch.ts의 simulateMatchSimple은 시즌
//   리플레이 경로가 아니라(레거시) 여기 둔다 — 그쪽에 두면 항상 0이 되는 허위 오라클. 로직·RNG 무영향(순수 관측).
let _simCalls = 0;
export const debugSimCalls = { count: (): number => _simCalls, reset: (): void => { _simCalls = 0; } };

// 반응형 특성 관측(가드 _dv_reactive 전용, §6.3) — debugSimCalls와 같은 패턴(순수 관측·rng/로직 무영향).
//   activations = 버프 발동 총 횟수(조커 투입·유리멘탈/오뚝이 트리거), maxBuffs = 한 순간 양 팀 활성 버프 최대 동시수.
//   반응형 미부여 리그면 둘 다 0 → 가드 (a)가 "무특성 무영향"을 봉인. env 시임 아님(잔여 관측 카운터).
let _reactiveActivations = 0;
let _reactiveMaxBuffs = 0;
let _reactiveExpires = 0;   // tick 만료(5랠리 소진)로 제거된 버프 수
let _reactiveClears = 0;    // 타임아웃/세트끝 clear로 해제된 버프 수(비었을 땐 0 가산 → 실제 해제만 카운트)
export const debugReactive = {
  activations: (): number => _reactiveActivations,
  maxBuffs: (): number => _reactiveMaxBuffs,
  expires: (): number => _reactiveExpires,
  clears: (): number => _reactiveClears,
  reset: (): void => { _reactiveActivations = 0; _reactiveMaxBuffs = 0; _reactiveExpires = 0; _reactiveClears = 0; },
};

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
  _simCalls++; // §7.8 (d) 가드 관측 — 로직/RNG 무영향
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

  const homeLineup = buildLineup(homePlayers, hc.dvPhilosophy ?? 0, opts.homeForce); // 육성 철학 U23 에지(§9.6-D) + 신인 등용 force(F). 생략=0/빈셋(neutral·byte-동일)
  const awayLineup = buildLineup(awayPlayers, ac.dvPhilosophy ?? 0, opts.awayForce);

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

  const home: RallyTeam = { six: homeLineup.six, libero: homeLineup.libero, rotation: 0, momentum: START_MOMENTUM, stam: homeStam, injured: new Set(), style: hc.style, pendingSevere: [], activeBuffs: new Map(), clutchArmed: new Set(), isHome: true };  // fixture 홈 — 안방호랑이/원정형 venue 배수 판정(§6.5)
  const away: RallyTeam = { six: awayLineup.six, libero: awayLineup.libero, rotation: 0, momentum: START_MOMENTUM, stam: awayStam, injured: new Set(), style: ac.style, pendingSevere: [], activeBuffs: new Map(), clutchArmed: new Set(), isHome: false };
  const teamOf = (s: Side) => (s === 'home' ? home : away);
  const matchOpsOf = (s: Side) => (s === 'home' ? hc.matchOps : ac.matchOps);
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

  // ── 반응형 특성(TRAIT_SYSTEM §6.3, Phase 2a) — 버프 지속/해제 관리. 무보유 리그면 전부 no-op(빈 맵 → 바이트 동일). rng 무소비. ──
  const findPlayer = (side: Side, id: string): Player | undefined => (side === 'home' ? homePlayers : awayPlayers).find((p) => p.id === id);
  // ── 반응형 연출 출력(TRAIT_SYSTEM §6.10, Phase 2c) — **순수 표현 파생**(보드 현수막 1회 + 마커 테두리). rng/결과 무영향. ──
  //   activeBuffs 발동/만료/해제에서만 파생. openReactive가 발동 시점 이벤트를 열고(startPoint=버프 set 시점 points.length),
  //   tick 만료·타임아웃/세트끝 clear가 closeReactive(endPoint=points.length−1)로 활성 창을 닫는다. 미부여 리그면 이벤트 0건.
  const reactiveEvents: ReactiveEvent[] = [];
  const liveReactive: Record<Side, Map<string, ReactiveEvent>> = { home: new Map(), away: new Map() };
  // 활성 창 닫기 — 해당 선수의 열린 이벤트에 endPoint 기입. 없으면 no-op(무보유 리그).
  const closeReactive = (side: Side, id: string, endPoint: number): void => {
    const ev = liveReactive[side].get(id);
    if (ev) { ev.endPoint = endPoint; liveReactive[side].delete(id); }
  };
  // 활성 창 열기 — 새 이벤트 push + liveReactive 등록. 같은 선수의 기존 열린 이벤트(덮어쓰기 발동)는 startPoint−1로 먼저 닫음(무영향 창).
  //   endPoint는 startPoint−1로 시작(즉시 해제·미갱신 시 무영향 창) → 이후 close에서 실제 값으로 갱신.
  const openReactive = (side: Side, id: string, trait: Trait, kind: 'buff' | 'debuff', pointIndex: number, startPoint: number): void => {
    closeReactive(side, id, startPoint - 1);
    const ev: ReactiveEvent = { pointIndex, playerId: id, trait, kind, startPoint, endPoint: startPoint - 1 };
    reactiveEvents.push(ev);
    liveReactive[side].set(id, ev);
  };
  // 랠리 1회 소비 후 지속 감소, 0이면 제거(발동 시점 left=5 → 이후 5랠리 활성). tickReactiveBuffs(순수)로 위임 — 가드가 동일 함수 검증.
  //   만료된 선수의 열린 연출 이벤트도 함께 닫는다(endPoint = 직전 랠리 = points.length−1). tick은 push 직후 호출이라 방금 친 랠리가 마지막 활성.
  const tickBuffs = (side: Side): void => {
    const t = teamOf(side);
    const before = t.activeBuffs.size ? [...t.activeBuffs.keys()] : null;
    _reactiveExpires += tickReactiveBuffs(t.activeBuffs);
    if (before) for (const id of before) if (!t.activeBuffs.has(id)) closeReactive(side, id, points.length - 1);
  };
  // 타임아웃/세트끝 즉시 전체 해제(양 팀). 실제 해제된 버프 수만 카운트(빈 맵은 0 → 무보유 리그 무동작). 열린 연출 이벤트도 닫는다(endPoint=points.length−1).
  const clearBuffs = (): void => {
    _reactiveClears += home.activeBuffs.size + away.activeBuffs.size;
    for (const id of home.activeBuffs.keys()) closeReactive('home', id, points.length - 1);
    for (const id of away.activeBuffs.keys()) closeReactive('away', id, points.length - 1);
    home.activeBuffs.clear(); away.activeBuffs.clear();
    // 대타승부사(§6.3 P2b) 미발동 arming도 타임아웃/세트끝에 해제. 발동 전이라 이벤트/카운터 없음 → 조용히 clear(_reactiveClears 무가산).
    home.clutchArmed.clear(); away.clutchArmed.clear();
  };
  const noteMaxBuffs = (): void => { const c = home.activeBuffs.size + away.activeBuffs.size; if (c > _reactiveMaxBuffs) _reactiveMaxBuffs = c; };
  // 교체 투입 순간 버프 — 조커(joker=buff, 전스킬↑) / 낯가림(coldStart=debuff, 전스킬↓). 둘은 상극(동시부여 없음)이라 상호배타.
  //   subIn이 코트에 세운 직후 호출(작전 교체 in만). subIn은 랠리 루프 최상단(playRally 전) 호출이라 points.length = 다음(투입 후
  //   첫) 랠리 인덱스 → startPoint=pointIndex=points.length(그 랠리부터 버프 활성). 미부여=no-op.
  const triggerSubInBuff = (side: Side, player: Player): void => {
    const tr = player.traits;
    if (!tr) return;
    if (tr.includes('joker')) {
      teamOf(side).activeBuffs.set(player.id, { trait: 'joker', kind: 'buff', left: REACTIVE_DURATION }); _reactiveActivations++; noteMaxBuffs();
      openReactive(side, player.id, 'joker', 'buff', points.length, points.length);
    } else if (tr.includes('coldStart')) { // 낯가림(§6.3 P2b) — 조커와 같은 트리거의 정반대(디버프)
      teamOf(side).activeBuffs.set(player.id, { trait: 'coldStart', kind: 'debuff', left: REACTIVE_DURATION }); _reactiveActivations++; noteMaxBuffs();
      openReactive(side, player.id, 'coldStart', 'debuff', points.length, points.length);
    }
  };

  // 랠리 사이 회복 — 체젠(staminaRegen) 높을수록 빨리 회복.
  // tracked = 체력을 추적하는 전원(선발+리베로+투입된 교체) — 교체 선수도 회복되게.
  const tracked: Record<Side, Player[]> = { home: [...onCourt(homeLineup)], away: [...onCourt(awayLineup)] };
  const recover = (side: Side, m: Map<string, number>, scale: number) => {
    for (const p of tracked[side]) {
      // 지구력(endurance): 체력재생↑ — 랠리/세트 사이 회복량에 선수별 배수(미부여=1배 → 결정론 골든 보존).
      m.set(p.id, Math.min(1, (m.get(p.id) ?? 1) + scale * (0.4 + p.staminaRegen / 100) * staminaRegenTraitMult(p.traits)));
    }
  };

  const points: PointLog[] = [];
  // 포인트별 코트(선발6+리베로) 체력 스냅샷(보드 스코어보드 표시용) — points와 1:1 정렬, 득점 확정 직후·회복 전.
  //   순수 관측(stam 맵을 읽기만, rng 미소비·결과 불변). setUse/timeoutEvents와 동일 계층 — 골든 무영향(serializeMatch 미해시).
  const stamByPoint: { home: TimeoutCourtStam[]; away: TimeoutCourtStam[] }[] = [];
  const setScores: { home: number; away: number }[] = [];
  const setFirstServers: Side[] = []; // 세트별 첫 서브 팀(보드·production이 재도출 않게 진실을 실어 보냄) — 5세트 코인토스 포함
  const subUse: Record<string, number> = {}; // 교체 출전 선수 id → 출전 랠리 수(출전 성장 XP용)
  const setUse: Record<string, number> = {}; // 선수 id → 출전 세트수(코트에 선 세트 카운트) — 화면 "N세트"용, 순수 관측(rng 미소비·결과 불변, MATCH_SYSTEM §1.3c-2)
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
    const setBaseIdx = points.length; // 이 세트 첫 랠리가 들어갈 전역 인덱스 — 개입 타임아웃 point 클램프용(세트 경계 역참조 방지)

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
    // 이 세트에 이미 적용된 유저(개입) 타임아웃 좌표(`side:h:a`) — 같은 데드볼 중복 커밋 방어(감사 P1). 표시 스테일로
    //   같은 좌표 TO가 2번 커밋돼도 세트 예산(timeouts[])을 1회만 소진한다. 같은 데드볼에 타임아웃 2번은 현실에 없음.
    const userToCoords = new Set<string>();

    // 작전 교체 상태(세트 단위): 예산 + 활성 교체(slotIdx → 원선발·종류)
    const subBudget = { home: SUBS_PER_SET, away: SUBS_PER_SET };
    // 작전/피로 교체만 activeSubs에 들어간다(injury는 injuryReplaced로 분리 — 세트말 원복 안 함). = 정본 SubKind − 'injury'.
    type TacticalSubKind = Exclude<SubKind, 'injury'>;
    const activeSubs: Record<Side, Map<number, { orig: Player; kind: TacticalSubKind }>> = { home: new Map(), away: new Map() };
    const courtThisSet = new Set<string>(); // 이 세트에 코트에 선 선수 id(매 랠리 six+libero 누적) → 세트말 setUse 플러시. 순수 관측(§1.3c-2)
    // FIVB 교체 규칙(세트 단위 리셋) — ① 교체선수는 세트당 1회만 진입(재진입 금지) ② 선발은 세트당 1왕복만(나갔다 돌아온 뒤 재이탈 금지).
    //   구현 누락으로 같은 스페셜리스트가 예산(6) 남는 한 핑퐁 투입되던 버그 수정(2026-07-01). checkSubs 규칙검사로 박제.
    const usedSubIn: Record<Side, Set<string>> = { home: new Set(), away: new Set() };       // 이 세트에 이미 투입된 교체선수 id
    const usedStarterOut: Record<Side, Set<string>> = { home: new Set(), away: new Set() };  // 이 세트에 이미 교체 아웃된 선발 id
    // 복원형 = 세트 중 자동 복원(subOut, 무조건 예산 −1)이 예약된 교체 종류. rest/manual은 세트말 무예산 원복이라 제외.
    const isRestorable = (k: TacticalSubKind): boolean => k === 'pinch' || k === 'block' || k === 'def';
    const subIn = (side: Side, slot: number, player: Player | null, kind: TacticalSubKind): void => {
      if (!player) return;
      const st = teamOf(side);
      if (injuryReplaced[side].has(slot)) return; // 부상 교체 슬롯은 작전 교체 대상 제외 — 부상 교체 선수를 영구 유지(1.3d)
      // ── 예산 예약 회계(P0, 2026-07-21 감사A) — FIVB 세트당 6교체 초과 방지 ──
      //   현재 활성 복원형(pinch/block/def)은 각자 나중에 subOut으로 예산을 1씩 더 쓴다(복원 루프, 무조건 차감). 단순 `<2`는
      //   이 IN 자신의 복원분 1건만 예약 → 복원형 2+ 활성 창에 (개입) 수동 IN이 끼면, 이후 자동 복원 OUT들이 예산을 음수로
      //   몰아 세트 7교체(감사A 실측). 잔여 예산이 [활성 복원 예정 건수 + 이 IN의 복원분(복원형이면 1, 아니면 0) + 1]을
      //   덮을 때만 수락 → 불변식 subBudget ≥ (활성 복원형 수)를 항상 유지(음수 불가). rest는 호출 전 REST_MIN_BUDGET(≥4)로,
      //   manual은 개입 경로로만 진입 → 무개입(AI) 경기는 복원형 R=0 구간 외엔 이 식이 구 `<2`와 동일값(바이트 불변 실측).
      const pendingRestores = [...activeSubs[side].values()].filter((r) => isRestorable(r.kind)).length;
      const reserve = pendingRestores + (isRestorable(kind) ? 2 : 1);
      if (activeSubs[side].has(slot) || subBudget[side] < reserve) return;
      // 이미 코트에 있으면 불가 — 같은 벤치 스페셜리스트가 두 슬롯에 중복 투입되는 것 방지
      if (st.six.some((p) => p.id === player.id)) return;
      if (st.injured.has(player.id)) return; // 부상 선수는 어떤 교체로도 코트 복귀 불가(1.3d) — benchSpecialists가 경기 시작 고정이라 이중부상 벤치교체 선수를 재투입하던 잠복버그 차단(subIn·injuryReplaced 이중 차단)
      if (usedSubIn[side].has(player.id)) return; // FIVB: 교체선수는 세트당 1회만 진입(재진입 금지)
      if (usedStarterOut[side].has(player.id)) return; // FIVB 15.6.1(F2, 2026-07-15): 이번 세트 이미 아웃된 선발은 subIn으로 재진입 불가 — 합법 복귀는 subOut(자기 슬롯·자기 교체선수와의 교대) 복원 경로뿐. 나간 선발을 타슬롯 IN으로 넣는 시도(rest 스캔·유저 개입) 차단. EC-SUB-02.
      const outP = st.six[slot];
      if (usedStarterOut[side].has(outP.id)) return; // FIVB: 선발은 세트당 1왕복만(돌아온 선발 재이탈 금지)
      usedSubIn[side].add(player.id);
      usedStarterOut[side].add(outP.id);
      activeSubs[side].set(slot, { orig: outP, kind });
      st.six[slot] = player;
      if (!st.stam.has(player.id)) { st.stam.set(player.id, 1); tracked[side].push(player); }
      subBudget[side] -= 1; // IN
      subEvents.push({ point: points.length, setNo, side, slot, inId: player.id, outId: outP.id, kind, enter: true });
      triggerSubInBuff(side, player); // 반응형(§6.3): 조커(buff)/낯가림(debuff) — 교체로 코트에 서면 발동(미보유=no-op)
      // 핀치서버(§6.3 P2b): 교체가 서브 로테이션 슬롯에 서고 그 팀이 서브 차례 → 곧 서브부터 서브↑(5랠리). subIn은 랠리 루프
      //   최상단(playRally 전) 호출 → 이 슬롯이 곧 서브(server=six[serverIndex]) → startPoint=pointIndex=points.length. rng 무소비.
      if (player.traits?.includes('pinchServer') && side === serving && slot === serverIndex(st.rotation)) {
        st.activeBuffs.set(player.id, { trait: 'pinchServer', kind: 'buff', left: REACTIVE_DURATION }); _reactiveActivations++; noteMaxBuffs();
        openReactive(side, player.id, 'pinchServer', 'buff', points.length, points.length);
      }
      // 대타승부사(§6.3 P2b): 교체 투입 후 첫 공격에 스파이크↑(1랠리) — arming만(발동/이벤트는 rally.ts 첫 공격 스윙에서). rng 무소비.
      if (player.traits?.includes('clutchSub')) st.clutchArmed.add(player.id);
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
            // 서브 교체(pinch)는 뺄 선수를 지정하지 않으면(§4 #4) **현재 서버 슬롯을 자동 타겟** — 사용자는 넣을
            //   서버만 고른다. 단 서버가 세터('S')면 no-op(5-1 무결성 — AI 핀치도 세터는 안 뺀다).
            let slot: number;
            if (iv.subKind === 'pinch' && !iv.outId) {
              slot = serverIndex(st.rotation);
              if (st.six[slot].position === 'S') continue; // 세터 서브차례 — 무동작
            } else {
              slot = st.six.findIndex((p) => p.id === iv.outId);
              if (slot < 0) continue; // 코트에 없음(방어)
            }
            const inP = (iv.side === 'home' ? homePlayers : awayPlayers).find((p) => p.id === iv.inId);
            if (!inP) continue;     // 벤치에 없음(방어)
            // 'pinch'=서브 교체(자동복원 루프가 서브권 잃으면 원선발로 되돌림) / 'manual'=세트 끝까지. FIVB 가드 전부 상속(no-op 자동 처리)
            subIn(iv.side, slot, inP, iv.subKind === 'pinch' ? 'pinch' : 'manual');
          } else {
            // 타임아웃 — 감독 자동 경로와 별개(임계·streak 무시 강제). 기존 타임아웃 블록의 효과를 그대로 복제.
            if (timeouts[iv.side] <= 0) continue; // 세트 한도 소진 시 no-op
            const toKey = `${iv.side}:${h}:${a}`; // 같은 데드볼 좌표 중복 커밋 방어(감사 P1) — 세트 예산 이중 소진 차단
            if (userToCoords.has(toKey)) continue;
            userToCoords.add(toKey);
            timeouts[iv.side]--;
            const courtStam = (st: typeof home, m: Map<string, number>): TimeoutCourtStam[] =>
              [...st.six, ...(st.libero ? [st.libero] : [])].map((p) => ({ id: p.id, stam: m.get(p.id) ?? 1 }));
            timeoutEvents.push({
              // 개입은 랠리 루프 상단(현재 랠리 push 전)에서 호출 — 세트 개막 0:0이면 points.length-1이 직전 세트 마지막을
              //   가리켜 보드가 뒤로 seek(감사 발견). 이 세트 첫 랠리 인덱스(setBaseIdx)로 클램프(자동/TTO는 push 후라 무영향).
              point: Math.max(setBaseIdx, points.length - 1), setNo, side: iv.side, home: h, away: a, streak,
              stamHome: courtStam(home, homeStam), stamAway: courtStam(away, awayStam),
              momHome: home.momentum, momAway: away.momentum,
            });
            const pull = (matchOpsOf(iv.side) / 100) * 0.6;
            home.momentum += (50 - home.momentum) * pull;
            away.momentum += (50 - away.momentum) * pull;
            streak = 0;
            lastScorer = null;
            recover('home', homeStam, TIMEOUT_REST);
            recover('away', awayStam, TIMEOUT_REST);
            clearBuffs(); // 반응형(§6.3): 타임아웃(개입)에 양 팀 활성 버프 즉시 해제
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
        if (side === opts.manualSide) continue; // 완전 수동 사이드 — 감독 자동 피로 교체 결정 안 함(§4.1)
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
        if (sv !== opts.manualSide && policyOf(sv).pinchServer && bench[sv].server && !activeSubs[sv].has(slot)
          && st.six[slot].position !== 'S'
          && R(bench[sv].server!).serve - R(st.six[slot]).serve >= PINCH_SERVE_GAP) {
          subIn(sv, slot, bench[sv].server, 'pinch');
        }
      }
      // 2b) 블로킹 강화 — 막판 접전, 전위 약한 블로커 (crunch는 위에서 산출)
      if (crunch) for (const side of ['home', 'away'] as Side[]) {
        if (side === opts.manualSide) continue; // 완전 수동 사이드 — 감독 자동 블로킹 강화 결정 안 함(§4.1)
        const st = teamOf(side);
        if (!policyOf(side).blockSub || !bench[side].blocker) continue;
        let weakSlot = -1, weakBlk = Infinity;
        for (const slot of frontRow(st.rotation)) { if (st.six[slot].position === 'S') continue; const b = R(st.six[slot]).block; if (b < weakBlk) { weakBlk = b; weakSlot = slot; } }
        if (weakSlot >= 0 && R(bench[side].blocker!).block - weakBlk >= BLOCK_SUB_GAP) subIn(side, weakSlot, bench[side].blocker, 'block');
      }
      // 2c) 수비 강화 — 받는 측 후위 약한 리시버(MB 제외, MB는 리베로가 커버)
      {
        const rs = other(serving); const st = teamOf(rs);
        if (rs !== opts.manualSide && policyOf(rs).defSub && bench[rs].defender) { // 완전 수동 사이드 제외(§4.1)
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
      // 대타승부사(§6.3 P2b): 이번 랠리에 clutchArmed에서 소비될(첫 공격) 선수 탐지용 스냅샷 — rally.ts가 첫 공격 스윙에 delete. 미부여 빈 집합=null.
      const clutchBefore: Record<Side, string[] | null> = { home: home.clutchArmed.size ? [...home.clutchArmed] : null, away: away.clutchArmed.size ? [...away.clutchArmed] : null };
      // 상태형 특성(§6.4) — 이번 랠리 직전 국면(현재 세트 점수·세트번호)을 stateSkillMult에 넘긴다. 미부여 선수 무영향(1배)·rng 무소비·연출 없음.
      const state = { homeScore: h, awayScore: a, setNo };
      const { winner, how, byId, recvId, setId, atkerId } = playRally(serving, home, away, R, rng, edge, opts.stats, opts.trace, opts.pos, tele, crunch, chasing, accBox, boxRng, touches, digRng, state);
      if (opts.stats && winner !== serving) opts.stats.sideouts++;
      if (winner === 'home') h++; else a++;
      points.push({ setNo, home: h, away: a, scorer: winner, how, byId, recvId, setId, touches });
      // 포인트별 코트 체력 스냅샷(§7.1, 회복 전 = 타임아웃 스냅샷과 동일 의미) — points와 1:1. 순수 관측(stam 맵 읽기만·rng 미소비).
      stamByPoint.push({
        home: [...home.six, ...(home.libero ? [home.libero] : [])].map((p) => ({ id: p.id, stam: homeStam.get(p.id) ?? 1 })),
        away: [...away.six, ...(away.libero ? [away.libero] : [])].map((p) => ({ id: p.id, stam: awayStam.get(p.id) ?? 1 })),
      });
      if (opts.boxTimeline) opts.boxTimeline.push(cloneBox(accBox!)); // 이 득점까지의 누적 스냅샷(points와 1:1)

      // ── 반응형 특성 지속/발동(TRAIT_SYSTEM §6.3, Phase 2a) — rng 무소비. 무보유 리그면 완전 no-op(빈 맵 → 바이트 동일). ──
      //   1) 이번 랠리 소비분 지속 감소(발동 랠리 포함 5랠리 후 만료).  2) 종결 사건 트리거: 유리멘탈(블로킹 당함=stuff)·오뚝이(막힘 or 범실).
      //   공격측 = other(winner)(stuff/atkErr는 winner=other(att)). 타임아웃이 이 랠리에 발화하면 아래 타임아웃 블록이 즉시 clear.
      tickBuffs('home'); tickBuffs('away');
      if ((how === 'stuff' || how === 'atkErr') && atkerId) {
        const aSide = other(winner);
        const ap = findPlayer(aSide, atkerId);
        if (ap?.traits) {
          // 이 트리거는 push 직후(points.length = 방금 친 랠리+1) — 버프는 **다음** 랠리부터 활성 → startPoint=points.length,
          //   트리거 사건이 보인 랠리(막힘/범실)는 points.length−1이라 pointIndex(배너 키)=points.length−1.
          if (how === 'stuff' && ap.traits.includes('fragile')) { teamOf(aSide).activeBuffs.set(atkerId, { trait: 'fragile', kind: 'debuff', left: REACTIVE_DURATION }); _reactiveActivations++; openReactive(aSide, atkerId, 'fragile', 'debuff', points.length - 1, points.length); }
          if (ap.traits.includes('bounce')) { teamOf(aSide).activeBuffs.set(atkerId, { trait: 'bounce', kind: 'buff', left: REACTIVE_DURATION }); _reactiveActivations++; openReactive(aSide, atkerId, 'bounce', 'buff', points.length - 1, points.length); } // 블로킹 당함(stuff) or 내 범실(atkErr)
        }
      }
      // 에이스기세(§6.3 P2b): 직접 서브 에이스(how='ace') → 서버(byId)에게 서브↑(5랠리). winner=서브팀(에이스 득점). fragile/bounce와 동일 층(push 직후).
      if (how === 'ace' && byId) {
        const sp = findPlayer(winner, byId);
        if (sp?.traits?.includes('aceStreak')) { teamOf(winner).activeBuffs.set(byId, { trait: 'aceStreak', kind: 'buff', left: REACTIVE_DURATION }); _reactiveActivations++; openReactive(winner, byId, 'aceStreak', 'buff', points.length - 1, points.length); }
      }
      // 대타승부사(§6.3 P2b): 이번 랠리에 clutchArmed에서 빠진(첫 공격을 친) 선수 → 발동. 1랠리 창(startPoint=endPoint=pointIndex=이 랠리).
      //   버프 적용(스파이크 ×1.08)은 rally.ts가 이미 처리 — 여기선 카운트/연출 이벤트만(활성 버프에 안 들어가 tick/clear 무관).
      for (const cs of ['home', 'away'] as Side[]) {
        const before = clutchBefore[cs];
        if (before) for (const id of before) if (!teamOf(cs).clutchArmed.has(id)) {
          _reactiveActivations++;
          openReactive(cs, id, 'clutchSub', 'buff', points.length - 1, points.length - 1);
          closeReactive(cs, id, points.length - 1);
        }
      }
      noteMaxBuffs();

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
        // 완전 수동 사이드(§4.1)는 감독 자동 타임아웃을 부르지 않는다 — 세트당 2회는 구단주 개입 몫(개입 블록은 별도 유지).
        if (!isSetOver(h, a, setNo) && streak >= th && timeouts[loserSide] > 0 && loserSide !== opts.manualSide) {
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
          const pull = (matchOpsOf(loserSide) / 100) * 0.6;
          home.momentum += (50 - home.momentum) * pull;
          away.momentum += (50 - away.momentum) * pull;
          streak = 0;
          lastScorer = null;
          recover('home', homeStam, TIMEOUT_REST); // 타임아웃 = 쉬는 시간(7.1) — 양 팀 회복
          recover('away', awayStam, TIMEOUT_REST);
          clearBuffs(); // 반응형(§6.3): 감독 타임아웃에 양 팀 활성 버프 즉시 해제
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
          // ── 생리 회복(TTO_REST)은 TTO on/off 무관하게 유지 ──
          //   v8에서 피로 곡선(체력 밴드·피로 교체율 [0.05,0.5])을 이 8·16점 회복을 **포함해** 튜닝했다(설계 기둥).
          //   TTO를 꺼도 이 회복까지 빼면 선수가 과피로 → 피로 교체율 0.45→0.89로 폭주(밴드 이탈, 실측). 사용자가 원한 건
          //   "타임아웃 규칙(모달·기세 중립화) 제거"지 "선수를 더 지치게"가 아니므로, 눈에 안 보이는 생리 회복은 남긴다.
          recover('home', homeStam, TTO_REST);
          recover('away', awayStam, TTO_REST);
          if (!TTO_ENABLED) continue; // ⛔ TTO 비활성(2026-07-28): 회복만. 아래 "타임아웃 자체"(관전 모달·기세 50 수렴·streak 리셋·버프 해제)는 생략. 부활하려면 TTO_ENABLED=true 한 글자.
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
          // 기세 50 수렴(중립 고정폭) + streak 리셋 — 코치 타임아웃과 동일. 팀 예산 timeouts[]는 건드리지 않음.
          home.momentum += (50 - home.momentum) * TTO_PULL;
          away.momentum += (50 - away.momentum) * TTO_PULL;
          streak = 0;
          lastScorer = null;
          clearBuffs(); // 반응형(§6.3): 테크니컬 타임아웃에도 양 팀 활성 버프 해제(타임아웃 해제 규칙)
        }
      }

      // 랠리 사이 체력 회복(7.1) — 교체 투입 선수 포함(tracked)
      recover('home', homeStam, STAM_REGEN_BASE);
      recover('away', awayStam, STAM_REGEN_BASE);

      // 출전 세트 집계(§1.3c-2) — 이 랠리에 코트에 선 선수(선발+작전/부상 교체+리베로)를 courtThisSet에 누적.
      //   랠리 말이라 이 랠리의 부상 교체(위 1.3d)까지 반영된 st.six. 순수 관측(rng 미소비·결과 불변).
      for (const side of ['home', 'away'] as Side[]) {
        const st = teamOf(side);
        for (const p of st.six) courtThisSet.add(p.id);
        if (st.libero) courtThisSet.add(st.libero.id);
      }
    }

    // 세트 종료: 출전 세트수 플러시 — 이 세트에 코트에 선 전원 setUse[id]++ (원복 전, 실제 출전 기준)
    for (const id of courtThisSet) setUse[id] = (setUse[id] ?? 0) + 1;

    // 세트 종료: 활성 교체 전부 원복(다음 세트 라인업 초기화) — 보드도 다음 세트 시작 랠리에서 원복
    for (const side of ['home', 'away'] as Side[]) {
      for (const [slot, rec] of activeSubs[side]) {
        const outP = teamOf(side).six[slot];
        teamOf(side).six[slot] = rec.orig;
        subEvents.push({ point: points.length, setNo, side, slot, inId: rec.orig.id, outId: outP.id, kind: rec.kind, enter: false });
      }
      activeSubs[side].clear();
    }
    clearBuffs(); // 반응형(§6.3): 세트 종료 시 양 팀 활성 버프 전체 해제

    setScores.push({ home: h, away: a });
    if (h > a) homeSets++; else awaySets++;
    lastSetWinner = h > a ? 'home' : 'away';
    setNo++;
  }

  return { homeSets, awaySets, setScores, points, subUse, setUse, subEvents, timeouts: timeoutEvents, setFirstServers, reactiveEvents, stamByPoint };
}

// momFactor 재노출(테스트/튜닝용)
export { momFactor };
