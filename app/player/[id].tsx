import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Card, Muted, OvrBadge, PosTag, Row, Screen, StatBar, Title, theme } from '../../components/Screen';
import { getEvolvedPlayer } from '../../data/league';
import { overall } from '../../engine/overall';
import { deriveRatings } from '../../engine/ratings';
import { useGameStore } from '../../store/useGameStore';

export default function PlayerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentDay = useGameStore((s) => s.currentDay);
  const p = id ? getEvolvedPlayer(id, currentDay) : undefined;

  if (!p) {
    return (
      <Screen title="선수 없음">
        <Muted>존재하지 않는 선수입니다.</Muted>
      </Screen>
    );
  }

  const r = deriveRatings(p);

  return (
    <Screen title={p.name}>
      <Card>
        <Row>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <PosTag pos={p.position} full />
            {p.isForeign ? <Text style={{ color: theme.bad, fontWeight: '700' }}>외국인</Text> : null}
          </View>
          <OvrBadge value={overall(p)} />
        </Row>
        <Muted>{p.age}세 · {p.height}cm · 전성기 {p.peakAge}세</Muted>
      </Card>

      <Title>종합 스탯 (윗단)</Title>
      <Card>
        <StatBar label="스파이크" value={r.spike} />
        <StatBar label="블로킹" value={r.block} />
        <StatBar label="디그" value={r.dig} />
        <StatBar label="리시브" value={r.receive} />
        <StatBar label="세팅" value={r.set} />
        <StatBar label="서브" value={r.serve} />
      </Card>

      <Title>세부 스탯 (밑단)</Title>
      <Card>
        <Muted style={{ marginBottom: 2 }}>신체</Muted>
        <StatBar label="점프력" value={p.jump} />
        <StatBar label="민첩성" value={p.agility} />
        <StatBar label="체력" value={p.staminaMax} />
        <StatBar label="체젠" value={p.staminaRegen} />
        <View style={{ height: 6 }} />
        <Muted style={{ marginBottom: 2 }}>공통 / 멘탈</Muted>
        <StatBar label="반응속도" value={p.reaction} />
        <StatBar label="위치선정" value={p.positioning} />
        <StatBar label="집중력" value={p.focus} />
        <StatBar label="기복" value={p.consistency} />
        <StatBar label="VQ" value={p.vq} />
      </Card>

      <Title>기술치</Title>
      <Card>
        <StatBar label="공격기술" value={p.skSpike} />
        <StatBar label="블로킹기술" value={p.skBlock} />
        <StatBar label="디그기술" value={p.skDig} />
        <StatBar label="리시브기술" value={p.skReceive} />
        <StatBar label="세팅기술" value={p.skSet} />
        <StatBar label="서브기술" value={p.skServe} />
      </Card>
    </Screen>
  );
}
