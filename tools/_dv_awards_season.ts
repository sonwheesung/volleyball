// 가드 — 기록 아카이브 시즌 탭 시상식 노출 정책(AWARDS_SYSTEM §6 "잠정 시상 노출 폐지", 2026-07-30).
// npx tsx tools/_dv_awards_season.ts (exit 0/1)
// 정책: 시상식류(MVP·신인상·베스트7·부문 기록상)는 시즌 종료 후에만 노출. 진행 중(provisional)엔 숨기고
//       안내 카드 + 순위표 + 개인 기록 리더보드만. 정적 소스 체크(RN 렌더라 시뮬 불가).
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const src = readFileSync(join(root, 'app', 'records-archive.tsx'), 'utf8');
const fails: string[] = [];

// ① 잠정 노출 잔재 제거 — AWARD_MIN_GAMES·awardsReady 미존재(진행 중 노출 게이트가 살아있으면 회귀)
if (/AWARD_MIN_GAMES/.test(src)) fails.push('AWARD_MIN_GAMES 잔존(잠정 노출 게이트 미제거)');
if (/awardsReady/.test(src)) fails.push('awardsReady 잔존(잠정 노출 게이트 미제거)');

// ② 시상식 그룹 렌더 게이트가 `!provisional && aw && aw.mvp` (진행 중이면 시상식 그룹 미렌더)
if (!/\{!provisional && aw && aw\.mvp \?/.test(src)) fails.push('시상식 그룹 게이트가 `!provisional && aw && aw.mvp`가 아님');

// ③ 진행 중 안내 카드(시상식류 대신) — provisional 분기 + 안내 문구
if (!/\) : provisional \?/.test(src)) fails.push('provisional 안내 카드 분기 없음');
if (!/시상 기록은 시즌이 끝난 뒤 시상식에서 공개됩니다/.test(src)) fails.push('진행 중 안내 문구 없음');

// ④ 스텝퍼 태그는 `진행 중`(구 `진행 중 · 잠정` 제거)
if (/진행 중\{provisional/.test(src)) fails.push('스텝퍼 태그에 `· 잠정` 잔존');

// ⑤ 순위표·개인 기록 리더보드는 진행 중에도 유지(숨김 대상 아님) — 존재 확인
if (!/개인 기록 리더보드/.test(src)) fails.push('개인 기록 리더보드 섹션 소실');
if (!/snap\.isCurrent \? '순위표' : '최종 순위'/.test(src)) fails.push('순위표 섹션 소실');

console.log('시상식 그룹 게이트=!provisional · 진행중 안내카드 · 순위표/리더보드 유지 확인');
const pass = fails.length === 0;
console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'}`);
if (!pass) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
