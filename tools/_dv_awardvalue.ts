// 가드 — 시상 수치의 "기준"이 표시 라벨과 일치 (AWARDS_SYSTEM §10, 2026-07-24 사용자 결정 "라벨 붙이기")
//
// 봉인하는 혼란: 같은 선수가 `정규 MVP 727 / 챔프전 MVP 793 / 득점상 727`로 떠 "숫자가 왜 다르지?"로 읽힘.
//   원인 = AwardWinner.value가 상마다 **다른 자(尺)** 인데 화면에 단위·기준이 없었음. 라벨을 붙였으니, 그 라벨이
//   가리키는 계산이 실제 코드 산식과 일치함을 봉인한다(라벨이 거짓말이면 더 나쁨).
//
// 검사(실 시즌 산출 재계산 대조):
//   V1 부문 기록상(titles) value === 해당 ProdLine 실카운트(scoring→points, spike→spikes, block→blocks,
//      serve→aces, dig→digs, set→assists, receive→receives) — "실적"이 맞다(단위 접미사의 근거).
//   V2 챔프전 MVP·신인상 value === round(impactScore(prod))  — 가중 없는 "공헌지수 원값".
//   V3 정규 MVP value === round(impactScore(prod) × teamWeight(rank))  — 팀 순위 가중이 곱해진 "공헌지수".
//      + 우승팀(1위)이 아니면 정규 MVP value < 그 선수 raw impact(가중이 실제로 깎는다 = 버그 사례 재현).
//   V4 기량발전상 value === round(impactScore(올) − impactScore(전시즌))  — "증가폭".
//   U1 단위/라벨 단일 출처: TITLE_UNITS(data/awards) == STAT_LEADER_META.unit, 소스에 로컬 TITLE_UNIT 사본 0
//      (뉴스 기사 프로즈 data/news.ts는 §1 잔여 결정으로 예외 — 스캔에서 제외).
//   A/B: teamWeight를 뺀 뮤턴트 기대식으로 V3를 재검하면 FAIL(가중이 실제로 산식에 있음을 증명).
//
//   npx tsx tools/_dv_awardvalue.ts   (exit 0=PASS / 1=FAIL)
import './_gt_mock';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// data/awardPoster는 emblems·teamColor로 PNG/webp를 require한다 — node/tsx는 이미지 파싱 불가라 자산 확장자를 더미로 스텁.
const NodeModule = require('module');
for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.m4a', '.ttf', '.otf']) {
  NodeModule._extensions[ext] = (m: { exports: unknown }) => { m.exports = 1; };
}

const log = (m: string) => process.stdout.write(m + '\n');
let fail = 0;
const check = (cond: boolean, pass: string, failMsg: string) => {
  if (cond) log(`PASS ${pass}`); else { fail++; log(`FAIL ${failMsg}`); }
};

// 정본 산식(문서 §1·§2 도출 — 독립 재구현 오라클). teamWeight = engine/awards.ts 사본.
const teamWeight = (rank: number, teamCount: number): number =>
  teamCount <= 1 ? 1 : 1 - 0.5 * (rank / (teamCount - 1));

const FIELD: Record<string, keyof import('../engine/production').ProdLine> = {
  scoring: 'points', spike: 'spikes', block: 'blocks', serve: 'aces', dig: 'digs', set: 'assists', receive: 'receives',
};

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, getPlayer, currentRosters } = await import('../data/league');
  const { leagueProduction } = await import('../data/production');
  const { computeStandings } = await import('../data/standings');
  const { currentSeasonAwards } = await import('../data/awards');
  const { impactScore } = await import('../engine/awards');
  const { TITLE_UNITS } = await import('../data/awards');
  const { STAT_LEADER_META } = await import('../data/awardPoster');
  const { SEASON_DAYS } = await import('../engine/calendar');

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);
  G().resetSave(); G().selectTeam(my);

  // 전시즌 라인(기량발전상 Δ 근거)을 만들려면 시즌 0을 롤오버시켜 seasonLines를 적립해야 한다.
  const playAndRoll = () => { for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any); G().setDay(SEASON_DAYS); G().endSeason(); };
  playAndRoll();                 // S0 → 롤오버(seasonLines[S0] 적립)
  // S1 경기만 기록하고 **롤오버 전** 산출을 잡는다 — leagueProduction(MAX)·standings·currentRosters가 전부 S1 라이브라
  //   currentSeasonAwards(1)가 실제로 소비하는 것과 완전히 동일(archive 스냅샷 드리프트 회피).
  for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any);
  G().setDay(SEASON_DAYS);

  const season = G().season;     // = 1
  const aw = currentSeasonAwards(season); // awards-ceremony/endSeason과 동일 경로(leagueProduction MAX 게이트 통과)
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  const standings = computeStandings(Number.MAX_SAFE_INTEGER);
  const teamCount = standings.length;
  const rankOf = new Map<string, number>();
  standings.forEach((s, i) => rankOf.set(s.teamId, i));
  const rmap = currentRosters();
  const teamOf = (id: string): string => {
    for (const t of Object.keys(rmap)) if (rmap[t].includes(id)) return t;
    return aw.mvp?.teamId ?? '';
  };

  log('=== 시상 value 기준 라벨 정합 가드 ===');
  log(`  대조 시즌 S${season}(롤오버 전 라이브) · 팀수 ${teamCount}`);

  // ── V1 부문 기록상 = ProdLine 실카운트 ──
  let v1bad = 0, v1checked = 0;
  for (const [k, field] of Object.entries(FIELD)) {
    const w = aw.titles[k as keyof typeof aw.titles];
    if (!w) continue;
    v1checked++;
    const l = prod.get(w.playerId);
    const expected = (l?.[field] as number) ?? 0;
    if (w.value !== expected) { v1bad++; log(`   · ${k}: value ${w.value} ≠ ProdLine.${field} ${expected} (${w.playerId})`); }
  }
  check(v1checked > 0 && v1bad === 0, `V1 부문 기록상 ${v1checked}종 value=ProdLine 실카운트(실적)`, `V1 부문 기록상 value≠실카운트 ${v1bad}건`);

  // ── V2 챔프MVP·신인상 = round(impactScore) ──
  const impRound = (id: string): number => Math.round(impactScore(prod.get(id)!));
  let v2ok = true;
  if (aw.finalsMvp) { const e = impRound(aw.finalsMvp.playerId); if (aw.finalsMvp.value !== e) { v2ok = false; log(`   · 챔프MVP value ${aw.finalsMvp.value} ≠ round(impact) ${e}`); } }
  if (aw.rookie) { const e = impRound(aw.rookie.playerId); if (aw.rookie.value !== e) { v2ok = false; log(`   · 신인상 value ${aw.rookie.value} ≠ round(impact) ${e}`); } }
  check(!!(aw.finalsMvp || aw.rookie) && v2ok, 'V2 챔프MVP·신인상 value=round(공헌지수) 원값', 'V2 챔프MVP/신인상 value≠round(impact)');

  // ── V3 정규 MVP = round(impact × teamWeight) + 비1위면 가중이 깎음 ──
  let v3ok = false, v3cut = false;
  if (aw.mvp) {
    const rank = rankOf.get(aw.mvp.teamId) ?? teamCount - 1;
    const raw = impactScore(prod.get(aw.mvp.playerId)!);
    const expected = Math.round(raw * teamWeight(rank, teamCount));
    v3ok = aw.mvp.value === expected;
    if (!v3ok) log(`   · 정규MVP value ${aw.mvp.value} ≠ round(impact ${raw.toFixed(1)} × tw(rank${rank})) ${expected}`);
    // 버그 사례 재현: 비1위 MVP는 raw impact(=챔프MVP 방식)보다 작아야(가중이 실제로 깎음)
    v3cut = rank === 0 ? aw.mvp.value === Math.round(raw) : aw.mvp.value < Math.round(raw);
    log(`   · 정규MVP rank ${rank} · value ${aw.mvp.value} vs raw impact ${Math.round(raw)} → ${rank === 0 ? '1위=동일' : '가중 깎임'} ${v3cut ? 'OK' : 'MISMATCH'}`);
  }
  check(!!aw.mvp && v3ok && v3cut, 'V3 정규 MVP value=round(공헌지수×팀순위가중) · 비1위면 raw보다 작음', 'V3 정규 MVP 가중 산식 불일치');

  // ── V4 기량발전상 = round(impact(올) − impact(전)) ──
  let v4note = '기량발전상 없음(스킵)';
  if (aw.mostImproved) {
    const id = aw.mostImproved.playerId;
    const prior = getPlayer(id)?.seasonLines?.find((l) => l.season === season - 1);
    if (prior) {
      const e = Math.round(impactScore(prod.get(id)!) - impactScore(prior));
      check(aw.mostImproved.value === e, `V4 기량발전상 value=round(공헌지수 증가폭) (${aw.mostImproved.value})`, `V4 기량발전상 value ${aw.mostImproved.value} ≠ Δ ${e}`);
      v4note = '';
    }
  }
  if (v4note) log(`  (${v4note})`);

  // ── U1 단위 단일 출처 ──
  const metaMatch = Object.keys(STAT_LEADER_META).every((k) => (STAT_LEADER_META as any)[k].unit === TITLE_UNITS[k]);
  check(metaMatch, 'U1a STAT_LEADER_META.unit == TITLE_UNITS(단일 출처)', 'U1a STAT_LEADER_META.unit ≠ TITLE_UNITS');

  // 로컬 TITLE_UNIT 사본 스캔 — data/awards.ts(정의 원본)·data/news.ts(언론 프로즈 예외) 외엔 0이어야
  const root = join(__dirname, '..');
  const scanFiles = ['app/season-recap-detail/[section].tsx', 'app/records-archive.tsx', 'app/news/[id].tsx', 'data/awardPoster.ts'];
  let localCopies = 0;
  for (const rel of scanFiles) {
    const src = readFileSync(join(root, rel), 'utf8');
    if (/const\s+TITLE_UNIT\b\s*[:=]/.test(src)) { localCopies++; log(`   · ${rel}: 로컬 TITLE_UNIT 사본 잔존`); }
  }
  check(localCopies === 0, 'U1b 소비 화면에 로컬 단위 사본 0(단일 출처 소비)', `U1b 로컬 단위 사본 ${localCopies}건`);

  // ── A/B 자가검증: 합성 입력으로 teamWeight 민감도를 **항상** 증명(이 시즌 MVP 순위와 무관). ──
  //   최고 생산자를 **꼴찌 팀**에 두면 정규 MVP value는 raw impact보다 반드시 작아야(가중이 실제로 곱해짐).
  //   teamWeight를 뺀 뮤턴트라면 value == round(raw) 가 되어 이 검사가 FAIL → 오라클이 비어있지 않음.
  const { computeSeasonAwards } = await import('../engine/awards');
  const synthL = (o: Partial<import('../engine/production').ProdLine>): import('../engine/production').ProdLine =>
    ({ matches: 30, points: 0, spikes: 0, backSpikes: 0, blocks: 0, aces: 0, assists: 0, digs: 0, receives: 0, ...o });
  const synthProd = new Map<string, import('../engine/production').ProdLine>([
    ['ace', synthL({ points: 800 })],  // 최고 생산자 — 꼴찌 팀
    ['mid', synthL({ points: 400 })],  // 1위 팀
  ]);
  const synthAw = computeSeasonAwards({
    prod: synthProd,
    player: (id) => ({ id, position: 'OP' } as any),
    teamOf: (id) => (id === 'ace' ? 'last' : 'first'),
    teamRank: new Map([['first', 0], ['last', 6]]),
    teamCount: 7,
    rookies: new Set(),
    priorImpact: new Map(),
    mostImprovedReady: false,
    championId: null,
    legProd: [],
  });
  const aceRaw = Math.round(impactScore(synthProd.get('ace')!)); // 800
  // ace(800×tw(6/6)=0.5=400) vs mid(400×tw(0)=400) → 동률, id 사전순(ace<mid)이라 ace 승. value=400 < raw 800.
  const synthMvp = synthAw.mvp;
  const abSensitive = !!synthMvp && synthMvp.playerId === 'ace' && synthMvp.value < aceRaw && synthMvp.value === 400;
  log(`  ④ A/B(합성): 꼴찌팀 최고생산자 raw ${aceRaw} → 정규MVP value ${synthMvp?.value}(기대 400 = 가중 0.5 적용, <raw) = ${abSensitive}`);
  check(abSensitive, '④ A/B teamWeight 민감도(합성: 꼴찌팀 MVP value=raw×0.5<raw)', '④ A/B 무감각 — teamWeight가 산식에 없음');

  const pass = fail === 0;
  log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fail ? ` — ${fail}건 실패` : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
