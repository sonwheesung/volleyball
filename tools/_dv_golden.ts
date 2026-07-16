// 골든 마스터 시뮬 카나리아 (TEST_METHODOLOGY §1 기법 N, 2026-07-16 — OpenTTD regression/ 차용)
//
// 배경: 기존 결정론 가드(engine-regression 48k·_dv_liberostam 등)는 "밸런스가 유지되나"를 무거운 분포로 본다.
//   이 가드는 정반대 — 고정 시드 3경기의 산출을 sha256으로 저장소에 **박제**하고, 커밋마다 1초 안에
//   "같은 ENGINE_VERSION에서 엔진 바이트가 바뀌었나"를 본다. rng 스트림 소비 실수(순서·횟수)·우연한 계수
//   변경을 커밋 즉시 잡는 조기 경보. 의도한 엔진 변경은 반드시 ENGINE_VERSION 범프 + 골든 재생성을 같은
//   커밋에 포함시켜야 통과 → 우연 변경과 의도 변경을 구조로 분리한다.
//
// 직렬화(안정): 각 경기에서 결정론 필드만 명시 나열해 배열로 → sha256. Date·객체 키 순서 의존 금지
//   (box 집계는 순서무관 합으로, 시퀀스는 명시 concat). 세부는 serializeMatch() 참조.
//
// 사용:
//   npx tsx tools/_dv_golden.ts             본 검증(골든과 대조, PASS/FAIL)
//   npx tsx tools/_dv_golden.ts --update    현재 산출로 corpus/golden/engine.json 재생성(의도 변경 시)
//   npx tsx tools/_dv_golden.ts --selftest  산출 숫자 하나를 교란해 해시 불일치 검출을 증명(비공허 오라클 A/B)
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch, ENGINE_VERSION } from '../engine/match';
import type { BoxSink } from '../engine/rally';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const log = (m: string) => process.stdout.write(m + '\n');
const GOLDEN_PATH = join(__dirname, '..', 'corpus', 'golden', 'engine.json');

interface Golden { engineVersion: number; hashes: string[]; updatedAt: string }

// 고정 시드 3경기(서로 다른 팀 조합). 팀 인덱스는 LEAGUE.teams 순서 — resetLeagueBase 후 결정론.
const FIXTURES: { seed: number; home: number; away: number }[] = [
  { seed: 760001, home: 0, away: 1 },
  { seed: 760017, home: 2, away: 5 },
  { seed: 760033, home: 4, away: 3 },
];

/** 한 경기 산출을 결정론 필드만 골라 **명시 배열**로 직렬화(키 순서 비의존). box 집계는 순서무관 합. */
function serializeMatch(seed: number, homeId: string, awayId: string): (string | number)[] {
  const home = getEvolvedTeamPlayers(homeId, 0);
  const away = getEvolvedTeamPlayers(awayId, 0);
  const box: BoxSink = new Map();
  const sim = simulateMatch(seed, home, away, {
    home: coachInfoOf(homeId), away: coachInfoOf(awayId), box, touches: true,
  });

  // 메인 rng 스트림 지문: 최종 세트·스코어·득점 시퀀스·종결유형(how). 가장 민감한 코어.
  const scorers = sim.points.map((p) => (p.scorer === 'home' ? 'h' : 'a')).join('');
  const hows = sim.points.map((p) => p.how ?? '_').join('');
  const byIds = sim.points.map((p) => p.byId ?? '_').join('|');       // 종결 선수 귀속(라인업 결정론)
  const recvIds = sim.points.map((p) => p.recvId ?? '_').join('|');   // 리시브 귀속(boxRng 스트림)

  // box 집계(순서무관 합) — 스윙 단위 귀속 스트림(box/boxRng/digRng)의 바이트 변화까지 카나리아에 태운다.
  let atkAtt = 0, atkKill = 0, atkErr = 0, atkBlocked = 0, srvAce = 0, srvErr = 0, blockPt = 0, digSucc = 0, assist = 0, recvAtt = 0, recvGood = 0;
  for (const l of box.values()) {
    atkAtt += l.atkAtt; atkKill += l.atkKill; atkErr += l.atkErr; atkBlocked += l.atkBlocked;
    srvAce += l.srvAce; srvErr += l.srvErr; blockPt += l.blockPt; digSucc += l.digSucc;
    assist += l.assist; recvAtt += l.recvAtt; recvGood += l.recvGood;
  }

  return [
    `seed=${seed}`, homeId, awayId,
    sim.homeSets, sim.awaySets,
    ...sim.setScores.flatMap((s) => [s.home, s.away]),
    sim.points.length,
    (sim.setFirstServers ?? []).join(','),
    scorers, hows, byIds, recvIds,
    atkAtt, atkKill, atkErr, atkBlocked, srvAce, srvErr, blockPt, digSucc, assist, recvAtt, recvGood,
  ];
}

function hashOf(payload: (string | number)[]): string {
  // JSON.stringify(배열)은 원소 순서 보존 → 안정. 객체 키 순서 의존 없음(전부 배열/스칼라).
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** 3경기 각각의 (payload, hash). resetLeagueBase로 base 시드 확정 후. */
function computeAll(): { payloads: (string | number)[][]; hashes: string[] } {
  resetLeagueBase();
  const ids = LEAGUE.teams.map((t) => t.id);
  const payloads = FIXTURES.map((f) => serializeMatch(f.seed, ids[f.home], ids[f.away]));
  return { payloads, hashes: payloads.map(hashOf) };
}

function readGolden(): Golden | null {
  if (!existsSync(GOLDEN_PATH)) return null;
  try { return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Golden; } catch { return null; }
}

function writeGolden(hashes: string[]): void {
  mkdirSync(join(__dirname, '..', 'corpus', 'golden'), { recursive: true });
  // updatedAt은 재현성 위해 Date 미사용 — 'manual' 고정(스펙 §4).
  const g: Golden = { engineVersion: ENGINE_VERSION, hashes, updatedAt: 'manual' };
  writeFileSync(GOLDEN_PATH, JSON.stringify(g, null, 2) + '\n', 'utf8');
}

// ── --update: 현재 산출로 골든 재생성 ──
if (process.argv.includes('--update')) {
  const { hashes } = computeAll();
  writeGolden(hashes);
  log(`✅ 골든 재생성 — engineVersion=${ENGINE_VERSION}, ${hashes.length}경기`);
  hashes.forEach((h, i) => log(`  [${i}] ${h}`));
  log(`  → ${GOLDEN_PATH}`);
  process.exit(0);
}

// ── --selftest: 산출 숫자 하나를 교란 → 해시 불일치 검출 증명(비공허 오라클 A/B) ──
if (process.argv.includes('--selftest')) {
  const { payloads } = computeAll();
  const base = payloads[0];
  const h0 = hashOf(base);
  // 마지막 숫자 원소(box 집계 recvGood) 하나를 +1 교란한 사본
  const mutated = base.slice();
  const idx = mutated.length - 1;
  mutated[idx] = (mutated[idx] as number) + 1;
  const hM = hashOf(mutated);
  log('골든 카나리아 셀프테스트(A/B) — 산출 1필드 교란 → 해시 불일치여야 함');
  log(`  base 해시   : ${h0}`);
  log(`  교란 해시   : ${hM}  (payload[${idx}] +1)`);
  const detected = h0 !== hM;
  log(detected ? '✅ 불일치 검출됨 — 오라클 비공허(민감)' : '❌ 교란해도 해시 동일 — 오라클 공허(가드 무효)');
  process.exit(detected ? 0 : 1);
}

// ── 본 검증: 골든과 대조 ──
const { hashes } = computeAll();
const golden = readGolden();

log(`골든 마스터 카나리아 — engineVersion(현재)=${ENGINE_VERSION}, 고정 시드 ${hashes.length}경기`);
hashes.forEach((h, i) => log(`  [${i}] ${h}`));

if (!golden) {
  log(`❌ FAIL — 골든 파일 없음(${GOLDEN_PATH}). 최초 생성: npx tsx tools/_dv_golden.ts --update`);
  process.exit(1);
}

log(`골든: engineVersion=${golden.engineVersion}, updatedAt=${golden.updatedAt}`);

if (golden.engineVersion !== ENGINE_VERSION) {
  log(`❌ FAIL — ENGINE_VERSION 범프됨(골든 ${golden.engineVersion} ≠ 현재 ${ENGINE_VERSION})인데 골든 미갱신.`);
  log('   범프 커밋에 골든 재생성을 포함하라: npx tsx tools/_dv_golden.ts --update');
  process.exit(1);
}

const mismatch = hashes.findIndex((h, i) => h !== golden.hashes[i]);
if (mismatch >= 0 || hashes.length !== golden.hashes.length) {
  log(`❌ FAIL — 엔진 출력이 바뀜(경기 [${mismatch}] 해시 불일치, ENGINE_VERSION은 ${ENGINE_VERSION} 그대로).`);
  log('   • 의도한 엔진 변경이면: engine/match.ts ENGINE_VERSION 범프 + `npx tsx tools/_dv_golden.ts --update`를 같은 커밋에 포함하라.');
  log('   • 의도하지 않았으면: 회귀다 — rng 스트림 소비(순서·횟수)·계수 변경을 되짚어라.');
  process.exit(1);
}

log('✅ PASS — 고정 시드 산출 해시가 골든과 일치(엔진 바이트 불변)');
process.exit(0);
