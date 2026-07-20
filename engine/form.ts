// 경기감각 (FORM_SYSTEM) — "훈련은 기술을 만들고, 경기는 감각을 만든다."
// 순수 함수. 출전 이력(최근 N경기) → 능력 계수. 시즌 계층(dynamics)이 날짜별로 파생해
// 적용하므로 선수 객체에 저장하지 않는다(리플레이 결정론 보존, 부상과 동일 패턴).

import type { Player } from '../types';

/** 감각 판정 창 — 최근 몇 경기의 출전을 보는가 */
export const FORM_WINDOW = 5;
/** 전 경기 결장 시 최대 페널티(체감 −7%) */
export const FORM_MAX_PENALTY = 0.07;
/** 리더십(leadership) 최대 완화율 — 감독 리더십 100이면 벤치 경기감각 하락을 이 비율만큼 줄인다(바닥·속도 동시).
 *  소폭(0.30): 하락 상한 −7% → 리더십 100에서 −4.9%(바닥 0.93→0.951). leadership≤50이면 0(완화 없음). STAFF §9.6-D. */
export const LEADERSHIP_FORM_RELIEF = 0.30;

/** 리더십 → 경기감각 페널티 완화 계수(0~LEADERSHIP_FORM_RELIEF). leadership 50→0, 100→최대. */
export function leadershipRelief(leadership: number): number {
  const t = Math.max(0, (leadership - 50) / 50); // 50→0, 100→1
  return LEADERSHIP_FORM_RELIEF * t;
}

/**
 * 출전 이력 → 감각 계수(0.93~1.00).
 * @param playedCount 최근 창(window) 안에서 출전한 경기 수
 * @param windowSize  실제 창 크기(시즌 초반엔 치른 경기 수가 FORM_WINDOW보다 적다)
 * @param relief 감독 리더십 완화(0~LEADERSHIP_FORM_RELIEF, STAFF §9.6-D) — 페널티를 (1−relief)배로 축소. 기본 0=완화 없음(byte-동일).
 * 창이 비어 있으면(개막전) 1.0 — 오프시즌 동안 감각은 리셋, 다 같이 새 출발.
 */
export function formFactor(playedCount: number, windowSize: number, relief = 0): number {
  if (windowSize <= 0) return 1;
  const w = Math.min(windowSize, FORM_WINDOW);
  const played = Math.max(0, Math.min(playedCount, w));
  const penalty = FORM_MAX_PENALTY * (1 - Math.max(0, Math.min(LEADERSHIP_FORM_RELIEF, relief)));
  return 1 - penalty * (1 - played / w);
}

/**
 * 감각 계수를 선수에게 적용한 사본 — 기술치(sk*)만 깎는다.
 * 몸(점프·체력)은 훈련으로 유지되지만 기술 발휘가 무뎌진다는 모델.
 * factor 1.0이면 원본 그대로 반환(주전 무비용 — 밸런스 보존).
 */
export function applyForm(p: Player, factor: number): Player {
  if (factor >= 1) return p;
  const f = Math.max(1 - FORM_MAX_PENALTY, factor); // 중첩·이상치 방어
  return {
    ...p,
    skSpike: p.skSpike * f,
    skBlock: p.skBlock * f,
    skDig: p.skDig * f,
    skReceive: p.skReceive * f,
    skSet: p.skSet * f,
    skServe: p.skServe * f,
  };
}

/** 표시용 등급 — 컨디션 점(●) */
export function formGrade(factor: number): 'sharp' | 'dull' | 'rusty' {
  if (factor >= 0.995) return 'sharp';
  if (factor >= 0.965) return 'dull';
  return 'rusty';
}
