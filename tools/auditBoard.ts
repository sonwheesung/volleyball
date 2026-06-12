// 보드 안무 자동 감사기 — 실제 경기를 프레임 단위(40ms)로 헤드리스 재생하며
// "손으로 짠 규칙"이 아니라 기하 원리로 어색한 장면을 탐지한다.
//
//   npx tsx tools/auditBoard.ts [경기수=6] [--dump]
//
// 렌더(MatchCourt)와 동일한 courtDirector.segmentTargets / courtPath.ballPath를 재생
// → 화면에 보이는 위치 = 검사하는 위치. 탐지 항목:
//   A 이동 속도(순간이동/비현실 질주)  B 네트 침범  C 코트 이탈
//   D 같은 팀 지속 겹침               E 리바운드 커버리지 홀(공격 시)
//   F 수비 빈 공간(상대 스파이크 순간)  G 디그 적합성(가까운 수비수가 가는가)
//   H 아웃볼 추격(추격자 필수 + 공 42px 내 도달)  I 유령터치(처리자가 공 옆에)
//   J 데드볼 재배치 금지                K 중계 공백(랠리당 최소 1줄)
//   L 토서 점유 금지(토스 중 토서 옆 주차)        M 퍼스트터치 배회 금지(터치 후 정지)
//   N 죽은 공 점유 금지(추격자가 공 위에 서기)    O 스터프 상승 금지(막힌 공은 안 떠오름)
//   P 공 전달 정합(서브 공은 볼보이=코트 밖 출발 또는 선수 픽업 — 휭 직행 금지)
// 기준 문서: docs/BOARD_RULES.md (사용자 주의사항 ↔ 룰 대응표). 새 주의사항은 문서에 먼저.
// 걸린 장면은 ASCII 코트로 덤프 → 사람 눈 없이도 직접 "보고" 진단 가능.

import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, SEG_DUR, markerTravelMs, type WP, type Lineups } from '../components/courtPath';
import { segmentTargets, reconstructRallies, type RallyState } from '../components/courtDirector';
import { commentLine } from '../components/courtCommentary';
import type { Side } from '../types';

const W = 360, H = 500, SERVE_OUT = 22;
const SPEED = 2;            // 렌더와 동일(2배 느림)
const DT = 40;              // 프레임 간격(ms)
const M_PER_PX = 9 / W;     // 코트 9m 기준 스케일
const NET_Y = 0.5 * H;

const log = (m: string) => process.stdout.write(m + '\n');
const dump = process.argv.includes('--dump');
const nMatches = Math.max(1, Number(process.argv.filter((a) => !a.startsWith('--'))[2]) || 6);

type Pt = { x: number; y: number };
type Key = string; // `${side}-${idx}`
interface Anim { from: Pt; to: Pt; t0: number; dur: number }

interface Issue { kind: string; detail: string; frame?: Record<Key, Pt>; ball?: Pt }
const issues: Issue[] = [];
const counts: Record<string, number> = {};
const flag = (kind: string, detail: string, frame?: Record<Key, Pt>, ball?: Pt) => {
  counts[kind] = (counts[kind] ?? 0) + 1;
  if (issues.length < 400) issues.push({ kind, detail, frame, ball });
};

// 통계(이상이 아니어도 리포트)
let maxSpeed = 0; let maxSpeedCtx = '';
const holeSamples: number[] = [];
const endings: Record<string, number> = {}; // 보드가 그리는 랠리 종결 유형 분포

const easeOut = (u: number) => 1 - (1 - u) * (1 - u); // Easing.out(quad)
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** ASCII 코트 덤프 — 25×19 그리드. 홈=대문자, 원정=소문자, 공=* */
function ascii(frame: Record<Key, Pt>, ball: Pt | undefined, L: Lineups): string[] {
  const COLS = 25, ROWS = 19;
  const grid: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill('·'));
  const netRow = Math.round((NET_Y / H) * (ROWS - 1));
  for (let c = 0; c < COLS; c++) grid[netRow][c] = '═';
  const put = (p: Pt, ch: string) => {
    const c = Math.max(0, Math.min(COLS - 1, Math.round((p.x / W) * (COLS - 1))));
    const r = Math.max(0, Math.min(ROWS - 1, Math.round((p.y / H) * (ROWS - 1))));
    grid[r][c] = ch;
  };
  for (const [key, p] of Object.entries(frame)) {
    const [side, iStr] = key.split('-');
    const i = Number(iStr);
    const lu = side === 'home' ? L.home : L.away;
    const ch = (lu.six[i]?.position ?? '?')[0];
    put(p, side === 'home' ? ch.toUpperCase() : ch.toLowerCase());
  }
  if (ball) put(ball, '*');
  return grid.map((row, r) => (r === netRow ? row.join('') + '  ← 네트' : row.join('')));
}

// ── 메인 재생 루프 ──
resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);
let totalRallies = 0, totalFrames = 0, commentTotal = 0;

for (let m = 0; m < nMatches; m++) {
  const hId = teams[m % teams.length];
  const aId = teams[(m + 1 + (m % (teams.length - 1))) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0);
  const aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 424242 + m * 7919;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  const rallies = reconstructRallies(sim);

  // 마커 상태(경기 내 연속 — 렌더와 동일하게 랠리를 넘어 이어짐)
  const cur: Record<Key, Pt> = {};
  const anim: Record<Key, Anim> = {};
  const overlapStreak: Record<string, number> = {};
  const lastTargets: Record<Key, Pt> = {};
  let prevLast: Pt | undefined;
  let tNow = 0;

  const posAt = (key: Key, t: number): Pt => {
    const a = anim[key];
    if (!a) return cur[key];
    const u = Math.max(0, Math.min(1, (t - a.t0) / a.dur));
    return lerp(a.from, a.to, easeOut(u));
  };

  for (let ri = 0; ri < rallies.length; ri++) {
    const r: RallyState = rallies[ri];
    totalRallies++;
    const path = ballPath(r, seed, L, W, H, SERVE_OUT, prevLast);
    prevLast = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prevLast;
    const stage = { serving: r.serving, homeRot: r.homeRot, awayRot: r.awayRot };
    // 종결 유형 = 엔진 기록(how) — 보드는 이를 사실대로 그린다(분포 = 엔진 분포 보장)
    {
      const KO: Record<string, string> = {
        kill: '킬', cap: '킬(랠리상한)', tip: '팁(페인트)', blockout: '블록아웃(터치아웃)', stuff: '스터프 블록', atkErr: '공격 범실',
        ace: '서브 에이스', serveErr: '서브 범실', recvErr: '리시브 범실', miscErr: '핸들링 범실', fault: '포지션 폴트',
      };
      const k = r.how ? (KO[r.how] ?? r.how) : '미기록(즉흥)';
      endings[k] = (endings[k] ?? 0) + 1;
    }
    const ctx = (extra: string) => `경기${m + 1}/랠리${ri + 1}(${r.setNo}세트 ${r.home}:${r.away}) ${extra}`;

    let commentCount = 0; // K) 중계 텍스트 커버리지 — 랠리당 최소 1줄
    // 퍼스트 터치(리시브/디그) 추적 — L(토서 점유 예외)·M(배회 금지)용
    let ft: { key: Key; pos: Pt; side: Side } | null = null;

    // P) 공 전달 정합: 새 랠리의 서브 공은 ①볼보이(코트 밖 사이드 출발) ②선수 픽업(무버가 공
    //    위치로) 중 하나여야 — 죽은 공이 혼자 코트를 가로질러 서버에게 날아오는 "휭 직행" 금지
    if (path[0]?.kind === 'start' && path[1]?.kind === 'return') {
      const pickup = path[1].movers?.[0];
      if (pickup) {
        if (dist({ x: pickup.x, y: pickup.y }, { x: path[0].x, y: path[0].y }) > 10)
          flag('P.공 전달(픽업 이탈)', ctx('줍는 선수가 공 위치로 가지 않음'));
      } else if (path[0].x >= 0 && path[0].x <= W) {
        flag('P.공 전달(유령 배달)', ctx(`새 공이 코트 안(${path[0].x.toFixed(0)},${path[0].y.toFixed(0)})에서 출발 — 볼보이는 사이드라인 밖`));
      }
    }
    for (let k = 0; k + 1 < path.length; k++) {
      const seg = { from: path[k], to: path[k + 1] };
      const to: WP = seg.to;
      if (commentLine(seg, r.how, L, stage)) commentCount++;
      const segDur = (to.dur ?? SEG_DUR[to.kind]) * SPEED;
      const targets = segmentTargets(seg, stage, L, W, H, SERVE_OUT, lastTargets);

      // 목표 변경 → 애니메이션 시작(렌더의 Animated.timing과 동일 모델)
      for (const [key, tgt] of Object.entries(targets)) {
        if (!cur[key]) { cur[key] = { ...tgt }; continue; }
        const prevTgt = anim[key]?.to ?? cur[key];
        if (Math.round(prevTgt.x) !== Math.round(tgt.x) || Math.round(prevTgt.y) !== Math.round(tgt.y)) {
          const fromP = posAt(key, tNow);
          anim[key] = { from: fromP, to: { ...tgt }, t0: tNow, dur: markerTravelMs(dist(fromP, tgt)) };
        }
      }

      // J) 데드볼 재배치 금지: 랠리가 죽은 구간(fault/bounce)에서 무버가 아닌 선수의
      //    목표가 직전 구간 대비 크게 바뀌면 안 됨(죽은 공에 공격 전환·스위칭 질주 — 사용자 발견 사례)
      if (to.kind === 'fault' || to.kind === 'bounce') {
        const moverKeys = new Set((to.movers ?? []).map((mv) => `${mv.side}-${mv.idx}`));
        for (const [key, tgt] of Object.entries(targets)) {
          if (moverKeys.has(key)) continue;
          const prevT = lastTargets[key];
          if (prevT && dist(prevT, tgt) > 30) flag('J.데드볼 재배치', ctx(`${key} 목표가 ${dist(prevT, tgt).toFixed(0)}px 점프(${to.kind})`));
        }
      }
      for (const [key, tgt] of Object.entries(targets)) lastTargets[key] = tgt;

      // H) 아웃볼 추격: 추격자가 "존재"하는 걸로는 부족 — 최소 1명은 공 낙하점까지 실제 도달해야
      //    (reach<1이면 선 안쪽에서 멈춰 어색 — 사용자 발견 사례를 상설 규칙화)
      if (to.kind === 'fault') {
        const out = to.x < 0 || to.x > W || to.y < 0 || to.y > H;
        if (out) {
          if (!(to.movers && to.movers.length)) flag('H.아웃볼 무추격', ctx(`fault → (${to.x.toFixed(0)},${to.y.toFixed(0)}) 추격자 0명`));
          else {
            const nearest = Math.min(...to.movers.map((mv) => dist({ x: mv.x, y: mv.y }, { x: to.x, y: to.y })));
            if (nearest > 42) flag('H.추격 미달(선에서 멈춤)', ctx(`fault 공까지 최근접 목표 ${(nearest * M_PER_PX).toFixed(1)}m`));
          }
        }
      }

      // L) 토서 점유 금지: 토스 구간에 토서(공이 올라간 지점=seg.from) 22px 안으로 들어오는
      //    같은 팀 무버 금지 — 공격수(타점행)·퍼스트 터치 정지는 예외. (구 미끼 런이 토서 위에
      //    포개지던 사용자 보고 3회를 상설 규칙화 — 재발 시 여기서 잡힌다)
      if (to.kind === 'toss' && to.movers) {
        for (const mv of to.movers) {
          if (mv.side !== to.side || mv.idx === to.idx) continue;
          if (ft && `${mv.side}-${mv.idx}` === ft.key) continue;
          const d = dist({ x: mv.x, y: mv.y }, { x: seg.from.x, y: seg.from.y });
          if (d < 22) flag('L.토서 점유', ctx(`${mv.side}-${mv.idx} 목표가 토서에서 ${d.toFixed(0)}px`));
        }
      }

      // M) 퍼스트터치 배회 금지: 리시브/디그한 선수는 그 공격이 끝날 때까지 터치 지점에 정지
      //    (자세 회복) — 패스/토스 중 대형 복귀·커버 합류로 어슬렁거리면 위반
      if (ft && (to.kind === 'pass' || to.kind === 'toss') && to.side === ft.side && `${to.side}-${to.idx}` !== ft.key) {
        const tgt = targets[ft.key];
        if (tgt && dist(tgt, ft.pos) > 18) flag('M.퍼스트터치 배회', ctx(`${ft.key} 목표가 터치 지점에서 ${dist(tgt, ft.pos).toFixed(0)}px 이탈(${to.kind})`));
      }

      // N) 죽은 공 점유 금지: 추격자는 공 가까이 가되(룰 H) 공 13px 안에 서면 안 된다 —
      //    닿는 거리에 도달했으면 잡았어야 한다(블록아웃 오버런 사용자 보고를 상설 규칙화)
      if (to.kind === 'fault' && to.movers) {
        for (const mv of to.movers) {
          const d = dist({ x: mv.x, y: mv.y }, { x: to.x, y: to.y });
          if (d < 13) flag('N.죽은 공 점유', ctx(`${mv.side}-${mv.idx} 추격 목표가 공에서 ${d.toFixed(0)}px — 닿는 거리면 잡았어야`));
        }
      }

      // O) 스터프 상승 금지: 블록에 막힌 공은 떠오를 수 없다 — 낙하 WP의 포물선은 0이어야
      if (r.how === 'stuff' && to.kind === 'fault' && (to.arc === undefined || to.arc > 0.02 * H)) {
        flag('O.스터프 상승', ctx(`막힌 공 arc=${to.arc === undefined ? '기본값(상승 포물선)' : to.arc.toFixed(0) + 'px'}`));
      }

      // 퍼스트 터치 추적: 서브/패스 도착 후 같은 팀 패스가 이어지면 이 도착의 처리자가 첫 터치
      // (서브 리시브·원터치 디그 — 원터치 디그 WP는 idx -1이라 무버에서 디거를 읽는다).
      // 클린/팁 디그는 spike 블록(룰 G 자리)에서 무버로 추적.
      if ((to.kind === 'serve' || to.kind === 'pass') && !to.hold
          && path[k + 2] && path[k + 2].kind === 'pass' && path[k + 2].side === to.side) {
        const h = to.idx >= 0 ? { idx: to.idx, x: to.x, y: to.y }
          : (() => { const mv = to.movers?.find((v) => v.side === to.side); return mv ? { idx: mv.idx, x: mv.x, y: mv.y } : null; })();
        if (h) ft = { key: `${to.side}-${h.idx}`, pos: { x: h.x, y: h.y }, side: to.side };
      }
      if (to.kind === 'fault') ft = null;

      // 프레임 스텝
      const steps = Math.max(1, Math.round(segDur / DT));
      for (let s = 1; s <= steps; s++) {
        const t = tNow + s * DT;
        totalFrames++;
        const frame: Record<Key, Pt> = {};
        for (const key of Object.keys(cur)) frame[key] = posAt(key, t);
        const ballT = easeOut(s / steps);
        const ball = lerp({ x: seg.from.x, y: seg.from.y }, { x: to.x, y: to.y }, ballT);

        for (const [key, p] of Object.entries(frame)) {
          const prev = posAt(key, t - DT);
          // A) 속도
          const v = (dist(prev, p) / DT) * 1000 * M_PER_PX; // m/s
          if (v > maxSpeed) { maxSpeed = v; maxSpeedCtx = ctx(`${key} ${to.kind}`); }
          if (v > 14) flag('A.과속(>14m/s)', ctx(`${key} ${v.toFixed(1)}m/s (${to.kind})`), frame, ball);
          // B) 네트 침범
          const side = key.startsWith('home') ? 'home' : 'away';
          if (side === 'home' ? p.y < NET_Y - 8 : p.y > NET_Y + 8) flag('B.네트침범', ctx(`${key} y=${p.y.toFixed(0)}`), frame, ball);
          // C) 코트 이탈(서브 공간·추격 마진 허용)
          if (p.x < -28 || p.x > W + 28 || p.y < -SERVE_OUT - 24 || p.y > H + SERVE_OUT + 24) flag('C.코트이탈', ctx(`${key} (${p.x.toFixed(0)},${p.y.toFixed(0)})`), frame, ball);
        }
        // D) 같은 팀 지속 겹침 — 인플레이만(랠리 간 리셋의 스침 제외), 160ms 지속
        const inPlaySeg = to.kind === 'serve' || to.kind === 'pass' || to.kind === 'toss' || to.kind === 'spike' || to.kind === 'fault';
        if (inPlaySeg) for (const side of ['home', 'away'] as Side[]) {
          for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) {
            const pk = `${side}-${a}|${side}-${b}`;
            const d = dist(frame[`${side}-${a}`], frame[`${side}-${b}`]);
            // separateTargets가 목표 간 MIN_SEP(20px)을 보장하므로 면제 없음 —
            // 지나치며 스치는 것만 정상(둘 다 거의 정지(<0.8m/s)한 채 포개진 것이 위반)
            const vA = (dist(posAt(`${side}-${a}`, t - DT), frame[`${side}-${a}`]) / DT) * 1000 * M_PER_PX;
            const vB = (dist(posAt(`${side}-${b}`, t - DT), frame[`${side}-${b}`]) / DT) * 1000 * M_PER_PX;
            const parked = vA < 0.8 && vB < 0.8;
            overlapStreak[pk] = (parked && d < 16) ? (overlapStreak[pk] ?? 0) + 1 : 0;
            if (overlapStreak[pk] === 4) flag('D.지속겹침', ctx(`${side}-${a}↔${side}-${b} ${d.toFixed(0)}px`), frame, ball);
          }
        }
      }
      tNow += segDur;

      // 구간 종료 시점 이벤트 검사
      const endFrame: Record<Key, Pt> = {};
      for (const key of Object.keys(cur)) endFrame[key] = posAt(key, tNow);
      for (const key of Object.keys(cur)) cur[key] = endFrame[key];

      // I) 터치 정합성: 서브/패스/토스 도착 시 지정 처리자가 공 옆에 있어야(유령 터치 방지)
      if ((to.kind === 'serve' || to.kind === 'pass' || to.kind === 'toss') && to.idx >= 0) {
        const handler = endFrame[`${to.side}-${to.idx}`];
        if (handler) {
          const gap = dist(handler, { x: to.x, y: to.y });
          if (gap > 38) flag('I.유령터치', ctx(`${to.kind} 처리자 ${to.side}-${to.idx}가 공에서 ${(gap * M_PER_PX).toFixed(1)}m`), endFrame, { x: to.x, y: to.y });
        }
      }

      if (to.kind === 'spike') {
        const att = path[k].side; // 토스 WP의 사이드 = 공격팀
        const def: Side = att === 'home' ? 'away' : 'home';
        const hit = { x: seg.from.x, y: seg.from.y };
        // E) 리바운드 커버리지: 네트~타점 사이 구역의 모든 표본점이 공격팀 누군가의 64px 안
        const dir = att === 'home' ? 1 : -1;
        const yFrom = NET_Y + dir * 0.06 * H;
        const span = Math.abs(hit.y - yFrom);
        if (span > 0.04 * H) {
          for (let sy = 0; sy <= 1; sy += 0.5) {
            for (const dx of [-0.08 * W, 0, 0.08 * W]) {
              const pt = { x: Math.max(15, Math.min(W - 15, hit.x + dx)), y: yFrom + dir * span * sy };
              let best = 1e9;
              for (let i = 0; i < 6; i++) best = Math.min(best, dist(endFrame[`${att}-${i}`], pt));
              if (best > 66) { flag('E.리바운드홀', ctx(`(${pt.x.toFixed(0)},${pt.y.toFixed(0)}) 최근접 ${(best * M_PER_PX).toFixed(1)}m`), endFrame, hit); break; }
            }
          }
        }
        // F) 수비 빈 공간(상대 코트 커버리지)
        let worst = 0;
        for (let gx = 0.14; gx <= 0.86; gx += 0.18) {
          for (let gy = 0.16; gy <= 0.42; gy += 0.13) {
            const pt = { x: gx * W, y: def === 'home' ? (0.5 + gy) * H : (0.5 - gy) * H };
            let best = 1e9;
            for (let i = 0; i < 6; i++) best = Math.min(best, dist(endFrame[`${def}-${i}`], pt));
            worst = Math.max(worst, best);
          }
        }
        holeSamples.push(worst * M_PER_PX);
        if (worst * M_PER_PX > 3.4) flag('F.수비홀', ctx(`최대 빈 공간 ${(worst * M_PER_PX).toFixed(1)}m`), endFrame, hit);
        // G) 디그 적합성: 디그 무버가 그 순간 수비 후위 3명 중 가까운 축인가
        const digMover = to.movers?.find((mv) => mv.side === def);
        if (digMover && path[k + 2] && path[k + 2].kind === 'pass') {
          const land = { x: to.x, y: to.y };
          const backs = [0, 1, 2, 3, 4, 5].map((i) => ({ i, d: dist(endFrame[`${def}-${i}`], land) })).sort((a, b) => a.d - b.d);
          const rank = backs.findIndex((b) => b.i === digMover.idx);
          if (rank > 3) flag('G.디그부적합', ctx(`디거 ${def}-${digMover.idx}가 ${rank + 1}번째로 먼 선수`), endFrame, land);
        }
        // 퍼스트 터치 추적(클린/팁 디그): 공수 전환 — 디거가 새 공격의 첫 터치(무버 목표 = 밀린 지점 포함)
        ft = digMover && path[k + 2] && path[k + 2].kind === 'pass'
          ? { key: `${def}-${digMover.idx}`, pos: { x: digMover.x, y: digMover.y }, side: def }
          : null;
      }
    }
    // K) 중계 커버리지 — 이름이 들어간 사실 라인이 한 줄도 없는 랠리는 "조용한 중계"
    commentTotal += commentCount;
    if (commentCount === 0) flag('K.중계공백', ctx('중계 라인 0줄'));
  }
}

// ── 리포트 ──
log(`\n═══ 보드 안무 자동 감사 — ${nMatches}경기 / ${totalRallies.toLocaleString()}랠리 / ${totalFrames.toLocaleString()}프레임(40ms) ═══`);
log(`최고 이동 속도 ${maxSpeed.toFixed(1)} m/s (${maxSpeedCtx})`);
{
  const tot = Object.values(endings).reduce((a, b) => a + b, 0) || 1;
  const setsApprox = totalRallies / 44; // 세트당 ~44랠리
  log('랠리 종결 연출 분포: ' + Object.entries(endings).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${((n / tot) * 100).toFixed(1)}%(세트당 ${(n / setsApprox).toFixed(1)}회)`).join(' · '));
}
if (holeSamples.length) {
  const sorted = holeSamples.slice().sort((a, b) => a - b);
  log(`수비 빈 공간: 중앙값 ${sorted[Math.floor(sorted.length / 2)].toFixed(1)}m · p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}m · 최대 ${sorted[sorted.length - 1].toFixed(1)}m`);
}
log(`중계 텍스트: 랠리당 평균 ${(commentTotal / Math.max(1, totalRallies)).toFixed(1)}줄`);
const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (total === 0) {
  log(`\n✅ 이상 장면 0건 — 워프·네트침범·코트이탈·지속겹침·리바운드홀·수비홀·디그부적합·아웃볼무추격·유령터치·토서점유·퍼스트터치배회·죽은공점유·스터프상승·공전달 모두 통과 (기준: docs/BOARD_RULES.md)`);
} else {
  log(`\n❌ 이상 ${total}건:`);
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) log(`  ${k}: ${n}건`);
  log('');
  const shown = new Set<string>();
  for (const iss of issues) {
    if (shown.has(iss.kind)) continue;
    shown.add(iss.kind);
    log(`── [${iss.kind}] ${iss.detail} ──`);
    if ((dump || shown.size <= 3) && iss.frame) {
      // 첫 경기의 라인업으로 ASCII (포지션 문자 표시용 — 마커 위치는 정확)
      const hPs = getEvolvedTeamPlayers(teams[0], 0);
      const aPs = getEvolvedTeamPlayers(teams[1], 0);
      for (const line of ascii(iss.frame, iss.ball, { home: buildLineup(hPs), away: buildLineup(aPs) })) log('  ' + line);
    }
  }
}
