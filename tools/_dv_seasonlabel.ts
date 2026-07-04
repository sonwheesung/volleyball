// 시즌 연도 라벨 가드(EC-REC-01 후속, 2026-07-04). `npx tsx tools/_dv_seasonlabel.ts`
import { seasonYear, seasonYearRange, SEASON_BASE_YEAR } from '../data/seasonLabel';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); fail++; } else console.log('  ✓ ' + m); };

console.log('[1] 기준 앵커');
ok(SEASON_BASE_YEAR === 2025, 'SEASON_BASE_YEAR=2025');
ok(seasonYear(0) === '2025-26', '1시즌(idx0)=2025-26: ' + seasonYear(0));
ok(seasonYear(2) === '2027-28', '3시즌(idx2)=2027-28(사용자 실기기): ' + seasonYear(2));

console.log('[2] 배경 스토리(음수 인덱스)');
ok(seasonYear(-1) === '2024-25', 'idx-1=2024-25(구단선택 배경 마지막): ' + seasonYear(-1));
ok(seasonYear(-5) === '2020-21', 'idx-5=2020-21(배경 5시즌 전): ' + seasonYear(-5));

console.log('[3] 100년 겹침 없음 + 세기 경계');
ok(seasonYear(74) === '2099-00', 'idx74=2099-00(끝 2자리 00): ' + seasonYear(74));
ok(seasonYear(75) === '2100-01', 'idx75=2100-01: ' + seasonYear(75));
const labels = new Set(Array.from({ length: 100 }, (_, i) => seasonYear(i)));
ok(labels.size === 100, '100시즌 라벨 전부 고유(겹침 0): ' + labels.size);

console.log('[4] 범위');
ok(seasonYearRange(0, 0) === '2025-26', '단일 시즌 범위=단일 라벨');
ok(seasonYearRange(0, 1) === '2025-26 ~ 2026-27', '다시즌 범위: ' + seasonYearRange(0, 1));

console.log('[5] A/B 민감도(형식이 실제로 연도인가 — "N시즌" 아님)');
ok(!seasonYear(0).includes('시즌') && /\d{4}-\d{2}/.test(seasonYear(0)), '라벨은 YYYY-YY 형식(옛 "N시즌" 아님)');

console.log(fail === 0 ? '\nPASS' : `\nFAIL (${fail}건)`);
process.exit(fail === 0 ? 0 : 1);
