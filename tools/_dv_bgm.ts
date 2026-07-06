// 가드 — BGM 자산·배선 정합(SOUND_SYSTEM §4). npx tsx tools/_dv_bgm.ts (exit 0/1)
// ①assets/bgm 파일 수==10·명명 규칙(bgm_01..bgm_10) ②audio/bgm.ts TRACKS require 수 일치
// ③bgmVolume 마이그레이션 키가 3곳(SAVE_DEFAULTS·KIND·partialize)에 존재. 자산 유실·손복제 드리프트 차단.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const EXPECTED = 10;
const fails: string[] = [];

// ① assets/bgm 파일
const dir = join(root, 'assets', 'bgm');
const files = readdirSync(dir).filter((f) => f.endsWith('.m4a')).sort();
const expectedNames = Array.from({ length: EXPECTED }, (_, i) => `bgm_${String(i + 1).padStart(2, '0')}.m4a`);
if (files.length !== EXPECTED) fails.push(`assets/bgm .m4a 수=${files.length} (기대 ${EXPECTED})`);
for (const n of expectedNames) if (!files.includes(n)) fails.push(`누락: ${n}`);
for (const f of files) if (!expectedNames.includes(f)) fails.push(`예상 밖 파일: ${f}`);

// ② audio/bgm.ts TRACKS require 수
const bgmSrc = readFileSync(join(root, 'audio', 'bgm.ts'), 'utf8');
const requireCount = (bgmSrc.match(/require\('\.\.\/assets\/bgm\/bgm_\d{2}\.m4a'\)/g) ?? []).length;
if (requireCount !== EXPECTED) fails.push(`bgm.ts TRACKS require 수=${requireCount} (기대 ${EXPECTED})`);

// ③ bgmVolume 마이그레이션 키 3곳
const mig = readFileSync(join(root, 'store', 'saveMigration.ts'), 'utf8');
const store = readFileSync(join(root, 'store', 'useGameStore.ts'), 'utf8');
if (!/bgmVolume:\s*0\.8/.test(mig)) fails.push('SAVE_DEFAULTS에 bgmVolume 없음');
if (!/bgmVolume:\s*'num'/.test(mig)) fails.push("KIND에 bgmVolume:'num' 없음");
if (!/bgmVolume:\s*s\.bgmVolume/.test(store)) fails.push('partialize에 bgmVolume 없음');

console.log(`assets .m4a=${files.length} · TRACKS require=${requireCount} · 마이그레이션 키 3곳 확인`);
const pass = fails.length === 0;
console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'}`);
if (!pass) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
