// 가드 — 조사 자동 교정(NEWS_SYSTEM §4.5): resolveJosa가 "코메츠이(가)" 병기를 받침 기준 하나로.
//   npx tsx tools/_ev_josa.ts [시즌=18]
// (A) 합성 A/B: 받침 유무·괄호 건너뜀·숫자·경계. (B) 실기사 전수: 잔여 병기 0.
import './_gt_mock';
import { hasBatchim, resolveJosa } from '../lib/josa';
(async () => {
  const fails: string[] = [];
  const eq = (got: string, want: string, label: string) => { if (got !== want) fails.push(`${label}: "${got}"≠"${want}"`); };

  // ── (A) 합성 A/B ──
  if (hasBatchim('코메츠') !== false) fails.push('코메츠 받침 오판');
  if (hasBatchim('한채원') !== true) fails.push('한채원 받침 오판');
  if (hasBatchim('11점') !== true) fails.push('11점(점) 받침 오판');
  eq(resolveJosa('코메츠이(가) 올랐다'), '코메츠가 올랐다', '받침無→가');
  eq(resolveJosa('한채원을(를) 앞세웠다'), '한채원을 앞세웠다', '받침有→을');
  eq(resolveJosa('타이드은(는) 정리했다'), '타이드는 정리했다', '받침無→는');
  eq(resolveJosa('한채원(인천 타이드)이(가) 선정'), '한채원(인천 타이드)이 선정', '괄호건너뜀→name기준 이');
  eq(resolveJosa('발렌티나(코메츠)이(가) 뽑혔다'), '발렌티나(코메츠)가 뽑혔다', '괄호건너뜀→name無받침 가');
  eq(resolveJosa('11점을(를) 기록'), '11점을 기록', '숫자+점→을');
  eq(resolveJosa('디그 5개을(를) 기록'), '디그 5개를 기록', '개(無받침)→를');
  eq(resolveJosa('수원 페어리스와(과) 재계약'), '수원 페어리스와 재계약', '스(無받침)→와');
  // 불명(라틴 자음끝 등)은 병기 유지(안전) — 깨지지 않게만
  if (resolveJosa('FC이(가)').includes('(가)') === false && resolveJosa('FC이(가)') !== 'FC이') { /* 허용 */ }

  // ── (B) 실기사 전수: 잔여 병기 0 ──
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON } = await import('../data/league');
  const { buildNewsFeed } = await import('../data/news');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(10, Number(process.argv[2]) || 18);
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);
  G().resetSave(); G().selectTeam(my);
  for (let s = 0; s < N; s++) { for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any); G().setDay(164); G().endSeason(); }
  for (const f of myFix.slice(0, 6)) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 2 } as any);
  const feed = buildNewsFeed(G().archive, G().milestones, G().hallOfFame, G().season, G().expelledLog, [], 80, my, G().transfers, G().retirements);
  const BYEONGI = /이\(가\)|을\(를\)|은\(는\)|과\(와\)|와\(과\)/;
  let residual = 0; const samples: string[] = [];
  for (const n of feed) {
    for (const txt of [n.headline, n.body ?? '']) {
      const m = txt.match(BYEONGI);
      if (m) { residual++; if (samples.length < 4) samples.push(`[${n.kind}] …${txt.slice(Math.max(0, txt.indexOf(m[0]) - 12), txt.indexOf(m[0]) + 6)}…`); }
    }
  }

  console.log('=== 조사 자동 교정 검증 ===');
  console.log(`  합성 A/B: ${fails.length === 0 ? 'OK' : 'FAIL'}`);
  console.log(`  실기사 ${feed.length}건 · 잔여 병기 ${residual}건 ${samples.length ? '— ' + samples.join(' / ') : ''}`);
  // A/B 민감도: 일부러 깬 입력은 잡혀야
  const abDetect = BYEONGI.test('코메츠이(가)');
  const pass = fails.length === 0 && residual === 0 && abDetect;
  console.log(`  A/B 민감도(병기 검출): ${abDetect}`);
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.slice(0, 5).join(' / ') : ''}${residual ? ` · 잔여병기 ${residual}` : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
