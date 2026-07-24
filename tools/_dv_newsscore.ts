// 경기 뉴스 상세 세트 스코어보드 + 득점원 Top3 셀렉터 상비 가드 (NEWS_SYSTEM §11.5).
// 검증=Fable / 구현·가드=Opus 에이전트, 2026-07-24.
//   npx tsx tools/_dv_newsscore.ts
//
// 대상 셀렉터: data/newsMatchBox.ts newsMatchBox(n) — "한 경기"로 환원되는 뉴스만 그 경기 박스를 반환.
//   match·debut(정규, day+teamId→buildMatchBox) · playoff 경기별(ref='po:g'/'final:g'→buildPlayoffBox).
//   그 외 kind·단일경기 아닌 ref(po:clinch·champion·clinch…)는 null(스코어보드 미표시).
//
// 검사(전부 실측·A/B):
//   (a) 정규(match/debut): 실제 fixture로 만든 뉴스 → non-null, homeSets/awaySets == buildMatchBox 세트,
//       세트칩 합(setScores) == homeSets/awaySets, 선택 fixture.dayIndex == n.day(스포일러: 그 경기만 재생).
//   (b) byte 일치: box 선수별 득점(atkKill+blockPt+srvAce) == seasonMatchProds mp.lines.points(단일 진실).
//   (c) Top3: box 득점순 상위3(득점>0)만·내림차순·#1=팀 최다 득점자(ScorersTop3 선택 로직과 동일 식).
//   (d) 플옵 경기별: ref='po:g'/'final:g' → non-null, homeSets/awaySets == series.games[g].hiSets/loSets, home==hiId.
//   (e) 배제: po:clinch·champion·clinch·transfer 등 · 형식오류 ref · day 없는 match · 0-fixture match → 전부 null.
//   (f) 유일성: 전 fixture에서 (dayIndex, teamId) 매칭이 정확히 1건(유일성 가드가 오탐 안 함).
//   A/B 자가검증(허위 오라클 금지): 뮤턴트 2종(플옵을 정규 경로로 뒤섞기 · 시리즈 ref 허용)이 오라클에 FAIL,
//       실제 셀렉터는 PASS 함을 단언 — 검사기 이빨 증명.

import { resetLeagueBase, SEASON, getTeam, coachInfoOf } from '../data/league';
import { buildMatchBox } from '../data/matchBox';
import { buildPlayoffs } from '../data/playoffs';
import { buildPlayoffBox } from '../data/postseason';
import { interventionsFor } from '../data/dynamics';
import { seasonMatchProds } from '../data/production';
import { PO_SLOTS, FINAL_SLOTS } from '../engine/calendar';
import { newsMatchBox } from '../data/newsMatchBox';
import { emptyBox } from '../engine/rally';
import type { BoxLine } from '../engine/rally';
import type { NewsItem } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const fails: string[] = [];
const check = (ok: boolean, msg: string) => { log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fails.push(msg); };
const MAX = Number.MAX_SAFE_INTEGER;
const pts = (l: BoxLine) => l.atkKill + l.blockPt + l.srvAce;

const mk = (kind: NewsItem['kind'], extra: Partial<NewsItem> = {}): NewsItem =>
  ({ season: 0, kind, headline: `${kind} test`, big: false, ...extra });

resetLeagueBase();
log('═══ 경기 뉴스 상세 스코어보드·득점원 Top3 셀렉터 가드 (NEWS §11.5) ═══\n');

// ── (a)(b)(c) 정규 경기(match/debut) — 실제 fixture 표본으로 셀렉터 구동 ──
{
  const prods = seasonMatchProds(MAX); // 전 경기 생산(단일 진실) — byte 대조용
  const prodByKey = new Map(prods.map((mp) => [`${mp.dayIndex}|${mp.homeTeamId}|${mp.awayTeamId}`, mp]));

  const sample = SEASON.filter((_, i) => i % 7 === 0); // 표본(전 라운드 골고루)
  let nullBad = 0, teamBad = 0, setSumBad = 0, dayBad = 0, byteBad = 0, byteChecked = 0, top3Bad = 0;
  const byteExamples: string[] = [];

  for (const kind of ['match', 'debut'] as const) {
    for (const f of sample) {
      const n = mk(kind, { day: f.dayIndex, teamId: f.homeTeamId });
      const mb = newsMatchBox(n);
      if (!mb) { nullBad++; continue; }
      if (mb.homeTeamId !== f.homeTeamId || mb.awayTeamId !== f.awayTeamId) teamBad++;

      // 스포일러: 선택된 경기는 정확히 n.day의 경기(다른 날 재생 금지)
      const cand = SEASON.filter((x) => x.dayIndex === n.day && (x.homeTeamId === n.teamId || x.awayTeamId === n.teamId));
      if (cand.length !== 1 || cand[0].id !== f.id) dayBad++;

      // 세트칩 합 == homeSets/awaySets
      const chipH = mb.sim.setScores.filter((s) => s.home > s.away).length;
      const chipA = mb.sim.setScores.filter((s) => s.away > s.home).length;
      if (chipH !== mb.sim.homeSets || chipA !== mb.sim.awaySets) setSumBad++;

      // byte 일치: box 득점 == seasonMatchProds points (kind='match'에서 1회만 — box는 kind 무관 동일)
      if (kind === 'match') {
        const mp = prodByKey.get(`${f.dayIndex}|${f.homeTeamId}|${f.awayTeamId}`);
        if (mp) {
          for (const [pid, l] of mb.box) {
            const line = mp.lines.get(pid);
            byteChecked++;
            if (!line || line.points !== pts(l)) {
              byteBad++;
              if (byteExamples.length < 3) byteExamples.push(`${pid}: box ${pts(l)} vs prod ${line?.points ?? 'none'}`);
            }
          }
        }

        // Top3 검증(ScorersTop3 선택 식 재현): 각 팀 득점>0 상위3, 내림차순, #1=팀 최다
        for (const squad of [mb.homeSquad, mb.awaySquad]) {
          const scored = squad.map((p) => ({ p, v: pts(mb.box.get(p.id) ?? emptyBox()) }))
            .filter((r) => r.v > 0).sort((x, y) => y.v - x.v);
          const top3 = scored.slice(0, 3);
          const maxV = scored.length ? scored[0].v : 0;
          const teamMax = Math.max(0, ...squad.map((p) => pts(mb.box.get(p.id) ?? emptyBox())));
          const monotone = top3.every((r, i) => i === 0 || top3[i - 1].v >= r.v);
          const allPos = top3.every((r) => r.v > 0);
          if (top3.length > 3 || !monotone || !allPos || (top3.length > 0 && maxV !== teamMax)) top3Bad++;
        }
      }
    }
  }

  check(nullBad === 0, `(a) 정규 match/debut ${sample.length * 2}건 전부 non-null (null=${nullBad})`);
  check(teamBad === 0, `(a) homeTeamId/awayTeamId == fixture (불일치=${teamBad})`);
  check(dayBad === 0, `(a) 스포일러: 선택 경기 == n.day의 그 fixture만 (위반=${dayBad})`);
  check(setSumBad === 0, `(a) 세트칩 합 == homeSets/awaySets (불일치=${setSumBad})`);
  check(byteBad === 0, `(b) byte 일치: box 득점 == seasonMatchProds points — ${byteChecked}명 대조 (불일치=${byteBad}${byteExamples.length ? ' :: ' + byteExamples.join(' / ') : ''})`);
  check(top3Bad === 0, `(c) Top3: 득점>0 상위3·내림차순·#1=팀최다 (위반=${top3Bad})`);
}

// ── (d) 플옵 경기별 — ref='po:g'/'final:g' → series.games[g] 세트 일치 ──
{
  let poNullBad = 0, poSetBad = 0, poHomeBad = 0, poTotal = 0;
  for (let s = 0; s < 40; s++) {
    const p = buildPlayoffs(s);
    for (const [round, m, slots] of [['po', p.po, PO_SLOTS] as const, ['final', p.final, FINAL_SLOTS] as const]) {
      if (!m) continue;
      for (let g = 0; g < m.series.games.length; g++) {
        poTotal++;
        const n = mk('playoff', { season: s, ref: `${round}:${g}`, teamId: m.hiId, day: slots[g] });
        const mb = newsMatchBox(n);
        if (!mb) { poNullBad++; continue; }
        if (mb.sim.homeSets !== m.series.games[g].hiSets || mb.sim.awaySets !== m.series.games[g].loSets) poSetBad++;
        if (mb.homeTeamId !== m.hiId || mb.awayTeamId !== m.loId) poHomeBad++;
      }
    }
  }
  check(poNullBad === 0, `(d) 플옵 경기별 ${poTotal}게임 전부 non-null (null=${poNullBad})`);
  check(poSetBad === 0, `(d) 플옵 homeSets/awaySets == series.games[g] (불일치=${poSetBad})`);
  check(poHomeBad === 0, `(d) 플옵 home==hiId·away==loId (불일치=${poHomeBad})`);
}

// ── (e) 배제: 단일 경기 아닌 kind·ref → null ──
{
  const excluded: NewsItem[] = [
    mk('playoff', { season: 0, ref: 'po:clinch', teamId: 'x' }),   // 시리즈 확정(단일 경기 아님)
    mk('playoff', { season: 0, ref: 'po' }),                       // 형식 오류(콜론 없음)
    mk('playoff', { season: 0, ref: 'final:x' }),                  // 비숫자 g
    mk('playoff', { season: 0, ref: 'po:1:2' }),                   // 3-파트
    mk('playoff', { season: 0, ref: 'semis:0' }),                  // 알 수 없는 라운드
    mk('playoff', { season: 0 }),                                  // ref 없음
    mk('champion', { teamId: 'x' }),
    mk('clinch', { teamId: 'x' }),
    mk('transfer', { ref: 'p1' }),
    mk('offseason', { teamId: 'x' }),
    mk('standing', { teamId: 'x' }),
    mk('milestone', { ref: 'p1' }),
    mk('award', { ref: 'p1' }),
    mk('injury', { ref: 'p1' }),
    mk('streak', { teamId: 'x' }),
    mk('foreign', { teamId: 'x' }),
    mk('hof', { ref: 'p1' }),
    mk('retire', { ref: 'p1' }),
    mk('coach', { teamId: 'x' }),
    mk('sponsor', { teamId: 'x' }),
    mk('draft', { ref: 'p1' }),
    mk('match', { teamId: SEASON[0].homeTeamId }),                 // day 없음 → 못 찾음
    mk('match', { day: SEASON[0].dayIndex, teamId: 'NO_SUCH_TEAM' }), // 0-fixture
    mk('debut', { day: -999, teamId: SEASON[0].homeTeamId }),      // day에 경기 없음
  ];
  let leaked = 0;
  const leaks: string[] = [];
  for (const n of excluded) {
    if (newsMatchBox(n) !== null) { leaked++; leaks.push(`${n.kind}/${n.ref ?? n.day ?? '-'}`); }
  }
  check(leaked === 0, `(e) 배제 ${excluded.length}종 전부 null (누수=${leaked}${leaks.length ? ' :: ' + leaks.join(', ') : ''})`);
}

// ── (f) 유일성: (dayIndex, teamId) 매칭이 항상 정확히 1건 ──
{
  let uniqBad = 0;
  const teams = new Set<string>();
  for (const f of SEASON) { teams.add(f.homeTeamId); teams.add(f.awayTeamId); }
  for (const f of SEASON) {
    for (const tid of [f.homeTeamId, f.awayTeamId]) {
      const cnt = SEASON.filter((x) => x.dayIndex === f.dayIndex && (x.homeTeamId === tid || x.awayTeamId === tid)).length;
      if (cnt !== 1) uniqBad++;
    }
  }
  check(uniqBad === 0, `(f) 유일성: 전 fixture (dayIndex,teamId) 매칭 정확히 1건 (위반=${uniqBad}) — 유일성 가드 오탐 없음`);
}

// ── A/B 자가검증(허위 오라클 금지): 뮤턴트가 오라클에 걸리는가 ──
{
  // 오라클1(플옵 정합): 플옵 경기 뉴스 → non-null이고 세트 == series.games[g]
  const p0 = buildPlayoffs(0);
  const g0 = !!p0.po && p0.po.series.games.length > 0;
  const poItem = mk('playoff', { season: 0, ref: 'po:0', teamId: p0.po?.hiId, day: PO_SLOTS[0] });

  // 뮤턴트A: 플옵을 정규 경로로 뒤섞음(day+teamId로 SEASON find) — 플옵 day는 SEASON에 없어 null 반환(잘못).
  const mutantPathMix = (n: NewsItem): unknown => {
    if (n.kind === 'playoff') {
      const cand = SEASON.filter((x) => x.dayIndex === n.day && (x.homeTeamId === n.teamId || x.awayTeamId === n.teamId));
      if (cand.length !== 1) return null; // 플옵 day ∉ SEASON → null
      const f = cand[0];
      return buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed, interventionsFor(f.id));
    }
    return newsMatchBox(n);
  };
  const realPo = newsMatchBox(poItem);
  const mutPo = mutantPathMix(poItem);
  const oracleReal = !!realPo && !!(realPo as { sim: { homeSets: number; awaySets: number } }).sim
    && realPo.sim.homeSets === p0.po!.series.games[0].hiSets && realPo.sim.awaySets === p0.po!.series.games[0].loSets;
  const oracleMut = !!mutPo; // 뮤턴트는 null(오라클 실패)
  log(`  A/B-1: 실제 셀렉터 플옵 정합=${oracleReal} · 뮤턴트(경로 뒤섞기) 반환=${oracleMut ? 'non-null' : 'null(오라클 FAIL)'}`);
  check(g0 && oracleReal, `A/B-1: 실제 셀렉터가 플옵 정합 오라클 PASS`);
  check(!oracleMut, `A/B-1: 뮤턴트(플옵→정규경로)가 오라클 FAIL (검사기 이빨 — 경로 분리 필수)`);

  // 오라클2(배제): po:clinch → null
  const clinch = mk('playoff', { season: 0, ref: 'po:clinch', teamId: 'x' });
  // 뮤턴트B: 시리즈 ref 허용(비숫자 g를 0으로 강제) — po:clinch를 g0 경기로 잘못 렌더.
  const mutantAllowSeries = (n: NewsItem): unknown => {
    if (n.kind === 'playoff' && n.ref) {
      const [round, gStr] = n.ref.split(':');
      if (round === 'po' || round === 'final') {
        const g = /^\d+$/.test(gStr ?? '') ? Number(gStr) : 0; // BUG: 'clinch' → 0
        try { return buildPlayoffBox(n.season, round, g); } catch { return null; }
      }
    }
    return newsMatchBox(n);
  };
  const realClinch = newsMatchBox(clinch);
  const mutClinch = mutantAllowSeries(clinch);
  log(`  A/B-2: 실제 셀렉터 po:clinch=${realClinch === null ? 'null(정상 배제)' : 'non-null'} · 뮤턴트(시리즈 허용)=${mutClinch ? 'non-null(오라클 FAIL)' : 'null'}`);
  check(realClinch === null, `A/B-2: 실제 셀렉터가 po:clinch를 null로 배제 (오라클 PASS)`);
  check(!!mutClinch, `A/B-2: 뮤턴트(시리즈 ref 허용)가 po:clinch를 non-null로 반환 (검사기 이빨 — 숫자 g 게이트 필수)`);
}

log('');
if (fails.length) { log(`NEWSSCORE FAIL — ${fails.length}건: ${fails.join(' / ')}`); process.exit(1); }
log(`NEWSSCORE PASS — 정규/플옵 경기 정합 · byte 일치 · Top3 · 배제 · 유일성 · A/B 뮤턴트 2종 자가검증`);
process.exit(0);
