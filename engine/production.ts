// 개인 생산 기록 귀속 (SALARY_SYSTEM 1장). 순수 함수 + 시드 결정론.
// 선발 라인업(코트 위 7명)만 정상 생산 → "뛴 선수만 기록/성장".
// 큰 점수차(블로아웃)의 가비지타임엔 벤치/유망주가 출전해 생산(감독 육성 판단).

import type { Player, Position, SeasonLine } from '../types';
import { createRng } from './rng';
import { overall } from './overall';
import { STARTER_NEED } from './transactions';
import { u23Edge } from './lineup';
import type { SimResult } from './simMatch';
import type { BoxSink } from './rally';

export interface ProdLine {
  matches: number;  // 출전
  points: number;   // 득점(공격+블록+에이스)
  spikes: number;
  backSpikes: number; // 후위공격(백어택) 득점 — spikes의 부분집합. 트리플 크라운(후위공격 3+) 판정 전용
  blocks: number;
  aces: number;
  assists: number;  // 세트(세터)
  digs: number;
  receives: number; // 서브 리시브(리시브왕) — 기록 전용(밸런스 무영향)
}

export const emptyProd = (): ProdLine => ({
  matches: 0, points: 0, spikes: 0, backSpikes: 0, blocks: 0, aces: 0, assists: 0, digs: 0, receives: 0,
});

/** 시즌 생산을 선수 통산 기록(CareerStats)에 누적한 새 선수 — 백년 누적 서사의 토대.
 *  career.seasons 는 rollover가 증가시키므로 여기선 생산 스탯만 더한다. 밸런스 무영향(기록용). */
export function accrueCareer(p: Player, prod: ProdLine | undefined): Player {
  if (!prod || prod.matches <= 0) return p;
  const c = p.career;
  return {
    ...p,
    career: {
      ...c,
      matches: c.matches + Math.round(prod.matches),
      points: c.points + prod.points,
      spikes: c.spikes + prod.spikes,
      blocks: c.blocks + prod.blocks,
      digs: c.digs + prod.digs,
      aces: c.aces + prod.aces,
      assists: (c.assists ?? 0) + prod.assists, // 구세이브 career엔 없을 수 있음
    },
  };
}

/** 시즌 라인 적립 — 선수 상세 "시즌별 기록"용. 시즌 경계에서 1회(같은 시즌 중복 호출은 덮어씀).
 *  선수 베이스에 붙어 은퇴 시 함께 정리(세이브 자동 다이어트). 밸런스 무영향(기록용). */
export function appendSeasonLine(p: Player, season: number, teamId: string, prod: ProdLine | undefined): Player {
  if (!prod || prod.matches <= 0) return p;
  const line: SeasonLine = {
    season, teamId, matches: Math.round(prod.matches),
    points: prod.points, spikes: prod.spikes, blocks: prod.blocks,
    aces: prod.aces, assists: prod.assists, digs: prod.digs,
  };
  return { ...p, seasonLines: [...(p.seasonLines ?? []).filter((l) => l.season !== season), line] };
}

export function mergeProd(a: ProdLine | undefined, b: ProdLine): ProdLine {
  const x = a ?? emptyProd();
  return {
    matches: x.matches + b.matches, points: x.points + b.points,
    spikes: x.spikes + b.spikes, backSpikes: x.backSpikes + b.backSpikes, blocks: x.blocks + b.blocks, aces: x.aces + b.aces,
    assists: x.assists + b.assists, digs: x.digs + b.digs, receives: x.receives + b.receives,
  };
}

// 코트 위 인원(선발) — 1S·2OH·1OP·2MB·1L = 7. 선발 구성 단일 출처(STARTER_NEED, engine/transactions).
const ON_COURT = STARTER_NEED;

// 공격 점유 — OP(아포짓)가 확실한 1옵션, OH 좌우, MB(센터)는 속공 위주로 비중 낮음(실제 여자배구)
// 엔진(rally.chooseAtk)의 실제 공격 분포(센터 ~18%)에 맞춰 MB 비중 상향(2026-06)
const ATTACK: Record<Position, number> = { OP: 1.38, OH: 0.98, MB: 0.42, S: 0.08, L: 0 };
const BLOCK: Record<Position, number> = { MB: 1.0, OH: 0.6, OP: 0.6, S: 0.3, L: 0 };
const SERVE: Record<Position, number> = { OP: 1, OH: 1, MB: 1, S: 1, L: 0.1 };
const DIG: Record<Position, number> = { L: 1.3, OH: 0.6, S: 0.5, MB: 0.4, OP: 0.3 };
const RECV: Record<Position, number> = { L: 1.3, OH: 1.0, S: 0.1, MB: 0.15, OP: 0.15 }; // 서브 리시브 = 리베로+OH(W형)
const ATK_FOCUS = 2.0; // 공격 집중도 — 좋은 공격수에게 세트 몰림(1옵션 에이스 부각)
const BACK_ATK_RATE = 0.24; // OH/OP 킬 중 후위공격(백어택) 비율 — 엔진 백어택 18%/공격을 OH/OP 킬 기준 환산(측정 calibration)
const BLK_FOCUS = 2.5; // 블록 집중도 — 좋은 블로커(센터)가 팀 블록 점유↑ → 스킬→블록 기울기 확보

/** 선발(코트 위 7) / 벤치 분리 — 포지션별 OVR 상위가 선발.
 *  @param dvPhilosophy 감독 육성 철학(STAFF §9.6-D) — U23 근소차 우선(buildLineup과 동일 에지). 기본 0=neutral(byte-동일). */
export function splitLineup(players: Player[], dvPhilosophy = 0): { starters: Player[]; bench: Player[] } {
  const byPos: Record<Position, Player[]> = { S: [], OH: [], OP: [], MB: [], L: [] };
  for (const p of players) byPos[p.position].push(p);
  const starters: Player[] = [];
  const bench: Player[] = [];
  (Object.keys(byPos) as Position[]).forEach((pos) => {
    const sorted = byPos[pos].sort((a, b) => (overall(b) + u23Edge(b, dvPhilosophy)) - (overall(a) + u23Edge(a, dvPhilosophy)));
    starters.push(...sorted.slice(0, ON_COURT[pos]));
    bench.push(...sorted.slice(ON_COURT[pos]));
  });
  return { starters, bench };
}

/** 큰 점수차일수록 가비지타임 비중↑ (벤치 출전) */
function garbageFrac(sim: SimResult): number {
  const lead = Math.abs(sim.homeSets - sim.awaySets);
  if (lead >= 3) return 0.2; // 3-0
  if (lead === 2) return 0.08; // 3-1
  return 0;
}

function pick(pool: Player[], weight: (p: Player) => number, r: number): Player | null {
  let total = 0;
  const ws: number[] = [];
  for (const p of pool) {
    const w = Math.max(0, weight(p));
    ws.push(w);
    total += w;
  }
  if (total <= 0) return null;
  let t = r * total;
  for (let i = 0; i < pool.length; i++) {
    t -= ws[i];
    if (t <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/** 통계 단일화(2026-06-24) — 스코어박스(엔진 box)를 **그대로** 통산 생산으로 집계. production이 자기 난수로
 *  재귀속하던 걸 폐기 → 관전 보드 = 스코어박스 = 통산/시즌/시상/연봉이 한 선수도 안 어긋난다(SALARY_SYSTEM 1.3).
 *  box 카테고리 → ProdLine: atkKill→spikes·blockPt→blocks·srvAce→aces·assist→assists·digSucc→digs·recvAtt→receives,
 *  points = atkKill+blockPt+srvAce(득점 사건). matches/garbage/subUse·backSpikes는 생산 고유 오버레이로 유지. */
function productionFromBox(
  sim: SimResult,
  home: Player[],
  away: Player[],
  seed: number,
  box: BoxSink,
  homeDv = 0,
  awayDv = 0,
): Map<string, ProdLine> {
  const H = splitLineup(home, homeDv);
  const A = splitLineup(away, awayDv);
  const gp = Math.round(sim.points.length * garbageFrac(sim));
  const tally = new Map<string, ProdLine>();
  const bump = (id: string, f: (l: ProdLine) => void) => {
    const l = tally.get(id) ?? emptyProd();
    f(l);
    tally.set(id, l);
  };
  // 스코어박스 그대로 집계 — 사건 단위 진실(비종결 디그·독립 카테고리 포함)
  for (const [id, l] of box) {
    bump(id, (p) => {
      p.spikes += l.atkKill;
      p.blocks += l.blockPt;
      p.aces += l.srvAce;
      p.assists += l.assist;
      p.digs += l.digSucc;
      p.receives += l.recvAtt;
      p.points += l.atkKill + l.blockPt + l.srvAce; // 득점 = 공격 성공(킬+블록아웃) + 스터프 + 에이스
    });
  }
  // 후위공격(backSpikes) 오버레이 — 박스는 백어택을 안 나누므로 OH/OP 스파이크에 BACK_ATK_RATE 적용(트리플크라운 전용).
  //   전용 backRng·id 정렬 순회로 결정론. box 미집계 = 0(스파이크 없는 선수).
  const backRng = createRng((seed ^ 0x517cc1b7) >>> 0);
  const posById = new Map<string, Position>([...home, ...away].map((p) => [p.id, p.position]));
  for (const id of [...tally.keys()].sort()) {
    const pos = posById.get(id);
    if (pos !== 'OH' && pos !== 'OP') continue;
    const sp = tally.get(id)!.spikes;
    for (let k = 0; k < sp; k++) if (backRng.next() < BACK_ATK_RATE) bump(id, (l) => { l.backSpikes++; });
  }
  // 출전(matches) — 통계가 아니라 참여 집계라 기존 로직 유지(선발 항상·벤치는 가비지·작전교체 코트타임)
  for (const p of [...H.starters, ...A.starters]) bump(p.id, (l) => { l.matches++; });
  if (gp > 0) for (const p of [...H.bench, ...A.bench]) bump(p.id, (l) => { l.matches++; });
  if (sim.subUse) for (const id in sim.subUse) bump(id, (l) => { l.matches += Math.min(1, sim.subUse![id] / 40); });
  return tally;
}

export function attributeProduction(
  sim: SimResult,
  home: Player[],
  away: Player[],
  seed: number,
  box?: BoxSink, // 주면 스코어박스를 **단일 진실**로 집계(보드=박스=통산 일치, SALARY_SYSTEM 1.3). 없으면 레거시 자체 귀속.
  homeDv = 0,    // 홈 감독 육성 철학(STAFF §9.6-D) — splitLineup U23 에지. 기본 0=neutral(byte-동일).
  awayDv = 0,
): Map<string, ProdLine> {
  if (box) return productionFromBox(sim, home, away, seed, box, homeDv, awayDv);
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  // 후위공격 판정용 독립 rng — 기존 귀속 스트림(rng) 불간섭 → spike/block/ace/assist/dig 귀속 불변, backSpikes만 가산
  const backRng = createRng((seed ^ 0x517cc1b7) >>> 0);
  const H = splitLineup(home, homeDv);
  const A = splitLineup(away, awayDv);
  const total = sim.points.length;
  const gp = Math.round(total * garbageFrac(sim));

  const tally = new Map<string, ProdLine>();
  const bump = (id: string, f: (l: ProdLine) => void) => {
    const l = tally.get(id) ?? emptyProd();
    f(l);
    tally.set(id, l);
  };

  // 서브권 추적(리시브 귀속용) — 세트 시작 서브팀 교대, 사이드아웃 시 교대(engine/match 규칙과 동일)
  let serving: 'home' | 'away' = 'home';
  let curSet = -1;

  sim.points.forEach((pt, i) => {
    const garbage = i >= total - gp;
    const offHome = pt.scorer === 'home';
    const offStart = offHome ? H.starters : A.starters;
    const offBench = offHome ? H.bench : A.bench;
    const defStart = offHome ? A.starters : H.starters;
    const defBench = offHome ? A.bench : H.bench;
    const off = garbage && offBench.length ? offBench : offStart;
    const def = garbage && defBench.length ? defBench : defStart;
    const roll = rng.next();

    // 서브 리시브 귀속: 세트 시작 서브팀 복원 → 받는 팀의 패서(리베로+OH)가 리시브. 서브범실은 리시브 없음.
    if (pt.setNo !== curSet) { curSet = pt.setNo; serving = sim.setFirstServers?.[pt.setNo - 1] ?? (pt.setNo % 2 === 1 ? 'home' : 'away'); }
    if (pt.how !== 'serveErr') {
      const recvHome = serving === 'away';
      const recvStart = recvHome ? H.starters : A.starters;
      const recvBench = recvHome ? H.bench : A.bench;
      const recv = garbage && recvBench.length ? recvBench : recvStart;
      const passer = pick(recv, (p) => RECV[p.position] * p.skReceive, rng.next());
      if (passer) bump(passer.id, (l) => { l.receives++; });
    }
    if (pt.scorer !== serving) serving = pt.scorer; // 사이드아웃 → 서브권 교대

    // 득점 유형 비율 = 밸런싱된 엔진 실측에 맞춤(공격킬+블록아웃 58% / 스터프 9% / 에이스 5.7% / 상대범실 27%, KOVO 정렬 2026-06)
    if (roll < 0.58) {
      const hitter = pick(off, (p) => ATTACK[p.position] * p.skSpike ** ATK_FOCUS, rng.next());
      if (hitter) {
        bump(hitter.id, (l) => { l.points++; l.spikes++; });
        // 후위공격(백어택) 귀속 — 백어택은 OH/OP만(MB 속공·S·L 제외). 엔진 백어택 ~18%/공격(측정),
        // OH/OP 킬에 BACK_ATK_RATE 적용 → OP(파이프)에 자연 집중. backSpikes ⊆ spikes. 트리플 크라운 전용.
        if ((hitter.position === 'OH' || hitter.position === 'OP') && backRng.next() < BACK_ATK_RATE)
          bump(hitter.id, (l) => { l.backSpikes++; });
      }
      const setter = pick(off, (p) => (p.position === 'S' ? p.skSet : 0), rng.next());
      if (setter) bump(setter.id, (l) => { l.assists++; });
      const digger = pick(def, (p) => DIG[p.position] * p.skDig, rng.next());
      if (digger) bump(digger.id, (l) => { l.digs++; });
    } else if (roll < 0.67) {
      const blocker = pick(off, (p) => BLOCK[p.position] * p.skBlock ** BLK_FOCUS, rng.next());
      if (blocker) bump(blocker.id, (l) => { l.points++; l.blocks++; });
    } else if (roll < 0.727) {
      const server = pick(off, (p) => SERVE[p.position] * p.skServe, rng.next());
      if (server) bump(server.id, (l) => { l.points++; l.aces++; });
    }
    // else: 상대 범실 — 무귀속
  });

  // 출전: 선발은 항상, 벤치는 가비지타임 있었을 때
  for (const p of [...H.starters, ...A.starters]) bump(p.id, (l) => { l.matches++; });
  if (gp > 0) for (const p of [...H.bench, ...A.bench]) bump(p.id, (l) => { l.matches++; });

  // 작전 교체 출전(핀치 서버·블로킹·수비 교체) → 코트타임 비례 경험 XP(1.3c). 풀세트≈한 경기.
  if (sim.subUse) {
    for (const id in sim.subUse) bump(id, (l) => { l.matches += Math.min(1, sim.subUse![id] / 40); });
  }

  return tally;
}
