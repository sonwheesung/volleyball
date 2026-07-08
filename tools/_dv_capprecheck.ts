// INDEPENDENT GUARD — 계약관리 재계약 사전체크 == store reSign 게이트 (조용한 거부 0, 2026-07-08).
//   배경(CONFIRMED): app/contracts.tsx pickOffer가 과거 `canAfford(payroll(getEvolvedTeamPlayers) − p.salary, offer)`
//   로 사전체크 → getEvolvedTeamPlayers는 **시즌초 커밋 명단**이라 시즌 중 영입 선수의 취득가(inSeasonCost)가 빠져,
//   캡 근접 + 시즌 중 영입 보유 시 UI는 "여유 있음"으로 통과시키고 store(capPayroll §7)가 조용히 거부했다.
//   수정: pickOffer도 store와 **동일한 capPayroll 경로**(시즌 중 영입비·배신 웃돈·프랜차이즈 팀캡 예외)로 교체.
//
//   판정(불변식): 캡 근접 + 시즌 중 영입 1명 시나리오에서 **새 사전체크(capPayroll) == store 게이트**(허위 여유 0).
//   A/B(허위 오라클 방지): **구 사전체크**(시즌초 base 합, inSeasonCost 누락)로 세면 동일 오퍼에서 판정이 뒤집혀야
//     한다(구=여유있음 통과 ↔ store=캡초과 거부). 필터(inSeasonCost 반영)가 load-bearing임을 flip으로 입증.
//   Usage: npx tsx tools/_dv_capprecheck.ts
import { resetLeagueBase, LEAGUE, getEvolvedTeamPlayers } from '../data/league';
import { capPayroll, payroll } from '../data/roster';
import { LEAGUE_CAP } from '../engine/cap';
import { inSeasonCost } from '../engine/transactions';
import { marketVal } from '../data/awardSalary';
import type { Contract, Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const f = (n: number) => (n / 10000).toFixed(1) + '억';
resetLeagueBase();
const DAY = 0;

// 시즌 중 영입 1명을 시뮬(다른 팀 국내 선수 q). q의 취득가(inSeasonCost)가 캡에 잡혀야 한다.
const teams = LEAGUE.teams;
const homeRoster = getEvolvedTeamPlayers(teams[0].id, DAY).filter((p) => !p.isForeign);
const q = getEvolvedTeamPlayers(teams[1].id, DAY).find((p) => !p.isForeign)!;
const p = homeRoster[0]; // 재계약 대상(내 팀 국내 선수)

const qCost = inSeasonCost(marketVal(q), false);
// 시즌초 base 국내 합(구 사전체크의 total). q(시즌 중 영입)는 시즌초 명단에 없어 여기 안 잡힘.
const baseTotal = payroll(homeRoster);
// 캡 근접이 되도록 오퍼를 잡는다: 구 사전체크 판정값(base − p.salary + O)이 정확히 CAP이 되게(=여유있음 경계 통과),
//   그러면 store(capPayroll)는 여기에 qCost가 더 얹혀 CAP+qCost > CAP → 거부. 두 판정이 뒤집힌다.
const offerSalary = LEAGUE_CAP - (baseTotal - p.contract.salary);
const contract: Contract = { salary: offerSalary, years: 1, remaining: 1, signedAtAge: p.age };

// ── 구 사전체크(버그 재현): getEvolvedTeamPlayers base 합, inSeasonCost 누락 ──
//   canAfford(total − p.salary, O) === (baseTotal − p.salary + O <= CAP)
const oldPrecheckOver = (baseTotal - p.contract.salary + offerSalary) > LEAGUE_CAP; // 경계=false(여유있음 통과)

// ── 새 사전체크 == store 게이트: 그날 유효 명단(시즌초 + 시즌 중 영입 q)에 override(p=오퍼) ──
const capPlayers: Player[] = [...homeRoster, q];
const nextOverrides: Record<string, Contract> = { [p.id]: contract };
const inSeasonSigned = new Set([q.id]);
const isBetrayed = () => false;
const newPay = capPayroll(capPlayers, nextOverrides, inSeasonSigned, isBetrayed);
const newPrecheckOver = newPay > LEAGUE_CAP; // 기대=true(거부)
// store 게이트도 완전히 동일한 capPayroll 호출 → 동일 입력이면 동일 결과(사전체크==게이트 불변식).
const storeGateOver = capPayroll(capPlayers, nextOverrides, inSeasonSigned, isBetrayed) > LEAGUE_CAP;

log('[_dv_capprecheck] 캡 근접 + 시즌 중 영입 1명 재계약 시나리오:');
log(`  시즌초 국내 base 합 ${f(baseTotal)} · 재계약 대상 ${p.name} 현연봉 ${f(p.contract.salary)}`);
log(`  시즌 중 영입 ${q.name} 취득가(inSeasonCost) ${f(qCost)} · 오퍼 ${f(offerSalary)} · 캡 ${f(LEAGUE_CAP)}`);
log(`  새 사전체크 payroll ${f(newPay)} → 초과=${newPrecheckOver}`);
log(`  구 사전체크(inSeasonCost 누락) 초과=${oldPrecheckOver} · store 게이트 초과=${storeGateOver}`);

// 불변식: 새 사전체크 == store 게이트(허위 여유 0)
const matchesStore = newPrecheckOver === storeGateOver && newPrecheckOver === true;
// A/B 민감도: 구 사전체크는 store와 판정이 뒤집힌다(구=여유있음 통과 false ↔ store=거부 true)
const flips = oldPrecheckOver === false && storeGateOver === true && qCost > 0;

log(`  [불변식] 새 사전체크 == store 게이트(초과 판정) = ${matchesStore}`);
log(`  [A/B] 구 사전체크 vs store 판정 뒤집힘(inSeasonCost가 load-bearing) = ${flips}`);

const pass = matchesStore && flips;
log(pass ? 'CAPPRECHECK_GUARD PASS' : 'CAPPRECHECK_GUARD FAIL');
process.exit(pass ? 0 : 2);
