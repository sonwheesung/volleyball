// 모기업 기조 → AI FA 입찰 (FINANCE 2.0 Stage3) 가드. 추정 금지 — 실측 A/B.
//   매 시즌 오프시즌마다 FA 시장을 stance on/off 로 두 번(+결정론 1회) 돌려 대조(비커밋 계산).
//   ① 레버 효과: stance on/off 사이 FA 행선지가 실제로 바뀐다(Δ>0). off==전팀 normal 베이스라인.
//   ② 캡 불변: 어떤 stance도 domesticPayroll ≤ LEAGUE_CAP 위반 0(clamp 검증, 결정#1).
//   ③ 방향성: aggressive 팀이 thrifty 팀보다 FA 영입 더 많이(타겟+1·배수). thrifty=관망.
//   ④ 결정론 + A/B 민감도(on-vs-on Δ=0 = 지표가 노이즈 아님 — 허위 오라클 차단).
//   ※ stance RNG는 (teamId,season) 키라 시즌마다 r이 달라짐 → 여러 시즌 평가로 다양성 확보(고정 시즌이면 7개뿐).
//   npx tsx tools/_dv_fa_stance.ts [H=24] [U=6]
import { reseedLeague, LEAGUE } from '../data/league';
import { resolvePreDraft } from '../data/offseason';
import { setSeasonHistory, setStanceEnabled, teamStanceOf } from '../data/leagueHistory';
import { type SponsorStance } from '../engine/sponsorStance';
import { domesticPayroll } from '../data/roster';
import { LEAGUE_CAP } from '../engine/cap';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { advanceOffseason } from './simLeague';
import type { SeasonArchive } from '../types';

const H = Math.max(8, Number(process.argv[2]) || 24);
const U = Math.max(1, Number(process.argv[3]) || 6);
const WARMUP = 4; // 초기 시즌은 이력 빈약 — 평가 제외
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${n}${d ? ' — ' + d : ''}`); };

const idTeam = (rosters: Record<string, string[]>): Record<string, string> => {
  const m: Record<string, string> = {};
  for (const t of Object.keys(rosters)) for (const id of rosters[t]) m[id] = t;
  return m;
};
// 두 결과의 선수 행선지 차이 수(한쪽에서만 보유/다른 팀 = stance 영향). 외인 트라이아웃은 양 arm 동일이라 상쇄.
const movedCount = (a: Record<string, string[]>, b: Record<string, string[]>): number => {
  const ma = idTeam(a), mb = idTeam(b);
  const ids = new Set([...Object.keys(ma), ...Object.keys(mb)]);
  let n = 0; for (const id of ids) if (ma[id] !== mb[id]) n++;
  return n;
};

let totalLever = 0, capViol = 0, detViol = 0, evalPts = 0, leverPts = 0;
let aggrGain = 0, aggrTeams = 0, thrGain = 0, thrTeams = 0, normGain = 0, normTeams = 0;
const stanceTally: Record<SponsorStance, number> = { thrifty: 0, normal: 0, aggressive: 0 };
const teamIds = LEAGUE.teams.map((t) => t.id);

for (let u = 0; u < U; u++) {
  reseedLeague(20251018 + u * 101, 777 + u * 13);
  const archive: SeasonArchive[] = []; // 가드 자체 적립(advanceOffseason도 simArchive 적립하나, 평가는 이 archive로 통제)
  for (let s = 0; s < H; s++) {
    const st = computeStandings(Number.MAX_SAFE_INTEGER);
    const order = st.map((r) => r.teamId);
    const champ = buildPlayoffs(s).championId ?? order[0];
    archive.push({ season: s, championId: champ, standings: order });

    if (s >= WARMUP) {
      setSeasonHistory(archive); // season s 포함 → 이 오프시즌(nextSeason=s+1) FA에 stance 도출(season s)
      setStanceEnabled(true);
      const on1 = resolvePreDraft('', {}, {}, [], false, [], s + 1);
      const on2 = resolvePreDraft('', {}, {}, [], false, [], s + 1); // 결정론·A/B 민감도
      setStanceEnabled(false);
      const off = resolvePreDraft('', {}, {}, [], false, [], s + 1);

      evalPts++;
      const lever = movedCount(on1.rosters, off.rosters);
      totalLever += lever; if (lever > 0) leverPts++;
      detViol += movedCount(on1.rosters, on2.rosters);
      for (const t of Object.keys(on1.rosters)) {
        if (domesticPayroll(on1.rosters[t], (id) => on1.snapshot[id]) > LEAGUE_CAP) capViol++;
      }
      // 방향성: 팀 stance(season s) × on-arm 국내 FA 영입 수(prevTeam≠현재팀)
      setStanceEnabled(true);
      const prev = on1.prevTeamOf;
      for (const t of teamIds) {
        const st2 = teamStanceOf(t, s);
        stanceTally[st2]++;
        let g = 0;
        for (const id of on1.rosters[t] ?? []) {
          const p = on1.snapshot[id];
          if (!p || p.isForeign) continue;
          if (prev[id] && prev[id] !== t) g++;
        }
        if (st2 === 'aggressive') { aggrGain += g; aggrTeams++; }
        else if (st2 === 'thrifty') { thrGain += g; thrTeams++; }
        else { normGain += g; normTeams++; }
      }
    }

    advanceOffseason(s, champ, order); // base 진화(다음 시즌). simArchive/컨텍스트도 set하나 다음 루프서 archive로 덮음
  }
  process.stderr.write(`  …유니버스 ${u + 1}/${U}\n`);
}

const aggrMean = aggrTeams ? aggrGain / aggrTeams : 0;
const thrMean = thrTeams ? thrGain / thrTeams : 0;
const normMean = normTeams ? normGain / normTeams : 0;

console.log(`\n═══ 모기업 기조 → AI FA 입찰 (${U}유니버스 × ${H}시즌, 평가 ${evalPts}오프시즌) ═══`);
console.log(`  stance 분류: aggressive ${stanceTally.aggressive}(팀 ${aggrTeams}) · normal ${stanceTally.normal} · thrifty ${stanceTally.thrifty}(팀 ${thrTeams})`);
console.log(`  팀당 평균 국내 FA 영입: aggressive ${aggrMean.toFixed(2)} · normal ${normMean.toFixed(2)} · thrifty ${thrMean.toFixed(2)}`);
console.log(`  레버: 변동 오프시즌 ${leverPts}/${evalPts} · 행선지 Δ누계 ${totalLever} · 캡위반 ${capViol} · 결정론위반 ${detViol}`);

check('① 레버 효과 — stance on/off 사이 FA 행선지 변동(Δ>0)', totalLever > 0, `Δ누계 ${totalLever} (${leverPts}/${evalPts} 오프시즌)`);
check('② 캡 불변 — domesticPayroll ≤ LEAGUE_CAP 위반 0(clamp)', capViol === 0, `${capViol}건`);
check('③ 방향성 — aggressive > thrifty 팀당 FA(타겟+1·배수)', aggrTeams >= 5 && thrTeams >= 5 ? aggrMean > thrMean : true, `aggr ${aggrMean.toFixed(2)} vs thr ${thrMean.toFixed(2)} (표본 ${aggrTeams}/${thrTeams})`);
check('④ 결정론·A/B 민감도 — on-vs-on Δ=0(노이즈 아님)', detViol === 0, `${detViol}`);
check('⑤ 양 stance 발화 — aggressive·thrifty 모두 출현', stanceTally.aggressive > 0 && stanceTally.thrifty > 0);

console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — pass ${pass} / fail ${fail}`);
process.exit(fail > 0 ? 1 : 0);
