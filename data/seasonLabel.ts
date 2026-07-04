// 인게임 시즌 인덱스(0-based) → V리그식 연도 라벨 (2026-07-04 사용자 결정, EC-REC-01 후속).
//
// 왜: "N시즌"(세는 숫자)은 시드 백스토리 포함 여부·현재 몇 시즌째인지와 헷갈린다(EC-REC-01).
//   실제 V리그처럼 **연도로 시즌을 부르면** 모호함이 사라지고 100년 연대기 느낌이 산다(누적 서사 기둥).
// 기준: 내가 맡는 **1시즌(idx 0) = 2025-26**. 구단선택 배경(게임 직전 5시즌)이 2020-21~2024-25라 그 다음.
// 형식: 풀 시작연도 + 2자리 끝(사용자 선택) — "2025-26". 100시즌+ 겹침 없음(2자리는 세기마다 충돌).

export const SEASON_BASE_YEAR = 2025; // 인게임 시즌 idx 0의 시작 연도

/** 시즌 인덱스(0-based) → "2025-26". 음수(게임 이전 배경)도 지원: -1 → "2024-25". */
export function seasonYear(idx: number): string {
  const y = SEASON_BASE_YEAR + idx;
  const end = ((y + 1) % 100 + 100) % 100; // 2099→2100은 "00"
  return `${y}-${String(end).padStart(2, '0')}`;
}

/** 통산 범위 — 같은 시즌이면 단일, 다르면 "A ~ B". from/to는 시즌 인덱스. */
export function seasonYearRange(fromIdx: number, toIdx: number): string {
  return fromIdx === toIdx ? seasonYear(fromIdx) : `${seasonYear(fromIdx)} ~ ${seasonYear(toIdx)}`;
}
