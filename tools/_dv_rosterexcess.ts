// 상설 가드 — 내 팀 로스터 정원 초과 자연 정리(FA_SYSTEM §1.7-내팀, 2026-07-28). 검증=Fable / 구현·문서=Opus.
//   npx tsx tools/_dv_rosterexcess.ts   (exit 0/1)
//
// 배경: 드래프트 위시 지명은 계약 상한 20을 우회(engine/draft.ts 위시 분기가 캡 미검사)해 내 팀 로스터가 24까지
//   커질 수 있다. 이 초과가 영구 지속되던 버그(data/offseason.ts가 내 팀을 능동 정리에서 제외)를 고쳐, 다음 오프시즌
//   buildOffseason이 **캡(20) 초과분만** 자연 정리(다년계약 잔여 후순위·포지션 floor 보호·최저가치 우선)하도록 활성화.
//
// 불변식(전부 실측):
//   A) 24 로스터 → 다음 오프시즌 후 **정확히 20** 수렴(캡 이하로는 안 내림) + rosterExcess 사유 4건(전원 pool)
//   B) 다년계약(remaining≥2) 보호 — 정리 대상 전원이 최종연도/만료(비다년) 선수. 다년 16명 전원 잔류.
//      ★ 강한 A/B: 비다년=고OVR·다년=저OVR로 배치 → 순수 OVR만이면 저OVR '다년'이 잘려야 하는데,
//        다년 보호가 있어야만 '비다년'만 잘린다(다년 보호 미적용 mutant면 이 검사 FAIL).
//   C) 포지션 floor(S2·OH3·OP2·MB3·L2) 최종 명단서 위반 0.
//   D) 결정론 — buildOffseason 재호출 동일(rosters·사유맵).
//   E) 대조군(control) — 정확히 20명 로스터면 정리 0건(트리밍은 캡 초과에서만 발화, 오탐 없음).
//
// A/B "트리밍 없으면 24 지속": A의 `final===20 && reasons===4` 단언은 else 트림 블록을 제거하면(구 동작) final=24·reasons=0으로 FAIL.

import { resetLeagueBase, setMyTeamStaff, LEAGUE, currentBasePlayers, currentRosters, commitPlayerBase, commitRosters } from '../data/league';
import { buildOffseason } from '../data/offseason';
import { ROSTER_CONTRACT_CAP, ROSTER_FLOOR } from '../engine/transactions';
import { overall } from '../engine/overall';
import type { Player, Position } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];

interface Spec { id: string; pos: Position; remaining: number }

/** 내 팀 로스터를 spec대로 클론 주입(리셋→커밋). 클론 템플릿은 도메스틱 선수를 OVR 내림차순으로 배분:
 *  spec 앞쪽(비다년)일수록 고OVR, 뒤쪽(다년)일수록 저OVR → 다년보호가 없으면 저OVR 다년이 잘리게 배치(강한 A/B). */
function installMyRoster(specs: Spec[]): string {
  resetLeagueBase();
  const my = LEAGUE.teams[0].id;
  setMyTeamStaff(my);
  const domestic = currentBasePlayers().filter((p) => !p.isForeign).sort((a, b) => overall(b) - overall(a));
  const clones: Record<string, Player> = {};
  const ids: string[] = [];
  specs.forEach((spec, i) => {
    const src = domestic[i % domestic.length];
    const c: Player = JSON.parse(JSON.stringify(src));
    c.id = spec.id;
    c.position = spec.pos;
    c.isForeign = false;
    c.age = 24; c.peakAge = 28; // 은퇴·노쇠 무발생(성장/하락으로 OVR 순서 뒤집힘 방지)
    c.contract = { salary: Math.min(c.contract.salary, 30000), years: spec.remaining, remaining: spec.remaining, signedAtAge: 24 };
    clones[spec.id] = c;
    ids.push(spec.id);
  });
  commitPlayerBase(clones);
  commitRosters({ ...currentRosters(), [my]: ids });
  return my;
}

const floorCounts = (ids: string[], get: (id: string) => Player | undefined): Record<Position, number> => {
  const c: Record<Position, number> = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
  for (const id of ids) { const p = get(id); if (p) c[p.position]++; }
  return c;
};

// ── 시나리오 A/B/C/D — 24명 로스터(비다년 8 + 다년 16), 초과분 4 정리 ──
{
  const nmPos: Position[] = ['OH', 'OH', 'OH', 'OH', 'MB', 'MB', 'OP', 'OP'];              // 비다년(remaining=2) 8명 — 고OVR(앞쪽)
  const myPos: Position[] = ['S', 'S', 'S', 'OH', 'OH', 'OH', 'OH', 'OP', 'OP', 'MB', 'MB', 'MB', 'MB', 'L', 'L', 'L']; // 다년(remaining=4) 16명 — 저OVR(뒤쪽)
  const specs: Spec[] = [
    ...nmPos.map((pos, i): Spec => ({ id: `xs_nm_${i}`, pos, remaining: 2 })),
    ...myPos.map((pos, i): Spec => ({ id: `xs_my_${i}`, pos, remaining: 4 })),
  ];
  // 포지션 합: S3 OH8 OP4 MB6 L3 = 24 (floor S2 OH3 OP2 MB3 L2 — 4 정리 후에도 floor 이상)

  const my = installMyRoster(specs);
  const off = buildOffseason(my, {}, {}, 2);
  const finalIds = off.rosters[my] ?? [];
  const reasons = Object.entries(off.myReleaseReasons).filter(([, r]) => r === 'rosterExcess').map(([id]) => id);
  const poolSet = new Set(off.pool);
  const get = (id: string) => off.snapshot[id];

  // 셋업 sanity — 희소 영구제명이 클론에 안 걸렸는가(걸리면 표본 오염 → id 조정 필요)
  ok(off.expelled.every((e) => !e.playerId.startsWith('xs_')), `셋업: 클론 영구제명 0(${off.expelled.filter((e) => e.playerId.startsWith('xs_')).length})`);
  // 최종 명단이 전부 내 클론(유령 유입 없음)
  ok(finalIds.every((id) => id.startsWith('xs_')), `최종 명단 전원 클론(비클론 ${finalIds.filter((id) => !id.startsWith('xs_')).length})`);

  ok(finalIds.length === ROSTER_CONTRACT_CAP, `A) 24 → 정확히 ${ROSTER_CONTRACT_CAP} 수렴(캡 이하로 안 내림) — 실측 ${finalIds.length}`);
  ok(reasons.length === 4, `A) rosterExcess 사유 4건(24−20) — 실측 ${reasons.length}`);
  ok(reasons.every((id) => poolSet.has(id)), `A) 정리자 전원 FA 풀行(사유맵 ⊆ pool)`);

  ok(reasons.length > 0 && reasons.every((id) => id.startsWith('xs_nm_')), `B) 다년 보호 — 정리 대상 전원 비다년(최종연도) [${reasons.sort().join(',')}]`);
  const multiSurvive = specs.filter((s) => s.remaining === 4).every((s) => finalIds.includes(s.id));
  ok(multiSurvive, `B) 다년계약 16명 전원 잔류(강한 A/B: 다년=저OVR인데도 보호돼 생존 — 순수OVR mutant면 여기서 잘림)`);

  const fc = floorCounts(finalIds, get);
  const floorOk = POS.every((p) => fc[p] >= ROSTER_FLOOR[p]);
  ok(floorOk, `C) 포지션 floor 무결 — ${POS.map((p) => `${p}${fc[p]}/${ROSTER_FLOOR[p]}`).join(' ')}`);

  const offD = buildOffseason(my, {}, {}, 2);
  const sameRoster = JSON.stringify([...(offD.rosters[my] ?? [])].sort()) === JSON.stringify([...finalIds].sort());
  const sameReasons = JSON.stringify(offD.myReleaseReasons) === JSON.stringify(off.myReleaseReasons);
  ok(sameRoster && sameReasons, `D) 결정론 — buildOffseason 재호출 동일(roster ${sameRoster}·사유 ${sameReasons})`);
}

// ── 시나리오 E — 대조군: 정확히 20명이면 정리 0(트리밍은 캡 초과에서만 발화) ──
{
  const ctrlPos: Position[] = ['S', 'S', 'S', 'OH', 'OH', 'OH', 'OH', 'OH', 'OH', 'OP', 'OP', 'OP', 'MB', 'MB', 'MB', 'MB', 'L', 'L', 'L', 'L']; // 20명 S3 OH6 OP3 MB4 L4
  const specs: Spec[] = ctrlPos.map((pos, i): Spec => ({ id: `xc_${i}`, pos, remaining: 4 }));
  const my = installMyRoster(specs);
  const off = buildOffseason(my, {}, {}, 2);
  const finalIds = off.rosters[my] ?? [];
  const reasons = Object.values(off.myReleaseReasons).filter((r) => r === 'rosterExcess');
  ok(reasons.length === 0, `E) 대조군 20명 — rosterExcess 정리 0(오탐 없음) — 실측 ${reasons.length}`);
  ok(finalIds.length === 20, `E) 대조군 로스터 불변(트리밍 미발화) — 실측 ${finalIds.length}`);
}

console.log(fail === 0 ? '\n✅ PASS — 내 팀 로스터 정원 초과 자연 정리 가드 전항 통과' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
