// FA 점수→확률 + 관계 트레이드오프 가드 (FA_SYSTEM 2.7 / RELATIONSHIP §4) — 사용자 4시나리오.
//   npx tsx tools/_dv_fa_relations.ts
// 검증: relT가 점수 ±·성향별 트레이드오프(우승파 강행 / 의리파 기피)·acceptProb S곡선·SIT_OUT·결정론.
import { offerScore, acceptProb, SIT_OUT, DEFAULT_FA_WEIGHTS } from '../engine/faMarket';
import type { FAWeights } from '../types';

const out = (m: string) => process.stdout.write(m + '\n');
let fail = 0;
const check = (n: string, c: boolean) => { out(`${c ? '✅' : '❌'} ${n}`); if (!c) fail++; };

const base = {
  teamOvr: 70, prestige: 0.4, posGap: 1, isOriginal: false, isFranchise: false,
  isPreferred: false, offerSalary: 30000, asking: 30000, w: DEFAULT_FA_WEIGHTS, rand: 0.5,
} as any;

// ── relT가 점수에 ± ──
check('relT +0.6 > 0 > −0.6 (친구 +·싫은선수 −)',
  offerScore({ ...base, relT: 0.6 }) > offerScore({ ...base, relT: 0 }) &&
  offerScore({ ...base, relT: 0 }) > offerScore({ ...base, relT: -0.6 }));

// ── 성향별 트레이드오프(사용자 시나리오 2·3) ──
const winW: FAWeights = { money: 0.2, win: 0.55, loyalty: 0.05, play: 0.1, home: 0.05, rel: 0.05 };
const relW: FAWeights = { money: 0.15, win: 0.20, loyalty: 0.05, play: 0.1, home: 0.05, rel: 0.45 };
const contenderRival = { teamOvr: 82, prestige: 0.85, posGap: 1, relT: -0.6 };   // 우승권인데 앙숙 있음
const friendlyMid = { teamOvr: 68, prestige: 0.3, posGap: 1, relT: 0.6 };          // 중위권인데 친구 있음
const sc = (w: FAWeights, t: any) => offerScore({ ...base, w, ...t });
check('우승파: 싫어도 우승권 강행(contender>friendly)', sc(winW, contenderRival) > sc(winW, friendlyMid));
check('의리파: 앙숙 피해 친구 팀(friendly>contender)', sc(relW, friendlyMid) > sc(relW, contenderRival));

// ── 연봉 양보+친구(시나리오 4): 의리파는 낮은 연봉 친구팀 > 높은 연봉 무관팀 ──
const lowPayFriend = sc(relW, { teamOvr: 72, prestige: 0.5, posGap: 1, relT: 0.6, offerSalary: 26000 } as any);
const highPayNeutral = sc(relW, { teamOvr: 72, prestige: 0.5, posGap: 1, relT: 0, offerSalary: 34000 } as any);
check('의리파: 연봉 양보하고 친구 팀(저연봉친구>고연봉무관)', lowPayFriend > highPayNeutral);

// ── acceptProb 완만 S곡선 ──
check('acceptProb(0.10)≈0 (바닥 미만)', acceptProb(0.10) < 0.02);
check('acceptProb(0.70)≈1 (천장 이상)', acceptProb(0.70) > 0.98);
check('acceptProb 단조 증가', acceptProb(0.3) < acceptProb(0.45) && acceptProb(0.45) < acceptProb(0.6));
check('acceptProb ∈ [0,1]', [0, 0.2, 0.4, 0.6, 0.8, 1].every((s) => { const p = acceptProb(s); return p >= 0 && p <= 1; }));
check('SIT_OUT < 수락 바닥(드문 시즌아웃)', SIT_OUT < 0.22);

// ── 결정론 ──
check('offerScore 결정론', offerScore({ ...base, relT: 0.3 }) === offerScore({ ...base, relT: 0.3 }));

out(fail === 0 ? '\n✅ ALL PASS' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
