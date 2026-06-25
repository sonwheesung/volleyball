// 가드 — 재계약 협상 3택(resignOptions, SALARY/FA 2.5b). 시장가 일괄 대신 표준/후하게/짧게.
//   npx tsx tools/_ev_resign.ts   (exit 0/1)
// 불변식: 3택·키 정확 / 연봉 후하게≥표준≥짧게 / 후하게≥시장가 / 전부 개인상한(cap) 이내 /
//   나이 적합(wAge): 어린 선수 후하게=장기(5년)·노장 후하게=단기(≤2년).
import './_gt_mock';
import type { Player } from '../types';
(async () => {
  const { resignOptions } = await import('../engine/salary');
  const { maxSalaryFor } = await import('../engine/cap');
  const mk = (age: number, tenure = 3): Player => ({
    id: `p${age}`, name: `P${age}`, age, position: 'OH', isForeign: false, height: 185,
    jump: 78, agility: 78, staminaMax: 78, staminaRegen: 78, reaction: 78, positioning: 78, focus: 78, consistency: 78, vq: 78,
    skSpike: 78, skBlock: 78, skDig: 78, skReceive: 78, skSet: 78, skServe: 78,
    xp: {}, potential: {} as any, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 }, traits: [],
    contract: { salary: 30000, years: 1, remaining: 1, signedAtAge: age }, clubTenure: tenure, peakAge: 28,
    career: { seasons: tenure, matches: 100, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
  } as any);
  const market = 42000; // 4.2억
  const fails: string[] = [];

  const opt = (p: Player) => { const o = resignOptions(p, market); return { std: o.find((x) => x.key === 'standard')!, gen: o.find((x) => x.key === 'generous')!, sht: o.find((x) => x.key === 'short')!, all: o }; };
  const young = opt(mk(25)), mid = opt(mk(29)), old = opt(mk(33));

  for (const [lbl, o, p] of [['25세', young, mk(25)], ['29세', mid, mk(29)], ['33세', old, mk(33)]] as const) {
    if (o.all.length !== 3) fails.push(`${lbl} 옵션 ${o.all.length}개(3 기대)`);
    if (!(o.gen.salary >= o.std.salary && o.std.salary >= o.sht.salary)) fails.push(`${lbl} 연봉 단조 깨짐 ${o.gen.salary}/${o.std.salary}/${o.sht.salary}`);
    const cap = maxSalaryFor(p);
    if (o.gen.salary > cap || o.std.salary > cap || o.sht.salary > cap) fails.push(`${lbl} 캡 초과 옵션(cap ${cap})`);
    if (!(o.gen.salary >= Math.min(cap, market))) fails.push(`${lbl} 후하게<시장가 — 성의 약함`);
  }
  // 나이 적합(wAge): 어린 후하게=장기 > 노장 후하게=단기
  if (!(young.gen.years > old.gen.years)) fails.push(`나이항 실패 — 어린 후하게 ${young.gen.years}년 ≤ 노장 ${old.gen.years}년`);
  if (!(old.gen.years <= 2)) fails.push(`노장 후하게 ${old.gen.years}년 — 장기계약 줘버림(나이 무시)`);

  console.log('=== 재계약 협상 3택 ===');
  console.log(`  25세: 표준 ${young.std.salary}·3년 / 후하게 ${young.gen.salary}·${young.gen.years}년 / 짧게 ${young.sht.salary}·${young.sht.years}년`);
  console.log(`  33세: 표준 ${old.std.salary}·3년 / 후하게 ${old.gen.salary}·${old.gen.years}년 / 짧게 ${old.sht.salary}·${old.sht.years}년`);
  console.log(`  나이항: 어린 후하게 ${young.gen.years}년 > 노장 후하게 ${old.gen.years}년 = ${young.gen.years > old.gen.years}`);
  const pass = fails.length === 0;
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.join(' / ') : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
