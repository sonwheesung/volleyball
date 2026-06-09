// 플레이스루 — 화면 대신 '버튼이 호출하는 게임 시스템'을 직접 조작해 단장 운영을 재현.
// 약체 팀을 맡아 스태프를 꾸리고 N시즌 운영 → 전력·순위·우승 변화를 본다.
//   npx tsx tools/playthrough.ts [시즌=12]

import {
  LEAGUE, getTeam, resetLeagueBase, getEvolvedTeamPlayers,
  availableCoaches, hireHeadCoach, availableAssistants, hireAssistant, availableScouts, hireScout,
  staffSpend, staffBudgetLeft, teamScoutReveal, getTeamCoach, teamAssistants,
} from '../data/league';
import { runUniverse } from './simLeague';
import { teamOverall } from '../engine/overall';
import { overall } from '../engine/overall';
import { SPECIALTY_KO } from '../engine/staff';
import { formatMoney } from '../engine/salary';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const top = (ps: Player[], n: number) => [...ps].sort((a, b) => overall(b) - overall(a)).slice(0, n);

function main(): void {
  const seasons = Math.max(1, Number(process.argv[2]) || 12);
  resetLeagueBase();
  const ids = LEAGUE.teams.map((t) => t.id);

  // ── 구단 선택: 가장 약한 팀을 맡는다(도전) ──
  const ranked = ids.map((id) => ({ id, ovr: teamOverall(getEvolvedTeamPlayers(id, 164)) })).sort((a, b) => a.ovr - b.ovr);
  const my = ranked[0].id;
  const startOvr = ranked[0].ovr;
  log(`\n🏐 [구단 선택] 가장 약한 ${getTeam(my)?.name}(전력 ${startOvr})을 맡습니다. 리그 ${ids.length}팀 중 최하위 전력.`);
  log(`   주축: ${top(getEvolvedTeamPlayers(my, 164), 4).map((p) => `${p.name}(${p.position} ${overall(p)})`).join(' · ')}`);

  // ── 단장 업무 → 스태프 계약 ──
  log(`\n💼 [스태프 계약] 예산 ${formatMoney(staffBudgetLeft(my) + staffSpend(my))} · 현재 감독 ${getTeamCoach(my)?.name}(연봉 ${formatMoney(getTeamCoach(my)?.salary ?? 0)})`);

  // 1) 카리스마 좋은 프리 감독으로 교체(예산 되면)
  const fc = availableCoaches().filter((c) => c.charisma >= 80).sort((a, b) => a.salary - b.salary)[0];
  if (fc && hireHeadCoach(my, fc.id)) log(`   ✔ 감독 영입: ${fc.name}(카리스마 ${fc.charisma}, ${fc.archetype}, ${formatMoney(fc.salary)})`);

  // 2) 전문 코치 3슬롯 — 기량(포텐↑) 위주로: 공격·수비·세터
  for (const sp of ['attack', 'defense', 'setter'] as const) {
    const a = availableAssistants().filter((x) => x.specialty === sp).sort((x, y) => y.rating - x.rating)[0];
    if (a && hireAssistant(my, a.id)) log(`   ✔ 코치 영입: ${SPECIALTY_KO[a.specialty]} ${a.name}(역량 ${a.rating}, ${formatMoney(a.salary)})`);
  }
  // 3) 스카우터 — 예산 남으면
  const sc = availableScouts().sort((a, b) => b.scouting - a.scouting)[0];
  if (sc && hireScout(my, sc.id)) log(`   ✔ 스카우터 영입: ${sc.name}(스카우팅 ${sc.scouting}, ${formatMoney(sc.salary)})`);
  log(`   → 스태프 지출 ${formatMoney(staffSpend(my))} / 예산 여유 ${formatMoney(staffBudgetLeft(my))} · 드래프트 공개도 ${Math.round(teamScoutReveal(my) * 100)}%`);
  log(`   코치진: ${teamAssistants(my).map((a) => SPECIALTY_KO[a.specialty]).join(', ')}`);

  // ── 시즌 운영(일정 자동진행 + 오프시즌) ──
  log(`\n📅 [시즌 운영] ${seasons}시즌 자동 진행(전 구단 AI, 내 팀은 위 스태프 적용)…`);
  const u = runUniverse(seasons, (s) => { if ((s + 1) % 4 === 0) process.stderr.write(`  …${s + 1}/${seasons}시즌\n`); });

  // ── 결과: 내 팀 시즌별 순위 + 우승 + 전력 변화 ──
  const myRanks = u.rankHistory[my];
  const finalOvr = teamOverall(getEvolvedTeamPlayers(my, 164));
  const myTitleSeasons = new Set(u.champSeasons[my] ?? []);
  log(`\n📊 [내 팀 ${getTeam(my)?.name} 운영 결과 · ${seasons}시즌]`);
  if (seasons <= 20) {
    log(`   시즌별 순위: ${myRanks.map((r, i) => `S${i + 1}:${r}위`).join('  ')}`);
  } else {
    // 10년 단위 요약: 평균순위 + 그 10년 우승수
    log(`   10년 단위 (평균순위 · 우승):`);
    for (let d = 0; d < seasons; d += 10) {
      const slice = myRanks.slice(d, d + 10);
      const avg = (slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(1);
      const wins = [...myTitleSeasons].filter((s) => s >= d && s < d + 10).length;
      log(`     ${String(d + 1).padStart(3)}~${String(Math.min(d + 10, seasons)).padStart(3)}시즌: 평균 ${avg}위 · 우승 ${wins}회`);
    }
  }
  log(`   통산 우승 ${u.titles[my]}회 · 평균순위 ${(u.rankSum[my] / seasons).toFixed(1)}위 (${ids.length}팀 중) · 최고 순위 ${Math.min(...myRanks)}위`);
  log(`   전력 변화: ${startOvr} → ${finalOvr} (${finalOvr - startOvr >= 0 ? '+' : ''}${finalOvr - startOvr})`);
  log(`   현재 주축: ${top(getEvolvedTeamPlayers(my, 164), 4).map((p) => `${p.name}(${p.position} ${overall(p)})`).join(' · ')}`);

  // 리그 우승 분포(맥락)
  log(`\n🏆 리그 우승 분포: ${ids.map((id) => ({ id, t: u.titles[id] })).sort((a, b) => b.t - a.t).map((x) => `${getTeam(x.id)?.name} ${x.t}`).join(' · ')}`);
  const myRank = ids.map((id) => ({ id, avg: u.rankSum[id] / seasons })).sort((a, b) => a.avg - b.avg).findIndex((x) => x.id === my) + 1;
  log(`   내 팀 평균순위 리그 ${myRank}위 (시작은 최하위 전력이었음)`);
}

main();
