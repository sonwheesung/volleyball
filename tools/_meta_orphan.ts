// 고아 가드 검출(메타 가드) — TEST_METHODOLOGY §4 "배터리 미연결(orphan guard)" 사각의 기계화.
//   npx tsx tools/_meta_orphan.ts
// 규칙: tools/·server/tools/ 의 가드 파일(_dv_*·_gt_*·_ev_*·_ms_*.ts)은 전부 docs/README.md 에
//   basename 이 등장해야 한다(상비 배터리든 온디맨드 색인이든 — 등재 자체가 존재 선언).
//   가드를 만들고 README에 안 실으면 인접 변경이 깨뜨려도 무감지로 썩는다(_dv_purchase 이틀 잠복,
//   _dv_cover 2026-07-16 재발). 새 가드 추가 시 이 검사가 커밋 전에 잡는다.
// A/B 자가검증: --selftest 는 존재하지 않는 팬텀 가드명을 목록에 주입해 "검출되는지"로
//   오라클 비공허를 증명한다(팬텀 미검출 = 이 가드 자체가 고장).
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const readme = readFileSync(join(ROOT, 'docs', 'README.md'), 'utf8');
const GUARD_RE = /^_(dv|gt|ev|ms|meta)_.*\.ts$/;

function guardsIn(dir: string): string[] {
  try {
    return readdirSync(join(ROOT, dir)).filter((f) => GUARD_RE.test(f)).map((f) => `${dir}/${f}`);
  } catch { return []; }
}

const files = [...guardsIn('tools'), ...guardsIn('server/tools')];
if (process.argv.includes('--selftest')) files.push('tools/_dv_zzz_phantom_selftest.ts');

const orphans = files.filter((f) => {
  const base = f.split('/').pop()!.replace(/\.ts$/, '');
  return !readme.includes(base);
});

if (process.argv.includes('--selftest')) {
  const caught = orphans.some((f) => f.includes('_dv_zzz_phantom_selftest'));
  console.log(caught ? '✅ selftest PASS — 팬텀 가드 검출(오라클 유효)' : '❌ selftest FAIL — 팬텀 미검출(가드 고장)');
  process.exit(caught ? 0 : 1);
}

console.log(`가드 파일 ${files.length}개 (tools + server/tools) ↔ docs/README.md 대조`);
if (orphans.length === 0) {
  console.log('✅ 고아 가드 0 — 전부 README에 등재됨');
  process.exit(0);
}
console.log(`❌ 고아 가드 ${orphans.length}개 — docs/README.md 검증 루틴(상비) 또는 온디맨드 색인에 등재하라:`);
for (const f of orphans) console.log('  ' + f);
process.exit(1);
