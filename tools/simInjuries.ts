// 부상 sanity — 시드 리그 0시즌 부상 타임라인 점검.
//   npx tsx tools/simInjuries.ts
// 팀당 부상 수·심각도 분포·동시부상 상한 준수·출전가능 최소인원 확인.

import { resetLeagueBase, getTeam, getPlayer, LEAGUE, SEASON } from '../data/league';
import { seasonInjuryReport, injuredOnDay, availableTeamPlayers } from '../data/injury';
import { SEVERITY_KO, CONCURRENT_CAP } from '../engine/injury';

const log = (m: string) => process.stdout.write(m + '\n');
const short = (tid: string) => (getTeam(tid)?.name ?? tid).split(' ').slice(-1)[0];

resetLeagueBase();
const spans = seasonInjuryReport();
const days = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);

log(`\n═══ 부상 sanity · 0시즌 (${LEAGUE.teams.length}팀) ═══`);

// 심각도 분포
const sev: Record<string, number> = {};
for (const s of spans) sev[s.severity] = (sev[s.severity] ?? 0) + 1;
log(`총 부상 ${spans.length}건 — ` + Object.entries(sev).map(([k, v]) => `${SEVERITY_KO[k as keyof typeof SEVERITY_KO]} ${v}`).join(' · '));
log(`팀당 평균 ${(spans.length / LEAGUE.teams.length).toFixed(1)}건/시즌`);

// 동시부상 상한 + 출전가능 최소 인원 검증
let maxConcurrent = 0, minAvail = 99;
for (const d of days) {
  for (const t of LEAGUE.teams) {
    const inj = [...injuredOnDay(d)].filter((id) => getPlayer(id) && LEAGUE.teams.find((x) => x.id === t.id));
    const teamInj = seasonInjuryReport().filter((s) => s.teamId === t.id && s.from <= d && d <= s.to).length;
    maxConcurrent = Math.max(maxConcurrent, teamInj);
    minAvail = Math.min(minAvail, availableTeamPlayers(t.id, d).length);
  }
}
log(`\n최대 동시부상(팀) ${maxConcurrent} (상한 ${CONCURRENT_CAP}) · 최소 출전가능 인원 ${minAvail}`);
log(maxConcurrent <= CONCURRENT_CAP ? '✅ 동시부상 상한 준수' : '❌ 상한 초과!');
log(minAvail >= 7 ? '✅ 항상 라인업 구성 가능' : '⚠️ 일부 시점 7인 미만(빌더 방어충원 동작)');

// 샘플
log('\n── 부상 샘플(앞 12건) ──');
for (const s of spans.slice(0, 12)) {
  const p = getPlayer(s.playerId);
  const ret = s.to >= Number.MAX_SAFE_INTEGER ? '시즌아웃' : `~${s.to}일 복귀`;
  log(`${short(s.teamId).padEnd(5)} ${p?.name ?? s.playerId}(${p?.age}세) ${SEVERITY_KO[s.severity]} ${s.missMatches}경기 (${s.from}일~, ${ret})`);
}
log('');
