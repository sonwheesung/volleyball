// 명장 열전 + 감독 코멘트 + 감독 뉴스 가드 (STAFF §9.6-E Phase E) — 순수 함수 직접 검증.
//   (a) 열전 재계산 멱등·결정론 (b) 입성 기준 단조(더 나은 커리어 ≥ 입성) (c) 구세이브 결측 필드 우아 강등 크래시 0
//   (d) 뉴스 빈도 게이트(무명 이동 뉴스 0·거장 이동 뉴스 발생) (e) 코멘트 결정론+상태 근거(각 문구 대응 상태에서만).
//   각 항목 A/B 민감도 자가검증(허위 오라클 방지 — 결함 주입 시 검출됨을 증명). npx tsx tools/_dv_hall_of_coaches.ts
import {
  hallOfCoaches, coachHallScore, coachNewsEvents, coachComment, reputationTier,
  HALL_MIN_SEASONS, HALL_SCORE_MIN, COACH_NEWS_TIER_STARS,
  type CoachCareerRow, type HeadCoachRef,
} from '../engine/reputation';

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => { if (cond) { pass++; console.log(`  PASS ${msg}`); } else { fail++; console.log(`  ✗ FAIL ${msg}`); } };

// ── 합성 경력 빌더 ──
function career(coachId: string, name: string, opts: {
  teamId: string; seasons: number; renown: number; pred: number; actual: number;
  champions?: number; wins?: number; losses?: number; startSeason?: number; noName?: boolean; noWL?: boolean;
}): CoachCareerRow[] {
  const rows: CoachCareerRow[] = [];
  const s0 = opts.startSeason ?? 0;
  for (let i = 0; i < opts.seasons; i++) {
    const champ = i < (opts.champions ?? 0);
    rows.push({
      season: s0 + i, coachId, teamId: opts.teamId,
      predictedRank: opts.pred, actualRank: champ ? 1 : opts.actual,
      playoff: champ ? 'champion' : 'none', champion: champ, midSeasonFired: false,
      coachName: opts.noName ? undefined : name,
      renown: opts.renown,
      wins: opts.noWL ? undefined : (opts.wins ?? 20),
      losses: opts.noWL ? undefined : (opts.losses ?? 16),
    });
  }
  return rows;
}

console.log('\n[a] 열전 재계산 멱등·결정론');
{
  const log = [
    ...career('c:great', '김명장', { teamId: 't0', seasons: 8, renown: 45, pred: 6, actual: 3, champions: 2 }),
    ...career('c:mid', '이보통', { teamId: 't1', seasons: 4, renown: 30, pred: 4, actual: 4 }),
  ];
  const active = new Set<string>(); // 둘 다 은퇴(풀에 없음)
  const h1 = hallOfCoaches(log, active);
  const h2 = hallOfCoaches(log, active);
  ok(JSON.stringify(h1) === JSON.stringify(h2), `hallOfCoaches 멱등(재호출 동일, 입성 ${h1.length}명)`);
  // 활동 중(풀 내) 감독은 제외 — 은퇴 트리거
  const hActive = hallOfCoaches(log, new Set(['c:great']));
  ok(!hActive.some((e) => e.coachId === 'c:great'), '활동 중(activeIds) 감독은 열전 제외(은퇴만)');
  // A/B 민감도: 로그 순서를 섞어도 결과 동일(그룹핑·정렬 결정론). 결함(순서 의존)이면 여기서 깨짐.
  const shuffled = [...log].reverse();
  ok(JSON.stringify(hallOfCoaches(shuffled, active)) === JSON.stringify(h1), 'A/B 민감도: 입력 순서 무관(결정론) — 순서 의존 결함이면 검출');
}

console.log('\n[b] 입성 기준 단조(더 나은 커리어 ≥ 입성)');
{
  // B: 겨우 입성권. A = B보다 우승·승률·명성 전부 우위(같은 시즌수).
  const B = career('c:B', '보더라인', { teamId: 't0', seasons: HALL_MIN_SEASONS, renown: 42, pred: 6, actual: 4, champions: 1, wins: 20, losses: 16 });
  const A = career('c:A', '우월', { teamId: 't1', seasons: HALL_MIN_SEASONS, renown: 42, pred: 6, actual: 4, champions: 3, wins: 28, losses: 8 });
  const hB = hallOfCoaches(B, new Set());
  const hA = hallOfCoaches(A, new Set());
  const inB = hB.length > 0, inA = hA.length > 0;
  ok(inB, `B(보더라인) 입성 확인 — 단조 전제(score ${hB[0] ? hB[0].score.toFixed(1) : 'n/a'} ≥ ${HALL_SCORE_MIN})`);
  ok(!inB || inA, 'B 입성 ⟹ A(모든 성분 우위) 입성 — 단조성');
  ok(inA && hA[0].score >= (hB[0]?.score ?? 0), `A.score(${hA[0]?.score.toFixed(1)}) ≥ B.score(${hB[0]?.score.toFixed(1)})`);
  // 단조식 성분 검증(직접): 각 성분 증가 시 score 증가.
  ok(coachHallScore(70, 2, 0.6) > coachHallScore(70, 1, 0.6), 'coachHallScore 우승↑→점수↑');
  ok(coachHallScore(70, 2, 0.7) > coachHallScore(70, 2, 0.5), 'coachHallScore 승률↑→점수↑');
  ok(coachHallScore(80, 2, 0.6) > coachHallScore(60, 2, 0.6), 'coachHallScore 최고명성↑→점수↑');
  // A/B 민감도: 시즌수 하한 게이트 — MIN 미만이면 아무리 좋아도 미입성(단명 배제).
  const shortStar = career('c:short', '단명거장', { teamId: 't2', seasons: HALL_MIN_SEASONS - 1, renown: 70, pred: 7, actual: 1, champions: HALL_MIN_SEASONS - 1, wins: 30, losses: 6 });
  ok(hallOfCoaches(shortStar, new Set()).length === 0, `A/B 민감도: 재직 ${HALL_MIN_SEASONS - 1}<${HALL_MIN_SEASONS}시즌은 초고성적이어도 미입성(하한 게이트) — 게이트 제거 결함이면 검출`);
}

console.log('\n[c] 구세이브 결측 필드 우아 강등 크래시 0');
{
  // 이름 결측 로그(구세이브) — 크래시 없이 제외돼야.
  const noName = career('c:noname', 'X', { teamId: 't0', seasons: 8, renown: 45, pred: 6, actual: 2, champions: 3, noName: true });
  let crashed = false, res: ReturnType<typeof hallOfCoaches> = [];
  try { res = hallOfCoaches(noName, new Set()); } catch { crashed = true; }
  ok(!crashed, '이름 결측 로그 hallOfCoaches 크래시 0');
  ok(res.length === 0, '이름(coachName) 결측 감독 → 열전 제외(우아 강등)');
  // 승률 결측(wins/losses undefined) — winRate 중립(0.5), 크래시 0, 이름 있으면 여전히 판정.
  const noWL = career('c:nowl', '유명무기록', { teamId: 't1', seasons: 8, renown: 50, pred: 7, actual: 2, champions: 2, noWL: true });
  let crash2 = false, res2: ReturnType<typeof hallOfCoaches> = [];
  try { res2 = hallOfCoaches(noWL, new Set()); } catch { crash2 = true; }
  ok(!crash2, '승률(wins/losses) 결측 크래시 0');
  ok(res2.length === 1 && res2[0].winRate === 0.5, '승률 결측 → winRate 중립(0.5)으로 우아 강등 + 이름 있으면 판정 지속');
  // 빈 로그·미스매치 로그도 크래시 0.
  ok(hallOfCoaches([], new Set()).length === 0, '빈 로그 크래시 0·빈 결과');
  // A/B 민감도: 이름을 하나라도 채우면 제외가 풀려 입성(결측 강등이 진짜 작동함을 증명).
  const oneName = noName.map((r, i) => (i === 3 ? { ...r, coachName: '되살아난이름' } : r));
  ok(hallOfCoaches(oneName, new Set()).length === 1, 'A/B 민감도: 이름 1행 복구 시 입성 — 결측 강등 로직이 실제 작동');
}

console.log('\n[d] 뉴스 빈도 게이트(무명 이동 뉴스 0 · 거장 이동 뉴스 발생)');
{
  // 무명 감독: 저명성·기대대로 성적 → 티어 ★1. 이적해도 뉴스 없음.
  const nobodyLog = career('c:nobody', '무명씨', { teamId: 'tA', seasons: 2, renown: 12, pred: 4, actual: 4 });
  const nobodyRep = reputationTier(12);
  const nobodyActive: HeadCoachRef[] = [{ id: 'c:nobody', name: '무명씨', renown: 12, teamId: 'tB', contractYears: 3 }]; // 이적(tA→tB)
  const nobodyEvents = coachNewsEvents(nobodyLog, nobodyActive, 2);
  ok(nobodyRep.stars < COACH_NEWS_TIER_STARS, `무명씨 티어 ★${nobodyRep.stars} < 게이트 ★${COACH_NEWS_TIER_STARS}`);
  ok(nobodyEvents.filter((e) => e.kind === 'move').length === 0, '무명 감독 이적 → 뉴스 0(빈도 게이트)');

  // 거장 감독: 고성적으로 명성 축적 → 티어 ★4+. 이적하면 뉴스 발생.
  const masterLog = career('c:master', '거장님', { teamId: 'tA', seasons: 6, renown: 45, pred: 7, actual: 2, champions: 2 });
  const masterActive: HeadCoachRef[] = [{ id: 'c:master', name: '거장님', renown: 45, teamId: 'tB', contractYears: 3 }]; // 이적
  const masterEvents = coachNewsEvents(masterLog, masterActive, 6);
  const masterMove = masterEvents.filter((e) => e.kind === 'move');
  ok(masterMove.length === 1 && masterMove[0].tier.stars >= COACH_NEWS_TIER_STARS, `거장 감독 이적 → 뉴스 발생(티어 ★${masterMove[0]?.tier.stars})`);
  ok(masterMove[0].fromTeamId === 'tA' && masterMove[0].teamId === 'tB' && masterMove[0].day0, '이적 뉴스 = 도착팀·직전팀·개막(day0) 정확');

  // 데뷔 게이트: 레전드 출신(renown 72=명장)은 데뷔 뉴스, 일반 승격(38=주목)은 없음.
  const legendDebut = coachNewsEvents([], [{ id: 'c:leg', name: '스타출신', renown: 72, teamId: 'tC', contractYears: 3 }], 5);
  const normalDebut = coachNewsEvents([], [{ id: 'c:norm', name: '무명승격', renown: 38, teamId: 'tC', contractYears: 3 }], 5);
  ok(legendDebut.filter((e) => e.kind === 'debut').length === 1, '레전드 출신 승격 → 데뷔 뉴스');
  ok(normalDebut.filter((e) => e.kind === 'debut').length === 0, '무명 승격 → 데뷔 뉴스 0(게이트)');

  // FA(미배정) 감독은 신선 이벤트 없음.
  const faEvents = coachNewsEvents(masterLog, [{ id: 'c:master', name: '거장님', renown: 45, teamId: null, contractYears: undefined }], 6);
  ok(faEvents.every((e) => e.kind === 'fired' || e.kind === 'enshrine'), 'FA(미배정) 감독 → 데뷔/이적/만료임박 없음');

  // 시즌 중 경질·헌액 파생 + 결정론.
  const firedLog: CoachCareerRow[] = [
    ...career('c:fired', '경질된감독', { teamId: 'tA', seasons: 3, renown: 40, pred: 4, actual: 5 }),
    { season: 3, coachId: 'c:fired', teamId: 'tA', predictedRank: 4, actualRank: 7, playoff: 'none', champion: false, midSeasonFired: true, coachName: '경질된감독', renown: 40, wins: 5, losses: 25 },
  ];
  const firedEvents = coachNewsEvents(firedLog, [], 4);
  ok(firedEvents.filter((e) => e.kind === 'fired').length === 1, '시즌 중 경질 로그 → 경질 뉴스');
  // 헌액: 은퇴(풀 없음) 명장.
  const enshrineEvents = coachNewsEvents(masterLog, [], 7); // master 풀에 없음=은퇴
  ok(enshrineEvents.filter((e) => e.kind === 'enshrine').length === 1, '은퇴 명장 → 명장 열전 헌액 뉴스');
  ok(JSON.stringify(coachNewsEvents(masterLog, [], 7)) === JSON.stringify(enshrineEvents), 'coachNewsEvents 결정론(재호출 동일)');
}

console.log('\n[e] 코멘트 결정론 + 상태 근거(각 문구 대응 상태에서만)');
{
  const base = { expectDelta: 0, champion: false, contractYears: 3, avgAge: 27, tierStars: 3, interest: 0 };
  ok(coachComment(base, 'c:1') === coachComment(base, 'c:1'), '코멘트 결정론(같은 상태+시드=같은 문구)');
  // 성적 리드는 상태로 결정 — 기대 미달 문구는 δ≤−2에서만.
  const under = coachComment({ ...base, expectDelta: -3 }, 'c:x');
  const over = coachComment({ ...base, expectDelta: 3 }, 'c:x');
  ok(under.includes('기대에 못 미친'), '기대 미달(δ≤−2) → "기대에 못 미친" 리드');
  ok(!over.includes('기대에 못 미친') && over.includes('예상을 웃도는'), 'A/B 민감도: 기대 이상(δ≥2)엔 미달 문구 미출현·"예상을 웃도는" 출현');
  // 우승 리드가 성적 리드를 지배.
  ok(coachComment({ ...base, champion: true, expectDelta: -3 }, 'c:x').includes('정상에 오른'), '우승 시 우승 리드 우선');
  // 문맥 꼬리는 대응 상태에서만(시드 전역 스캔 — 없는 상태에선 절대 미출현, 있는 상태에선 최소 1회 출현).
  const seeds = Array.from({ length: 40 }, (_, i) => `s${i}`);
  const appears = (state: typeof base, sub: string) => seeds.some((s) => coachComment(state, s).includes(sub));
  const never = (state: typeof base, sub: string) => seeds.every((s) => !coachComment(state, s).includes(sub));
  ok(never({ ...base, interest: 0 }, '다른 구단의 관심'), '관심 0 → "다른 구단의 관심" 절대 미출현');
  ok(appears({ ...base, interest: 3 }, '다른 구단의 관심'), '관심≥1 → "다른 구단의 관심" 출현(A/B 민감도)');
  ok(never({ ...base, contractYears: 3 }, '거취를 정해야'), '계약 여유 → "거취를 정해야" 미출현');
  ok(appears({ ...base, contractYears: 0 }, '거취를 정해야'), '계약 만료 → "거취를 정해야" 출현');
  ok(never({ ...base, avgAge: 27 }, '어린 선수가 많은'), '평균연령 27 → "어린 선수" 미출현');
  ok(appears({ ...base, avgAge: 24 }, '어린 선수가 많은'), '젊은 팀(≤25.5) → "어린 선수" 출현');
  ok(appears({ ...base, avgAge: 30 }, '베테랑이 중심'), '노장 팀(≥29) → "베테랑" 출현');
  ok(never({ ...base, tierStars: 3 }, '이름값이 있는'), '중간 티어 → "이름값" 미출현');
  ok(appears({ ...base, tierStars: 5 }, '이름값이 있는'), '거장(★5) → "이름값" 출현');
  ok(appears({ ...base, tierStars: 1 }, '증명할 것이 많은'), '무명(★1) → "증명할 것이 많은" 출현');
}

console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
