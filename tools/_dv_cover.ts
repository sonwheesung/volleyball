// 커버 안무 v2 검증(BOARD_RULES 룰 62·룰 68) — 세터 토스 시 커버 배정을 실측.
//   npx tsx tools/_dv_cover.ts [경기수=40]
// 오라클(룰 62 — 제외 방향): open/tempo(세터가 고를 수 있는 국면)면 전위 히터(옵션)가 커버에 0명(위장).
//         백어택이면 전위가 네트 앞 커버로 들어온다(대조 — 같은 도구가 전위 커버를 봄 = 비공허 A/B).
//         어느 국면이든 이번 공격수(atkIdx)는 커버 아님(자기 공격).
// 오라클(룰 68 — 포함/행 방향 ②'): 백어택 근접 커버 슬롯(y=0.62H)엔 전위만. 전위 가용≥2 국면에서
//         후위 선수가 근접 슬롯에 든 국면 = 기대 0. 전위 가용<2 폴백 국면은 별도 카운트(위반 아님).
//         A/B: 구 x-only 선정을 각 국면 pool·ahx에서 재계산 → "구 로직이면 근접 슬롯 후위 침입 N>0" 증명.
// 추정 금지: 코드가 아니라 실제 ballPath 재생 결과(coverSink)로 판정.
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, type Lineups, type Atk } from '../components/courtPath';
import { reconstructRallies } from '../components/courtDirector';
import { coverSpots } from '../components/courtLayout';

const W = 360, H = 500, SERVE_OUT = 22;
const nMatches = Math.max(1, Number(process.argv[2]) || 40);
const log = (m: string) => process.stdout.write(m + '\n');

// ── R4 커버 반원 좌표 핀(회귀 가드) — 전면 공격 커버가 실측 타이트닝 값인가 ──
// 근접 y ≤ 0.58(전위 존 진입, 구 0.645 반려)·라인 슬롯이 안쪽 슬롯보다 사이드라인 쪽으로 넓게(비대칭).
// A/B: 구 대칭·얕은 값(0.645/±34)이면 이 핀들이 깨져야(오라클 유효).
function coverPin(): boolean {
  const fy = (p: { x: number; y: number }, side: 'home' | 'away') => side === 'home' ? p.y / H : 1 - p.y / H;
  let ok = true; const msgs: string[] = [];
  for (const [side, axf] of [['away', 0.800], ['home', 0.200]] as const) {
    const s = coverSpots(side, axf * W, 3, W, H, false);
    const nearY = fy(s[0], side);                       // 근접 슬롯 깊이(홈 프랙션 — 타이트닝으로 얕아야, 구 0.645)
    const lineSlot = axf >= 0.5 ? s[1] : s[0];          // 히터 쪽 사이드라인 슬롯
    const insideSlot = axf >= 0.5 ? s[0] : s[1];        // 중앙 쪽 슬롯
    const lineGap = Math.abs(lineSlot.x - axf * W) / W; // 라인 슬롯 ↔ attackX 편차(사이드라인 쪽)
    const insGap = Math.abs(insideSlot.x - axf * W) / W;// 안쪽 슬롯 ↔ attackX 편차(중앙 쪽)
    // 핀: ① 근접 타이트닝(≤0.58, 구 0.645 반려) ② 비대칭(라인≠안쪽 — 구 대칭 ±0.094 아님) ③ 둘 다 구 대칭보다 넓게(≥0.10)
    const nearOK = nearY <= 0.58;
    const asymOK = Math.abs(lineGap - insGap) >= 0.005 && lineGap >= 0.10 && insGap >= 0.10;
    if (!(nearOK && asymOK)) ok = false;
    msgs.push(`${side} x${axf}: 근접y=${nearY.toFixed(3)}(≤0.58 ${nearOK ? '✅' : '✗'}) 라인=${lineGap.toFixed(3)}·안쪽=${insGap.toFixed(3)}(비대칭·≥0.10 ${asymOK ? '✅' : '✗'})`);
  }
  // A/B: 구 값(근접 y0.645·대칭 ±34px=0.094)이면 ①근접(0.645>0.58 위반) ②대칭(|0.094−0.094|=0<0.005 위반) 둘 다 핀 깨짐 → 오라클 유효.
  const oldNearY = 0.645, oldSym = 34 / W;
  const abBreaks = oldNearY > 0.58 && Math.abs(oldSym - oldSym) < 0.005;
  for (const m of msgs) log('   · ' + m);
  log(`   [A/B] 구 값(근접 y0.645·대칭 ±34px)이면 근접+비대칭 핀 위반 → ${abBreaks ? '✅ 오라클 유효' : '⚠'}`);
  return ok && abBreaks;
}

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

type Rec = { atk: Atk; atkIdx: number; front: number[]; cover: number[]; near: number[]; pool: { i: number; x: number }[]; ahx: number; libero?: number; liberoWasFirst?: boolean };
const recs: Rec[] = [];

for (let m = 0; m < nMatches; m++) {
  const hId = teams[m % teams.length];
  const aId = teams[(m + 1 + (m % (teams.length - 1))) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0);
  const aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 424242 + m * 7919;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId), touches: true });
  const rallies = reconstructRallies(sim);
  let prevLast: { x: number; y: number } | undefined;
  for (const r of rallies) {
    const sink: Rec[] = [];
    const path = ballPath(r, seed, L, W, H, SERVE_OUT, prevLast, undefined, sink);
    prevLast = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prevLast;
    recs.push(...sink);
  }
}

// 집계 헬퍼
const group = (f: (r: Rec) => boolean) => recs.filter(f);
const frontInCover = (r: Rec) => r.cover.filter((c) => r.front.includes(c)).length;
const atkInCover = (r: Rec) => r.cover.includes(r.atkIdx);
// 전위 가용 = 커버 후보 풀(atkIdx·토서·퍼스트터치 제외됨) 안의 전위 수
const frontAvail = (r: Rec) => r.front.filter((i) => r.pool.some((p) => p.i === i)).length;
// 근접 슬롯(near)에 든 후위(전위 아님) 수
const backInNear = (near: number[], front: number[]) => near.filter((i) => !front.includes(i)).length;

// 구 x-only 선정 재현(수정 전 로직): pool을 |x-ahx| 근접순 3인 → x 좌→우 → length===3이면 near=[0],[2]/deep=[1]
const oldNear = (r: Rec): number[] => {
  const cand = r.pool.slice()
    .sort((a, b) => Math.abs(a.x - r.ahx) - Math.abs(b.x - r.ahx)).slice(0, 3)
    .sort((a, b) => a.x - b.x)
    .map((p) => p.i);
  return cand.length === 3 ? [cand[0], cand[2]] : cand.slice();
};

const disguise = group((r) => r.atk === 'open' || r.atk === 'tempo'); // 위장 국면
const back = group((r) => r.atk === 'back');
const quick = group((r) => r.atk === 'quick');

const disguiseFrontLeak = disguise.filter((r) => frontInCover(r) > 0).length; // 위반: 옵션(전위)이 커버에
const backFrontCover = back.filter((r) => frontInCover(r) > 0).length;         // 대조: 백어택은 전위 커버 참여
const anyAtkInCover = recs.filter(atkInCover).length;                          // 위반: 공격수가 커버

// ②' [행 정합] 백어택 근접 슬롯의 후위 침입 — 전위 가용≥2 국면에서 기대 0. 전위<2는 폴백(별도)
const backReady = back.filter((r) => frontAvail(r) >= 2);   // 전위 가용 충분(오라클 적용 국면)
const backFallback = back.filter((r) => frontAvail(r) < 2); // 전위 부족(폴백 — 후위가 근접 채워도 위반 아님)
const nearBackIntrusion = backReady.filter((r) => backInNear(r.near, r.front) > 0).length; // 위반
const fallbackBackInNear = backFallback.filter((r) => backInNear(r.near, r.front) > 0).length; // 참고(폴백서 후위 근접)
// A/B: 구 로직이었으면 같은 국면(전위 가용≥2)에서 근접 슬롯 후위 침입이 몇 건이었나 (>0 이어야 민감)
const oldNearBackIntrusion = backReady.filter((r) => backInNear(oldNear(r), r.front) > 0).length;

// ── R3(#131): 공격팀 리베로(수비 스페셜리스트) 커버 합류 — firstTouch(서브리시브/디그)여도 방치 금지 ──
// 구 로직은 firstTouch면 리베로를 커버 풀에서 제외 → 반대 구석 베이스에 방치(사용자 실측). 신 로직은 리베로를 합류.
//  eligible = 리베로가 firstTouch였고(구 로직이 방치했을 국면) 자기가 공격수가 아닌 경우(= 커버 대상).
//  방치(위반) = eligible인데 cover에 없음 → 신 로직 기대 0. A/B = eligible 국면 수(>0 이어야 "구 로직이 방치할 시나리오 존재" 증명).
const libEligible = recs.filter((r) => r.liberoWasFirst === true && r.libero !== undefined && r.libero !== r.atkIdx);
const libAbandoned = libEligible.filter((r) => !r.cover.includes(r.libero!)).length; // 신 로직 위반(기대 0)
const libAbandonByType = (t: Atk) => { const g = libEligible.filter((r) => r.atk === t); return `${g.filter((r) => !r.cover.includes(r.libero!)).length}/${g.length}`; };

const pct = (n: number, d: number) => d ? (100 * n / d).toFixed(1) : '—';
log('\n═══ 커버 안무 검증 (룰 62 제외방향 + 룰 68 포함/행방향) ═══');
log(`표본: ${recs.length} 커버 국면 (${nMatches}경기) — open/tempo ${disguise.length} · back ${back.length} · quick ${quick.length}`);
log('');
log('── 룰 62 (제외 방향: 옵션이 커버로 안 빠짐) ──');
log(`① [위장] open/tempo 전위 옵션이 커버에 낀 국면: ${disguiseFrontLeak} (${pct(disguiseFrontLeak, disguise.length)}%) — 기대 0`);
log(`② [대조/비공허] 백어택서 전위가 네트앞 커버로: ${backFrontCover} (${pct(backFrontCover, back.length)}%) — 같은 도구가 전위 커버를 봄(측정 유효)`);
log(`③ [불변] 이번 공격수(atkIdx)가 자기 커버에 낀 국면: ${anyAtkInCover} — 기대 0`);
log('');
log('── 룰 68 (포함/행 방향: 근접 슬롯=전위, 깊은 슬롯=후위) ──');
log(`②' [행 정합] 백어택 전위가용≥2 국면 ${backReady.length}건 중 근접 슬롯에 후위 침입: ${nearBackIntrusion} (${pct(nearBackIntrusion, backReady.length)}%) — 기대 0`);
log(`   [폴백] 전위가용<2 국면 ${backFallback.length}건 중 후위가 근접 채움: ${fallbackBackInNear} — 위반 아님(무방비 금지 폴백)`);
log(`   [A/B 민감도] 구 x-only 선정이었으면 같은 ${backReady.length}건 중 근접 후위 침입: ${oldNearBackIntrusion} (${pct(oldNearBackIntrusion, backReady.length)}%) — >0 이어야 검사 유효`);

log('');
log('── R4 커버 반원 좌표 핀(전면 공격 타이트닝) ──');
const covPinOK = coverPin();

log('');
log('── R3 리베로 커버 합류 (firstTouch여도 방치 금지) ──');
log(`③'' [방치 봉인] 리베로 firstTouch·비공격수 국면 ${libEligible.length}건 중 커버 누락(방치): ${libAbandoned} (${pct(libAbandoned, libEligible.length)}%) — 기대 0`);
log(`   유형별 방치: open ${libAbandonByType('open')} · tempo ${libAbandonByType('tempo')} · back ${libAbandonByType('back')} · quick ${libAbandonByType('quick')}`);
log(`   [A/B 민감도] 구 로직(firstTouch 리베로 제외)이면 이 ${libEligible.length}건 전부 방치 → ${libEligible.length > 0 ? '✅ 시나리오 존재(>0)' : '⚠ 표본 없음'}`);

const pass =
  disguiseFrontLeak === 0 && anyAtkInCover === 0 && backFrontCover > 0 && // 룰 62
  nearBackIntrusion === 0 && oldNearBackIntrusion > 0 &&                  // 룰 68 (위반 0 + A/B 민감)
  libAbandoned === 0 && libEligible.length > 0 &&                        // R3 (리베로 방치 0 + A/B 시나리오 존재)
  covPinOK;                                                              // R4 (커버 반원 타이트닝 핀 + A/B)
log('');
log(pass
  ? '✅ PASS — 룰62(옵션누출 0·공격수 0·백어택대조 유효) + 룰68(근접 후위침입 0 · 구로직 A/B >0) + R3(리베로 방치 0 · A/B >0) + R4(커버 타이트닝 핀 ✅)'
  : '❌ FAIL — 위 지표 확인(②\'>0 룰68 미봉인 / ③\'\'>0 리베로 방치 / 커버핀 위반 / A/B==0 검사 공허)');
process.exit(pass ? 0 : 1);
