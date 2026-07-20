// 장기 운영 무결성 QA — 단장이 스태프 꾸린 팀으로 N시즌 돌리며 매 시즌 게임 상태 불변식 검사.
//   npx tsx tools/qaIntegrity.ts [시즌=150]
// 검사: 로스터 크기 · 선수 중복(두 팀 동시 소속) · OVR/나이 범위·NaN · 우승팀 유효 · 스태프 예산.

import {
  LEAGUE, getTeam, resetLeagueBase, currentRosters, getEvolvedTeamPlayers,
  availableCoaches, hireHeadCoach, availableAssistants, hireAssistant, availableScouts, hireScout,
  staffSpend,
} from '../data/league';
import { STAFF_BUDGET } from '../engine/staff';
import { advanceOffseason } from './simLeague';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { overall } from '../engine/overall';

const log = (m: string) => process.stdout.write(m + '\n');

function main(): void {
  const seasons = Math.max(1, Number(process.argv[2]) || 150);
  resetLeagueBase();
  const ids = new Set(LEAGUE.teams.map((t) => t.id));
  const idArr = [...ids];
  const my = idArr[0];

  // 단장: 스태프 풀세트(예산 한도까지)
  const fc = availableCoaches().sort((a, b) => b.matchOps - a.matchOps)[0];
  if (fc) hireHeadCoach(my, fc.id);
  for (const sp of ['attack', 'defense', 'setter'] as const) {
    const a = availableAssistants().filter((x) => x.specialty === sp).sort((x, y) => y.rating - x.rating)[0];
    if (a) hireAssistant(my, a.id);
  }
  const sc = availableScouts().sort((a, b) => b.scouting - a.scouting)[0];
  if (sc) hireScout(my, sc.id);

  const violations: string[] = [];
  const add = (s: number, msg: string) => { if (violations.length < 30) violations.push(`S${s + 1}: ${msg}`); };
  let minRoster = 99, maxRoster = 0, minOvr = 99, maxOvr = 0, minAge = 99, maxAge = 0;

  for (let s = 0; s < seasons; s++) {
    // 우승 유효성
    const champ = buildPlayoffs(s).championId ?? computeStandings(Number.MAX_SAFE_INTEGER)[0]?.teamId;
    if (!champ || !ids.has(champ)) add(s, `우승팀 무효: ${champ}`);

    // 로스터 무결성
    const rost = currentRosters();
    const seen = new Map<string, string>(); // playerId → teamId (중복 검출)
    for (const tid of idArr) {
      const r = rost[tid] ?? [];
      minRoster = Math.min(minRoster, r.length); maxRoster = Math.max(maxRoster, r.length);
      if (r.length < 12 || r.length > 20) add(s, `${getTeam(tid)?.name} 로스터 크기 ${r.length}`);
      for (const pid of r) {
        if (seen.has(pid)) add(s, `선수 중복: ${pid} (${seen.get(pid)} & ${tid})`);
        else seen.set(pid, tid);
      }
      // 진화 선수 스탯 검사
      for (const p of getEvolvedTeamPlayers(tid, 164)) {
        const o = overall(p);
        if (!Number.isFinite(o) || o < 40 || o > 99) add(s, `${p.name} OVR 이상: ${o}`);
        if (!Number.isFinite(p.age) || p.age < 16 || p.age > 46) add(s, `${p.name} 나이 이상: ${p.age}`);
        minOvr = Math.min(minOvr, o); maxOvr = Math.max(maxOvr, o);
        minAge = Math.min(minAge, p.age); maxAge = Math.max(maxAge, p.age);
        for (const k of ['skSpike', 'skBlock', 'skDig', 'skReceive', 'skSet', 'skServe', 'jump', 'staminaMax'] as const) {
          const v = (p as unknown as Record<string, number>)[k];
          if (!Number.isFinite(v) || v < 0 || v > 120) add(s, `${p.name}.${k} 이상: ${v}`);
        }
      }
    }
    // 내 팀 스태프 예산
    if (staffSpend(my) > STAFF_BUDGET) add(s, `스태프 예산 초과: ${staffSpend(my)} > ${STAFF_BUDGET}`);

    advanceOffseason(s);
    if ((s + 1) % 30 === 0) process.stderr.write(`  …${s + 1}/${seasons}시즌 검사\n`);
  }

  log(`\n═══ 장기 무결성 QA — ${seasons}시즌 (${idArr.length}팀) ═══`);
  log(`로스터 크기: ${minRoster}~${maxRoster} · OVR 범위: ${minOvr}~${maxOvr} · 나이 범위: ${minAge}~${maxAge}`);
  if (violations.length === 0) log(`\n✅ 위반 0건 — 모든 시즌에서 게임 상태 무결(로스터·중복·OVR·나이·스탯·예산·우승팀).`);
  else { log(`\n❌ 위반 ${violations.length}건 (앞 30):`); for (const v of violations) log(`  ${v}`); }
}

main();
