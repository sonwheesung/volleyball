// 보드 위치 검증 뷰어(개발) — 로테이션·국면·사이드를 넘기며 모든 대형을 정지 화면으로 확인.
// MatchCourt와 동일한 courtLayout 순수 모듈을 그대로 그림 → 보이는 좌표 = 실제 경기 좌표.

import { useMemo, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Muted, Screen, theme } from '../components/Screen';
import { LEAGUE, getEvolvedTeamPlayers, getTeam } from '../data/league';
import { buildLineup } from '../engine/lineup';
import {
  receiveFormation, switchedSpots, displayPos, zoneOfIdx, zonePx, lineupIdxAt,
} from '../components/courtLayout';
import { useGameStore } from '../store/useGameStore';
import type { Position, Side } from '../types';

const POS_COLOR: Record<Position, string> = {
  S: '#a78bfa', OH: '#38bdf8', OP: '#f87171', MB: '#fbbf24', L: '#4ade80',
};

const W = Dimensions.get('window').width - 32;
const H = Math.min(W * 1.4, Dimensions.get('window').height * 0.5);
const MR = 15;

type Phase = '리시브 대형' | '스위칭(공격)' | '스위칭(수비)' | '존 기본위치';
const PHASES: Phase[] = ['리시브 대형', '스위칭(공격)', '스위칭(수비)', '존 기본위치'];

export default function DebugCourt() {
  const myTeam = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const [rot, setRot] = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [serving, setServing] = useState<Side>('away'); // 리시브 대형 = 받는 쪽 기준 표시

  const homeId = myTeam ?? LEAGUE.teams[0].id;
  const awayId = LEAGUE.teams.find((t) => t.id !== homeId)?.id ?? LEAGUE.teams[1].id;
  const lus = useMemo(() => ({
    home: buildLineup(getEvolvedTeamPlayers(homeId, currentDay)),
    away: buildLineup(getEvolvedTeamPlayers(awayId, currentDay)),
  }), [homeId, awayId, currentDay]);

  const phase = PHASES[phaseIdx];

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
});
