// 통산 리더보드 셀렉터 sanity-check — 현역+은퇴 병합/정렬/필터/팀필터 검증.
// 추정 금지: 셀렉터가 실제로 기대대로 동작하는지 합성 HOF + 실 리그로 확인.
import { careerLeaderboard, teamCareerLeaderboard } from '../data/records';
import { currentRosters, getPlayer } from '../data/league';
import type { HofEntry } from '../types';

const rs = currentRosters();
const teamIds = Object.keys(rs);
const activeCount = teamIds.reduce((n, t) => n + rs[t].length, 0);
console.log(`활성 로스터: ${teamIds.length}팀 ${activeCount}명`);

// 시즌0 현역 통산은 모두 0 → 필터로 비어야 정상(정직)
const emptyLb = careerLeaderboard('points', []);
console.log(`현역만(HOF 없음) 통산 득점 리더보드 길이: ${emptyLb.length} (시즌0이면 0이 정상)`);

// 합성 HOF 5명 (한 명은 영구결번, 한 명은 value 0 → 필터돼야 함)
const t0 = teamIds[0], t1 = teamIds[1];
const hof: HofEntry[] = [
  { id: 'h1', name: '레전드A', position: 'OH', teamId: t0, seasons: 15, points: 5000, blocks: 200, digs: 1200, spikes: 4500, aces: 300, assists: 80, retiredSeason: 10, legend: true },
  { id: 'h2', name: '레전드B', position: 'MB', teamId: t0, seasons: 12, points: 3000, blocks: 900, digs: 300, spikes: 2000, aces: 100, assists: 40, retiredSeason: 8, legend: false },
  { id: 'h3', name: '레전드C', position: 'OP', teamId: t1, seasons: 9, points: 4200, blocks: 150, digs: 200, spikes: 3900, aces: 150, assists: 20, retiredSeason: 6, legend: false },
  { id: 'h4', name: '레전드D', position: 'L', teamId: t1, seasons: 14, points: 0, blocks: 0, digs: 2500, retiredSeason: 9, legend: false }, // spikes/aces/assists 없음(구세이브 모사)
  { id: 'h5', name: '동률E', position: 'OH', teamId: t0, seasons: 20, points: 3000, blocks: 100, digs: 800, spikes: 2800, aces: 90, assists: 30, retiredSeason: 12, legend: false },
];

const lb = careerLeaderboard('points', hof);
console.log('\n통산 득점(현역+은퇴 병합):');
lb.forEach((r, i) => console.log(`  ${i + 1}. ${r.name} ${r.value}점 ${r.seasons}시즌 ${r.retired ? (r.legend ? '[영구결번]' : '[은퇴]') : '[현역]'} @${r.teamId}`));

// 검증
const assert = (c: boolean, m: string) => console.log(`  ${c ? 'PASS' : 'FAIL ❌'} — ${m}`);
console.log('\n검증:');
assert(lb.length === 4, 'value=0(레전드D) 필터됨 → 4명');
assert(lb[0].id === 'h1' && lb[1].id === 'h3', '내림차순 정렬(5000 > 4200)');
// 동률 3000: h2(12시즌) vs h5(20시즌) → 시즌 많은 h5 먼저
const iB = lb.findIndex((r) => r.id === 'h2'), iE = lb.findIndex((r) => r.id === 'h5');
assert(iE < iB, '동률 타이브레이크: 시즌 많은 쪽(동률E 20) 먼저');

const dig = careerLeaderboard('digs', hof);
assert(dig[0].id === 'h4' && dig[0].value === 2500, '디그 카테고리 전환 정상(레전드D 1위)');

// 신규 optional 카테고리: spikes(레전드D는 미보유 → ?? 0 으로 필터)
const spk = careerLeaderboard('spikes', hof);
assert(spk[0].id === 'h1' && spk[0].value === 4500, '공격(spikes) 1위 레전드A 4500');
assert(!spk.some((r) => r.id === 'h4'), 'spikes 미보유(undefined) → ?? 0 → 필터됨');
const ace = careerLeaderboard('aces', hof);
assert(ace[0].id === 'h1' && ace[0].value === 300, '서브(aces) 1위 레전드A 300');

const teamLb = teamCareerLeaderboard('points', t0, hof);
console.log(`\n팀(${t0}) 통산 득점: ${teamLb.map((r) => r.name).join(', ')}`);
assert(teamLb.every((r) => r.teamId === t0), '팀 필터: 전부 해당 팀');
assert(teamLb.length === 3, 'h1·h2·h5 = 3명(h3·h4는 타팀)');

// 현역 경로가 실제로 돌아가는지(0값이라 필터되지만 활성 선수는 존재)
const sample = getPlayer(rs[t0][0]);
console.log(`\n활성 샘플: ${sample?.name} career.points=${sample?.career.points}`);
console.log('완료.');
