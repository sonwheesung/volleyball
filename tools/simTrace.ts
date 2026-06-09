// 실제 경기 트레이스 — 한 경기를 랠리 단위로 따라가며 토스 선택·선수 위치·블로킹·리시브 전환(공 튕김)을 본다.
//   npx tsx tools/simTrace.ts [집계 라운드로빈 반복=20]
//
// (1) 코트 포지션: 로테이션별 전위/후위 6인 + 리베로 후위 교체.
// (2) 랠리 트레이스: 서브 → 리시브 품질 → 세트(속공/오픈 등 + 공격수) → 블로킹/디그(튕김) → 득점.
// (3) 집계: 세트(토스) 선택 분포, 센터 토스 비중(패스 품질별), 블로킹 결과.

import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, getTeam, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import { newRallyStats, newPosStats, type RallyStats, type PosStats } from '../engine/rally';
import type { Position } from '../types';
import { buildLineup } from '../engine/lineup';
import { frontRow, backRow } from '../engine/rotation';
import type { Player } from '../types';

const lbl = (p: Player) => `${p.name}(${p.position})`;
const pct = (x: number, d: number) => (d > 0 ? (x / d * 100) : 0).toFixed(1) + '%';
const log = (m: string) => process.stdout.write(m + '\n');

function main(): void {
  const reps = Math.max(1, Number(process.argv[2]) || 20);
  resetLeagueBase();
  const ids = LEAGUE.teams.map((t) => t.id);
  const sq: Record<string, Player[]> = {};
  for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);
  const a = ids[0], b = ids[1];

  // (1) 코트 포지션 — 로테이션별 전·후위 + 리베로
  const lu = buildLineup(sq[a]);
  log(`\n═══ 코트 포지션 — ${getTeam(a)?.name} (5-1 대각 배치) ═══`);
  log('선발 슬롯: ' + lu.six.map((p, i) => `${i}:${lbl(p)}`).join('  '));
  log('리베로: ' + (lu.libero ? lbl(lu.libero) : '없음') + ' (후위 MB 자리 자동 교체, 전위·서브 불가)');
  for (let rot = 0; rot < 6; rot++) {
    const fr = frontRow(rot).map((i) => lu.six[i]);
    const bk = backRow(rot).map((i) => lu.six[i]).map((p) => (p.position === 'MB' && lu.libero ? lu.libero : p));
    log(`  로테이션 ${rot}: 전위[${fr.map(lbl).join(', ')}]  후위[${bk.map(lbl).join(', ')}]  서브:${lu.six[rot % 6].name}`);
  }

  // (2) 한 경기 랠리 트레이스(앞부분)
  const trace: string[] = [];
  simulateMatch(500001, sq[a], sq[b], { home: coachInfoOf(a), away: coachInfoOf(b), trace });
  log(`\n═══ 랠리 트레이스: ${getTeam(a)?.name} vs ${getTeam(b)?.name} (앞 ~40줄) ═══`);
  for (const line of trace.slice(0, 40)) log(line);

  // (3) 집계 — 라운드로빈 reps회
  const S: RallyStats = newRallyStats();
  const P: PosStats = newPosStats();
  let seed = 700000;
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      seed += 7;
      simulateMatch(seed, sq[ids[i]], sq[ids[j]], { home: coachInfoOf(ids[i]), away: coachInfoOf(ids[j]), stats: S, pos: P });
    }
  }
  const totalAtk = S.atkQuick + S.atkTempo + S.atkOpen + S.atkBack;
  const center = S.atkQuick + S.atkTempo;

  log(`\n═══ 세트(토스) 선택 집계 — ${S.rallies}랠리 / ${totalAtk}공격 ═══`);
  log('[공격 종류 분포]');
  log(`  속공(센터)      ${pct(S.atkQuick, totalAtk)}  └ A퀵 ${pct(S.atkQuickA, S.atkQuick)} · B퀵 ${pct(S.atkQuickB, S.atkQuick)} · 이동속공 ${pct(S.atkSlide, S.atkQuick)} (속공 내 비중)`);
  log(`  시간차(센터)    ${pct(S.atkTempo, totalAtk)}`);
  log(`  오픈(레프트/라이트) ${pct(S.atkOpen, totalAtk)}`);
  log(`  후위공격        ${pct(S.atkBack, totalAtk)}`);
  log('\n[센터 토스 비중 — 패스 품질에 따라(현실: 좋은 패스일수록 속공↑)]');
  log(`  전체 센터 토스   ${pct(center, totalAtk)}`);
  log(`  좋은 패스(q≥0.6) 시 센터 ${pct(S.goodCenter, S.goodAtk)}`);
  log(`  난조 패스(q<0.45) 시 센터 ${pct(S.badCenter, S.badAtk)}  (찬스볼→오픈/후위로)`);
  log('\n[블로킹/공 튕김 결과 — 전체 득점 대비]');
  log(`  스터프 블록 득점  ${pct(S.stuffs, S.rallies)}`);
  log(`  블록아웃(툴샷)    ${pct(S.blockouts, S.rallies)}`);
  log(`  소프트블록(튕겨 전환) ${pct(S.softblocks, S.attacks)} (공격 시도 대비)`);
  log(`  디그(공 튕겨 전환) ${pct(S.digs, S.attacks)} (공격 시도 대비)`);
  log(`  서브 에이스       ${pct(S.aces, S.rallies)}`);
  log('\n[서브 타입 분포 — 변형 다양성]');
  log(`  안전서브 ${pct(S.srvSafe, S.serves)}  플로터 ${pct(S.srvFloat, S.serves)}  점프플로터 ${pct(S.srvJump, S.serves)}  스파이크서브 ${pct(S.srvSpike, S.serves)}`);

  // (4) 포지션별 동작 검증 — 누가 서브/세트/공격/속공/블로킹을 하는가
  const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
  const sum = (m: Record<Position, number>) => POS.reduce((a, p) => a + m[p], 0);
  const row = (label: string, m: Record<Position, number>) => {
    const t = sum(m);
    log(`  ${label.padEnd(14)} ` + POS.map((p) => `${p} ${pct(m[p], t)}`).join('  '));
  };
  log('\n═══ 포지션별 동작 검증 (누가 그 동작을 하는가) ═══');
  row('서브', P.serve);
  row('세트(토스)', P.set);
  row('공격', P.attack);
  row('속공/시간차', P.quick);
  row('주 블로커', P.block);
  log('\n[기대치] 세트→S 100% · 속공→MB 위주 · 주블로커→MB 최다 · 서브/공격에 L 0% · 리시브/디그는 팀 단위(아래 생산)');
  log('  ※ 리시브·디그는 엔진이 그룹 강도로 처리(개별 처리자 없음) → 개인 귀속은 production.ts(리베로 디그 4.5/세트 검증됨)');
}

main();
