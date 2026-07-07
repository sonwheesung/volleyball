// 캐시 스플라이스 로그 (REALTIME_SIM_SYSTEM §7) — 파생 캐시(순위·생산)의 부분 무효화용 minAffectedDay 추적.
// 각 무효화 bump의 영향 구간은 접미 [minDay, ∞)(전진 전용 — §7 불변식). 재계산 시 minDay 이전 행을 재사용한다.
// 전역 단조 seq + bump 로그. 캐시는 계산 시점 seq를 저장하고, minAffectedDaySince(seq)로 그 이후 min을 질의.
// 순수 모듈(다른 데이터/엔진 미의존) — 순환 import 없음.

let seq = 0;
let log: { seq: number; minDay: number }[] = [];

/** 현재 bump 시퀀스 — 캐시가 계산 시점에 저장(이후 bump와 대조용). */
export const spliceSeq = (): number => seq;

/** 무효화 bump 기록. minDay=0(소급/전체)이면 로그 절단 — 이전 bump는 이 전체 무효화에 포섭되고
 *  seq<이 bump인 캐시는 질의 시 0을 보게 되므로(전체 재계산) 안전. 장기 게임 메모리 바운드. */
export function recordBump(minDay: number): void {
  seq++;
  const d = Number.isFinite(minDay) ? Math.max(0, Math.floor(minDay)) : 0;
  if (d === 0) log = [{ seq, minDay: 0 }];
  else log.push({ seq, minDay: d });
}

/** fromSeq(캐시 계산 시점) 이후 bump들의 minAffectedDay min. bump 없으면 Infinity(호출측이 전체 재계산으로 처리).
 *  0이면 전체 무효화(소급 bump 존재) → 재사용 불가. */
export function minAffectedDaySince(fromSeq: number): number {
  let m = Infinity;
  for (const b of log) if (b.seq > fromSeq) { if (b.minDay < m) m = b.minDay; if (m === 0) break; }
  return m;
}

/** 테스트 전용 — 로그 초기화(격리 실행 시드 리셋). 앱 경로 미사용. */
export function _resetSpliceLog(): void { seq = 0; log = []; }
