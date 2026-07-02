// 다이아 지갑 멱등키 빌더 (BACKEND_SYSTEM §13.12) — 순수 함수, tsx로 검증 가능(_dv_walletauth).
//
// 서버 원장 UNIQUE는 `(proj_code, idempotency_key)`라 **키에 userId를 넣어 전역 유일**하게 만든다.
// (안 넣으면 서로 다른 유저가 같은 achId를 수령할 때 두 번째가 dedupe돼 0 지급되는 버그.)
//
// 비대칭(의도):
//  - ach = `ach:<userId>:<achId>` — **에폭 없음 = 계정 평생 1회**. 세이브 리셋 후 재달성해도 재수령 0(파밍 차단).
//  - camp = `camp:<userId>:<saveId>:<season>:<playerId>` — **saveId(세이브 생성 128비트 nonce=walletEpoch)** 포함 →
//    세이브 지우고 새로 시작하면 같은 (season,playerId)라도 새 키 → "이미 처리됨"(무료 재강화) 버그 차단. 다시 돈 냄=정당.
//  - ad = `ad:<userId>:<dayIndex>:<count>` — 슬롯 결정론. 같은 날 같은 슬롯 재시도만 dedupe(시계 되돌려도 캘린더-데이 키가 막음).

export const adKey = (userId: string, dayIndex: number, count: number): string => `ad:${userId}:${dayIndex}:${count}`;

export const achKey = (userId: string, achId: string): string => `ach:${userId}:${achId}`;

export const campKey = (userId: string, saveId: string, season: number, playerId: string): string =>
  `camp:${userId}:${saveId}:${season}:${playerId}`;

/** 세이브 인스턴스 nonce(walletEpoch) 생성 — camp 멱등키 스코프. 스토어 런타임이라 Date.now/Math.random 허용(엔진 아님). */
export function newSaveId(): string {
  const rnd = Math.floor(Math.random() * 0xffffffff).toString(36) + Math.floor(Math.random() * 0xffffffff).toString(36);
  return `s_${Date.now().toString(36)}_${rnd}`;
}
