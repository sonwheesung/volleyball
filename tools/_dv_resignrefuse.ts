// 상설 가드 — 인시즌 재계약(override) 우회 봉인(FA_SYSTEM §2.5c·D안, 2026-07-10). 검증=Fable / 구현·문서=Opus.
//   npx tsx tools/_dv_resignrefuse.ts [N]   (exit 0/1)
//
// 실버그(발견 2026-07-10·시뮬 확증): 인시즌 재계약(contractOverrides)이 rolloverPlayer에서 remaining≥1로 적용돼
//   buildOffseason의 만료(remaining≤0) 버킷을 건너뛰어 refuses()(재계약 거부 롤)를 완전히 우회 → refuseProb 0.99를
//   강제해도 override 보유자 46/46 잔류(프로브). "재계약 확정=불만 무시 100% 잔류"가 OWNER_SYSTEM·§2.5와 모순.
// 봉인: override 보유 **만료자**(원계약 willBeFA)도 refuses() 롤을 태운다. 거부 시 override 폐기 → FA 풀행.
//
// 불변식:
//   [HI] override + refuseProb 0.99 → override 만료자는 **거부돼 FA 풀행**(내 팀 로스터에서 이탈).
//   [LO] override + refuseProb 0(만족)  → **잔류**(내 팀 로스터 유지).
//   [A/B 이빨] 같은 override인데 HI(이탈)≠LO(잔류) — 봉인이 제거되면 HI도 잔류(우회)해 이 차등이 사라진다(가드 실패).
//   [preview=result] buildDraftContext(결과)와 faMarketPreview(FA 센터)가 같은 이탈/잔류 집합.
import './_gt_mock';

import {
  resetLeagueBase, setMyTeamStaff, LEAGUE, currentRosters, getEvolvedTeamPlayers, getTeam, teamScoutReveal,
  commitPlayerBase, commitRosters,
} from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { faMarketPreview } from '../data/offseason';
import { resolveDraft } from '../engine/draft';
import { aiTargetOf } from '../data/rosterTarget'; // #116 프로덕션 우주 정합(2026-07-15)
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { willBeFA, prefWeightsOf } from '../engine/faMarket';
import { discontentNow } from '../data/owner';
import { marketValue } from '../engine/salary';
import { salaryEraNow } from '../data/awardSalary';
import type { OwnerFx } from '../engine/owner';
import type { Contract } from '../types';

const N = Math.max(1, Number(process.argv[2]) || 24);
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

resetLeagueBase();
const myTeam = LEAGUE.teams[0].id;
setMyTeamStaff(myTeam);
const teamIds = LEAGUE.teams.map((t) => t.id);
const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';

// ── Stage 2: money 불만이 override 연봉에 반응(§2.5c D안 2단계) ── (프레시 base — 시즌 진행 전)
//   discontentNow salaryRatio가 대기 override 연봉을 쓴다: stingy(0.3×시장가)→money 불만 발화, generous(1.2×)→해소.
//   win/minutes/hometown 불만은 돈 면역(override 연봉 무영향)이어야 한다.
{
  const DAY = 160;
  const era = salaryEraNow();
  const players = getEvolvedTeamPlayers(myTeam, DAY).filter((p) => !p.isForeign);
  let tested = 0, toggled = 0;
  for (const p of players) {
    if (prefWeightsOf(p).money < 0.25) continue; // 연봉 성향 있는 선수만(그 외엔 money 불만 미발화 — 설계)
    const mv = marketValue(p, era);
    const stingy: Record<string, Contract> = { [p.id]: { salary: Math.round(mv * 0.3), years: 3, remaining: 3, signedAtAge: p.age } };
    const generous: Record<string, Contract> = { [p.id]: { salary: Math.round(mv * 1.2), years: 3, remaining: 3, signedAtAge: p.age } };
    tested++;
    if (discontentNow(p, myTeam, DAY, stingy).topic === 'money' && discontentNow(p, myTeam, DAY, generous).topic !== 'money') toggled++;
  }
  console.log(`── Stage 2: money override 반응 ── w.money≥0.25 ${tested}명 중 stingy→money·generous→해소 ${toggled}명`);
  ok(tested >= 2 && toggled >= Math.ceil(tested * 0.5), `override 연봉이 money 불만을 양방향 재평가(${toggled}/${tested})`);
}

let sample = 0, hiLeft = 0, hiStay = 0, loStay = 0, loLeft = 0, pvMismatch = 0;
for (let s = 1; s <= N; s++) {
  const expiringFA = getEvolvedTeamPlayers(myTeam, 0).filter((p) => !p.isForeign && willBeFA(p));
  const overrides: Record<string, Contract> = {};
  for (const p of expiringFA) overrides[p.id] = { salary: p.contract.salary, years: 3, remaining: 3, signedAtAge: p.age };

  const fxHi: OwnerFx = { refuseProb: {}, offerBias: {} };
  const fxLo: OwnerFx = { refuseProb: {}, offerBias: {} };
  for (const p of expiringFA) fxHi.refuseProb[p.id] = 0.99; // fxLo = 만족(0, 미기재)

  // 결과 경로(endSeason과 동일) — HI/LO 각각
  const hi = buildDraftContext(myTeam, {}, overrides, [], false, [], s, fxHi, 9_999_999);
  const lo = buildDraftContext(myTeam, {}, overrides, [], false, [], s, fxLo, 9_999_999);
  // 미리보기 경로(FA 센터) — HI
  const pv = faMarketPreview(myTeam, {}, overrides, [], false, [], s, fxHi, 9_999_999);

  const retiredHi = new Set<string>(hi.retired ?? []);
  const hiRoster = new Set(hi.rosters[myTeam] ?? []);
  const loRoster = new Set(lo.rosters[myTeam] ?? []);
  const pvRoster = new Set(pv.myRoster);

  for (const p of expiringFA) {
    if (retiredHi.has(p.id)) continue; // 은퇴는 별개 종착 — 제외
    sample++;
    if (hiRoster.has(p.id)) hiStay++; else hiLeft++;
    if (loRoster.has(p.id)) loStay++; else loLeft++;
    // preview=result: HI에서 결과 이탈 여부 == 미리보기 이탈 여부
    if (hiRoster.has(p.id) !== pvRoster.has(p.id)) { pvMismatch++; }
  }

  // 다음 시즌으로 리그 진행(HI 기준 — 우회 검증과 무관, 표본 다양화)
  const snapshot = hi.snapshot;
  const d = resolveDraft(hi.order, hi.cls, hi.rosters, (id) => snapshot[id], myTeam, [], styleOf, teamScoutReveal, [], aiTargetOf());
  for (const p of d.picked) snapshot[p.id] = p;
  const f = fillRosters(d.rosters, (id) => snapshot[id], s);
  for (const p of f.newPlayers) snapshot[p.id] = p;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(f.rosters)) for (const id of f.rosters[tid]) { const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr); }
  commitPlayerBase(snapshot); commitRosters(f.rosters);
  void teamIds;
}

console.log(`\n표본(override 보유 만료자) ${sample}명 · ${N}시즌`);
console.log(`[HI] refuseProb 0.99 → 이탈 ${hiLeft} · 잔류 ${hiStay}`);
console.log(`[LO] refuseProb 0(만족) → 잔류 ${loStay} · 이탈 ${loLeft}`);
console.log(`[preview=result] 불일치 ${pvMismatch}`);

ok(sample >= 5, `표본 충분(${sample} ≥ 5)`);
// [HI] 봉인 발효 — override 만료자 대다수가 refuseProb 0.99에 거부돼 이탈(우회면 전원 잔류). 확률 0.99라 이론상 극소수 잔류 허용.
ok(hiLeft >= Math.ceil(sample * 0.9), `[HI] override 만료자 이탈 ${hiLeft}/${sample} (≥90% — 봉인 발효, 우회 아님)`);
// [LO] 만족(refuseProb 0)이면 거부 롤 미발동 — 전원 잔류(override 재계약 정상 반영)
ok(loLeft === 0, `[LO] 만족 선수 이탈 0 (${loLeft}) — override 재계약 잔류 정상`);
// [A/B 이빨] HI(이탈)와 LO(잔류)가 명확히 갈림 — 봉인 제거 시 HI도 잔류해 이 차등 소멸
ok(hiLeft > 0 && loLeft === 0 && hiStay < hiLeft, `[A/B] HI 이탈(${hiLeft}) ≫ LO 이탈(${loLeft}) — 봉인 없으면 사라질 차등(가드 이빨)`);
// [preview=result] 결과=미리보기
ok(pvMismatch === 0, `[preview=result] buildDraftContext=faMarketPreview 이탈/잔류 일치(불일치 ${pvMismatch})`);

console.log(fail === 0 ? '\n✅ PASS — 인시즌 재계약 우회 봉인 가드 전항 통과' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
