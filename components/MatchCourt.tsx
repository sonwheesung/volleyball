// 경기 보드 — 코트 위 마커(선수)와 노란 공으로 랠리를 시각화.
// 엔진 SimResult.points 만으로 각 랠리의 서브권·로테이션을 복원(엔진과 동일한 사이드아웃 규칙)
// → 마커를 실제 코트 위치에 놓고 공을 득점 결과와 일치하게 애니메이션.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, StyleSheet, Text, View } from 'react-native';
import { theme } from './Screen';
import { buildLineup } from '../engine/lineup';
import { createRng } from '../engine/rng';
import type { SimResult } from '../engine/simMatch';
import type { Player, Position, Side } from '../types';

const POS_COLOR: Record<Position, string> = {
  S: '#a78bfa', OH: '#38bdf8', OP: '#f87171', MB: '#fbbf24', L: '#4ade80',
};

// 코트 영역 크기
const SCREEN_W = Dimensions.get('window').width;
const COURT_W = SCREEN_W - 32;
const COURT_H = Math.min(COURT_W * 1.4, Dimensions.get('window').height * 0.52);

// 존(zone) → 그리드 (col 0~2, row F=전위/B=후위)
const GRID: Record<number, [number, 'F' | 'B']> = {
  4: [0, 'F'], 3: [1, 'F'], 2: [2, 'F'],
  5: [0, 'B'], 6: [1, 'B'], 1: [2, 'B'],
};
const COLX = [0.18, 0.5, 0.82];

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

/** 존 중심 좌표(px) — 홈은 하단, 원정은 상단(좌우·전후 점대칭) */
function zonePx(side: Side, zone: number): { x: number; y: number } {
  const [col, row] = GRID[zone];
  const x = (side === 'home' ? COLX[col] : COLX[2 - col]) * COURT_W;
  const yF = side === 'home' ? 0.62 : 0.38;
  const yB = side === 'home' ? 0.9 : 0.1;
  return { x, y: (row === 'F' ? yF : yB) * COURT_H };
}

/** 로테이션 r 에서 zone 에 선 라인업 인덱스 (zone z → (r+z-1)%6) */
const lineupIdxAt = (r: number, zone: number) => (r + zone - 1) % 6;

interface Lineups {
  home: ReturnType<typeof buildLineup>;
  away: ReturnType<typeof buildLineup>;
}

/** 사이드 라인업에서 zone 의 선수 (후위 5·6 MB는 리베로로 치환) */
function playerAt(L: Lineups, side: Side, rot: number, zone: number): Player {
  const lu = side === 'home' ? L.home : L.away;
  let p = lu.six[lineupIdxAt(rot, zone)];
  if ((zone === 5 || zone === 6) && lu.libero && p?.position === 'MB') p = lu.libero;
  return p;
}

interface Rally {
  setNo: number;
  home: number;       // 누적 점수
  away: number;
  scorer: Side;
  serving: Side;
  homeRot: number;
  awayRot: number;
  homeSetsBefore: number;
  awaySetsBefore: number;
}

/** points[] → 랠리별 서브권·로테이션·세트 상태 복원 (engine/match.ts 규칙과 동일) */
function reconstruct(sim: SimResult): Rally[] {
  const out: Rally[] = [];
  let homeRot = 0, awayRot = 0;
  let serving: Side = 'home';
  let curSet = 0;
  let hs = 0, as = 0; // 완료 세트
  for (let i = 0; i < sim.points.length; i++) {
    const pt = sim.points[i];
    if (pt.setNo !== curSet) {
      // 새 세트: 회전 0, 서브권 교대(홀수=홈)
      if (curSet !== 0) {
        const prev = sim.points[i - 1];
        if (prev.home > prev.away) hs++; else as++;
      }
      curSet = pt.setNo;
      homeRot = 0; awayRot = 0;
      serving = pt.setNo % 2 === 1 ? 'home' : 'away';
    }
    out.push({
      setNo: pt.setNo, home: pt.home, away: pt.away, scorer: pt.scorer,
      serving, homeRot, awayRot, homeSetsBefore: hs, awaySetsBefore: as,
    });
    if (pt.scorer !== serving) {
      if (pt.scorer === 'home') homeRot = (homeRot + 1) % 6; else awayRot = (awayRot + 1) % 6;
      serving = pt.scorer;
    }
  }
  return out;
}

/** 한 랠리의 공 이동 경로(px 좌표열) — 득점 측에서 끝남 */
function ballPath(r: Rally, seed: number): { x: number; y: number }[] {
  const rng = createRng((seed ^ ((r.home << 8) | r.away) ^ (r.setNo * 7919)) >>> 0);
  const pick = <T,>(a: T[]): T => a[Math.floor(rng.next() * a.length)];
  const P = (s: Side, z: number) => zonePx(s, z);
  const floor = (s: Side, z: number) => {
    const f = zonePx(s, z);
    return { x: f.x, y: (s === 'home' ? 0.96 : 0.04) * COURT_H };
  };

  const serving = r.serving;
  const recv = other(serving);
  const wp: { x: number; y: number }[] = [];
  wp.push(P(serving, 1));            // 서브 지점
  wp.push(P(recv, pick([6, 5, 1]))); // 리시브
  wp.push(P(recv, 3));               // 토스
  let att: Side = recv;
  wp.push(P(att, pick([4, 2, 3])));  // 공격 임팩트

  for (let hop = 0; hop < 6; hop++) {
    const def = other(att);
    if (att === r.scorer) { wp.push(floor(def, pick([5, 6, 1]))); break; } // 득점 → 상대 코트로 낙구
    wp.push(P(def, pick([6, 5, 1]))); // 디그
    wp.push(P(def, 3));               // 토스
    wp.push(P(def, pick([4, 2, 3]))); // 역공
    att = def;
  }
  return wp;
}

interface Props {
  sim: SimResult;
  home: Player[];
  away: Player[];
  seed: number;
  mineSide: Side | null;
  onFinished?: () => void;
}

export function MatchCourt({ sim, home, away, seed, mineSide, onFinished }: Props) {
  const lineups: Lineups = useMemo(() => ({ home: buildLineup(home), away: buildLineup(away) }), [home, away]);
  const rallies = useMemo(() => reconstruct(sim), [sim]);
  const total = rallies.length;

  const [idx, setIdx] = useState(0);      // 현재 진행 중인 랠리
  const [shown, setShown] = useState(-1); // 점수에 반영된 마지막 랠리
  const [playing, setPlaying] = useState(true);
  const [fast, setFast] = useState(false);

  const ball = useRef(new Animated.ValueXY(zonePx('home', 1))).current;
  const finishedOnce = useRef(false);

  const finished = idx >= total;

  // 랠리 애니메이션 (랠리 단위)
  useEffect(() => {
    if (!playing || finished) return;
    const path = ballPath(rallies[idx], seed);
    ball.setValue(path[0]);
    const steps = path.slice(1).map((p) =>
      Animated.timing(ball, { toValue: p, duration: fast ? 90 : 240, useNativeDriver: true }),
    );
    const seq = Animated.sequence(steps);
    seq.start(({ finished: done }) => {
      if (!done) return;
      setShown(idx);
      setIdx((i) => i + 1);
    });
    return () => seq.stop();
  }, [idx, playing, fast, finished, rallies, seed, ball]);

  useEffect(() => {
    if (finished && !finishedOnce.current) {
      finishedOnce.current = true;
      onFinished?.();
    }
  }, [finished, onFinished]);

  // 화면에 표시할 상태
  const view = shown >= 0 ? rallies[Math.min(shown, total - 1)] : null;
  const homeSets = finished ? sim.homeSets : view?.homeSetsBefore ?? 0;
  const awaySets = finished ? sim.awaySets : view?.awaySetsBefore ?? 0;
  const curPts = view ? { h: view.home, a: view.away } : { h: 0, a: 0 };
  const setNo = view?.setNo ?? 1;

  // 마커 배치는 현재 진행 중 랠리(idx) 기준
  const stage = rallies[Math.min(idx, total - 1)];

  const markers = (side: Side) => {
    const rot = side === 'home' ? stage.homeRot : stage.awayRot;
    return [1, 2, 3, 4, 5, 6].map((z) => {
      const p = playerAt(lineups, side, rot, z);
      const { x, y } = zonePx(side, z);
      const serving = stage.serving === side && z === 1 && !finished;
      const mine = mineSide === side;
      const color = p ? POS_COLOR[p.position] : theme.muted;
      return (
        <View key={`${side}-${z}`} style={[styles.marker, {
          left: x - MR, top: y - MR,
          backgroundColor: color + (mine ? 'ee' : '99'),
          borderColor: serving ? theme.warn : mine ? theme.text : 'transparent',
          borderWidth: serving ? 2.5 : mine ? 1.5 : 0,
        }]}>
          <Text style={styles.markerTxt}>{p?.position ?? ''}</Text>
        </View>
      );
    });
  };

  return (
    <View style={{ gap: 10 }}>
      {/* 코트 */}
      <View style={styles.court}>
        <View style={[styles.half, styles.halfAway]} />
        <View style={[styles.half, styles.halfHome]} />
        <View style={styles.net} />
        <View style={[styles.attackLine, { top: COURT_H * 0.34 }]} />
        <View style={[styles.attackLine, { top: COURT_H * 0.66 }]} />
        {markers('away')}
        {markers('home')}
        <Animated.View style={[styles.ball, { transform: ball.getTranslateTransform() }]} />
        {finished ? (
          <View style={styles.finishOverlay}>
            <Text style={styles.finishTxt}>경기 종료</Text>
          </View>
        ) : null}
      </View>

      {/* 플레이 컨트롤 */}
      <View style={styles.controls}>
        <Ctrl label={playing ? '⏸' : '▶'} onPress={() => setPlaying((p) => !p)} />
        <Ctrl label={fast ? '2x ✓' : '2x'} on={fast} onPress={() => setFast((f) => !f)} />
        <Ctrl label="⏭ 결과" onPress={() => { setPlaying(false); setShown(total - 1); setIdx(total); }} />
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
  court: {
    width: COURT_W, height: COURT_H, alignSelf: 'center',
    borderRadius: 10, borderWidth: 2, borderColor: theme.muted, overflow: 'hidden',
  },
  half: { position: 'absolute', left: 0, right: 0, height: COURT_H / 2 },
  halfAway: { top: 0, backgroundColor: '#3a2a1a' },
  halfHome: { bottom: 0, backgroundColor: '#1a2e3a' },
  net: { position: 'absolute', left: 0, right: 0, top: COURT_H / 2 - 1.5, height: 3, backgroundColor: theme.text },
  attackLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: theme.muted + '55' },
  marker: {
    position: 'absolute', width: MR * 2, height: MR * 2, borderRadius: MR,
    alignItems: 'center', justifyContent: 'center',
  },
  markerTxt: { color: '#0b1220', fontSize: 11, fontWeight: '900' },
  ball: {
    position: 'absolute', left: 0, top: 0, width: 12, height: 12, borderRadius: 6,
    marginLeft: -6, marginTop: -6, backgroundColor: '#ffd23f',
    borderWidth: 1, borderColor: '#b8860b',
  },
  finishOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  finishTxt: { color: theme.text, fontSize: 22, fontWeight: '900', backgroundColor: '#000a', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  ctrl: {
    color: theme.text, fontSize: 15, fontWeight: '800', overflow: 'hidden',
    borderWidth: 1, borderColor: theme.border, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 8, minWidth: 64, textAlign: 'center',
  },
  track: { height: 5, backgroundColor: theme.card, borderRadius: 3, marginHorizontal: 4, overflow: 'hidden' },
  fill: { height: 5, backgroundColor: theme.accent },
  scoreboard: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  sName: { flex: 1, color: theme.text, fontSize: 15, fontWeight: '800' },
  sets: { color: theme.muted, fontSize: 20, fontWeight: '900', minWidth: 18, textAlign: 'center' },
  ptsBox: { alignItems: 'center', minWidth: 96 },
  setNo: { color: theme.accent, fontSize: 11, fontWeight: '700' },
  pts: { color: theme.text, fontSize: 30, fontWeight: '900' },
});
