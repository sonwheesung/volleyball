// 간이 경기 시뮬 (Phase 0) + SimResult/PointLog 타입 계약의 정본.
// 풀 엔진은 match.ts(랠리 체인/로테이션/기세)로 구현됐고 이 파일의 SimResult 타입을 따른다.
// simulateMatchSimple(OVR 비율 + 시드 RNG)는 레거시 — production.test.ts 등 빠른 단위 검증용으로 유지.
// 결정론: 같은 (seed, ovr) = 같은 경기.

import { createRng } from './rng';
import { isSetOver, SETS_TO_WIN } from './match';

import type { PointHow, TouchEvent } from './rally';
import type { Side } from '../types';

export interface PointLog {
  setNo: number;
  home: number;
  away: number;
  scorer: 'home' | 'away';
  how?: PointHow; // 종결 방식(보드가 사실대로 그리기 위함) — 구세이브 결과엔 없음
  byId?: string;  // 종결 선수 id(킬/팁/블록아웃/cap=공격수·stuff=블로커·ace=서버) — 보드/중계가 박스와 같은 선수를 그림
  recvId?: string; // 서브 리시버 id(박스 recvAtt 귀속자) — 보드가 같은 리시버를 그림(리시브 칸 일치)
  setId?: string;  // 종결 공격 어시(assist) 귀속 세터 id — 보드 종결 토서를 박스와 일치(세트 칸). 킬/팁/블록아웃만
  touches?: TouchEvent[]; // 이 점의 터치 순서(서브→리시브→세트→공격→디그…) — opts.touches일 때만. 보드 재생용·승패 불변
}

/** 교체 사유 union(정본) — 작전 3종(pinch/block/def) + rest(피로 교체 1.3e) + injury(경기 내 부상 교체 1.3d)
 *  + manual(플레이어 개입 교체, MATCH_INTERVENTION_SYSTEM §3·§4).
 *  match.ts(activeSubs·subIn)·MatchCourt(SUB_KIND_KO)가 이 타입을 공유해 재타이핑 드리프트를 막는다. */
export type SubKind = 'pinch' | 'block' | 'def' | 'injury' | 'rest' | 'manual';

/** 플레이어 개입 1건(input, 재관전 재생용) — MATCH_INTERVENTION_SYSTEM §2.1·§3·§4.
 *  좌표(at)는 "직전 기록 점수"(랠리 루프 최상단에서 매칭). 한 세트 내 (h,a)는 단조증가 격자라 좌표 유일.
 *  interventions가 비면 엔진은 완전 무동작(바이트 동일) — non-empty일 때만 적용된다. */
export interface MatchIntervention {
  at: { setNo: number; h: number; a: number };  // 직전 기록 점수 = 주입 좌표(프리픽스 불변, §3)
  side: Side;                                     // 내 팀 사이드(home|away)
  kind: 'sub' | 'timeout';
  outId?: string;  // kind==='sub': 코트에서 뺄 선수 id
  inId?: string;   // kind==='sub': 벤치에서 넣을 선수 id
}

/** 작전 교체 1건 — 보드 연출용 로그(승패 무영향, 순수 가산). 엔진이 st.six 를 실제로 바꾼 순간을 기록. */
export interface SubEvent {
  point: number;   // 기록 시점 points.length = 이 교체가 처음 반영되는 랠리 인덱스(0-based)
  setNo: number;
  side: Side;
  slot: number;    // 라인업 슬롯 0..5
  inId: string;    // 코트로 들어온 선수
  outId: string;   // 코트에서 나간 선수
  kind: SubKind;   // injury = 경기 내 부상 교체(1.3d, 영구·enter만) · rest = 피로 교체(1.3e, net-zero 왕복 — 지친 주전을 잠시 쉬게)
  enter: boolean;  // true=벤치 스페셜리스트 투입, false=원선발 복귀(원위치). injury는 항상 true(복귀 없음)
}

/** 작전 타임아웃 1건 — 보드 연출용(승패 무영향, 순수 가산). 감독이 타임아웃을 부른 순간을 기록.
 *  보드는 이 랠리(point) 종료 후 멈추고 코트 체력/기세를 보여준다. 미래 교체 UI의 진입점. */
export interface TimeoutCourtStam { id: string; stam: number } // 0..1
export interface TimeoutEvent {
  point: number;   // 이 랠리(인덱스) 종료 직후 타임아웃 — 보드는 이 랠리를 보여준 뒤 멈춘다
  setNo: number;
  side: Side;      // 타임아웃을 부른 팀(연속 실점한 지는 팀)
  home: number;    // 당시 스코어
  away: number;
  streak: number;  // 상대 연속 득점(타임아웃을 부른 이유)
  stamHome: TimeoutCourtStam[]; // 코트(선발6+리베로) 체력 스냅샷(회복 전)
  stamAway: TimeoutCourtStam[];
  momHome: number; // 기세(수렴 전, 0..100)
  momAway: number;
  technical?: boolean; // true = KOVO 테크니컬 타임아웃(1~4세트 8·16점 자동 휴식, 감독 호출 아님·팀 예산 무차감). 없거나 false = 감독 작전 타임아웃. 보드가 라벨 분기(2026-07-07)
}

export interface SimResult {
  homeSets: number;
  awaySets: number;
  setScores: { home: number; away: number }[];
  points: PointLog[];
  subUse?: Record<string, number>; // 작전 교체로 코트에 선 선수 id → 출전 랠리 수(출전 성장 XP용)
  subEvents?: SubEvent[];           // 작전 교체 연출 로그(보드가 코트 위 실제 교체를 보여주기 위함)
  timeouts?: TimeoutEvent[];        // 작전 타임아웃 로그(보드가 멈추고 체력/기세를 보여주기 위함)
  setFirstServers?: Side[];         // 세트별(인덱스=세트-1) 첫 서브 팀. 5세트는 코인토스(MATCH_SYSTEM v2.1)라
                                    // 소비자(보드 복원·production)가 setNo%2로 재도출하면 어긋남 → 엔진이 진실을 실어 보낸다.
}

export function simulateMatchSimple(seed: number, homeOvr: number, awayOvr: number): SimResult {
  const rng = createRng(seed);

  // 기본 득점 확률 = OVR 비율, 0.32~0.68로 클램프(블로아웃 방지)
  let pHome = homeOvr / (homeOvr + awayOvr);
  pHome = Math.max(0.32, Math.min(0.68, pHome));

  const points: PointLog[] = [];
  const setScores: { home: number; away: number }[] = [];
  let homeSets = 0;
  let awaySets = 0;
  let setNo = 1;

  while (homeSets < SETS_TO_WIN && awaySets < SETS_TO_WIN) {
    let h = 0;
    let a = 0;
    while (!isSetOver(h, a, setNo)) {
      // 약간의 랜덤 흔들림으로 런(연속 득점) 느낌
      const noise = (rng.next() - 0.5) * 0.08;
      const homeScores = rng.chance(pHome + noise);
      if (homeScores) h++;
      else a++;
      points.push({ setNo, home: h, away: a, scorer: homeScores ? 'home' : 'away' });
    }
    setScores.push({ home: h, away: a });
    if (h > a) homeSets++;
    else awaySets++;
    setNo++;
  }

  return { homeSets, awaySets, setScores, points };
}
