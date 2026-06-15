// 경기 보드 — 코트 위 마커(선수)와 노란 공으로 랠리를 시각화.
// 엔진 SimResult.points 만으로 각 랠리의 서브권·로테이션을 복원(엔진과 동일한 사이드아웃 규칙)
// → 마커를 실제 코트 위치에 놓고 공을 득점 결과와 일치하게 애니메이션.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, Text, View } from 'react-native';
import { theme } from './Screen';
import { buildLineup } from '../engine/lineup';
import type { SimResult } from '../engine/simMatch';
import type { Player, Position, Side } from '../types';
import {
  lineupIdxAt, playerAtZone,
  zonePx as zonePxRaw, switchedSpots as switchedSpotsRaw,
} from './courtLayout';
import { ballPath as ballPathRaw, SEG_DUR as DUR, markerTravelMs, type Move, type WP } from './courtPath';
import type { PointHow } from '../engine/rally';
import { segmentTargets, reconstructRallies, isInPlay, type RallyState } from './courtDirector';
import { commentLine } from './courtCommentary';

// KOVO 라이트 시스템과 동일한 파스텔 포지션색 (Screen.tsx POS_COLOR와 일치)
const POS_COLOR: Record<Position, string> = {
  S: '#36BE9A', OH: '#0E9C8C', OP: '#FF6B5A', MB: '#8B7CF0', L: '#C8961F',
};

// 랠리 종결 자막 — 엔진이 기록한 사실(PointLog.how)을 그대로 외친다(보드가 지어내지 않음)
// 색은 흰 뱃지 위에서 읽히도록 진한 톤으로(라이트 테마)
const HOW_CAPTION: Record<PointHow, { txt: string; color: string }> = {
  kill: { txt: '스파이크 득점!', color: '#0E9C8C' },
  cap: { txt: '스파이크 득점!', color: '#0E9C8C' },
  stuff: { txt: '🧱 블로킹 차단!', color: '#E0922B' },
  blockout: { txt: '블록 터치아웃!', color: '#F2722C' },
  tip: { txt: '페인트!', color: '#8B7CF0' },
  ace: { txt: '서브 에이스!', color: '#10B9A6' },
  serveErr: { txt: '서브 범실', color: '#8A94A6' },
  recvErr: { txt: '리시브 범실', color: '#8A94A6' },
  miscErr: { txt: '핸들링 범실', color: '#8A94A6' },
  atkErr: { txt: '공격 범실', color: '#8A94A6' },
  fault: { txt: '포지션 폴트', color: '#8A94A6' },
};

// 코트 영역 크기
const SCREEN_W = Dimensions.get('window').width;
const COURT_W = SCREEN_W - 32;
const COURT_H = Math.min(COURT_W * 1.4, Dimensions.get('window').height * 0.52);

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

// 위치 계산은 courtLayout(순수 모듈)에 — 보드 크기 바인딩 래퍼
const zonePx = (side: Side, zone: number) => zonePxRaw(side, zone, COURT_W, COURT_H);
const switchedSpots = (side: Side, lu: ReturnType<typeof buildLineup>, rot: number, offense: boolean) =>
  switchedSpotsRaw(side, lu, rot, offense, COURT_W, COURT_H);

interface Lineups {
  home: ReturnType<typeof buildLineup>;
  away: ReturnType<typeof buildLineup>;
}

/** 사이드 라인업에서 zone 의 선수 (후위 1·5·6 MB는 리베로로 교체. 리베로는 전위 불가) */
function playerAt(L: Lineups, side: Side, rot: number, zone: number): Player {
  return playerAtZone(side === 'home' ? L.home : L.away, rot, zone);
}

type Rally = RallyState;

// 구간별 포물선 높이(px) / 공 크기 피크 — 토스가 가장 크게 휘고 커진다
const ARC: Record<Move, number> = { start: 0, return: 0, walk: 0, serve: COURT_H * 0.10, pass: COURT_H * 0.05, toss: COURT_H * 0.17, spike: COURT_H * 0.03, fault: COURT_H * 0.06, bounce: COURT_H * 0.05 };
const BALL_SCALE: Record<Move, number> = { start: 1, return: 1, walk: 1, serve: 1.2, pass: 1.05, toss: 1.55, spike: 1.15, fault: 1.1, bounce: 1.06 };
const JUMP = 1.45; // 점프 시 마커 확대
const SPEED = 2; // 전체 경기 속도 배수(클수록 느림). 2 = 2배 느리게
const SERVE_OUT = 22; // 엔드라인 뒤(코트 밖) 서브 거리(px)
const COURT_PAD = SERVE_OUT + 10; // 코트 밖 서브 공간 확보용 상하 여백
const serveOutY = (side: Side) => (side === 'home' ? COURT_H + SERVE_OUT : -SERVE_OUT);

/** 한 랠리의 공 이동 경로 — courtPath(순수 모듈, 헤드리스 검증 가능)에 위임 */
const ballPath = (r: Rally, seed: number, L: Lineups, prevLast?: { x: number; y: number }): WP[] =>
  ballPathRaw(r, seed, L, COURT_W, COURT_H, SERVE_OUT, prevLast);

const easingFor = (k: Move) =>
  k === 'toss' ? Easing.inOut(Easing.quad) : k === 'spike' || k === 'fault' ? Easing.in(Easing.quad) : k === 'bounce' ? Easing.out(Easing.quad) : Easing.linear;

/** 이 구간에 점프하는 마커들 — 서브(서버)·토스(세터)·스파이크(공격수+벽에 선 블로커만) */
function jumpersFor(from: WP, to: WP, homeRot: number, awayRot: number, L: Lineups): { side: Side; idx: number }[] {
  if (to.kind === 'serve' || to.kind === 'toss') return [{ side: from.side, idx: from.idx }];
  if (to.kind === 'spike') {
    const opp = other(from.side);
    const rot = opp === 'home' ? homeRot : awayRot;
    const lu = opp === 'home' ? L.home : L.away;
    const dSw = switchedSpots(opp, lu, rot, false);
    const front = [2, 3, 4].map((z) => lineupIdxAt(rot, z));
    const n = Math.min(from.blk ?? 3, front.length); // 토스 WP의 블록 장수(속공은 1장만 점프)
    const blockers = front.slice()
      .sort((a, b) => Math.abs(dSw.pos[a].x - from.x) - Math.abs(dSw.pos[b].x - from.x)).slice(0, n);
    return [{ side: from.side, idx: from.idx }, ...blockers.map((idx) => ({ side: opp, idx }))];
  }
  return [];
}

interface Props {
  sim: SimResult;
  home: Player[];
  away: Player[];
  seed: number;
  mineSide: Side | null;
  onFinished?: () => void;
  onTimeoutSuggest?: (atRally: number) => void; // 구단주 타임아웃 건의(다음 랠리 전에 감독이 판정)
}

export function MatchCourt({ sim, home, away, seed, mineSide, onFinished, onTimeoutSuggest }: Props) {
  const lineups: Lineups = useMemo(() => ({ home: buildLineup(home), away: buildLineup(away) }), [home, away]);
  const rallies = useMemo(() => reconstructRallies(sim), [sim]);
  const total = rallies.length;

  const [idx, setIdx] = useState(0);      // 현재 진행 중인 랠리
  const [segIdx, setSegIdx] = useState(0);// 랠리 내 공 이동 구간
  const [shown, setShown] = useState(-1); // 점수에 반영된 마지막 랠리
  const [playing, setPlaying] = useState(true);
  const [fast, setFast] = useState(false);
  const [feed, setFeed] = useState<string[]>([]); // 중계 텍스트(최근 라인 유지)

  const prog = useRef(new Animated.Value(0)).current; // 현재 구간 진행도 0..1
  const posRefs = useRef<Record<string, Animated.ValueXY>>({}); // 마커별 위치(선수 단위)
  const posLast = useRef<Record<string, { x: number; y: number }>>({});
  const finishedOnce = useRef(false);
  const lastTargets = useRef<Record<string, { x: number; y: number }>>({});

  const finished = idx >= total;
  // 직전 랠리 낙구점 → 새 랠리 공 시작점으로 이어 붙여 공이 순간이동하지 않게
  const prevLast = useMemo(() => {
    if (finished || idx <= 0) return undefined;
    const pp = ballPath(rallies[idx - 1], seed, lineups);
    const w = pp[pp.length - 1];
    return { x: w.x, y: w.y };
  }, [finished, rallies, idx, seed, lineups]);
  const path = useMemo(() => (finished ? [] : ballPath(rallies[idx], seed, lineups, prevLast)), [finished, rallies, idx, seed, lineups, prevLast]);
  const segCount = Math.max(0, path.length - 1);

  // 구간 단위 진행 (위치·포물선·크기·점프를 prog 하나로 동기화)
  useEffect(() => {
    if (!playing || finished) return;
    if (segIdx >= segCount) {
      // 득점 → 점수 반영 후 잠시 멈춤(공은 낙구 지점에 정지) → 다음 랠리
      setShown(idx);
      const r = rallies[idx];
      if (r?.how) {
        const c = HOW_CAPTION[r.how];
        setFeed((f) => [...f, `▶ ${c.txt} — ${r.scorer === 'home' ? '홈' : '원정'} 득점 (${r.home}:${r.away})`].slice(-30));
      }
      const t = setTimeout(() => { setIdx((i) => i + 1); setSegIdx(0); }, fast ? 200 : 650);
      return () => clearTimeout(t);
    }
    const to = path[segIdx + 1];
    prog.setValue(0);
    const anim = Animated.timing(prog, {
      toValue: 1,
      duration: (to.dur ?? DUR[to.kind]) * (fast ? 0.4 : 1) * SPEED,
      easing: easingFor(to.kind),
      useNativeDriver: true,
    });
    anim.start(({ finished: done }) => { if (done) setSegIdx((s) => s + 1); });
    return () => anim.stop();
  }, [idx, segIdx, playing, fast, finished, segCount, path, prog, rallies]);

  useEffect(() => {
    if (finished && !finishedOnce.current) {
      finishedOnce.current = true;
      onFinished?.();
    }
  }, [finished, onFinished]);

  const seg = !finished && segIdx < segCount ? { from: path[segIdx], to: path[segIdx + 1] } : null;

  // 화면에 표시할 상태
  const view = shown >= 0 ? rallies[Math.min(shown, total - 1)] : null;
  const homeSets = finished ? sim.homeSets : view?.homeSetsBefore ?? 0;
  const awaySets = finished ? sim.awaySets : view?.awaySetsBefore ?? 0;
  const curPts = view ? { h: view.home, a: view.away } : { h: 0, a: 0 };
  const setNo = view?.setNo ?? 1;

  // 마커 배치는 현재 진행 중 랠리(idx) 기준
  const stage = rallies[Math.min(idx, total - 1)];

  const segKind: Move | null = seg ? seg.to.kind : null;
  // 서브 이후(공 인플레이)엔 전 선수가 전문 포지션으로 스위칭
  const inPlay = isInPlay(segKind);
  const jl = seg ? jumpersFor(seg.from, seg.to, stage.homeRot, stage.awayRot, lineups) : [];
  const jumpScale = prog.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, JUMP, 1] });

  // 전 마커 목표 좌표 — courtDirector(순수 모듈, 헤드리스 감사기와 동일 소스)
  const targets = segmentTargets(seg, { serving: stage.serving, homeRot: stage.homeRot, awayRot: stage.awayRot }, lineups, COURT_W, COURT_H, SERVE_OUT, lastTargets.current);
  lastTargets.current = targets;

  // 마커는 "선수(라인업 인덱스)" 단위로 그린다 → 위치가 바뀌면 무조건 슬라이드(순간이동 금지).
  const getPos = (key: string, init: { x: number; y: number }) => {
    if (!posRefs.current[key]) { posRefs.current[key] = new Animated.ValueXY(init); posLast.current[key] = init; }
    return posRefs.current[key];
  };

  type Mk = { key: string; side: Side; p: Player | undefined; tx: number; ty: number; jumping: boolean; isServer: boolean };
  const buildMarkers = (side: Side): Mk[] => {
    const rot = side === 'home' ? stage.homeRot : stage.awayRot;
    const lu = side === 'home' ? lineups.home : lineups.away;
    const arr: Mk[] = [];
    for (let i = 0; i < 6; i++) {
      const zone = ((i - rot) % 6 + 6) % 6 + 1;     // 이 선수가 현재 선 존
      const isServer = !finished && stage.serving === side && zone === 1;
      const p = isServer ? lu.six[i] : playerAt(lineups, side, rot, zone); // 서버는 실제 선수(리베로는 서브 불가), 그 외 후위 MB→리베로
      const t = targets[`${side}-${i}`] ?? zonePx(side, zone);
      let tx = t.x;
      let ty = t.y;
      const jumping = jl.some((j) => j.side === side && j.idx === i);
      if (jumping) { const lp = posLast.current[`${side}-${i}`]; if (lp) { tx = lp.x; ty = lp.y; } } // 점프 중엔 제자리(착지 후 이동)
      arr.push({ key: `${side}-${i}`, side, p, tx, ty, jumping, isServer });
    }
    return arr;
  };
  const allMarkers = [...buildMarkers('home'), ...buildMarkers('away')];

  // 목표가 바뀐 마커만 부드럽게 이동(순간이동 금지)
  const posSig = allMarkers.map((m) => `${m.key}:${Math.round(m.tx)},${Math.round(m.ty)}`).join('|');
  useEffect(() => {
    for (const m of allMarkers) {
      const v = getPos(m.key, { x: m.tx, y: m.ty });
      const last = posLast.current[m.key];
      if (last && (last.x !== m.tx || last.y !== m.ty)) {
        posLast.current[m.key] = { x: m.tx, y: m.ty };
        const d = Math.hypot(m.tx - last.x, m.ty - last.y);
        Animated.timing(v, { toValue: { x: m.tx, y: m.ty }, duration: markerTravelMs(d) * (fast ? 0.4 : 1), easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posSig]);

  // 공 transform — 포물선(translateY에 아치 가산) + 크기(떴다 떨어지는 원근감)
  const last = path.length ? path[path.length - 1] : zonePx('home', 1);
  const arcH = seg ? (seg.to.arc ?? ARC[seg.to.kind]) : 0;
  const ballTransform = seg
    ? [
        { translateX: prog.interpolate({ inputRange: [0, 1], outputRange: [seg.from.x, seg.to.x] }) },
        {
          translateY: Animated.add(
            prog.interpolate({ inputRange: [0, 1], outputRange: [seg.from.y, seg.to.y] }),
            prog.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -0.75 * arcH, -arcH, -0.75 * arcH, 0] }),
          ),
        },
        { scale: prog.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, seg.to.scale ?? BALL_SCALE[seg.to.kind], 1] }) },
      ]
    : [{ translateX: last.x }, { translateY: last.y }];

  // 중계 텍스트 — 구간 시작마다 사실 기반 한 줄(서브/리시브/토스/스파이크 + 행위자 이름)
  const segSig = seg ? `${idx}:${segIdx}` : '';
  useEffect(() => {
    if (!seg) return;
    const line = commentLine(seg, rallies[Math.min(idx, total - 1)]?.how, lineups, {
      serving: stage.serving, homeRot: stage.homeRot, awayRot: stage.awayRot,
    });
    if (line) setFeed((f) => (f[f.length - 1] === line ? f : [...f, line].slice(-30)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segSig]);

  // 종결 자막 — 공이 죽은 순간(바운드)부터 다음 서브 전까지. 바운드 중엔 진행 랠리, 그 후엔 점수 반영 랠리
  const capRally = finished ? null
    : segKind === 'bounce' ? rallies[Math.min(idx, total - 1)]
    : !inPlay && shown >= 0 ? rallies[Math.min(shown, total - 1)]
    : null;
  const caption = capRally?.how ? HOW_CAPTION[capRally.how] : null;

  // 공 궤적(흰 점선) — 경기 중(인플레이)에만. 끝점은 의도(aim)가 있으면 그쪽으로(터치아웃: 점선=의도 코스)
  const aimEnd = seg ? seg.to.aim ?? seg.to : null;
  const trailDots = seg && inPlay && aimEnd
    ? Array.from({ length: 17 }, (_, k) => {
        const s = k / 16;
        return {
          key: k,
          x: seg.from.x + (aimEnd.x - seg.from.x) * s,
          y: seg.from.y + (aimEnd.y - seg.from.y) * s - arcH * 4 * s * (1 - s),
        };
      })
    : [];

  return (
    <View style={{ gap: 10 }}>
      {/* 코트 */}
      <View style={styles.courtWrap}>
      <View style={styles.court}>
        <View style={[styles.half, styles.halfAway]} />
        <View style={[styles.half, styles.halfHome]} />
        <View style={styles.net} />
        <View style={[styles.attackLine, { top: COURT_H * 0.34 }]} />
        <View style={[styles.attackLine, { top: COURT_H * 0.66 }]} />
        {allMarkers.map((m) => {
          const pos = getPos(m.key, { x: m.tx, y: m.ty });
          const mine = mineSide === m.side;
          const color = m.p ? POS_COLOR[m.p.position] : theme.muted;
          return (
            <Animated.View key={m.key} style={[styles.marker, {
              left: -MR, top: -MR,
              backgroundColor: color + (mine ? 'ff' : 'd0'),
              borderColor: m.isServer ? theme.warn : mine ? theme.text : '#FFFFFF',
              borderWidth: m.isServer ? 2.5 : mine ? 1.5 : 1.5,
              transform: [{ translateX: pos.x }, { translateY: pos.y }, { scale: m.jumping ? jumpScale : 1 }],
            }]}>
              <Text style={styles.markerTxt}>{m.p?.position ?? ''}</Text>
            </Animated.View>
          );
        })}
        {trailDots.map((d) => (
          <View key={d.key} style={[styles.trailDot, { left: d.x - 1.5, top: d.y - 1.5 }]} />
        ))}
        <Animated.View style={[styles.ball, { transform: ballTransform }]} />
        {caption ? (
          <View style={[styles.howBadge, { borderColor: caption.color }]}>
            <Text style={[styles.howTxt, { color: caption.color }]}>{caption.txt}</Text>
          </View>
        ) : null}
        {finished ? (
          <View style={styles.finishOverlay}>
            <Text style={styles.finishTxt}>경기 종료</Text>
          </View>
        ) : null}
      </View>
      </View>

      {/* 중계 텍스트 */}
      {feed.length > 0 ? (
        <View style={styles.feedBox}>
          {feed.slice(-4).map((t, i, arr) => (
            <Text key={`${feed.length}-${i}`} numberOfLines={1} style={[styles.feedLine, i === arr.length - 1 && styles.feedLast]}>
              {t}
            </Text>
          ))}
        </View>
      ) : null}

      {/* 플레이 컨트롤 */}
      <View style={styles.controls}>
        <Ctrl label={playing ? '⏸' : '▶'} onPress={() => setPlaying((p) => !p)} />
        <Ctrl label={fast ? '2x ✓' : '2x'} on={fast} onPress={() => setFast((f) => !f)} />
        {onTimeoutSuggest && mineSide && !finished ? (
          <Ctrl label="🙋 타임아웃 건의" onPress={() => onTimeoutSuggest(Math.min(idx + 1, total - 1))} />
        ) : null}
        <Ctrl label="⏭ 결과" onPress={() => { setPlaying(false); setShown(total - 1); setIdx(total); setSegIdx(0); }} />
      </View>

      {/* 진행 바 */}
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${total ? (Math.min(idx, total) / total) * 100 : 0}%` }]} />
      </View>

      {/* 점수 */}
      <View style={styles.scoreboard}>
        <Text style={[styles.sName, mineSide === 'home' && { color: theme.accent }]} numberOfLines={1}>홈</Text>
        <Text style={styles.sets}>{homeSets}</Text>
        <View style={styles.ptsBox}>
          <Text style={styles.setNo}>{finished ? '종료' : `${setNo}세트`}</Text>
          <Text style={styles.pts}>{curPts.h} : {curPts.a}</Text>
        </View>
        <Text style={styles.sets}>{awaySets}</Text>
        <Text style={[styles.sName, { textAlign: 'right' }, mineSide === 'away' && { color: theme.accent }]} numberOfLines={1}>원정</Text>
      </View>
    </View>
  );
}

function Ctrl({ label, onPress, on }: { label: string; onPress: () => void; on?: boolean }) {
  return (
    <Text onPress={onPress} style={[styles.ctrl, on && { color: theme.accent, borderColor: theme.accent }]}>
      {label}
    </Text>
  );
}

const MR = 15; // 마커 반지름

const styles = StyleSheet.create({
  courtWrap: { paddingVertical: COURT_PAD, alignItems: 'center' },
  court: {
    width: COURT_W, height: COURT_H, alignSelf: 'center',
    borderRadius: 12, borderWidth: 2, borderColor: '#A9DCD4', overflow: 'visible',
  },
  half: { position: 'absolute', left: 0, right: 0, height: COURT_H / 2 },
  halfAway: { top: 0, backgroundColor: '#EEF3F8' },     // 상대 코트 — 쿨 라이트
  halfHome: { bottom: 0, backgroundColor: '#E3F4F0' },  // 내 코트 — 민트 라이트
  net: { position: 'absolute', left: 0, right: 0, top: COURT_H / 2 - 1.5, height: 3, backgroundColor: theme.accent },
  attackLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: theme.accent + '44' },
  marker: {
    position: 'absolute', width: MR * 2, height: MR * 2, borderRadius: MR,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#1B2A4A', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  markerTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  howBadge: {
    position: 'absolute', top: 8, alignSelf: 'center',
    backgroundColor: '#FFFFFFF2', borderWidth: 1.5, borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 5,
    shadowColor: '#1B2A4A', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  howTxt: { fontSize: 13, fontWeight: '900' },
  feedBox: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, gap: 1 },
  feedLine: { color: theme.muted, fontSize: 11 },
  feedLast: { color: theme.text, fontSize: 12.5, fontWeight: '700' },
  ball: {
    position: 'absolute', left: 0, top: 0, width: 12, height: 12, borderRadius: 6,
    marginLeft: -6, marginTop: -6, backgroundColor: '#FFD23F',
    borderWidth: 1, borderColor: '#B8860B',
  },
  trailDot: {
    position: 'absolute', width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: theme.accent + 'cc',
  },
  finishOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  finishTxt: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', backgroundColor: '#15202BD9', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  ctrl: {
    color: theme.text, fontSize: 15, fontWeight: '800', overflow: 'hidden',
    borderWidth: 1, borderColor: theme.border, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 8, minWidth: 64, textAlign: 'center',
  },
  track: { height: 5, backgroundColor: theme.cardAlt, borderRadius: 3, marginHorizontal: 4, overflow: 'hidden' },
  fill: { height: 5, backgroundColor: theme.accent },
  scoreboard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: '#1B2A4A', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  sName: { flex: 1, color: theme.text, fontSize: 15, fontWeight: '800' },
  sets: { color: theme.muted, fontSize: 20, fontWeight: '900', minWidth: 18, textAlign: 'center' },
  ptsBox: { alignItems: 'center', minWidth: 96 },
  setNo: { color: theme.accent, fontSize: 11, fontWeight: '700' },
  pts: { color: theme.text, fontSize: 30, fontWeight: '900' },
});
