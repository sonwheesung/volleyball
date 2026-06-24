// 수비 위치 실험실 (개발용) — 실제 경기를 시뮬해 "한 스텝(공 이동 구간)"마다 멈추고, 그 순간
// 양 팀 12명의 위치를 직접 드래그해 고친다. 저장하면 각 선수의 base(코드 계산값)·now(옮긴 값)·Δ를
// 텍스트로 내보내, 개발자(클로드)가 어느 위치 계산이 틀렸는지 읽고 courtLayout/courtDirector를 고친다.
//
// 위치는 실제 보드(MatchCourt)와 동일한 ballPath + segmentTargets로 계산 → 화면에서 보던 그 좌표 그대로.
// 새 네이티브 모듈 없음(PanResponder는 RN 내장) — Expo Go 안전.
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, PanResponder, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';
import { Button, Card, Muted, Row, Screen, theme } from '../components/Screen';
import { POS_COLOR } from '../components/posTokens';
import { DEV_TOOLS } from '../data/flags';
import { LEAGUE, coachInfoOf, shortTeamName } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import {
  displayPos, playerAtZone, zonePx, type Lineup, type Px,
} from '../components/courtLayout';
import {
  segmentTargets, reconstructRallies, applySubsToSix, offenseSideOf,
} from '../components/courtDirector';
import { ballPath, type Move, type Lineups } from '../components/courtPath';
import type { Player, Position, Side } from '../types';
import { useGameStore } from '../store/useGameStore';

// MatchCourt와 동일한 코트 크기·서브 여백 — 화면에서 보던 위치 그대로 재현
const SCREEN_W = Dimensions.get('window').width;
const W = SCREEN_W - 32;
const H = Math.min(W * 1.4, Dimensions.get('window').height * 0.52);
const SERVE_OUT = 22;
const R = 14; // 마커 반지름

const KIND_KO: Record<Move, string> = {
  start: '시작', return: '복귀', walk: '서브대기', serve: '서브', pass: '리시브',
  toss: '토스(세트)', spike: '스파이크', fault: '범실', bounce: '바운드',
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const sgn = (n: number) => (n >= 0 ? `+${n.toFixed(3)}` : n.toFixed(3));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isBackZone = (z: number) => z === 1 || z === 5 || z === 6;
/** 마커가 base(코드 계산값)에서 옮겨졌는지 — 화면 px 0.5 이상 차이 */
const isMoved = (m: LabMarker) => Math.abs(m.x - m.baseFx * W) > 0.5 || Math.abs(m.y - m.baseFy * H) > 0.5;
/** 화살촉 삼각형 점들(SVG polygon points) — from→to 방향 끝에 */
function arrowHead(fx: number, fy: number, tx: number, ty: number): string {
  const ux = tx - fx, uy = ty - fy; const len = Math.hypot(ux, uy) || 1;
  const nx = ux / len, ny = uy / len; const px = -ny, py = nx;
  const hb = 9, hw = 5; // 화살촉 길이·반폭
  const bx = tx - nx * hb, by = ty - ny * hb;
  return `${tx},${ty} ${bx + px * hw},${by + py * hw} ${bx - px * hw},${by - py * hw}`;
}
const SERVE_RING = '#F2722C'; // 서버 링(주황)
const FRONT_RING = '#F2A93B'; // 전위 링(금)
const RW = R + 5;             // 링 포함 마커 반지름

interface LabMarker {
  key: string; side: Side; name: string; pos: Position; zone: number;
  front: boolean; server: boolean;
  baseFx: number; baseFy: number; x: number; y: number;
}

/** 드래그 마커 — 자기 위치를 내부 state로 들고, 놓을 때 부모에 커밋(내보내기용). id 바뀌면 재마운트=리셋. */
function DragMarker({ m, onCommit }: { m: LabMarker & { id: string }; onCommit: (key: string, x: number, y: number) => void }) {
  const [pos, setPos] = useState({ x: m.x, y: m.y });
  const posRef = useRef(pos);
  posRef.current = pos;
  const startRef = useRef({ x: 0, y: 0 });
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderGrant: () => { startRef.current = posRef.current; },
      onPanResponderMove: (_e, g) => setPos({ x: clamp(startRef.current.x + g.dx, 0, W), y: clamp(startRef.current.y + g.dy, 0, H) }),
      onPanResponderRelease: () => onCommit(m.key, posRef.current.x, posRef.current.y),
      onPanResponderTerminate: () => onCommit(m.key, posRef.current.x, posRef.current.y),
    }),
  ).current;
  const color = POS_COLOR[m.pos] ?? theme.muted;
  const moved = Math.abs(pos.x - m.x) > 0.5 || Math.abs(pos.y - m.y) > 0.5;
  const home = m.side === 'home';
  const ring = m.server ? SERVE_RING : m.front ? FRONT_RING : null;
  return (
    <View {...pan.panHandlers} style={[styles.markerWrap, { left: pos.x - RW, top: pos.y - RW }]}>
      {ring ? <View style={[styles.ring, { borderColor: ring }]} /> : null}
      <View
        style={[
          styles.marker,
          { backgroundColor: home ? color : '#FFFFFF', borderColor: home ? '#FFFFFF' : color },
        ]}
      >
        <Text style={[styles.markerTxt, { color: home ? '#FFFFFF' : color }]}>{m.pos}</Text>
      </View>
      {m.server ? <Text style={styles.svTag}>서브</Text> : null}
      {moved ? <View style={styles.movedDot} /> : null}
    </View>
  );
}

export default function BoardLab() {
  if (!DEV_TOOLS) return <Redirect href="/(tabs)/" />;
  const router = useRouter();
  const myId = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);

  const teams = LEAGUE.teams;
  const firstId = myId ?? teams[0].id;
  const [homeId, setHomeId] = useState(firstId);
  const [awayId, setAwayId] = useState(() => (teams.find((t) => t.id !== firstId) ?? teams[0]).id);
  const [seed, setSeed] = useState(1);

  // 실제 경기 시뮬 — 보드 샌드박스와 동일 소스(availableTeamPlayers + simulateMatch + 감독정보)
  const sim = useMemo(() => {
    const hs = availableTeamPlayers(homeId, currentDay);
    const as = availableTeamPlayers(awayId, currentDay);
    return { sim: simulateMatch(seed, hs, as, { home: coachInfoOf(homeId), away: coachInfoOf(awayId) }), hs, as };
  }, [homeId, awayId, seed, currentDay]);

  const rallies = useMemo(() => reconstructRallies(sim.sim), [sim]);
  const total = rallies.length;
  const baseLineups: Lineups = useMemo(() => ({ home: buildLineup(sim.hs), away: buildLineup(sim.as) }), [sim]);
  const byId = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of sim.hs) m.set(p.id, p);
    for (const p of sim.as) m.set(p.id, p);
    return m;
  }, [sim]);

  const [idx, setIdx] = useState(0);  // 랠리
  const [segIdx, setSegIdx] = useState(0);  // 랠리 내 공 이동 구간(스텝)
  const [nonce, setNonce] = useState(0);    // 현 스텝 초기화
  const [markers, setMarkers] = useState<LabMarker[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [showMoves, setShowMoves] = useState(true); // 다음 이동 방향 화살표

  // 팀/시드 바뀌면 처음부터
  useEffect(() => { setIdx(0); setSegIdx(0); }, [sim]);

  const effLineupsAt = (rallyIdx: number): Lineups => ({
    home: { ...baseLineups.home, six: applySubsToSix(baseLineups.home.six, 'home', sim.sim.subEvents, rallyIdx, byId) },
    away: { ...baseLineups.away, six: applySubsToSix(baseLineups.away.six, 'away', sim.sim.subEvents, rallyIdx, byId) },
  });

  // 한 스텝(랠리 i·구간 sIdx)의 전체 상태(보드와 동일 계산) — base 마커 좌표 포함. 현재·다음 스텝 모두 이 함수로.
  const computeStep = (i0: number, sIdx: number) => {
    const i = Math.min(i0, total - 1);
    const rally = rallies[i];
    const lineups = effLineupsAt(i);
    let prevLast: Px | undefined;
    if (i > 0) {
      const pp = ballPath(rallies[i - 1], seed, effLineupsAt(i - 1), W, H, SERVE_OUT);
      const w = pp[pp.length - 1];
      prevLast = { x: w.x, y: w.y };
    }
    const path = ballPath(rally, seed, lineups, W, H, SERVE_OUT, prevLast);
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
  };

  // 현재 스텝 + 다음 스텝(이동 방향 화살표용). 다음 = 같은 랠리 다음 구간, 없으면 다음 랠리 첫 구간.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const step = useMemo(() => computeStep(idx, segIdx), [idx, segIdx, sim, seed, rallies, baseLineups]);
  const nextStep = useMemo(() => {
    if (segIdx < step.segCount - 1) return computeStep(idx, segIdx + 1);
    if (idx < total - 1) return computeStep(idx + 1, 0);
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, segIdx, step.segCount, total, sim, seed, rallies, baseLineups]);

  // 스텝이 바뀌면 마커를 base로 리셋(드래그 폐기)
  useEffect(() => {
    setMarkers(step.markersBase);
    setSaved(null);
  }, [step, nonce]);

  const commit = (key: string, x: number, y: number) =>
    setMarkers((ms) => ms.map((m) => (m.key === key ? { ...m, x, y } : m)));

  const segCount = step.segCount;
  const advance = () => {
    if (segIdx < segCount - 1) setSegIdx((s) => s + 1);
    else if (idx < total - 1) { setIdx((i) => i + 1); setSegIdx(0); }
  };
  const back = () => {
    if (segIdx > 0) setSegIdx((s) => s - 1);
    else if (idx > 0) { setIdx((i) => i - 1); setSegIdx(0); }
  };
  const nextRally = () => { if (idx < total - 1) { setIdx((i) => i + 1); setSegIdx(0); } };
  const prevRally = () => { if (idx > 0) { setIdx((i) => i - 1); setSegIdx(0); } };

  // 서브 시점 점수(이 랠리의 득점 "전") — step.rally.home/away는 이 랠리 결과 점수라 서브대기엔 헷갈림.
  const preH = step.rally.home - (step.rally.scorer === 'home' ? 1 : 0);
  const preA = step.rally.away - (step.rally.scorer === 'away' ? 1 : 0);
  // 상황 한 줄 — 구간 종류로 "지금 무슨 일인지"를 평이하게.
  const teamKo = (s: Side) => shortTeamName(s === 'home' ? homeId : awayId);
  const serverName = step.markersBase.find((m) => m.server)?.name ?? '';
  const situation = (() => {
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
  })();

  const onSave = () => {
    const r = step.rally;
    const sideKo = (s: Side | null) => (s === 'home' ? '홈' : s === 'away' ? '원정' : '-');
    const head =
      `[보드 실험실] 경기 ${shortTeamName(homeId)}(홈) vs ${shortTeamName(awayId)}(원정) · seed ${seed}\n` +
      `상황: ${situation}\n` +
      `랠리 ${idx + 1}/${total} · 세트${r.setNo} (${preH}:${preA}) · 스텝 ${step.sc + 1}/${segCount} · ` +
      `구간=${step.kind ? KIND_KO[step.kind] : '-'} · 서브=${sideKo(step.serving)} · 공격=${sideKo(step.offSide)}` +
      (step.ball ? ` · 공[${r3(step.ball.toX / W).toFixed(3)},${r3(step.ball.toY / H).toFixed(3)}]` : '') + '\n' +
      `좌표=화면분수 x(0좌→1우)·y(0상단=원정 / 1하단=홈 엔드라인), 네트=0.500. 전위=✦ 서버=⚑ 표시`;
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
    const text = [head, summary, ` [홈 ${shortTeamName(homeId)}]`, ...home.map(fmt), ` [원정 ${shortTeamName(awayId)}]`, ...away.map(fmt)].join('\n');
    setSaved(text);
    // Metro 터미널/콘솔에도 출력 — 구분선으로 감싸 복사하기 쉽게(개발자가 읽을 채널)
    console.log(`\n===== [BOARD-LAB EXPORT] =====\n${text}\n===== [/BOARD-LAB EXPORT] =====\n`);
  };

  const dmark = markers.map((m) => ({ ...m, id: `${m.key}-${idx}-${segIdx}-${nonce}` }));
  const server = markers.find((m) => m.server);
  const movedMarkers = markers.filter(isMoved);
  const frontOf = (s: Side) => markers.filter((m) => m.side === s && m.front).map((m) => `${m.pos} ${m.name}`).join(' · ');
  // 다음 스텝 이동 방향 — 각 선수의 현재 base → 다음 스텝 base. 거의 안 움직이면(<10px) 생략.
  // 같은 랠리 안의 다음 구간일 때만(랠리 경계는 로테이션 변경+데드볼이라 순간이동처럼 보여 제외).
  const sameRallyNext = segIdx < step.segCount - 1;
  const nextMap = new Map((nextStep?.markersBase ?? []).map((m) => [m.key, m]));
  const moves = showMoves && sameRallyNext
    ? step.markersBase.flatMap((m) => {
        const n = nextMap.get(m.key);
        if (!n || Math.hypot(n.x - m.x, n.y - m.y) < 10) return [];
        return [{ key: m.key, side: m.side, fx: m.x, fy: m.y, tx: n.x, ty: n.y }];
      })
    : [];

  return (
    <Screen title="수비 위치 실험실 (개발용)">
      <Card>
        <Muted>
          실제 경기를 <Text style={{ fontWeight: '800', color: theme.text }}>한 스텝씩 진행</Text>하며,
          그 순간 <Text style={{ fontWeight: '800', color: theme.text }}>양 팀 12명</Text> 위치를 직접 끌어 고치세요.
          <Text style={{ color: theme.text, fontWeight: '800' }}> 채워진 원=홈 / 테두리 원=원정</Text>.
        </Muted>
        <View style={styles.warn}>
          <Text style={styles.warnTxt}>
            ⚠ 저장은 <Text style={{ fontWeight: '900' }}>경기에 반영되지 않습니다</Text>. 좌표를 텍스트로 내보낼 뿐이에요.
            그 텍스트와 "이래야 하는 이유"를 채팅에 적어주시면, 함께 타당하다고 합의했을 때만 제가 실제 엔진 코드를 고칩니다.
          </Text>
        </View>
      </Card>

      {/* 팀 선택 */}
      <Card>
        <Muted style={{ fontSize: 12 }}>홈</Muted>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
          {teams.map((t) => <Pill key={t.id} label={shortTeamName(t.id)} on={t.id === homeId} onPress={() => setHomeId(t.id)} small />)}
        </ScrollView>
        <Muted style={{ fontSize: 12, marginTop: 6 }}>원정</Muted>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
          {teams.map((t) => <Pill key={t.id} label={shortTeamName(t.id)} on={t.id === awayId} onPress={() => setAwayId(t.id)} small />)}
        </ScrollView>
        {homeId === awayId ? <Muted style={{ fontSize: 12, color: theme.bad }}>서로 다른 두 팀을 골라주세요.</Muted> : null}
        <Row>
          <Muted style={{ fontSize: 12 }}>시드 {seed}</Muted>
          <Pill label="시드 변경" on={false} onPress={() => setSeed((s) => s + 1)} small />
        </Row>
      </Card>

      {/* 스텝 정보 */}
      <Card>
        <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15, marginBottom: 2 }}>🏐 {situation}</Text>
        <Row>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            랠리 {idx + 1}/{total} · 세트{step.rally.setNo} ({preH}:{preA})
          </Text>
          <Text style={{ color: theme.accent, fontWeight: '800' }}>
            스텝 {step.sc + 1}/{Math.max(1, segCount)}
          </Text>
        </Row>
        <Muted style={{ fontSize: 12 }}>
          구간 <Text style={{ color: theme.text, fontWeight: '800' }}>{step.kind ? KIND_KO[step.kind] : '-'}</Text>
          {step.offSide ? ` · 공격 ${step.offSide === 'home' ? '홈' : '원정'}` : ''}
        </Muted>
        <Muted style={{ fontSize: 12 }}>
          <Text style={{ color: SERVE_RING, fontWeight: '800' }}>서브</Text>{' '}
          {server ? `${server.side === 'home' ? '홈' : '원정'} ${server.pos} ${server.name}` : '— (인플레이)'}
        </Muted>
        <Muted style={{ fontSize: 12 }}>
          <Text style={{ color: FRONT_RING, fontWeight: '800' }}>전위</Text> 홈 {frontOf('home') || '-'}
        </Muted>
        <Muted style={{ fontSize: 12 }}>
          <Text style={{ color: FRONT_RING, fontWeight: '800' }}>전위</Text> 원정 {frontOf('away') || '-'}
        </Muted>
      </Card>

      {/* 코트 */}
      <View style={styles.court}>
        <View style={[styles.line, { top: H * 0.5, height: 2, backgroundColor: '#15202B' }]} />
        <View style={[styles.line, { top: H * 0.333, backgroundColor: theme.border }]} />
        <View style={[styles.line, { top: H * 0.667, backgroundColor: theme.border }]} />
        <Text style={[styles.zoneTag, { top: 4, left: 6 }]}>원정({shortTeamName(awayId)})</Text>
        <Text style={[styles.zoneTag, { bottom: 4, left: 6 }]}>홈({shortTeamName(homeId)})</Text>
        <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
          {moves.flatMap((mv) => {
            const col = mv.side === 'home' ? '#0E9C8C' : '#FF6B5A';
            return [
              <Line key={`${mv.key}-l`} x1={mv.fx} y1={mv.fy} x2={mv.tx} y2={mv.ty} stroke={col} strokeWidth={2} opacity={0.8} />,
              <Polygon key={`${mv.key}-h`} points={arrowHead(mv.fx, mv.fy, mv.tx, mv.ty)} fill={col} opacity={0.8} />,
            ];
          })}
          {step.ball ? (
            <>
              <Line x1={step.ball.fromX} y1={step.ball.fromY} x2={step.ball.toX} y2={step.ball.toY} stroke="#E0A21B" strokeWidth={2} strokeDasharray="5,5" />
              <Circle cx={step.ball.fromX} cy={step.ball.fromY} r={4} fill="none" stroke="#E0A21B" strokeWidth={2} />
              <Circle cx={step.ball.toX} cy={step.ball.toY} r={9} fill="#FFD23F" stroke="#15202B" strokeWidth={2} />
            </>
          ) : null}
        </Svg>
        {dmark.map((m) => <DragMarker key={m.id} m={m} onCommit={commit} />)}
      </View>
      <Row>
        <Muted style={{ fontSize: 11, flex: 1 }}>
          → 화살표=다음 이동 방향 · 🟡 공 · <Text style={{ color: FRONT_RING, fontWeight: '800' }}>금테=전위</Text> ·{' '}
          <Text style={{ color: SERVE_RING, fontWeight: '800' }}>주황테=서브</Text> · ●홈 ○원정
        </Muted>
        <Pill label={showMoves ? '이동 ✓' : '이동 ✕'} on={showMoves} onPress={() => setShowMoves((v) => !v)} small />
      </Row>

      {/* 진행 컨트롤 */}
      <Row>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pill label="◀◀ 랠리" on={false} onPress={prevRally} small />
          <Pill label="◀ 단계" on={false} onPress={back} small />
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pill label="단계 ▶" on onPress={advance} small />
          <Pill label="랠리 ▶▶" on={false} onPress={nextRally} small />
        </View>
      </Row>

      <Muted style={{ fontSize: 12 }}>
        이 스텝에서 옮긴 선수:{' '}
        <Text style={{ color: movedMarkers.length ? theme.accent : theme.muted, fontWeight: '800' }}>{movedMarkers.length}명</Text>
        {movedMarkers.length ? ` — ${movedMarkers.map((m) => `${m.side === 'home' ? '홈' : '원'} ${m.pos}`).join(', ')}` : ''}
      </Muted>
      <Row>
        <View style={{ flex: 1, marginRight: 6 }}>
          <Button label="좌표 내보내기 (경기 미반영)" onPress={onSave} />
        </View>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Button label="이 스텝 초기화" variant="ghost" onPress={() => setNonce((n) => n + 1)} />
        </View>
      </Row>

      {saved ? (
        <Card>
          <Muted style={{ fontSize: 11, marginBottom: 4 }}>아래 텍스트를 길게 눌러 복사 → 채팅에 붙여넣고 이유를 적어주세요(✎=옮긴 선수). 합의 전엔 경기 미반영.</Muted>
          <Text selectable style={styles.code}>{saved}</Text>
        </Card>
      ) : null}

      <Button label="← 일정으로" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

function Pill({ label, on, onPress, small }: { label: string; on: boolean; onPress: () => void; small?: boolean }) {
  return (
    <Text
      onPress={onPress}
      style={[
        styles.pill,
        small && { paddingHorizontal: 11, paddingVertical: 6, fontSize: 12 },
        on ? { backgroundColor: theme.accent, color: '#FFFFFF' } : { backgroundColor: theme.cardAlt, color: theme.text },
      ]}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  pill: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, fontSize: 13, fontWeight: '800' },
  court: {
    width: W, height: H, alignSelf: 'center',
    backgroundColor: '#EBE0C8', borderRadius: 10, borderWidth: 2, borderColor: '#C9B98E', overflow: 'hidden',
  },
  line: { position: 'absolute', left: 0, right: 0, height: 1 },
  zoneTag: { position: 'absolute', color: '#15202B', fontSize: 10, fontWeight: '700', opacity: 0.45 },
  warn: { backgroundColor: theme.warn + '1F', borderRadius: 10, padding: 10, marginTop: 8 },
  warnTxt: { color: '#8A6A12', fontSize: 12, lineHeight: 18, fontWeight: '600' },
  markerWrap: { position: 'absolute', width: RW * 2, height: RW * 2, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: RW * 2, height: RW * 2, borderRadius: RW, borderWidth: 2.5 },
  marker: { width: R * 2, height: R * 2, borderRadius: R, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  markerTxt: { fontSize: 10, fontWeight: '900' },
  svTag: { position: 'absolute', bottom: -3, color: SERVE_RING, fontSize: 8, fontWeight: '900' },
  movedDot: { position: 'absolute', top: 1, right: 1, width: 7, height: 7, borderRadius: 4, backgroundColor: '#15202B' },
  code: { color: theme.text, fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },
});
