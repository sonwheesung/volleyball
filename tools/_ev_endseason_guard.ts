// 측정 — endSeason 더블탭 가드의 전제 검증(§3.5). store의 endSeason은 롤오버 시 results={}로 비우고(useGameStore:749),
//   진입부에서 planNextAction(SEASON, my, results).kind !== 'seasonOver'면 return한다.
//   → 첫 호출(모든 일정 소화=seasonOver)은 통과, 롤오버 후 둘째 탭(results 빈=match)은 차단되는지 확인.
//   Usage: npx tsx tools/_ev_endseason_guard.ts
import { resetLeagueBase, SEASON, LEAGUE } from '../data/league';
import { planNextAction } from '../engine/advance';
import type { MatchResult } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const my = LEAGUE.teams[0].id;

// 시즌 종료 시점 재현: 내 팀의 모든 경기를 results에 채움
const full: Record<string, MatchResult> = {};
for (const f of SEASON) if (f.homeTeamId === my || f.awayTeamId === my) full[f.id] = {} as MatchResult;

const atEnd = planNextAction(SEASON, my, full).kind;   // 첫 호출(시즌 끝) → seasonOver (통과해야)
const afterRollover = planNextAction(SEASON, my, {}).kind; // 롤오버 후 results={} → match (차단돼야)

log('═══ endSeason 더블탭 가드 전제 검증 ═══');
log(`첫 호출(내 팀 전 경기 소화): planNextAction=${atEnd}  → 가드 통과(진행) 기대 'seasonOver'`);
log(`둘째 탭(롤오버 후 results={}): planNextAction=${afterRollover}  → 가드 차단(return) 기대 'match'`);

const firstProceeds = atEnd === 'seasonOver';   // 정상 진행
const secondBlocked = afterRollover === 'match'; // 더블탭 차단
const ok = firstProceeds && secondBlocked;
log(`\n첫 호출 진행=${firstProceeds} · 둘째 탭 차단=${secondBlocked}`);
log(`GUARD OK = ${ok}`);
process.exit(ok ? 0 : 2);
