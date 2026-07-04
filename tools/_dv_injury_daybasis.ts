// 부상 표기 날짜기준 불일치 프로브 (사용자 보고: "선수 정보 화면에서 부상 표기가 안 되어있다")
//   npx tsx tools/_dv_injury_daybasis.ts
// 선수단(squad.tsx)·대시보드는 currentDay로 출전 가능/부상을 판정하고,
// 선수 상세(player/[id].tsx)는 displayDay=leagueDisplayDay(currentDay)=currentDay−1로 판정한다.
// 두 기준이 부상 span 경계(from·to+1)에서 어긋나면 "선수단 🚑 인데 상세엔 부상 표기 없음"(또는 그 반대·stale)이 발생.
// 이 프로브는 시드 리그 0시즌 전 일자를 스캔해 그 불일치 케이스를 결정론으로 뽑는다(추정 금지 — 실제 함수로 재현).
import { resetLeagueBase, getTeam, getPlayer, LEAGUE, SEASON } from '../data/league';
import { teamInjuriesOn, availableTeamPlayers } from '../data/dynamics';
import { leagueDisplayDay } from '../data/standings';

const log = (m: string) => process.stdout.write(m + '\n');
const short = (tid: string) => (getTeam(tid)?.name ?? tid).split(' ').slice(-1)[0];
const nm = (pid: string) => getPlayer(pid)?.name ?? pid;

resetLeagueBase();

const dayIdx = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);
const maxDay = dayIdx[dayIdx.length - 1];

// squad/대시보드가 보는 부상자(currentDay 기준, availableTeamPlayers에서 빠지고 teamInjuriesOn에 잡히는 선수)
const squadInjured = (team: string, cd: number): Set<string> => {
  const avail = new Set(availableTeamPlayers(team, cd).map((p) => p.id));
  return new Set(teamInjuriesOn(team, cd).map((s) => s.playerId).filter((id) => !avail.has(id)));
};
// 상세([id])가 보는 부상 결장. basis='old' = 수정 전(displayDay=cd−1), basis='new' = 수정 후(currentDay).
const detailInjured = (team: string, cd: number, basis: 'old' | 'new'): Set<string> => {
  const dd = basis === 'old' ? leagueDisplayDay(cd) : cd;
  const avail = new Set(availableTeamPlayers(team, dd).map((p) => p.id));
  return new Set(teamInjuriesOn(team, dd).map((s) => s.playerId).filter((id) => !avail.has(id)));
};

const scan = (basis: 'old' | 'new') => {
  let squadOnlyDetailOff = 0, detailStale = 0;
  const samples: string[] = [];
  for (let cd = 1; cd <= maxDay + 2; cd++) {
    for (const t of LEAGUE.teams) {
      const s = squadInjured(t.id, cd);
      const d = detailInjured(t.id, cd, basis);
      for (const pid of s) if (!d.has(pid)) { squadOnlyDetailOff++; if (samples.length < 12) samples.push(`day ${cd} · ${short(t.id)} · ${nm(pid)} → 선수단 🚑, 상세 표기 없음 (부상 from=${teamInjuriesOn(t.id, cd).find((x) => x.playerId === pid)?.from})`); }
      for (const pid of d) if (!s.has(pid)) detailStale++;
    }
  }
  return { squadOnlyDetailOff, detailStale, samples };
};

const oldR = scan('old'); // 수정 전 코드(displayDay)
const newR = scan('new'); // 수정 후 코드(currentDay)

log('\n═══ 부상 표기 날짜기준: 선수단(currentDay) vs 상세 ═══');
log(`스캔: ${LEAGUE.teams.length}팀 × ${maxDay + 2}일`);
log(`\n[수정 전: 상세=displayDay(cd−1)]`);
log(`  ① 선수단 🚑 인데 상세 표기 없음(보고 증상): ${oldR.squadOnlyDetailOff}건`);
log(`  ② 상세엔 부상인데 선수단 복귀(stale): ${oldR.detailStale}건`);
log('  ── 증상① 샘플 ──');
for (const s of oldR.samples) log('    · ' + s);
log(`\n[수정 후: 상세=currentDay(선수단과 동일)]`);
log(`  ① 선수단 🚑 인데 상세 표기 없음: ${newR.squadOnlyDetailOff}건`);
log(`  ② 상세엔 부상인데 선수단 복귀(stale): ${newR.detailStale}건`);

const pass = oldR.squadOnlyDetailOff > 0 && newR.squadOnlyDetailOff === 0 && newR.detailStale === 0;
log(pass
  ? '\n✅ A/B 자가검증: 수정 전 불일치 재현 → 수정 후 0(선수단과 완전 일치). currentDay 정렬이 옳음'
  : `\n❌ 예상 밖 — old(${oldR.squadOnlyDetailOff}/${oldR.detailStale}) new(${newR.squadOnlyDetailOff}/${newR.detailStale})`);
process.exit(pass ? 0 : 1);
