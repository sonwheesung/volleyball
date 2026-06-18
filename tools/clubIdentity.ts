// 구단 정체성 → 선수단 매핑 sanity 측정 (CLUB_IDENTITY_SYSTEM 5장, 추정 금지).
// 정체성 라벨이 실제 선수단에 맞물리는지: 팀OVR 단조(명문>중위>약체)·신생/신흥 평균나이 최저·포텐 최고.
//   npx tsx tools/clubIdentity.ts [리시드=400]
import { LEAGUE, reseedLeague, getTeamPlayers } from '../data/league';
import { clubIdentity } from '../data/clubIdentity';
import { overallRaw, teamOverallRaw, displayOvr } from '../engine/overall';
import { TRAINABLE_STATS } from '../engine/training';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const K = Math.max(1, Number(process.argv[2]) || 400);

const headroom = (p: Player): number => {
  let h = 0;
  for (const s of TRAINABLE_STATS) h += Math.max(0, (p.potential[s] ?? 0) - (p as unknown as Record<string, number>)[s]);
  return h / TRAINABLE_STATS.length;
};

// 정체성 key → 누적
const acc: Record<string, { ovr: number[]; age: number[]; head: number[]; disp: number[] }> = {};

for (let k = 0; k < K; k++) {
  reseedLeague(3100 + k * 29, 777);
  for (const t of LEAGUE.teams) {
    const id = clubIdentity(t.id);
    if (!id) continue;
    const pl = getTeamPlayers(t.id);
    const a = (acc[id.key] ??= { ovr: [], age: [], head: [], disp: [] });
    a.ovr.push(teamOverallRaw(pl));
    a.disp.push(displayOvr(teamOverallRaw(pl)));
    for (const p of pl) { a.age.push(p.age); a.head.push(headroom(p)); }
  }
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const ORDER = ['dynasty', 'rising', 'aging', 'midpack', 'rebuild', 'cellar', 'expansion'];
const LABEL: Record<string, string> = {
  dynasty: '명문', aging: '황혼의명가', rising: '신흥강호', cellar: '만년약체',
  midpack: '중위권', expansion: '신생팀', rebuild: '리빌딩',
};

log(`\n═══ 구단 정체성 → 선수단 매핑 (리시드 ${K}) ═══\n`);
log(`  ${'정체성'.padEnd(10)} 팀OVR(raw→표시)   평균나이   평균포텐헤드룸`);
for (const key of ORDER) {
  const a = acc[key]; if (!a) continue;
  log(`  ${LABEL[key].padEnd(8)}  ${mean(a.ovr).toFixed(1)} → ${mean(a.disp).toFixed(1)}      ${mean(a.age).toFixed(1)}세      +${mean(a.head).toFixed(1)}`);
}

// 단조성 점검
const teamOvrByOrder = ORDER.map((k) => (acc[k] ? mean(acc[k].ovr) : NaN)).filter((x) => !Number.isNaN(x));
const monotone = teamOvrByOrder.every((v, i) => i === 0 || v <= teamOvrByOrder[i - 1] + 0.3);
const youngest = ORDER.reduce((best, k) => (acc[k] && mean(acc[k].age) < mean(acc[best].age) ? k : best), 'dynasty');
const topPot = ORDER.reduce((best, k) => (acc[k] && mean(acc[k].head) > mean(acc[best].head) ? k : best), 'dynasty');
log('');
log(`  단조(명문→신생 OVR 내림차순): ${monotone ? '✅' : '❌'}`);
log(`  평균나이 최저: ${LABEL[youngest]}  ·  포텐헤드룸 최고: ${LABEL[topPot]}  (기대: 신생/신흥)`);
log('');
