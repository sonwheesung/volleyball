// 로테이션 규칙 (CLAUDE.md 4.3) — 배구를 "숫자 야구"와 구분 짓는 핵심 변수.
// 6명이 시계방향 1칸 회전. 전위(2·3·4)만 네트 앞 공격/블로킹 가능.
// rotation 값 0..5 = 현재 1번 자리에 선 선수의 라인업 인덱스.

export type Zone = 1 | 2 | 3 | 4 | 5 | 6;

/** 사이드아웃으로 서브권을 따낼 때 시계방향 1칸 회전 */
export function rotate(rotation: number): number {
  return (rotation + 1) % 6;
}

/** 전위(2·3·4번)에 서는 라인업 인덱스 3개 — 공격/블로킹 가능자 */
export function frontRow(rotation: number): [number, number, number] {
  // 코트 존 2,3,4 에 해당하는 라인업 슬롯을 회전만큼 시프트.
  return [
    (rotation + 1) % 6, // zone 2
    (rotation + 2) % 6, // zone 3
    (rotation + 3) % 6, // zone 4
  ];
}

/** 후위(1·5·6번)에 서는 라인업 인덱스 3개 — 후위 공격만 가능 */
export function backRow(rotation: number): [number, number, number] {
  return [
    rotation % 6,       // zone 1 (서버)
    (rotation + 4) % 6, // zone 5
    (rotation + 5) % 6, // zone 6
  ];
}

/** 현재 서브하는 선수의 라인업 인덱스 (zone 1) */
export function serverIndex(rotation: number): number {
  return rotation % 6;
}

/** 라인업 인덱스가 전위인지 */
export function isFrontRow(rotation: number, lineupIndex: number): boolean {
  return frontRow(rotation).includes(lineupIndex);
}
