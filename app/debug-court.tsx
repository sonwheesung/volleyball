// 보드 위치 검증 뷰어(개발) — 로테이션·국면·사이드를 넘기며 모든 대형을 정지 화면으로 확인.
// MatchCourt와 동일한 courtLayout 순수 모듈을 그대로 그림 → 보이는 좌표 = 실제 경기 좌표.

import { useMemo, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Muted, Screen, theme } from '../components/Screen';
import { LEAGUE, getEvolvedTeamPlayers, getTeam } from '../data/league';
import { buildLineup } from '../engine/lineup';
import {
  receiveFormation, switchedSpots, displayPos, zoneOfIdx, zonePx, lineupIdxAt,
  fanSlots, blockerWall, coverSpots,
} from '../components/courtLayout';
import { useGameStore } from '../store/useGameStore';
import type { Position, Side } from '../types';

const POS_COLOR: Record<Position, string> = {
  S: '#a78bfa', OH: '#38bdf8', OP: '#f87171', MB: '#fbbf24', L: '#4ade80',
};

const W = Dimensions.get('window').width - 32;
const H = Math.min(W * 1.4, Dimensions.get('window').height * 0.5);
const MR = 15;

type Phase = '리시브 대형' | '스위칭(공격)' | '스위칭(수비)' | '존 기본위치' | '공방 순간(스파이크)' | '디그 순간';
const PHASES: Phase[] = ['리시브 대형', '스위칭(공격)', '스위칭(수비)', '존 기본위치', '공방 순간(스파이크)', '디그 순간'];
const LANES = [0.22, 0.5, 0.78];
const LANE_KO = ['좌(4번)', '중(3번)', '우(2번)', '백어택(파이프)']; // 4번째는 공방 순간 전용
// 디그 낙하 지점(수비 진영 기준 분율) — 깊은 좌/중앙/깊은 우/블록 뒤 짧은 팁
const DIG_SPOTS: { ko: string; xf: number; yf: number }[] = [
  { ko: '깊은 좌', xf: 0.2, yf: 0.82 },
  { ko: '중앙', xf: 0.5, yf: 0.74 },
  { ko: '깊은 우', xf: 0.8, yf: 0.82 },
  { ko: '짧은 팁', xf: 0.5, yf: 0.6 },
];

export default function DebugCourt() {
  const myTeam = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const [rot, setRot] = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [serving, setServing] = useState<Side>('away'); // 리시브 대형 = 받는 쪽 기준 표시
  const [attSide, setAttSide] = useState<Side>('home'); // 공방/디그: 공격 팀
  const [laneIdx, setLaneIdx] = useState(0);            // 공방/디그: 공격 라인(좌/중/우)
  const [digIdxSpot, setDigIdxSpot] = useState(0);      // 디그: 낙하 지점

  const homeId = myTeam ?? LEAGUE.teams[0].id;
  const awayId = LEAGUE.teams.find((t) => t.id !== homeId)?.id ?? LEAGUE.teams[1].id;
  const lus = useMemo(() => ({
    home: buildLineup(getEvolvedTeamPlayers(homeId, currentDay)),
    away: buildLineup(getEvolvedTeamPlayers(awayId, currentDay)),
  }), [homeId, awayId, currentDay]);

  const phase = PHASES[phaseIdx];
  const defSide: Side = attSide === 'home' ? 'away' : 'home';
  // 디그 낙하 지점(수비 진영 좌표) — 수비가 원정이면 상하·좌우 반전
  const digSpot = (() => {
    const d = DIG_SPOTS[digIdxSpot];
    const xf = defSide === 'home' ? d.xf : 1 - d.xf;
    const yf = defSide === 'home' ? d.yf : 1 - d.yf;
    return { x: xf * W, y: yf * H };
  })();

  // 사이드별 좌표 계산 — MatchCourt와 동일 함수
  const posFor = (side: Side): Record<number, { x: number; y: number }> => {
    const lu = side === 'home' ? lus.home : lus.away;
    if (phase === '리시브 대형') {
      // 서브하는 쪽은 스위칭 전 존 기본(서버는 엔드라인 뒤), 받는 쪽은 리시브 대형
      if (side === serving) {
        const out: Record<number, { x: number; y: number }> = {};
        for (let i = 0; i < 6; i++) {
          const z = zoneOfIdx(rot, i);
          const p = zonePx(side, z, W, H);
          out[i] = z === 1 ? { x: p.x, y: side === 'home' ? H + 18 : -18 } : p; // 서버는 엔드라인 뒤
        }
        return out;
      }
      return receiveFormation(side, lu, rot, W, H);
    }
    if (phase === '스위칭(공격)') return switchedSpots(side, lu, rot, true, W, H).pos;
    if (phase === '스위칭(수비)') return switchedSpots(side, lu, rot, false, W, H).pos;
    if (phase === '공방 순간(스파이크)') {
      // MatchCourt의 토스~스파이크 순간 재현: 공격팀=커버 반원, 수비팀=블로커 벽+부채꼴
      const isPipe = laneIdx === 3; // 백어택(파이프)
      const laneF = isPipe ? 0.5 : LANES[laneIdx];
      const ax = (attSide === 'home' ? laneF : 1 - laneF) * W;
      if (side === attSide) {
        const sw = switchedSpots(side, lu, rot, true, W, H);
        const pos = { ...sw.pos };
        // 공격수: 파이프=후위 OH/OP(3m 라인 뒤 타점) / 그 외=해당 라인 전위 히터
        let atk: number;
        if (isPipe) {
          const backs = [1, 5, 6].map((z) => lineupIdxAt(rot, z))
            .filter((i) => i !== sw.setterIdx && (lu.six[i].position === 'OH' || lu.six[i].position === 'OP'));
          atk = backs.length
            ? backs.reduce((b, i) => (Math.abs(sw.pos[i].x - ax) < Math.abs(sw.pos[b].x - ax) ? i : b), backs[0])
            : sw.frontHitters[0];
          pos[atk] = { x: ax, y: (side === 'home' ? 0.70 : 0.30) * H };
        } else {
          atk = sw.frontHitters.reduce((b, i) => (Math.abs(sw.pos[i].x - ax) < Math.abs(sw.pos[b].x - ax) ? i : b), sw.frontHitters[0]);
          pos[atk] = { x: ax, y: (side === 'home' ? 0.56 : 0.44) * H };
        }
        // 커버 반원(공격수·세터 제외 최대 3, 좌→우 슬롯 배정. 백어택은 측면 커버가 타점 앞)
        const cand = [0, 1, 2, 3, 4, 5].filter((i) => i !== atk && i !== sw.setterIdx)
          .sort((a, b) => Math.abs(sw.pos[a].x - ax) - Math.abs(sw.pos[b].x - ax)).slice(0, 3)
          .sort((a, b) => sw.pos[a].x - sw.pos[b].x);
        const cs = coverSpots(side, ax, cand.length, W, H, isPipe);
        if (cand.length === 3) { pos[cand[0]] = cs[0]; pos[cand[2]] = cs[1]; pos[cand[1]] = cs[2]; }
        else cand.forEach((i, k) => { pos[i] = cs[k]; });
        return pos;
      }
      // 수비팀: 전위 = 블로커 벽(파이프 2장/그 외 3장) / 후위 = 부채꼴
      const swd = switchedSpots(side, lu, rot, false, W, H);
      const pos = { ...swd.pos };
      const front = [2, 3, 4].map((z) => lineupIdxAt(rot, z));
      const nBlk = isPipe ? 2 : 3;
      const chosen = front.slice().sort((a, b) => Math.abs(swd.pos[a].x - ax) - Math.abs(swd.pos[b].x - ax)).slice(0, nBlk)
        .sort((a, b) => swd.pos[a].x - swd.pos[b].x);
      const wall = blockerWall(side, ax, chosen.length, W, H);
      chosen.forEach((bi, k) => { pos[bi] = wall[k]; });
      const back = [1, 5, 6].map((z) => lineupIdxAt(rot, z));
      const slots = fanSlots(side, ax, W, H);
      back.slice().sort((a, b) => swd.pos[a].x - swd.pos[b].x).forEach((bi, k) => { pos[bi] = slots[k]; });
      return pos;
    }
    if (phase === '디그 순간') {
      // 스파이크가 낙하 지점으로 향한 순간: 수비 부채꼴에서 가장 가까운 후위가 디그 지점으로.
      const laneF = LANES[laneIdx % 3]; // 백어택 라인(3)은 공방 순간 전용 — 디그에선 좌/중/우만
      const ax = (attSide === 'home' ? laneF : 1 - laneF) * W;
      if (side === attSide) {
        // 공격팀은 공방 순간 그대로(공격수+커버 반원)
        const sw = switchedSpots(side, lu, rot, true, W, H);
        const pos = { ...sw.pos };
        const atk = sw.frontHitters.reduce((b, i) => (Math.abs(sw.pos[i].x - ax) < Math.abs(sw.pos[b].x - ax) ? i : b), sw.frontHitters[0]);
        pos[atk] = { x: ax, y: (side === 'home' ? 0.56 : 0.44) * H };
        const cand = [0, 1, 2, 3, 4, 5].filter((i) => i !== atk && i !== sw.setterIdx)
          .sort((a, b) => Math.abs(sw.pos[a].x - ax) - Math.abs(sw.pos[b].x - ax)).slice(0, 3)
          .sort((a, b) => sw.pos[a].x - sw.pos[b].x);
        const cs = coverSpots(side, ax, cand.length, W, H);
        if (cand.length === 3) { pos[cand[0]] = cs[0]; pos[cand[2]] = cs[1]; pos[cand[1]] = cs[2]; }
        else cand.forEach((i, k) => { pos[i] = cs[k]; });
        return pos;
      }
      // 수비팀: 부채꼴 기본 + 가장 가까운 후위(MatchCourt nearestDig 로직)가 낙하 지점으로
      const swd = switchedSpots(side, lu, rot, false, W, H);
      const pos = { ...swd.pos };
      const front = [2, 3, 4].map((z) => lineupIdxAt(rot, z));
      const chosenB = front.slice().sort((a, b) => Math.abs(swd.pos[a].x - ax) - Math.abs(swd.pos[b].x - ax)).slice(0, 3)
        .sort((a, b) => swd.pos[a].x - swd.pos[b].x);
      const wall = blockerWall(side, ax, chosenB.length, W, H);
      chosenB.forEach((bi, k) => { pos[bi] = wall[k]; });
      const back = [1, 5, 6].map((z) => lineupIdxAt(rot, z));
      const slots = fanSlots(side, ax, W, H);
      back.slice().sort((a, b) => swd.pos[a].x - swd.pos[b].x).forEach((bi, k) => { pos[bi] = slots[k]; });
      const d2 = (p: { x: number; y: number }) => (p.x - digSpot.x) ** 2 + (p.y - digSpot.y) ** 2;
      const digger = back.reduce((b, i) => (d2(swd.pos[i]) < d2(swd.pos[b]) ? i : b), back[0]); // 선정은 swDef 기준(MatchCourt 동일)
      pos[digger] = { x: digSpot.x, y: digSpot.y };
      return pos;
    }
    const out: Record<number, { x: number; y: number }> = {};
    for (let i = 0; i < 6; i++) out[i] = zonePx(side, zoneOfIdx(rot, i), W, H);
    return out;
  };

  const markers = (['home', 'away'] as Side[]).flatMap((side) => {
    const lu = side === 'home' ? lus.home : lus.away;
    const pos = posFor(side);
    return [0, 1, 2, 3, 4, 5].map((i) => {
      const z = zoneOfIdx(rot, i);
      const d = displayPos(lu, rot, i);
      const isServer = phase === '리시브 대형' && side === serving && z === 1;
      const shown = isServer ? lu.six[i].position : d; // 서버는 실제 선수(리베로 서브 불가)
      return { key: `${side}-${i}`, side, i, z, pos: pos[i], label: shown, swapped: d === 'L' && lu.six[i].position === 'MB', isServer };
    });
  });

  // 존 번호 가이드(홈 기준 흐릿하게)
  const zoneGuides = [1, 2, 3, 4, 5, 6].flatMap((z) => (['home', 'away'] as Side[]).map((s) => ({ key: `${s}${z}`, z, ...zonePx(s, z, W, H) })));

  return (
    <Screen title="보드 위치 검증 (개발)">
      <Card>
        <Muted style={{ fontSize: 12 }}>
          실제 경기 보드와 동일한 위치 계산(courtLayout)을 정지 화면으로 표시.
          마커: 표시 포지션 / 아래 첨자 = 존 번호. 보라 테두리 = 리베로↔MB 교체 슬롯, 노란 테두리 = 서버.
        </Muted>
      </Card>

      {/* 컨트롤 */}
      <View style={st.row}>
        <Ctl label={`로테이션 ${rot}`} onPress={() => setRot((r) => (r + 1) % 6)} />
        <Ctl label={phase} onPress={() => setPhaseIdx((p) => (p + 1) % PHASES.length)} />
        {phase === '리시브 대형' ? (
          <Ctl label={`서브: ${serving === 'home' ? '홈' : '원정'}`} onPress={() => setServing((s) => (s === 'home' ? 'away' : 'home'))} />
        ) : null}
        {phase === '공방 순간(스파이크)' || phase === '디그 순간' ? (
          <>
            <Ctl label={`공격: ${attSide === 'home' ? '홈' : '원정'}`} onPress={() => setAttSide((s) => (s === 'home' ? 'away' : 'home'))} />
            <Ctl
              label={`라인: ${LANE_KO[phase === '공방 순간(스파이크)' ? laneIdx : laneIdx % 3]}`}
              onPress={() => setLaneIdx((l) => (l + 1) % (phase === '공방 순간(스파이크)' ? 4 : 3))}
            />
          </>
        ) : null}
        {phase === '디그 순간' ? (
          <Ctl label={`낙하: ${DIG_SPOTS[digIdxSpot].ko}`} onPress={() => setDigIdxSpot((d) => (d + 1) % DIG_SPOTS.length)} />
        ) : null}
      </View>

      {/* 코트 */}
      <View style={{ paddingVertical: 26, alignItems: 'center' }}>
        <View style={[st.court, { width: W, height: H }]}>
          <View style={[st.half, { top: 0, height: H / 2, backgroundColor: '#3a2a1a' }]} />
          <View style={[st.half, { bottom: 0, height: H / 2, backgroundColor: '#1a2e3a' }]} />
          <View style={[st.net, { top: H / 2 - 1.5 }]} />
          <View style={[st.attack, { top: H * 0.34 }]} />
          <View style={[st.attack, { top: H * 0.66 }]} />
          {zoneGuides.map((g) => (
            <Text key={g.key} style={[st.zoneNo, { left: g.x - 6, top: g.y - 9 }]}>{g.z}</Text>
          ))}
          {phase === '디그 순간' ? (
            <View style={[st.ballSpot, { left: digSpot.x - 7, top: digSpot.y - 7 }]} />
          ) : null}
          {markers.map((m) => (
            <View key={m.key} style={[st.marker, {
              left: m.pos.x - MR, top: m.pos.y - MR,
              backgroundColor: POS_COLOR[m.label] + 'dd',
              borderColor: m.isServer ? theme.warn : m.swapped ? '#c084fc' : 'transparent',
              borderWidth: m.isServer || m.swapped ? 2.5 : 0,
            }]}>
              <Text style={st.mTxt}>{m.label}</Text>
              <Text style={st.mZone}>{m.z}</Text>
            </View>
          ))}
        </View>
      </View>

      <Card>
        <Muted style={{ fontSize: 12 }}>
          홈(아래) {getTeam(homeId)?.name} vs 원정(위) {getTeam(awayId)?.name} · 로테이션/국면/서브권을 눌러 전 조합 확인.
          헤드리스 전수 검사: npx tsx tools/checkCourtBoard.ts
        </Muted>
      </Card>
    </Screen>
  );
}

function Ctl({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={st.ctl}>
      <Text style={st.ctlTxt}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  ctl: { borderWidth: 1, borderColor: theme.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  ctlTxt: { color: theme.accent, fontWeight: '800', fontSize: 13 },
  court: { borderRadius: 10, borderWidth: 2, borderColor: theme.muted, overflow: 'visible' },
  half: { position: 'absolute', left: 0, right: 0 },
  net: { position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: theme.text },
  attack: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: theme.muted + '55' },
  zoneNo: { position: 'absolute', color: theme.muted + '66', fontSize: 12, fontWeight: '900' },
  marker: { position: 'absolute', width: MR * 2, height: MR * 2, borderRadius: MR, alignItems: 'center', justifyContent: 'center' },
  mTxt: { color: '#0b1220', fontSize: 10, fontWeight: '900', lineHeight: 11 },
  mZone: { color: '#0b1220', fontSize: 8, fontWeight: '700', lineHeight: 9, opacity: 0.7 },
  ballSpot: {
    position: 'absolute', width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#ffd23f', borderWidth: 2, borderColor: '#b8860b',
  },
});
