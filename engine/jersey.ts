// 헌액 번호 — 선수 등번호(1~99). id 시드 결정론·무저장·버전 동결. docs/BROADCAST_SYSTEM §8.
// 비소모: 번호는 표시·명예 라벨일 뿐 코트에서 배정·고갈되지 않는다('영구결번' 아님). 같은 번호를
// 후배가 달면 '번호 계보(사실)'로 과거 레전드를 나열한다(가짜 인과 금지 — '계승' 아니라 '같은 번호').
import { createRng, strSeed } from './rng';

// 동결: 해시 식을 바꾸면 과거 세이브의 번호가 흔들리므로 버전을 고정한다(바꿀 땐 버전 올리고 문서화).
const JERSEY_SEED_VERSION = 1;

/** id에서 파생되는 고정 등번호 1~99. 무저장·결정론(메인 RNG 비소모). */
export function jerseyNumber(id: string): number {
  const r = createRng(strSeed(`jersey:v${JERSEY_SEED_VERSION}:${id}`)).next();
  return 1 + Math.floor(r * 99); // 1..99
}

// 초레전드 금색 티어(통산 1만점+) — 1000년+ 플레이 시 '레전드' 의미 인플레 방지(표시 전용).
export const SUPER_LEGEND_POINTS = 10000;
