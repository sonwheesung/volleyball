// 웹 수비 위치 실험실 — app/board-lab.tsx 의 계산을 브라우저로 옮긴 것.
// 실제 경기를 시뮬해 "한 스텝(공 이동 구간)"마다 멈추고, 그 순간 양 팀 12명 위치를 드래그로 고친 뒤
// 좌표(base=코드값 · now=옮긴값 · Δ)를 텍스트로 내보내 채팅에 붙여넣는다.
// ⚠ 엔진 미반영(제안 전용) — board-lab.tsx 와 동일 원칙. 위치 계산은 실제 보드와 같은 ballPath+segmentTargets.
import { resetLeagueBase, LEAGUE, coachInfoOf, shortTeamName } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { displayPos, playerAtZone, zonePx, type Lineup, type Px } from '../components/courtLayout';
import { segmentTargets, reconstructRallies, applySubsToSix, offenseSideOf } from '../components/courtDirector';
import { ballPath, type Move, type Lineups } from '../components/courtPath';
import { POS_COLOR } from '../components/posTokens';
import type { Player, Position, Side } from '../types';

resetLeagueBase();

const W = 400, H = 560, SERVE_OUT = 22, R = 15, RW = R + 5;
const DAY = 0; // 프리시즌 기준(부상 없음·풀 로스터)
const SERVE_RING = '#F2722C', FRONT_RING = '#F2A93B';
const KIND_KO: Record<Move, string> = {
  start: '시작', return: '복귀', walk: '서브대기', serve: '서브', pass: '리시브',
  toss: '토스(세트)', spike: '스파이크', fault: '범실', bounce: '바운드',
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const sgn = (n: number) => (n >= 0 ? `+${n.toFixed(3)}` : n.toFixed(3));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isBackZone = (z: number) => z === 1 || z === 5 || z === 6;
const NS = 'http://www.w3.org/2000/svg';

interface LabMarker {
  key: string; side: Side; name: string; pos: Position; zone: number;
  front: boolean; server: boolean; baseFx: number; baseFy: number; x: number; y: number;
}

// ── 상태 ──
const teams = LEAGUE.teams;
const state = {
  homeId: teams[0].id,
  awayId: (teams.find((t) => t.id !== teams[0].id) ?? teams[0]).id,
  seed: 1,
  idx: 0,       // 랠리
  segIdx: 0,    // 랠리 내 구간(스텝)
  showMoves: true,
  showNames: true, // 마커에 선수 이름 라벨 표시
  overrides: new Map<string, { x: number; y: number }>(), // 드래그로 옮긴 좌표(key→px)
};

// ── 시뮬 캐시(팀/시드 의존) ──
let sim: ReturnType<typeof simulateMatch>;
let hs: Player[], as: Player[];
let rallies: ReturnType<typeof reconstructRallies>;
let total = 0;
let baseLineups: Lineups;
let byId: Map<string, Player>;

function recompute(): void {
  hs = availableTeamPlayers(state.homeId, DAY);
  as = availableTeamPlayers(state.awayId, DAY);
  sim = simulateMatch(state.seed, hs, as, { home: coachInfoOf(state.homeId), away: coachInfoOf(state.awayId) });
  rallies = reconstructRallies(sim);
  total = rallies.length;
  baseLineups = { home: buildLineup(hs), away: buildLineup(as) };
  byId = new Map<string, Player>();
  for (const p of hs) byId.set(p.id, p);
  for (const p of as) byId.set(p.id, p);
  state.idx = 0; state.segIdx = 0; state.overrides.clear();
}

const effLineupsAt = (rallyIdx: number): Lineups => ({
  home: { ...baseLineups.home, six: applySubsToSix(baseLineups.home.six, 'home', sim.subEvents, rallyIdx, byId) },
  away: { ...baseLineups.away, six: applySubsToSix(baseLineups.away.six, 'away', sim.subEvents, rallyIdx, byId) },
});

// 한 스텝의 전체 상태(보드와 동일 계산) — base 마커 좌표 포함.
function computeStep(i0: number, sIdx: number) {
  const i = Math.min(i0, total - 1);
  const rally = rallies[i];
  const lineups = effLineupsAt(i);
  let prevLast: Px | undefined;
  if (i > 0) {
    const pp = ballPath(rallies[i - 1], state.seed, effLineupsAt(i - 1), W, H, SERVE_OUT);
    const w = pp[pp.length - 1];
    prevLast = { x: w.x, y: w.y };
  }
  const path = ballPath(rally, state.seed, lineups, W, H, SERVE_OUT, prevLast);
  const segCount = Math.max(0, path.length - 1);
  const sc = clamp(sIdx, 0, Math.max(0, segCount - 1));
  const seg = segCount > 0 ? { from: path[sc], to: path[sc + 1] } : null;
  const stage = { serving: rally.serving, homeRot: rally.homeRot, awayRot: rally.awayRot };
  const prevT = seg && sc > 0 ? segmentTargets({ from: path[sc - 1], to: path[sc] }, stage, lineups, W, H, SERVE_OUT) : undefined;
  const targets = segmentTargets(seg, stage, lineups, W, H, SERVE_OUT, prevT);

  const sideMarkers = (side: Side): LabMarker[] => {
    const rot = side === 'home' ? stage.homeRot : stage.awayRot;
    const lu: Lineup = side === 'home' ? lineups.home : lineups.away;
    return [0, 1, 2, 3, 4, 5].map((k) => {
      const zone = ((k - rot) % 6 + 6) % 6 + 1;
      const isServer = stage.serving === side && zone === 1;
      const p = isServer ? lu.six[k] : playerAtZone(lu, rot, zone);
      const pos: Position = isServer ? (p?.position ?? 'OH') : displayPos(lu, rot, k);
      const t = targets[`${side}-${k}`] ?? zonePx(side, zone, W, H);
      return {
        key: `${side}-${k}`, side, name: p?.name ?? '?', pos, zone,
        front: !isBackZone(zone), server: isServer,
        baseFx: r3(t.x / W), baseFy: r3(t.y / H), x: t.x, y: t.y,
      };
    });
  };
  const ball = seg ? { fromX: seg.from.x, fromY: seg.from.y, toX: seg.to.x, toY: seg.to.y } : null;
  return {
    segCount, sc, kind: seg ? seg.to.kind : null, offSide: offenseSideOf(seg), ball,
    serving: stage.serving, rally, markersBase: [...sideMarkers('home'), ...sideMarkers('away')],
  };
}

type Step = ReturnType<typeof computeStep>;

// 옮긴 좌표(override)를 입힌 현재 마커들
function currentMarkers(step: Step): LabMarker[] {
  return step.markersBase.map((m) => {
    const o = state.overrides.get(m.key);
    return o ? { ...m, x: o.x, y: o.y } : m;
  });
}
const isMoved = (m: LabMarker) => Math.abs(m.x - m.baseFx * W) > 0.5 || Math.abs(m.y - m.baseFy * H) > 0.5;

// ── 내보내기 텍스트(board-lab.tsx onSave 와 동일 포맷) ──
function exportText(step: Step, markers: LabMarker[]): string {
  const r = step.rally;
  const preH = r.home - (r.scorer === 'home' ? 1 : 0);
  const preA = r.away - (r.scorer === 'away' ? 1 : 0);
  const sideKo = (s: Side | null) => (s === 'home' ? '홈' : s === 'away' ? '원정' : '-');
  const head =
    `[보드 실험실·웹] 경기 ${shortTeamName(state.homeId)}(홈) vs ${shortTeamName(state.awayId)}(원정) · seed ${state.seed}\n` +
    `상황: ${situationOf(step, markers)}\n` +
    `랠리 ${state.idx + 1}/${total} · 세트${r.setNo} (${preH}:${preA}) · 스텝 ${step.sc + 1}/${Math.max(1, step.segCount)} · ` +
    `구간=${step.kind ? KIND_KO[step.kind] : '-'} · 서브=${sideKo(step.serving)} · 공격=${sideKo(step.offSide)}` +
    (step.ball ? ` · 공[${r3(step.ball.toX / W).toFixed(3)},${r3(step.ball.toY / H).toFixed(3)}]` : '') + '\n' +
    `좌표=화면분수 x(0좌→1우)·y(0상단=원정 / 1하단=홈 엔드라인), 네트=0.500. 전위=✦ 서버=⚑`;
  const role = (m: LabMarker) => (m.server ? '⚑' : m.front ? '✦' : ' ');
  const fmt = (m: LabMarker) => {
    const fx = r3(m.x / W), fy = r3(m.y / H);
    const dx = r3(fx - m.baseFx), dy = r3(fy - m.baseFy);
    const moved = Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001;
    const tag = (`${role(m)}${m.pos} z${m.zone} ${m.name}` + '              ').slice(0, 16);
    return `  ${moved ? '✎' : ' '} ${tag} base[${m.baseFx.toFixed(3)},${m.baseFy.toFixed(3)}] now[${fx.toFixed(3)},${fy.toFixed(3)}] Δ[${sgn(dx)},${sgn(dy)}]`;
  };
  const changed = markers.filter(isMoved);
  const summary = changed.length
    ? `■ 수정 ${changed.length}건: ` + changed.map((m) => `${m.side === 'home' ? '홈' : '원정'} ${m.pos} z${m.zone} ${m.name}`).join(', ')
    : '■ 수정 없음 — 드래그한 선수가 없습니다(이 스텝은 코드 위치 그대로).';
  const home = markers.filter((m) => m.side === 'home');
  const away = markers.filter((m) => m.side === 'away');
  return [head, summary, ` [홈 ${shortTeamName(state.homeId)}]`, ...home.map(fmt), ` [원정 ${shortTeamName(state.awayId)}]`, ...away.map(fmt)].join('\n');
}

function situationOf(step: Step, markers: LabMarker[]): string {
  const teamKo = (s: Side) => shortTeamName(s === 'home' ? state.homeId : state.awayId);
  const serverName = markers.find((m) => m.server)?.name ?? '';
  switch (step.kind) {
    case 'walk':
    case 'serve': return `${teamKo(step.serving)} 서브 — ${serverName}. 상대는 리시브 대형.`;
    case 'pass': return '리시브/디그 — 공을 세터에게 올리는 중.';
    case 'toss': return `${step.offSide ? teamKo(step.offSide) + ' ' : ''}세트(토스) — 상대 블로커 형성.`;
    case 'spike': return `${step.offSide ? teamKo(step.offSide) + ' ' : ''}스파이크 — 상대 블록·수비.`;
    case 'fault': return '범실 — 데드볼.';
    case 'bounce': return '공 낙구 — 랠리 종료.';
    default: return '대형 정리 중.';
  }
}

// ── 렌더 ──
const $ = (id: string) => document.getElementById(id)!;

function render(): void {
  const step = computeStep(state.idx, state.segIdx);
  const markers = currentMarkers(step);
  const r = step.rally;
  const preH = r.home - (r.scorer === 'home' ? 1 : 0);
  const preA = r.away - (r.scorer === 'away' ? 1 : 0);
  const segCount = Math.max(1, step.segCount);
  const movedCount = markers.filter(isMoved).length;
  const frontOf = (s: Side) => markers.filter((m) => m.side === s && m.front).map((m) => `${m.pos} ${m.name}`).join(' · ') || '-';
  const server = markers.find((m) => m.server);

  $('situation').textContent = '🏐 ' + situationOf(step, markers);
  $('counters').innerHTML =
    `랠리 <b>${state.idx + 1}/${total}</b> · 세트${r.setNo} (${preH}:${preA}) · 스텝 <b style="color:var(--accent)">${step.sc + 1}/${segCount}</b> · ` +
    `구간 <b>${step.kind ? KIND_KO[step.kind] : '-'}</b>${step.offSide ? ` · 공격 ${step.offSide === 'home' ? '홈' : '원정'}` : ''}`;
  $('roles').innerHTML =
    `<span style="color:${SERVE_RING};font-weight:800">서브</span> ${server ? `${server.side === 'home' ? '홈' : '원정'} ${server.pos} ${server.name}` : '— (인플레이)'}` +
    ` &nbsp;·&nbsp; <span style="color:${FRONT_RING};font-weight:800">전위</span> 홈 ${frontOf('home')} / 원정 ${frontOf('away')}`;
  $('movedline').innerHTML =
    `이 스텝에서 옮긴 선수: <b style="color:${movedCount ? 'var(--accent)' : 'var(--soft)'}">${movedCount}명</b>` +
    (movedCount ? ` — ${markers.filter(isMoved).map((m) => `${m.side === 'home' ? '홈' : '원'} ${m.pos}`).join(', ')}` : '');

  $('lineup').innerHTML = lineupHtml(markers);
  drawCourt(step, markers);
}

// 위/아래 코트 + 전위/후위별 선수 명단(이름) — 좌→우 순서로 코트와 같게. ⚑=서브 ✎=옮김.
function lineupHtml(markers: LabMarker[]): string {
  const fmt = (m: LabMarker) => {
    const col = POS_COLOR[m.pos] ?? '#8A94A6';
    const tag = `${m.server ? '⚑' : ''}${isMoved(m) ? '✎' : ''}`;
    return `<span class="pl"><b style="color:${col}">${m.pos}</b> ${m.name}${tag ? `<span class="tg">${tag}</span>` : ''}</span>`;
  };
  const grp = (side: Side, label: string, team: string) => {
    const ms = markers.filter((m) => m.side === side).slice().sort((a, b) => a.x - b.x);
    const front = ms.filter((m) => m.front).map(fmt).join('<i class="sep">·</i>') || '<span class="pl" style="color:var(--soft)">-</span>';
    const back = ms.filter((m) => !m.front).map(fmt).join('<i class="sep">·</i>') || '<span class="pl" style="color:var(--soft)">-</span>';
    return `<div class="cgrp"><div class="ch">${label} <span class="tn">${team}</span></div>` +
      `<div class="ln"><span class="rl front">전위</span>${front}</div>` +
      `<div class="ln"><span class="rl back">후위</span>${back}</div></div>`;
  };
  return grp('away', '▲ 위 코트 (원정)', shortTeamName(state.awayId)) + grp('home', '▼ 아래 코트 (홈)', shortTeamName(state.homeId));
}

// 다음 스텝(이동 화살표용)
function nextStepOf(step: Step): Step | null {
  if (state.segIdx < step.segCount - 1) return computeStep(state.idx, state.segIdx + 1);
  if (state.idx < total - 1) return computeStep(state.idx + 1, 0);
  return null;
}

function drawCourt(step: Step, markers: LabMarker[]): void {
  const svg = $('court') as unknown as SVGSVGElement;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const rect = (x: number, y: number, w: number, h: number, fill: string) => {
    const e = document.createElementNS(NS, 'rect');
    e.setAttribute('x', `${x}`); e.setAttribute('y', `${y}`); e.setAttribute('width', `${w}`); e.setAttribute('height', `${h}`); e.setAttribute('fill', fill);
    svg.appendChild(e);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, w = 1, dash?: string) => {
    const e = document.createElementNS(NS, 'line');
    e.setAttribute('x1', `${x1}`); e.setAttribute('y1', `${y1}`); e.setAttribute('x2', `${x2}`); e.setAttribute('y2', `${y2}`);
    e.setAttribute('stroke', stroke); e.setAttribute('stroke-width', `${w}`); if (dash) e.setAttribute('stroke-dasharray', dash);
    svg.appendChild(e);
  };
  const circle = (cx: number, cy: number, rr: number, fill: string, stroke?: string, sw = 0) => {
    const e = document.createElementNS(NS, 'circle');
    e.setAttribute('cx', `${cx}`); e.setAttribute('cy', `${cy}`); e.setAttribute('r', `${rr}`); e.setAttribute('fill', fill);
    if (stroke) { e.setAttribute('stroke', stroke); e.setAttribute('stroke-width', `${sw}`); }
    svg.appendChild(e); return e;
  };

  // 코트 바닥·라인
  rect(0, 0, W, H, '#EBE0C8');
  line(0, H * 0.5, W, H * 0.5, '#15202B', 2);   // 네트
  line(0, H * 0.333, W, H * 0.333, '#C9B98E', 1); // 공격선(원정)
  line(0, H * 0.667, W, H * 0.667, '#C9B98E', 1); // 공격선(홈)

  // 이동 화살표(같은 랠리 다음 구간일 때만)
  const sameRallyNext = state.segIdx < step.segCount - 1;
  if (state.showMoves && sameRallyNext) {
    const next = nextStepOf(step);
    const nextMap = new Map((next?.markersBase ?? []).map((m) => [m.key, m] as const));
    for (const m of step.markersBase) {
      const n = nextMap.get(m.key);
      if (!n || Math.hypot(n.x - m.x, n.y - m.y) < 10) continue;
      const col = m.side === 'home' ? '#0E9C8C' : '#FF6B5A';
      line(m.x, m.y, n.x, n.y, col, 2, undefined);
      const ah = document.createElementNS(NS, 'polygon');
      ah.setAttribute('points', arrowHead(m.x, m.y, n.x, n.y)); ah.setAttribute('fill', col); ah.setAttribute('opacity', '0.85');
      svg.appendChild(ah);
    }
  }

  // 공 경로
  if (step.ball) {
    line(step.ball.fromX, step.ball.fromY, step.ball.toX, step.ball.toY, '#E0A21B', 2, '5,5');
    circle(step.ball.fromX, step.ball.fromY, 4, 'none', '#E0A21B', 2);
    circle(step.ball.toX, step.ball.toY, 9, '#FFD23F', '#15202B', 2);
  }

  // 마커(드래그 가능)
  for (const m of markers) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', `translate(${m.x},${m.y})`);
    g.style.cursor = 'grab';
    (g as any).dataset.key = m.key;
    const color = POS_COLOR[m.pos] ?? '#8A94A6';
    const home = m.side === 'home';
    const ring = m.server ? SERVE_RING : m.front ? FRONT_RING : null;
    if (ring) {
      const ce = document.createElementNS(NS, 'circle');
      ce.setAttribute('r', `${RW}`); ce.setAttribute('fill', 'none'); ce.setAttribute('stroke', ring); ce.setAttribute('stroke-width', '2.5');
      g.appendChild(ce);
    }
    const body = document.createElementNS(NS, 'circle');
    body.setAttribute('r', `${R}`); body.setAttribute('fill', home ? color : '#FFFFFF');
    body.setAttribute('stroke', home ? '#FFFFFF' : color); body.setAttribute('stroke-width', '2');
    g.appendChild(body);
    const tx = document.createElementNS(NS, 'text');
    tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('dy', '3.5'); tx.setAttribute('font-size', '10'); tx.setAttribute('font-weight', '900');
    tx.setAttribute('fill', home ? '#FFFFFF' : color); tx.textContent = m.pos;
    g.appendChild(tx);
    if (isMoved(m)) {
      const d = document.createElementNS(NS, 'circle');
      d.setAttribute('cx', `${R - 2}`); d.setAttribute('cy', `${-(R - 2)}`); d.setAttribute('r', '3.5'); d.setAttribute('fill', '#15202B');
      g.appendChild(d);
    }
    // 선수 이름 라벨 — 홈(아래)은 원 위, 원정(위)은 원 아래(코트 안쪽=네트 쪽으로 두어 가장자리 잘림 방지).
    // 흰 테두리(paint-order)로 코트·마커 어디서나 읽히게.
    if (state.showNames) {
      const nm = document.createElementNS(NS, 'text');
      nm.setAttribute('text-anchor', 'middle');
      nm.setAttribute('y', `${home ? -(RW + 4) : RW + 12}`);
      nm.setAttribute('font-size', '10.5');
      nm.setAttribute('font-weight', '700');
      nm.setAttribute('fill', '#15202B');
      nm.setAttribute('stroke', '#FFFFFF');
      nm.setAttribute('stroke-width', '3');
      nm.setAttribute('paint-order', 'stroke');
      nm.textContent = m.name;
      g.appendChild(nm);
    }
    attachDrag(g, svg, m.key);
    svg.appendChild(g);
  }
}

function arrowHead(fx: number, fy: number, tx: number, ty: number): string {
  const ux = tx - fx, uy = ty - fy; const len = Math.hypot(ux, uy) || 1;
  const nx = ux / len, ny = uy / len; const px = -ny, py = nx;
  const hb = 9, hw = 5;
  const bx = tx - nx * hb, by = ty - ny * hb;
  return `${tx},${ty} ${bx + px * hw},${by + py * hw} ${bx - px * hw},${by - py * hw}`;
}

// SVG 좌표 변환(화면 px → 코트 px, CSS 스케일 보정)
function toCourt(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const r = svg.getBoundingClientRect();
  const sx = W / r.width, sy = H / r.height;
  return { x: clamp((clientX - r.left) * sx, 0, W), y: clamp((clientY - r.top) * sy, 0, H) };
}

function attachDrag(g: SVGGElement, svg: SVGSVGElement, key: string): void {
  let dragging = false;
  g.addEventListener('pointerdown', (e) => {
    dragging = true; g.style.cursor = 'grabbing';
    (e.target as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  g.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = toCourt(svg, e.clientX, e.clientY);
    g.setAttribute('transform', `translate(${p.x},${p.y})`); // 드래그 중엔 직접 이동(부드럽게)
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false; g.style.cursor = 'grab';
    const p = toCourt(svg, e.clientX, e.clientY);
    state.overrides.set(key, p); // 커밋
    render(); // 옮김 표시·수정 카운트 갱신
  };
  g.addEventListener('pointerup', end);
  g.addEventListener('pointercancel', end);
}

// ── 컨트롤 배선 ──
function advance(): void {
  const step = computeStep(state.idx, state.segIdx);
  if (state.segIdx < step.segCount - 1) state.segIdx++;
  else if (state.idx < total - 1) { state.idx++; state.segIdx = 0; }
  state.overrides.clear(); render();
}
function back(): void {
  if (state.segIdx > 0) state.segIdx--;
  else if (state.idx > 0) { state.idx--; state.segIdx = 0; }
  state.overrides.clear(); render();
}
function nextRally(): void { if (state.idx < total - 1) { state.idx++; state.segIdx = 0; state.overrides.clear(); render(); } }
function prevRally(): void { if (state.idx > 0) { state.idx--; state.segIdx = 0; state.overrides.clear(); render(); } }

function fillTeamSelects(): void {
  const opts = teams.map((t) => `<option value="${t.id}">${shortTeamName(t.id)}</option>`).join('');
  const homeSel = $('homeSel') as HTMLSelectElement;
  const awaySel = $('awaySel') as HTMLSelectElement;
  homeSel.innerHTML = opts; awaySel.innerHTML = opts;
  homeSel.value = state.homeId; awaySel.value = state.awayId;
  homeSel.onchange = () => { state.homeId = homeSel.value; recompute(); render(); };
  awaySel.onchange = () => { state.awayId = awaySel.value; recompute(); render(); };
}

function init(): void {
  fillTeamSelects();
  ($('seedVal') as HTMLElement).textContent = `${state.seed}`;
  $('seedBtn').onclick = () => { state.seed++; ($('seedVal') as HTMLElement).textContent = `${state.seed}`; recompute(); render(); };
  $('prevRally').onclick = prevRally;
  $('back').onclick = back;
  $('adv').onclick = advance;
  $('nextRally').onclick = nextRally;
  $('resetStep').onclick = () => { state.overrides.clear(); render(); };
  $('movesBtn').onclick = () => { state.showMoves = !state.showMoves; ($('movesBtn') as HTMLElement).textContent = state.showMoves ? '이동 ✓' : '이동 ✕'; render(); };
  $('namesBtn').onclick = () => { state.showNames = !state.showNames; ($('namesBtn') as HTMLElement).textContent = state.showNames ? '이름 ✓' : '이름 ✕'; render(); };
  $('exportBtn').onclick = () => {
    const step = computeStep(state.idx, state.segIdx);
    const out = exportText(step, currentMarkers(step));
    const ta = $('out') as HTMLTextAreaElement;
    ta.value = out; ta.style.display = 'block'; ta.select();
    try { navigator.clipboard?.writeText(out); ($('copied') as HTMLElement).textContent = '복사됨 — 채팅에 붙여넣고 "이래야 하는 이유"를 적어주세요.'; } catch { /* 권한 없으면 수동 복사 */ }
  };
  recompute();
  render();
}

init();
