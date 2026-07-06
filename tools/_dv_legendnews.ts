// 헌액 번호/계보 뉴스 실가드(BROADCAST §8.2·§8.3, NEWS_SYSTEM §3.2) — 관찰 스크립트에서 어서션+exit 배선으로 승격(2026-07-07).
//   ① 자연 표본: HOF 레전드 전원에 kind='hof' 기사 + 본문에 '헌액 번호 N번' 박힘(누락 1건이라도 FAIL).
//   ② 합성 표본: 같은 팀·같은 헌액 번호 레전드 2명(jerseyNumber 결정론 → id쌍 스캔으로 인위 구성 — 계보는 자연표본선 희귀라 무검증이던 사각)
//      → 후대 레전드 본문에 '같은 N번을 달았던 과거 레전드' 계보 문구 + 과거 레전드 이름 박힘.
//   의도적 FAIL 재현(가드판 A/B): LEGENDNEWS_POISON=1 이면 기대 문자열을 오염 → 어서션이 FAIL해야(도구 민감도 증명).
//   npx tsx tools/_dv_legendnews.ts [시즌=60]   (POISON: LEGENDNEWS_POISON=1 npx tsx tools/_dv_legendnews.ts)
import './_gt_mock';
import type { HofEntry } from '../types';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON } = await import('../data/league');
  const { buildNewsFeed } = await import('../data/news');
  const { jerseyNumber } = await import('../engine/jersey');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(8, Number(process.argv[2]) || 60);
  const POISON = process.env.LEGENDNEWS_POISON === '1'; // 의도적 FAIL 스위치(기대 문자열 오염 → A/B 민감도 증명)
  const poison = (s: string) => (POISON ? s + 'ZZZ_INJECTED' : s);

  let fail = 0;
  const check = (cond: boolean, msg: string) => { if (!cond) { console.log('  ❌ ' + msg); fail++; } else console.log('  ✓ ' + msg); };

  // ── ① 자연 표본: 레전드 전원 HOF 기사 + 본문 '헌액 번호 N번'(BROADCAST §8.2, data/news.ts hof 절) ──
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);
  G().resetSave(); G().selectTeam(my);
  for (let s = 0; s < N; s++) { for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any); G().setDay(164); G().endSeason(); }

  const hof = G().hallOfFame;
  const legends = hof.filter((h) => h.legend);
  const feed = buildNewsFeed(G().archive, [], hof, G().season, [], [], 0, my, [], G().retirements);
  console.log(`=== ① 자연 표본: 레전드 ${legends.length}명 (HOF ${hof.length}) — ${N}시즌 ===`);
  check(legends.length >= 1, `레전드 표본 존재(${legends.length}명) — 자연 경로 검증이 유효(0이면 sim 결함)`);
  for (const L of legends) {
    const num = jerseyNumber(L.id);
    const item = feed.find((n) => n.kind === 'hof' && n.ref === L.id); // ref=h.id(엔티티 앵커) — 동명이인 안전
    const want = poison(`헌액 번호 ${num}번`);
    check(!!item, `${L.name}(${L.teamId}): kind='hof' 기사 존재`);
    check(!!item?.body?.includes(want), `${L.name}: 본문에 '${want}' 박힘`);
  }

  // ── ② 합성 표본: 같은 팀·같은 헌액 번호 레전드 2명 → 번호 계보(자연표본선 희귀 → 영구 무검증이던 사각) ──
  //   jerseyNumber(id)는 id 시드 결정론이니, 같은 번호가 나오는 실제 id 쌍을 스캔해 인위 구성(자연 표본 의존 금지).
  const byNum = new Map<number, string[]>();
  let pair: [string, string] | null = null;
  for (let i = 0; i < 200000 && !pair; i++) {
    const id = `synLegend_${i}`;
    const n = jerseyNumber(id);
    const arr = byNum.get(n) ?? []; arr.push(id); byNum.set(n, arr);
    if (arr.length >= 2) pair = [arr[0], arr[1]];
  }
  console.log(`\n=== ② 합성 표본: 번호 계보(같은 팀·같은 번호 레전드 2명) ===`);
  check(!!pair, '같은 헌액 번호가 나오는 id 쌍 확보(합성 케이스 구성 가능)');
  if (pair) {
    const [idA, idB] = pair;
    const num = jerseyNumber(idA);
    const mk = (id: string, name: string, retiredSeason: number, points: number): HofEntry => ({
      id, name, position: 'OH', teamId: my, seasons: 12, points, blocks: 0, digs: 0, retiredSeason, legend: true,
    });
    // A가 먼저 은퇴(과거 레전드) → 나중 은퇴한 B의 본문 계보에 A가 나열되어야(numberLineage beforeSeason 규칙)
    const synHof = [mk(idA, '원조전설', 5, 9000), mk(idB, '후대전설', 10, 8000)];
    const synFeed = buildNewsFeed([], [], synHof, 11, [], [], 0, my, [], []);
    const bItem = synFeed.find((n) => n.kind === 'hof' && n.ref === idB);
    const wantLineage = poison(`같은 ${num}번을 달았던 과거 레전드`);
    check(jerseyNumber(idA) === jerseyNumber(idB), `합성 id쌍 번호 일치(${num}번)`);
    check(!!bItem, '후대 레전드(idB) HOF 기사 존재');
    check(!!bItem?.body?.includes(wantLineage), `후대 본문에 번호 계보 문구 '${wantLineage}' 박힘(BROADCAST §8.3)`);
    check(!!bItem?.body?.includes('원조전설'), '계보에 과거 레전드 이름(원조전설) 박힘 — 사실 나열');
    if (bItem) console.log(`  BODY: ${bItem.body}`);
  }

  console.log(fail ? `\n❌ FAIL ${fail} — 헌액번호/계보 뉴스 규약 위반` : '\n✅ PASS — 레전드 전원 헌액 번호 본문 + 번호 계보(합성) 검증');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
