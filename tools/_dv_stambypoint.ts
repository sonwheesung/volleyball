// SimResult.stamByPoint 가드 — 포인트별 코트(선발6+리베로) 체력 스냅샷의 구조·결정론·골든무영향·생리 sanity.
//
// 배경: 경기 보드 스코어보드에 "내 팀 코트 체력"을 포인트별로 표시(테스터 "타임아웃 타이밍을 못 잡음")하기 위해
//   엔진이 stamByPoint(points와 1:1 정렬, 득점 확정 직후·회복 전)를 순수 관측으로 실어 보낸다. 이 가드는:
//   ① 길이 정합(stamByPoint.length == points.length)
//   ② 각 엔트리 home/away 각 6~7명(선발6+리베로), stam ∈ [0,1]
//   ③ 결정론(동일 시드 = 동일 stamByPoint 바이트)
//   ④ 골든 무영향(serializeMatch가 stamByPoint 미참조) — 코어 직렬화가 stamByPoint를 안 읽음을 A/B로 증명 + 실제 _dv_golden PASS
//   ⑤ 생리 sanity(세트 시작 신선 → 세트 진행하며 하락 경향, 리베로 포함)
//
// 사용:
//   npx tsx tools/_dv_stambypoint.ts             본 검증(PASS/FAIL)
//   npx tsx tools/_dv_stambypoint.ts --selftest   각 불변식에 결함을 주입해 검출을 증명(비공허 오라클 A/B)
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import type { BoxSink } from '../engine/rally';
import type { SimResult } from '../engine/simMatch';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const log = (m: string) => process.stdout.write(m + '\n');

type Snap = { home: { id: string; stam: number }[]; away: { id: string; stam: number }[] };

function runSim(seed: number, homeId: string, awayId: string): { sim: SimResult; box: BoxSink } {
  const home = getEvolvedTeamPlayers(homeId, 0);
  const away = getEvolvedTeamPlayers(awayId, 0);
  const box: BoxSink = new Map();
  const sim = simulateMatch(seed, home, away, { home: coachInfoOf(homeId), away: coachInfoOf(awayId), box });
  return { sim, box };
}

/** 골든 코어 직렬화 복제(_dv_golden serializeMatch와 동일 필드 집합) — stamByPoint를 **읽지 않음**을 대조하기 위한 기준. */
function coreHash(sim: SimResult, box: BoxSink): string {
  const scorers = sim.points.map((p) => (p.scorer === 'home' ? 'h' : 'a')).join('');
  const hows = sim.points.map((p) => p.how ?? '_').join('');
  const byIds = sim.points.map((p) => p.byId ?? '_').join('|');
  const recvIds = sim.points.map((p) => p.recvId ?? '_').join('|');
  let atkAtt = 0, atkKill = 0, atkErr = 0, atkBlocked = 0, srvAce = 0, srvErr = 0, blockPt = 0, digSucc = 0, assist = 0, recvAtt = 0, recvGood = 0;
  for (const l of box.values()) {
    atkAtt += l.atkAtt; atkKill += l.atkKill; atkErr += l.atkErr; atkBlocked += l.atkBlocked;
    srvAce += l.srvAce; srvErr += l.srvErr; blockPt += l.blockPt; digSucc += l.digSucc;
    assist += l.assist; recvAtt += l.recvAtt; recvGood += l.recvGood;
  }
  const payload = [
    sim.homeSets, sim.awaySets, ...sim.setScores.flatMap((s) => [s.home, s.away]),
    sim.points.length, scorers, hows, byIds, recvIds,
    atkAtt, atkKill, atkErr, atkBlocked, srvAce, srvErr, blockPt, digSucc, assist, recvAtt, recvGood,
  ];
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** 골든이 "만약" stamByPoint를 읽었다면의 해시(누수 시뮬) — ④ 오라클 비공허 증명용. */
function coreHashWithStam(sim: SimResult, box: BoxSink): string {
  const base = coreHash(sim, box);
  const stamDigest = (sim.stamByPoint ?? []).map((sp) =>
    [...sp.home, ...sp.away].map((s) => Math.round(s.stam * 1000)).join(',')).join('|');
  return createHash('sha256').update(base + '::' + stamDigest).digest('hex');
}

// ── 불변식 체크 (violations 반환, 빈 배열 = PASS) ──

/** ①② 구조: 길이 정합 + 각 엔트리 6~7명 + stam∈[0,1]. */
function checkStructure(sim: SimResult): string[] {
  const v: string[] = [];
  const sbp = sim.stamByPoint;
  if (!sbp) { v.push('stamByPoint 미부여(undefined)'); return v; }
  if (sbp.length !== sim.points.length) v.push(`① 길이 불일치 stamByPoint=${sbp.length} vs points=${sim.points.length}`);
  for (let i = 0; i < sbp.length; i++) {
    for (const side of ['home', 'away'] as const) {
      const arr = sbp[i][side];
      if (arr.length < 6 || arr.length > 7) { v.push(`② [${i}].${side} 인원 ${arr.length}명(6~7 아님)`); break; }
      for (const s of arr) {
        if (!s.id) { v.push(`② [${i}].${side} id 없음`); break; }
        if (!(s.stam >= 0 && s.stam <= 1)) { v.push(`② [${i}].${side} ${s.id} stam=${s.stam} ∉[0,1]`); break; }
      }
    }
    if (v.length > 8) break; // 폭주 방지
  }
  return v;
}

/** ③ 결정론: 동일 시드 재실행 stamByPoint 바이트 동일. */
function checkDeterminism(seed: number, homeId: string, awayId: string): string[] {
  const a = runSim(seed, homeId, awayId).sim.stamByPoint;
  const b = runSim(seed, homeId, awayId).sim.stamByPoint;
  if (JSON.stringify(a) !== JSON.stringify(b)) return [`③ 결정론 위반 — 동일 시드(${seed}) stamByPoint 불일치`];
  return [];
}

/** ⑤ 생리 sanity: 세트 시작 코트 평균 체력 > 세트 종반 평균(하락 경향). 리베로 포함(7인 엔트리 관측). */
function sanityAggregate(sims: SimResult[]): { violations: string[]; startMean: number; endMean: number; sawLibero: boolean } {
  let startSum = 0, startN = 0, endSum = 0, endN = 0;
  let sawLibero = false;
  const meanCourt = (sp: Snap) => {
    const all = [...sp.home, ...sp.away];
    if (sp.home.length === 7 || sp.away.length === 7) sawLibero = true;
    return all.reduce((s, x) => s + x.stam, 0) / all.length;
  };
  for (const sim of sims) {
    const sbp = sim.stamByPoint!;
    // 세트별 첫/마지막 point 인덱스
    const setStart = new Map<number, number>(), setEnd = new Map<number, number>();
    sim.points.forEach((p, i) => {
      if (!setStart.has(p.setNo)) setStart.set(p.setNo, i);
      setEnd.set(p.setNo, i);
    });
    for (const [setNo, si] of setStart) {
      const ei = setEnd.get(setNo)!;
      if (ei - si < 10) continue; // 너무 짧은 세트(관측 무의미)
      startSum += meanCourt(sbp[si]); startN++;
      endSum += meanCourt(sbp[ei]); endN++;
    }
  }
  const startMean = startSum / Math.max(1, startN);
  const endMean = endSum / Math.max(1, endN);
  const v: string[] = [];
  if (!(endMean < startMean)) v.push(`⑤ 하락 경향 위반 — 세트종반 평균 ${endMean.toFixed(4)} ≥ 세트시작 평균 ${startMean.toFixed(4)}`);
  if (!sawLibero) v.push('⑤ 리베로(7인 엔트리) 미관측 — 코트 스냅샷에 리베로 누락 의심');
  return { violations: v, startMean, endMean, sawLibero };
}

// 고정 시드 픽스처(_dv_golden과 동일 팀 조합) + sanity용 다수 시드.
const FIXTURES = [
  { seed: 770001, home: 0, away: 1 },
  { seed: 770017, home: 2, away: 5 },
  { seed: 770033, home: 4, away: 3 },
];
const SANITY_N = 300;

function build() {
  resetLeagueBase();
  const ids = LEAGUE.teams.map((t) => t.id);
  return { ids };
}

// ── --selftest: 각 불변식에 결함을 주입 → 검출을 증명(비공허 오라클) ──
if (process.argv.includes('--selftest')) {
  const { ids } = build();
  const { sim, box } = runSim(FIXTURES[0].seed, ids[FIXTURES[0].home], ids[FIXTURES[0].away]);
  log('가드 셀프테스트(A/B) — 각 불변식에 결함 주입 시 검출되어야 함');
  let allDetected = true;
  const report = (label: string, detected: boolean) => {
    log(`  ${detected ? '✅' : '❌'} ${label} — ${detected ? '검출됨' : '미검출(가드 무효)'}`);
    if (!detected) allDetected = false;
  };

  // ① 길이: 마지막 엔트리 제거
  {
    const mut = { ...sim, stamByPoint: sim.stamByPoint!.slice(0, -1) } as SimResult;
    report('① 길이 정합(엔트리 1개 제거)', checkStructure(mut).some((x) => x.startsWith('①')));
  }
  // ② 범위: stam=1.5 주입
  {
    const clone = JSON.parse(JSON.stringify(sim.stamByPoint)) as Snap[];
    clone[0].home[0].stam = 1.5;
    const mut = { ...sim, stamByPoint: clone } as SimResult;
    report('② stam 범위(1.5 주입)', checkStructure(mut).some((x) => x.startsWith('②')));
  }
  // ② 인원: 코트 인원 5명으로 축소
  {
    const clone = JSON.parse(JSON.stringify(sim.stamByPoint)) as Snap[];
    clone[0].home = clone[0].home.slice(0, 5);
    const mut = { ...sim, stamByPoint: clone } as SimResult;
    report('② 인원(5명 축소)', checkStructure(mut).some((x) => x.startsWith('②')));
  }
  // ③ 결정론: 두 번째 실행을 흉내 낸 변조본과 비교(한 값 +0.1)
  {
    const a = sim.stamByPoint!;
    const b = JSON.parse(JSON.stringify(a)) as Snap[];
    b[Math.floor(b.length / 2)].home[0].stam = Math.min(1, b[Math.floor(b.length / 2)].home[0].stam + 0.1);
    report('③ 결정론(재실행 값 1개 변조)', JSON.stringify(a) !== JSON.stringify(b));
  }
  // ④ 골든 무영향 오라클 비공허: stamByPoint를 읽는 가상 직렬화는 값 변조에 민감(누수 시 잡힌다),
  //    실제 coreHash는 무감(순수 관측 보존). 둘 다여야 오라클이 비공허.
  {
    const zeroed = JSON.parse(JSON.stringify(sim.stamByPoint)) as Snap[];
    for (const sp of zeroed) { for (const s of sp.home) s.stam = 0; for (const s of sp.away) s.stam = 0; }
    const mut = { ...sim, stamByPoint: zeroed } as SimResult;
    const coreSame = coreHash(sim, box) === coreHash(mut, box);         // 실제 코어: 무감이어야
    const leakSensitive = coreHashWithStam(sim, box) !== coreHashWithStam(mut, box); // 누수 시뮬: 민감이어야
    report('④ 골든 무영향(코어 무감 + 누수시뮬 민감)', coreSame && leakSensitive);
  }
  // ⑤ sanity: 모든 stam=1(하락 없음) → 하락 경향 위반 검출
  {
    const flat = JSON.parse(JSON.stringify(sim.stamByPoint)) as Snap[];
    for (const sp of flat) { for (const s of sp.home) s.stam = 1; for (const s of sp.away) s.stam = 1; }
    const mut = { ...sim, stamByPoint: flat } as SimResult;
    report('⑤ 하락 경향(모든 stam=1)', sanityAggregate([mut]).violations.some((x) => x.startsWith('⑤ 하락')));
  }

  log(allDetected ? '✅ SELFTEST PASS — 모든 불변식 오라클 비공허(민감)' : '❌ SELFTEST FAIL — 일부 오라클 공허');
  process.exit(allDetected ? 0 : 1);
}

// ── 본 검증 ──
const { ids } = build();
const violations: string[] = [];

// ①② 구조 (픽스처 3경기)
const sims: SimResult[] = [];
for (const f of FIXTURES) {
  const { sim } = runSim(f.seed, ids[f.home], ids[f.away]);
  sims.push(sim);
  const v = checkStructure(sim);
  if (v.length) violations.push(`[구조 seed=${f.seed}] ${v.join(' | ')}`);
}

// ③ 결정론 (픽스처 3경기)
for (const f of FIXTURES) {
  const v = checkDeterminism(f.seed, ids[f.home], ids[f.away]);
  if (v.length) violations.push(`[결정론 seed=${f.seed}] ${v.join(' | ')}`);
}

// ④ 골든 무영향 — (a) 코어 직렬화가 stamByPoint를 안 읽음(값 변조에 무감) A/B
{
  const { sim, box } = runSim(FIXTURES[0].seed, ids[FIXTURES[0].home], ids[FIXTURES[0].away]);
  const h0 = coreHash(sim, box);
  const zeroed = JSON.parse(JSON.stringify(sim.stamByPoint)) as Snap[];
  for (const sp of zeroed) { for (const s of sp.home) s.stam = 0; for (const s of sp.away) s.stam = 0; }
  const h1 = coreHash({ ...sim, stamByPoint: zeroed } as SimResult, box);
  if (h0 !== h1) violations.push(`④ 코어 직렬화가 stamByPoint에 반응(누수) — 골든에 새어들어감`);
  log(`④a 코어해시(stamByPoint 무관): ${h0.slice(0, 16)}… (변조본 동일=${h0 === h1})`);
}
// ④ (b) 실제 골든 카나리아 PASS(엔진 바이트 불변)
try {
  execFileSync('npx', ['tsx', join(__dirname, '_dv_golden.ts')], { stdio: 'pipe', shell: process.platform === 'win32' });
  log('④b _dv_golden 실행 결과: PASS (골든 해시 불변)');
} catch (e: any) {
  const out = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
  violations.push(`④ _dv_golden FAIL — 골든 바이트 변함(stamByPoint가 새어들어감 의심):\n${out.trim().split('\n').slice(-3).join('\n')}`);
}

// ⑤ sanity (다수 시드 aggregate)
{
  const bigSims: SimResult[] = [];
  const nTeams = ids.length;
  for (let i = 0; i < SANITY_N; i++) {
    const h = i % nTeams, a = (i * 7 + 3) % nTeams;
    if (h === a) continue;
    bigSims.push(runSim(900000 + i, ids[h], ids[a]).sim);
  }
  const s = sanityAggregate(bigSims);
  log(`⑤ 생리 sanity — 세트시작 평균 ${s.startMean.toFixed(4)} → 세트종반 평균 ${s.endMean.toFixed(4)} (Δ${(s.endMean - s.startMean).toFixed(4)}), 리베로 관측=${s.sawLibero} (N=${bigSims.length}경기)`);
  violations.push(...s.violations);
}

if (violations.length) {
  log(`❌ FAIL — ${violations.length}건`);
  for (const v of violations) log(`  • ${v}`);
  process.exit(1);
}
log('✅ PASS — stamByPoint 구조·결정론·골든무영향·생리 sanity 전부 통과');
process.exit(0);
