// 검증 — 콘솔 what-if 부상 주입이 시즌 전체(라인업·순위·생산)에 파급되고, 초기화하면 복원되는가(A/B).
import { resetLeagueBase, LEAGUE, getEvolvedTeamPlayers, getPlayer } from '../data/league';
import { availableTeamPlayers, setInjuryOverride, clearWhatIf, injuredOnDay } from '../data/dynamics';
import { computeStandings } from '../data/standings';
import { buildLineup } from '../engine/lineup';
import { overall } from '../engine/overall';
const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const t0 = LEAGUE.teams[0].id;
const setterOf = (day: number) => buildLineup(availableTeamPlayers(t0, day)).six.find((p) => p.position === 'S');

const before = computeStandings(164).find((s) => s.teamId === t0)!;
const aceSetter = setterOf(60)!;
log(`주입 전 — 세터 ${aceSetter.name}(OVR ${Math.round(overall(aceSetter))}) · 인천 ${before.wins}승 ${before.losses}패 ${before.points}점`);

// 에이스 세터 시즌아웃 주입
setInjuryOverride([{ playerId: aceSetter.id, teamId: t0, from: 0, to: 164, severity: 'season', missMatches: 36 }]);
const inAvail = availableTeamPlayers(t0, 60).some((p) => p.id === aceSetter.id);
const inInjured = injuredOnDay(60).has(aceSetter.id);
const newSetter = setterOf(60)!;
const after = computeStandings(164).find((s) => s.teamId === t0)!;
log(`주입 후 — 가용 명단 포함=${inAvail}(false 기대) · injuredOnDay=${inInjured}(true 기대) · 세터 ${newSetter.name}(OVR ${Math.round(overall(newSetter))}) · 인천 ${after.wins}승 ${after.losses}패 ${after.points}점`);

clearWhatIf();
const restored = computeStandings(164).find((s) => s.teamId === t0)!;
const restSetter = setterOf(60)!;
log(`초기화 후 — 세터 ${restSetter.name} · 인천 ${restored.wins}승 ${restored.points}점`);

const ok = !inAvail && inInjured && newSetter.id !== aceSetter.id && (after.wins !== before.wins || after.points !== before.points) && restored.wins === before.wins && restSetter.id === aceSetter.id;
log(`\n파급(라인업·순위 변화)=${after.wins !== before.wins || after.points !== before.points} · 복원=${restored.wins === before.wins && restSetter.id === aceSetter.id}`);
log(`WHATIF OK = ${ok}`);
process.exit(ok ? 0 : 2);
