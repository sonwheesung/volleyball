import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Card, Muted, Row, Screen, StatBar, Title, theme } from '../../components/Screen';
import { getCoach, getTeam } from '../../data/league';
import { TRAINING_NAME } from '../../engine/training';

const STYLE_LABEL = { attack: '공격형', defense: '수비형', balanced: '밸런스' } as const;
const STYLE_DESC = {
  attack: '공격적 서브·속공 비중↑, 공격적 블로킹. 타임아웃을 아끼고 밀어붙인다.',
  defense: '안정 서브·소프트 블로킹·디그 중심. 위기에 타임아웃을 빨리 부른다.',
  balanced: '무난한 분포. 상황에 따라 균형 있게 운영한다.',
} as const;

export default function CoachDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = id ? getCoach(id) : undefined;

  if (!c) {
    return (
      <Screen title="감독 없음">
        <Muted>존재하지 않는 감독입니다.</Muted>
      </Screen>
    );
  }

  const team = getTeam(c.teamId);

  return (
    <Screen title={c.name}>
      <Card>
        <Row>
          <Muted>{team?.name ?? ''} 감독</Muted>
          <Muted>{c.age}세</Muted>
        </Row>
      </Card>

      <Title>성향 · {STYLE_LABEL[c.style]}</Title>
      <Card>
        <Muted>{STYLE_DESC[c.style]}</Muted>
      </Card>

      <Title>능력</Title>
      <Card>
        <StatBar label="카리스마" value={c.charisma} />
        <Muted style={{ marginTop: 4 }}>
          카리스마가 높을수록 타임아웃 때 경기 흐름(기세)을 강하게 끌어온다.
        </Muted>
      </Card>

      <Title>훈련 성향 · {c.archetype}</Title>
      <Card>
        <Muted>핵심 훈련 (집중 육성)</Muted>
        <Text style={{ color: theme.accent, fontWeight: '700' }}>
          {c.trainingFocus.primary.map((id) => TRAINING_NAME[id]).join(' · ')}
        </Text>
        <Muted style={{ marginTop: 6 }}>보조 훈련</Muted>
        <Text style={{ color: theme.text }}>
          {c.trainingFocus.secondary.map((id) => TRAINING_NAME[id]).join(' · ')}
        </Text>
        <Muted style={{ marginTop: 6 }}>
          이 성향에 따라 선수들이 서로 다른 스탯으로 천천히 성장한다.
        </Muted>
      </Card>
    </Screen>
  );
}
