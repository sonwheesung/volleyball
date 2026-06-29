// 모기업 기조 → 내 팀 1회성 현금 보너스 (FINANCE 2.0 Stage4) 가드. 추정 금지 — 실측 A/B.
//   각 팀을 '내 팀'으로 두고 projectSettledCash(FA 프리뷰 지갑)를 stance on/off로 대조.
//   ① 레버: aggressive 팀 = 지갑 +STANCE_AGGR_BONUS / ② 권한 무영향: thrifty·normal = Δ0(강제 차단/보너스 0)
//   ③ stanceCashBonus 순수치(aggressive만) ④ 결정론(같은 입력 동일) ⑤ 세 stance 모두 관측.
//   npx tsx tools/_dv_stance_bonus.ts [H=20] [U=6]
import { reseedLeague, LEAGUE } from '../data/league';
import { projectSettledCash } from '../data/financeProjection';
import { upcomingStanceOf, setStanceEnabled, setSeasonHistory } from '../data/leagueHistory';
import { stanceCashBonus, STANCE_AGGR_BONUS } from '../engine/finance';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { advanceOffseason } from './simLeague';
import type { SponsorStance, } from '../engine/sponsorStance';
import type { SeasonArchive } from '../types';

const H = Math.max(6, Number(process.argv[2]) || 20);
const U = Math.max(1, Number(process.argv[3]) || 6);
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${n}${d ? ' — ' + d : ''}`); };

// 단위: stanceCashBonus 순수치
check('stanceCashBonus(aggressive)=BONUS', stanceCashBonus('aggressive') === STANCE_AGGR_BONUS, `${STANCE_AGGR_BONUS}`);
check('stanceCashBonus(thrifty)=0', stanceCashBonus('thrifty') === 0);
check('stanceCashBonus(normal)=0', stanceCashBonus('normal') === 0);

const CASH0 = 100000, FAN = 50;
const tally: Record<SponsorStance, number> = { thrifty: 0, normal: 0, aggressive: 0 };
let leverBad = 0, authBad = 0, detBad = 0;
const teamIds = LEAGUE.teams.map((t) => t.id);

const WARMUP = 2;
for (let u = 0; u < U; u++) {
  reseedLeague(20251018 + u * 101, 777 + u * 13);
  const archive: SeasonArchive[] = [];
  for (let s = 0; s < H; s++) {
    const order = computeStandings(Number.MAX_SAFE_INTEGER).map((r) => r.teamId);
    const champ = buildPlayoffs(s).championId ?? order[0];
    archive.push({ season: s, championId: champ, standings: order });
    if (s >= WARMUP) {
      setSeasonHistory(archive); // season s 포함 — upcomingStanceOf가 라이브 s를 덧대 도출
      for (const my of teamIds) {
        setStanceEnabled(false);
        const off = projectSettledCash(my, s, CASH0, FAN, []);
        setStanceEnabled(true);
        const on1 = projectSettledCash(my, s, CASH0, FAN, []);
        const on2 = projectSettledCash(my, s, CASH0, FAN, []);
        const stance = upcomingStanceOf(my, s);
        tally[stance]++;
        const delta = on1 - off;
        if (delta !== stanceCashBonus(stance)) leverBad++;            // 보너스 = stance 도출과 정확히 일치
        if (stance !== 'aggressive' && delta !== 0) authBad++;        // 권한 무영향(thrifty/normal Δ0)
        if (on1 !== on2) detBad++;                                    // 결정론
      }
    }
    advanceOffseason(s, champ, order);
  }
  process.stderr.write(`  …유니버스 ${u + 1}/${U}\n`);
}

console.log(`\n═══ 내 팀 모기업 보너스 (${U}유니버스 × ${H}시즌, ${tally.aggressive + tally.normal + tally.thrifty} 팀-평가) ═══`);
console.log(`  stance: aggressive ${tally.aggressive} · normal ${tally.normal} · thrifty ${tally.thrifty}`);
console.log(`  보너스 불일치 ${leverBad} · 권한위반(thr/norm Δ≠0) ${authBad} · 결정론위반 ${detBad}`);

check('① 보너스 정합 — Δ(on−off)==stanceCashBonus(stance) 전부', leverBad === 0, `${leverBad}건`);
check('② 권한 무영향 — thrifty/normal 지갑 Δ=0', authBad === 0, `${authBad}건`);
check('④ 결정론 — 같은 입력 동일', detBad === 0, `${detBad}건`);
check('⑤ 세 stance 모두 관측(aggressive·normal·thrifty)', tally.aggressive > 0 && tally.normal > 0 && tally.thrifty > 0);

console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — pass ${pass} / fail ${fail}`);
process.exit(fail > 0 ? 1 : 0);
