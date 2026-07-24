// FA 센터 배지 렌더 무해성 가드 — BUG-01(2026-07-24 에뮬 1시즌 E2E) 봉인.
//   npx tsx tools/_dv_fabadge.ts [자연런 시즌=40]
//
// 배경(무엇이 터졌나): app/fa.tsx가 `getTeam(lost)?.name ?? shortTeam(lost)`를 **code==='LOST' 분기 밖에서
//   무조건** 평가했다. lostTo는 타 팀이 실제 계약했을 때만 채워지므로(data/offseason.ts:342·372)
//   CASH/CAP/ROSTER/SIT_OUT 경로에선 undefined → shortTeamName이 `undefined.split(' ')`로 throw.
//   렌더 중 throw는 화면이 아니라 **앱 프로세스를 죽였고**(Render Error + SIGSEGV), 오퍼가 세이브에 남아
//   FA 센터 재진입마다 재크래시 = 오프시즌 영구 소프트락(드래프트로 갈 길이 막힘).
//
// 이 가드가 검사하는 것:
//   (A) 실제 게이트 재현 — resolveFAMarket으로 CASH/CAP/ROSTER를 강제 발화시켜, **그 실제 (code, lostTo) 쌍**을
//       화면이 쓰는 셀렉터 faPreviewBadge에 그대로 먹인다. throw 0 · 'undefined' 문자열 0.
//   (B) 자연런 — 실제 FA 시장을 굴려 나오는 모든 상태(won/LOST/SIT_OUT/미해결)를 같은 셀렉터에 먹인다.
//   (C) 조합 전수 — 코드 6종 × lostTo 유무 × won/targeted 데카르트 곱(엔진이 못 만드는 조합까지 방어).
//   (D) 하드닝 — shortTeamName이 undefined/''/미등록 id에서 throw하지 않고, **정상 id 반환값은 바이트 동일**.
//   (E) 소스 회귀 — app/fa.tsx가 lostTo를 분기 밖에서 다시 평가하지 않는지(재도입 봉인).
//   커버리지 오라클: 6개 코드 경로가 전부 실제로 실행됐는지 확인(미커버면 FAIL — 허위 PASS 방지).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resetLeagueBase, getTeam, LEAGUE, currentBasePlayers, shortTeamName,
} from '../data/league';
import { resolveFAMarket, faMarketPreview, type FAFailCode } from '../data/offseason';
import { faPreviewBadge, teamLabel } from '../data/faBadge';
import { overall } from '../engine/overall';
import { LEAGUE_CAP } from '../engine/cap';
import { ROSTER_CONTRACT_CAP } from '../engine/transactions';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
let violations = 0;
const fail = (msg: string) => { violations++; log(`  ❌ ${msg}`); };
const ok = (msg: string) => log(`  ✓ ${msg}`);

// 실행된 코드 경로(커버리지 오라클)
const covered = new Set<string>();
let throwCount = 0;

/** 화면이 하는 그대로 배지를 계산 — throw는 그대로 위반으로 잡는다(렌더 중 throw = 앱 종료). */
function renderBadge(where: string, a: {
  won: boolean; targeted: boolean; code?: FAFailCode; lostTo?: string; counteredTo?: number;
}): void {
  covered.add(a.won ? 'WON' : !a.targeted ? 'NONE' : (a.code ?? 'PENDING'));
  let badge: { t: string; tone: string } | null;
  try {
    badge = faPreviewBadge(a);
  } catch (e) {
    throwCount++;
    fail(`${where} — 배지 계산 중 throw: ${(e as Error).message}`);
    return;
  }
  if (!a.targeted && !a.won) { if (badge !== null) fail(`${where} — 미지명인데 배지 생성됨`); return; }
  if (!badge) { fail(`${where} — 배지가 없음(지명 선수는 항상 상태를 보여야)`); return; }
  if (!badge.t.trim()) fail(`${where} — 배지 문구가 빈 문자열`);
  if (badge.t.includes('undefined') || badge.t.includes('null')) fail(`${where} — 배지 문구에 '${badge.t}'`);
  if (!a.won && a.targeted && a.code === 'LOST' && a.lostTo) {   // won이면 코드보다 계약 성사가 우선(짧은 회로)
    const expect = getTeam(a.lostTo)?.name ?? shortTeamName(a.lostTo);
    if (!badge.t.includes(expect)) fail(`${where} — LOST 배지에 상대 구단명(${expect}) 없음: '${badge.t}'`);
  }
}

resetLeagueBase();
const A = LEAGUE.teams[0].id;
const B = LEAGUE.teams[1].id;

// ── (A) 실제 게이트 재현 — CASH/CAP/ROSTER를 강제 발화시켜 실제 관측값을 배지에 먹인다 ──
log('═══ (A) 실제 게이트(CASH/CAP/ROSTER) 재현 → 배지 렌더 ═══');
{
  const templates = currentBasePlayers().filter((p) => !p.isForeign);
  let tIdx = 0;
  const clone = (id: string, pos: Player['position'], salary: number): Player => {
    const t = templates[(tIdx++) % templates.length];
    return { ...t, id, position: pos, isForeign: false, isAsianQuota: false, contract: { ...t.contract, salary, remaining: 0 } };
  };
  const run = (myRoster: Player[], target: Player, myCash: number) => {
    const bRoster = [clone(`B_${target.id}`, 'S', 5000)];
    const snapshot: Record<string, Player> = {};
    for (const p of [...myRoster, ...bRoster, target]) snapshot[p.id] = p;
    const off = { snapshot, rosters: { [A]: myRoster.map((p) => p.id), [B]: bRoster.map((p) => p.id) }, pool: [target.id] };
    const r = resolveFAMarket(off, A, [target.id], false, [], { [target.id]: B }, 9000, { [A]: 0.5, [B]: 0.5 }, undefined, myCash);
    return { code: r.faFail[target.id], lostTo: r.lostTo[target.id], won: r.signedByMe.includes(target.id), countered: r.counterFired[target.id]?.to };
  };

  const cases: Array<{ label: string; roster: Player[]; cash: number; expect: FAFailCode }> = [
    { label: 'CASH(운영 자금 0)', roster: [], cash: 0, expect: 'CASH' },
    { label: 'CAP(캡 소진)', roster: [clone('A_H1', 'MB', Math.floor(LEAGUE_CAP / 2)), clone('A_H2', 'OH', Math.floor(LEAGUE_CAP / 2))], cash: 99_999_999, expect: 'CAP' },
    { label: 'ROSTER(계약 상한)', roster: Array.from({ length: ROSTER_CONTRACT_CAP }, (_, i) => clone(`A_F${i}`, 'OH', 1000)), cash: 99_999_999, expect: 'ROSTER' },
  ];
  for (const c of cases) {
    const target = clone(`FA_${c.expect}`, 'OP', 40000);
    const r = run(c.roster, target, c.cash);
    if (r.code !== c.expect) { fail(`${c.label} — 기대 코드 ${c.expect}, 실제 '${r.code}'(픽스처 드리프트)`); continue; }
    if (r.lostTo !== undefined && c.expect !== 'LOST') {
      // 이게 BUG-01의 뇌관: 게이트 코드인데 lostTo가 undefined(=구코드가 분기 밖에서 읽던 값)
    }
    renderBadge(`${c.label} lostTo=${r.lostTo ?? 'undefined'}`, { won: r.won, targeted: true, code: r.code, lostTo: r.lostTo, counteredTo: r.countered });
    ok(`${c.label} → code=${r.code} · lostTo=${r.lostTo ?? 'undefined'} · 배지 렌더 무해`);
  }
}

// ── (B) 자연런 — 실제 FA 시장이 만들어내는 상태 전부를 배지에 먹인다 ──
const N = Math.max(1, Number(process.argv[2]) || 40);
log(`\n═══ (B) 자연런 ${N}시즌 × (자금 충분·자금 0) — 실제 관측 상태 → 배지 렌더 ═══`);
{
  let cards = 0;
  let crashShape = 0; // 크래시 조건 그 자체: 지명 + 게이트/잔류 코드 + lostTo 없음(구코드가 undefined.split로 죽던 카드)
  const seen: Record<string, number> = {};
  for (const cash of [99_999_999, 0]) {
    for (let s = 1; s <= N; s++) {
      const pre = faMarketPreview(A, {}, {}, [], true, [], s, undefined, cash);
      const wishlist = [...pre.pool].map((id) => pre.snapshot[id]).filter((p): p is Player => !!p)
        .sort((a, b) => overall(b) - overall(a)).slice(0, 4).map((p) => p.id);
      const pv = faMarketPreview(A, {}, {}, wishlist, true, [], s, undefined, cash);
      for (const id of pv.pool) {
        const targeted = wishlist.includes(id);
        const won = pv.signedByMe.has(id);
        const code = pv.faFail[id];
        seen[won ? 'WON' : !targeted ? 'NONE' : (code ?? 'PENDING')] = (seen[won ? 'WON' : !targeted ? 'NONE' : (code ?? 'PENDING')] ?? 0) + 1;
        cards++;
        if (targeted && !won && code && code !== 'LOST' && pv.lostTo[id] === undefined) crashShape++;
        renderBadge(`s${s}/cash${cash}/${id}`, { won, targeted, code, lostTo: pv.lostTo[id], counteredTo: pv.counterFired[id]?.to });
      }
    }
  }
  ok(`FA 카드 ${cards.toLocaleString()}건 렌더 — 상태 분포 ${Object.entries(seen).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  // 크래시 조건이 자연 시장에서 실제로 발생하는지 — 0이면 자연런이 결함을 태우지 못한 것(오라클 무력화)
  if (crashShape > 0) ok(`구코드 크래시 조건(지명 + 게이트 코드 + lostTo 없음) 자연 발생 ${crashShape}건 — 오라클이 결함 표면을 실제로 지남`);
  else fail('크래시 조건(게이트 코드 + lostTo 없음)이 자연런에서 0건 — 픽스처가 결함 표면을 못 지남');
}

// ── (C) 조합 전수 — 엔진이 만들지 않는 조합까지(방어적) ──
log('\n═══ (C) 코드 × lostTo × won/targeted 조합 전수 ═══');
{
  const codes: Array<FAFailCode | undefined> = ['LOST', 'CASH', 'CAP', 'ROSTER', 'SIT_OUT', undefined];
  const losts: Array<string | undefined> = [B, undefined, '', 'no-such-team'];
  let n = 0;
  for (const code of codes) for (const lostTo of losts) for (const won of [false, true]) for (const targeted of [false, true]) {
    for (const counteredTo of [undefined, 42000]) {
      n++;
      renderBadge(`code=${code ?? 'none'}/lost=${lostTo ?? 'undefined'}/won=${won}/targeted=${targeted}`, { won, targeted, code, lostTo, counteredTo });
    }
  }
  ok(`조합 ${n}건 렌더 — 누적 throw ${throwCount}건`);
}

// ── (D) shortTeamName 하드닝 — 빈 입력에도 throw 없음 + 정상 경로 바이트 동일 ──
log('\n═══ (D) shortTeamName 하드닝 ═══');
{
  for (const bad of [undefined, null, '']) {
    try {
      const r = shortTeamName(bad as unknown as string);
      if (typeof r !== 'string') fail(`shortTeamName(${String(bad)}) 반환이 문자열 아님: ${String(r)}`);
      else ok(`shortTeamName(${bad === '' ? "''" : String(bad)}) → '${r}' (throw 없음)`);
    } catch (e) { fail(`shortTeamName(${String(bad)}) throw: ${(e as Error).message}`); }
  }
  try {
    const r = teamLabel(undefined);
    if (!r) fail('teamLabel(undefined) 빈 문자열');
    else ok(`teamLabel(undefined) → '${r}'`);
  } catch (e) { fail(`teamLabel(undefined) throw: ${(e as Error).message}`); }
  // 정상 경로 불변 — 전 구단에서 "이름 마지막 어절"과 바이트 동일해야(하드닝이 정상 출력을 바꾸지 않았음)
  let same = 0;
  for (const t of LEAGUE.teams) {
    const name = getTeam(t.id)!.name;
    const expect = name.split(' ').slice(-1)[0] || name;
    if (shortTeamName(t.id) === expect) same++;
    else fail(`shortTeamName('${t.id}')='${shortTeamName(t.id)}' ≠ 기존 산식 '${expect}'`);
  }
  ok(`정상 경로 바이트 동일 — ${same}/${LEAGUE.teams.length}개 구단`);
  // 미등록 id는 옛 동작(id 그대로 어절 분해) 유지
  if (shortTeamName('unknown-team') === 'unknown-team') ok(`미등록 id 폴백 불변 — 'unknown-team'`);
  else fail(`미등록 id 폴백이 바뀜: '${shortTeamName('unknown-team')}'`);
}

// ── (E) 소스 회귀 — 분기 밖 lostTo 평가 재도입 봉인 ──
log('\n═══ (E) 소스 회귀 — app/fa.tsx 분기 밖 lostTo 평가 금지 ═══');
{
  const src = readFileSync(resolve(__dirname, '..', 'app', 'fa.tsx'), 'utf8');
  const banned = [/shortTeam\(\s*lost\s*\)/, /getTeam\(\s*lost\s*\)/];
  const hit = banned.filter((re) => re.test(src));
  if (hit.length) fail(`app/fa.tsx가 lost를 직접 팀 조회에 넘김(${hit.map((r) => r.source).join(', ')}) — teamLabel/faPreviewBadge를 쓸 것`);
  else ok('app/fa.tsx는 lost를 teamLabel/faPreviewBadge로만 사용');
  if (!/faPreviewBadge\(/.test(src)) fail('app/fa.tsx가 faPreviewBadge를 쓰지 않음(셀렉터 우회 — 가드가 무의미해짐)');
  else ok('app/fa.tsx가 배지 셀렉터를 사용 — 가드 경로 = 화면 경로');
}

// ── 커버리지 오라클 ──
const NEED = ['WON', 'LOST', 'CASH', 'CAP', 'ROSTER', 'SIT_OUT', 'PENDING', 'NONE'];
const missing = NEED.filter((k) => !covered.has(k));
log(`\n커버된 경로: ${[...covered].sort().join(' · ')}`);
if (missing.length) fail(`미커버 경로 ${missing.join(', ')} — 오라클이 그 코드를 실제로 태우지 못함(허위 PASS 위험)`);

log(violations === 0
  ? `\n✅ FABADGE_GUARD PASS — FA 배지가 모든 실패 코드/lostTo 상태에서 throw 없이 렌더(위반 0)`
  : `\n❌ FABADGE_GUARD FAIL — 위반 ${violations}건`);
process.exit(violations === 0 ? 0 : 1);
