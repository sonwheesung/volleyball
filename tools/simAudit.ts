// 영입 무결성 감사 CLI — data/acquisitionAudit 엔진을 그대로 호출(인앱 QA 화면과 동일 로직).
//   npx tsx tools/simAudit.ts [시즌=40]
import { runAcquisitionAudit } from '../data/acquisitionAudit';

const N = Math.max(1, Number(process.argv[2]) || 40);
const r = runAcquisitionAudit(N);
const log = (m: string) => process.stdout.write(m + '\n');

log(`\n═══ 영입 무결성 감사 ${r.seasons}시즌 ═══`);
log(`스트레스: FA영입 ${r.stats.faSigned} · 감독경질 ${r.stats.coachFired} · 감독영입 ${r.stats.coachHired} · 코치영입 ${r.stats.asstHired} · 스카우터영입 ${r.stats.scoutHired}`);
for (const c of r.checks) {
  log(`${c.pass ? '✅' : '❌'} ${c.name} — 위반 ${c.violations}`);
  for (const s of c.samples) log(`     · ${s}`);
}
log(r.ok ? '\n✅ 전체 통과 — 영입 중복/오배정 없음' : `\n❌ 위반 발견`);
process.exit(r.ok ? 0 : 1);
