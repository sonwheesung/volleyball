// 독립 검증(메인 작성) — 개입의 "프리픽스 불변" + "실제 효과" 스모크.
// 에이전트가 만든 _dv_intervention_empty(빈=noop)와 별개로, 개입이 (1) 결과를 실제로 바꾸고
// (2) 개입 좌표 이전 points[]는 바이트 동일함을 증명한다. 이게 인터랙티브 방식의 린치핀.
import { simulateMatch } from '../engine/match';
import type { MatchIntervention } from '../engine/simMatch';
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';

resetLeagueBase();
const teams = LEAGUE.teams;

let changed = 0, prefixOk = 0, applied = 0, total = 0;
let firstBadPrefix: string | null = null;

for (let i = 0; i < 3000; i++) {
  const seed = (i * 2654435761) >>> 0;
  const H = getEvolvedTeamPlayers(teams[i % teams.length].id, 0);
  const A = getEvolvedTeamPlayers(teams[(i + 1) % teams.length].id, 0);
  const opts = { home: coachInfoOf(teams[i % teams.length].id), away: coachInfoOf(teams[(i + 1) % teams.length].id) };

  // 기준(개입 없음)
  const base = simulateMatch(seed, H, A, opts);
  if (base.points.length < 10) continue;
  total++;

  // 1세트 중반 어떤 점수에서 홈이 코트 비세터 1명을 벤치 임의 1명으로 교체 시도
  const midPt = base.points.find((p) => p.setNo === 1 && p.home + p.away >= 6);
  if (!midPt) continue;
  const coord = { setNo: 1, h: midPt.home, a: midPt.away };

  // 코트에 있을 법한 비세터 선발 + 벤치 후보(단순: 홈 로스터에서 포지션 매칭 2명)
  const nonSetters = H.filter((p) => p.position !== 'S' && p.position !== 'L');
  if (nonSetters.length < 2) continue;
  const outP = nonSetters[0];
  const inP = nonSetters.find((p) => p.position === outP.position && p.id !== outP.id)
    ?? nonSetters[1];

  const iv: MatchIntervention[] = [{ at: coord, side: 'home', kind: 'sub', outId: outP.id, inId: inP.id }];
  const withIv = simulateMatch(seed, H, A, { ...opts, interventions: iv });

  // subEvents에 manual이 실제로 들어갔나(개입이 적용됐나 — 좌표/후보가 유효했을 때)
  const didApply = (withIv.subEvents ?? []).some((e) => e.kind === 'manual');
  if (didApply) applied++;

  // (2) 프리픽스 불변: coord 이전(그 점수 이전) points가 바이트 동일
  const cut = base.points.findIndex((p) => p.setNo === coord.setNo && p.home === coord.h && p.away === coord.a);
  const preBase = JSON.stringify(base.points.slice(0, cut + 1));
  const preIv = JSON.stringify(withIv.points.slice(0, cut + 1));
  if (preBase === preIv) prefixOk++;
  else if (!firstBadPrefix) firstBadPrefix = `seed=${seed} cut=${cut}`;

  // (1) 실제 효과: 개입이 적용된 경우 전체 경기가 기준과 달라졌나(뒷부분 전개 변화)
  if (didApply && JSON.stringify(withIv.points) !== JSON.stringify(base.points)) changed++;
}

console.log(`total=${total} applied=${applied} prefixOk=${prefixOk} changed=${changed}`);
if (firstBadPrefix) { console.log(`PREFIX BROKEN: ${firstBadPrefix}`); process.exit(1); }
if (prefixOk !== total) { console.log(`prefixOk(${prefixOk}) != total(${total})`); process.exit(1); }
if (applied === 0) { console.log('개입이 한 번도 적용 안 됨 — 테스트 무효(허위 통과 방지)'); process.exit(1); }
if (changed === 0) { console.log('개입이 결과를 한 번도 안 바꿈 — 기계 미작동 의심'); process.exit(1); }
console.log(`PASS — 프리픽스 ${prefixOk}/${total} 바이트동일, 개입적용 ${applied}건 중 결과변화 ${changed}건`);
