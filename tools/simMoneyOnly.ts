// '돈만' 보상 옵션 검증 — A/B FA를 돈만 OFF/ON으로 각각 영입해 결과 대조.
//   npx tsx tools/simMoneyOnly.ts [탐색시즌=60]
// 같은 시드·같은 영입이라 OFF/ON 차이는 오직 moneyOnly 플래그 → 기작 격리 증명.
// 불변식(post-FA 로스터 = buildDraftContext.rosters, 드래프트·충원 전):
//   (1) ON에서 내 로스터는 OFF의 상위집합 — ON만 가진 선수 정확히 1명(=보상선수, 유출 면제)
//   (2) OFF에만 있고 ON에 없는 선수 0명 — ON이 더 잃지 않는다
//   (3) 보상금(compCash) ON > OFF, 비율 = A 1.5배(300/200)·B 2배(200/100)

import { resetLeagueBase, setMyTeamStaff, getTeam, LEAGUE } from '../data/league';
import { faMarketPreview } from '../data/offseason';
import { buildDraftContext } from '../data/draftSetup';
import { assignFAGrades } from '../engine/faMarket';
import { needsCompensationPlayer } from '../engine/compensation';
import { overall } from '../engine/overall';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const SCAN = Math.max(1, Number(process.argv[2]) || 60);
const BIG_CASH = 99_999_999;

resetLeagueBase();
const myTeam = LEAGUE.teams[0].id;
setMyTeamStaff(myTeam);

let checked = 0, violations = 0, outflowCases = 0;
const fail = (s: number, msg: string) => { violations++; log(`  ❌ [시즌 ${s}] ${msg}`); };

for (let s = 1; s <= SCAN && checked < 14; s++) {
  // 풀에서 타팀 소속 A/B FA 중 최고 OVR 1명만 노린다(보상선수 경로 격리)
  const pre = faMarketPreview(myTeam, {}, {}, [], true, [], s, undefined, BIG_CASH);
  const grades = assignFAGrades(pre.pool.map((id) => pre.snapshot[id]).filter(Boolean) as Player[]);
  const target = [...pre.pool]
    .map((id) => pre.snapshot[id]).filter((p): p is NonNullable<typeof p> => !!p)
    .filter((p) => { const g = grades.get(p.id); return g && needsCompensationPlayer(g); })
    .sort((a, b) => overall(b) - overall(a))[0];
  if (!target) continue;
  const wish = [target.id];
  const g = grades.get(target.id)!;

  // OFF: 보상선수 동반 / ON: 돈만(보상선수 면제) — 같은 시즌·같은 영입
  const off = buildDraftContext(myTeam, {}, {}, wish, true, [], s, undefined, BIG_CASH, [], null, []);
  const on = buildDraftContext(myTeam, {}, {}, wish, true, [], s, undefined, BIG_CASH, [], null, [target.id]);
  const offMine = new Set(off.rosters[myTeam] ?? []);
  const onMine = new Set(on.rosters[myTeam] ?? []);
  if (!offMine.has(target.id) || !onMine.has(target.id)) continue; // 영입 실패(경합 패) → 케이스 아님

  checked++;
  const onlyOn = [...onMine].filter((id) => !offMine.has(id));   // ON만 가진 선수 = 유출 면제된 보상선수
  const onlyOff = [...offMine].filter((id) => !onMine.has(id));  // OFF만 가진 선수(없어야 함)

  // (2) ON이 더 잃지 않는다
  if (onlyOff.length !== 0) fail(s, `${target.name}(${g}): OFF에만 있는 선수 ${onlyOff.length}명 (ON이 더 잃음 — 비정상)`);

  // (1) OFF에서 보상선수 유출이 실제 발생했다면(onlyOn=1) 그게 면제된 것. 보호풀 고갈 등으로 OFF도 유출 0일 수 있음
  if (onlyOn.length === 1) {
    outflowCases++;
    const comp = off.snapshot[onlyOn[0]];
    log(`  ✓ [시즌 ${s}] ${getTeam(myTeam)?.name} ← ${target.name}(${g})  보상선수 ${comp?.name}(OVR ${comp ? overall(comp) : '?'}) 유출 면제  ·  보상금 ${off.compCash}→${on.compCash}`);
  } else if (onlyOn.length === 0) {
    log(`  · [시즌 ${s}] ${target.name}(${g}) 영입 — OFF도 유출 0(보상 대상 없음). 보상금 ${off.compCash}→${on.compCash}`);
  } else {
    fail(s, `${target.name}(${g}): ON만 가진 선수 ${onlyOn.length}명 (보상선수는 영입당 1명이어야)`);
  }

  // (3) 보상금 가중·비율 — 엔진 내부 등급으로 A=1.5배(300/200)·B=2배(200/100) 중 하나여야.
  //   (등급은 엔진이 내부 판정 — 외부 재계산은 경계에서 어긋날 수 있어, 비율이 두 정상값 중 하나인지로 검증)
  if (!(on.compCash > off.compCash)) fail(s, `${target.name}: 돈만 보상금 미가중 (OFF ${off.compCash} → ON ${on.compCash})`);
  const ratio = off.compCash > 0 ? on.compCash / off.compCash : 0;
  if (off.compCash > 0 && Math.abs(ratio - 1.5) > 0.02 && Math.abs(ratio - 2.0) > 0.02)
    fail(s, `${target.name}: 보상금 비율 ${ratio.toFixed(3)} 이 정상값(1.5=A·2.0=B) 아님`);
}

log(`\n═══ '돈만' 보상 검증 — ${checked}개 A/B 영입 케이스(유출 발생 ${outflowCases}건) · myTeam=${getTeam(myTeam)?.name} ═══`);
log(violations === 0
  ? `\n✅ 위반 0건 — 돈만 선택 시 보상선수 유출 면제, 보상금 가중(A 300%·B 200%) 정확`
  : `\n❌ 위반 ${violations}건 — 위 로그 확인`);
process.exit(violations === 0 ? 0 : 1);
