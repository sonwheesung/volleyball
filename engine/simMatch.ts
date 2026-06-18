// 간이 경기 시뮬 (Phase 0) + SimResult/PointLog 타입 계약의 정본.
// 풀 엔진은 match.ts(랠리 체인/로테이션/기세)로 구현됐고 이 파일의 SimResult 타입을 따른다.
// simulateMatchSimple(OVR 비율 + 시드 RNG)는 레거시 — production.test.ts 등 빠른 단위 검증용으로 유지.
// 결정론: 같은 (seed, ovr) = 같은 경기.

import { createRng } from './rng';

import type { PointHow } from './rally';
import type { Side } from '../types';

export interface PointLog {
  setNo: number;
  home: number;
  away: number;
  scorer: 'home' | 'away';
  how?: PointHow; // 종결 방식(보드가 사실대로 그리기 위함) — 구세이브 결과엔 없음
}

/** 작전 교체 1건 — 보드 연출용 로그(승패 무영향, 순수 가산). 엔진이 st.six 를 실제로 바꾼 순간을 기록. */
export interface SubEvent {
  point: number;   // 기록 시점 points.length = 이 교체가 처음 반영되는 랠리 인덱스(0-based)
  setNo: number;
  side: Side;
  slot: number;    // 라인업 슬롯 0..5
  inId: string;    // 코트로 들어온 선수
  outId: string;   // 코트에서 나간 선수
  kind: 'pinch' | 'block' | 'def';
  enter: boolean;  // true=벤치 스페셜리스트 투입, false=원선발 복귀(원위치)
}

export interface SimResult {
  homeSets: number;
  awaySets: number;
  setScores: { home: number; away: number }[];
  points: PointLog[];
  subUse?: Record<string, number>; // 작전 교체로 코트에 선 선수 id → 출전 랠리 수(출전 성장 XP용)
  subEvents?: SubEvent[];           // 작전 교체 연출 로그(보드가 코트 위 실제 교체를 보여주기 위함)
}

function targetPoints(setNo: number): number {
  return setNo >= 5 ? 15 : 25;
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

  while (homeSets < 3 && awaySets < 3) {
    const target = targetPoints(setNo);
    let h = 0;
    let a = 0;
    while (!((h >= target || a >= target) && Math.abs(h - a) >= 2)) {
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
