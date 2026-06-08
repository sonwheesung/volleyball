import { useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Card, Muted, Row, Screen, StatBar, Title, theme } from '../../components/Screen';
import { getCoach, getTeam } from '../../data/league';
import { TRAINING_NAME } from '../../engine/training';
import { ARCHETYPES } from '../../data/seed';
import { useGameStore } from '../../store/useGameStore';
import type { TrainingFocus } from '../../types';

const sameFocus = (a: TrainingFocus, b: TrainingFocus): boolean =>
  [...a.primary].sort().join() === [...b.primary].sort().join() &&
  [...a.secondary].sort().join() === [...b.secondary].sort().join();

const STYLE_LABEL = { attack: '공격형', defense: '수비형', balanced: '밸런스' } as const;
const STYLE_DESC = {
  attack: '공격적 서브·속공 비중↑, 공격적 블로킹. 타임아웃을 아끼고 밀어붙인다.',
  defense: '안정 서브·소프트 블로킹·디그 중심. 위기에 타임아웃을 빨리 부른다.',
  balanced: '무난한 분포. 상황에 따라 균형 있게 운영한다.',
} as const;

export default function CoachDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = id ? getCoach(id) : undefined;
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);
  const trainingFocus = useGameStore((s) => s.trainingFocus);
  const setTrainingFocus = useGameStore((s) => s.setTrainingFocus);

  if (!c) {
    return (
      <Screen title="감독 없음">
        <Muted>존재하지 않는 감독입니다.</Muted>
      </Screen>
    );
  }

  const team = getTeam(c.teamId);
  const isMine = !!selectedTeamId && c.teamId === selectedTeamId;
  // 실제 적용 중인 방향: 단장 오버라이드 우선, 없으면 감독 기본
  const applied: TrainingFocus = isMine && trainingFocus ? trainingFocus : c.trainingFocus;

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

      {isMine ? (
        <>
          <Title>훈련 방향 변경 (단장)</Title>
          <Card>
            <Muted>팀의 장기 성장 방향을 직접 고른다. 다음 진행부터 즉시 반영.</Muted>
            <View style={{ gap: 6, marginTop: 8 }}>
              <FocusOption
                label={`감독 기본 · ${c.archetype}`}
                selected={!trainingFocus}
                onPress={() => setTrainingFocus(null)}
              />
              {ARCHETYPES.map((a) => (
                <FocusOption
                  key={a.name}
                  label={`${a.name} · ${a.focus.primary.map((id) => TRAINING_NAME[id]).join('/')}`}
                  selected={!!trainingFocus && sameFocus(applied, a.focus)}
                  onPress={() => setTrainingFocus(a.focus)}
                />
              ))}
            </View>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function FocusOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
          borderColor: selected ? theme.accent : theme.border,
          backgroundColor: selected ? theme.accent + '22' : 'transparent',
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={{ color: selected ? theme.accent : theme.text, fontWeight: selected ? '800' : '600' }}>
        {selected ? '✓ ' : ''}{label}
      </Text>
    </Pressable>
  );
}
