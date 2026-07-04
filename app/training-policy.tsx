// 훈련 방침 — 단장이 팀 장기 성장 방향을 고른다(감독 기본 또는 아키타입 오버라이드).
// 감독 정보 화면에 있던 "훈련 방향 변경(단장)" 셀렉터를 단장실로 이동(2026-07-04 사용자 요청).
// 즉시 적용 → **초안 선택 후 저장(confirm) 확정** 방식으로 변경(오조작 방지). 저장은 다음 진행부터 반영.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, IconLabel, Muted, Screen, theme } from '../components/Screen';
import { showAlert } from '../components/AppDialog';
import { getTeamCoach } from '../data/league';
import { TRAINING_NAME } from '../engine/training';
import { ARCHETYPES } from '../data/seed';
import { useGameStore } from '../store/useGameStore';
import type { TrainingFocus } from '../types';

const sameFocus = (a: TrainingFocus, b: TrainingFocus): boolean =>
  [...a.primary].sort().join() === [...b.primary].sort().join() &&
  [...a.secondary].sort().join() === [...b.secondary].sort().join();
// null(감독 기본) 포함 동등 비교
const focusEq = (a: TrainingFocus | null, b: TrainingFocus | null): boolean =>
  a === null || b === null ? a === b : sameFocus(a, b);

export default function TrainingPolicy() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const trainingFocus = useGameStore((s) => s.trainingFocus); // 현재 저장된 방침(null=감독 기본)
  const setTrainingFocus = useGameStore((s) => s.setTrainingFocus);
  const coach = getTeamCoach(teamId);
  const [draft, setDraft] = useState<TrainingFocus | null>(trainingFocus); // 아직 저장 안 한 선택

  const dirty = !focusEq(draft, trainingFocus);
  const draftLabel = draft === null
    ? `감독 기본 · ${coach?.archetype ?? ''}`
    : ARCHETYPES.find((a) => sameFocus(a.focus, draft))?.name ?? '선택한 방향';

  const onSave = () => {
    showAlert('훈련 방침 저장', `팀을 "${draftLabel}" 방향으로 육성할까요?\n다음 경기 진행부터 반영됩니다.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '저장',
        onPress: () => {
          setTrainingFocus(draft);
          showAlert('저장 완료', '다음 경기 진행부터 새 훈련 방침이 반영됩니다.', [
            { text: '확인', onPress: () => router.back() },
          ]);
        },
      },
    ]);
  };

  return (
    <Screen title="훈련 방침">
      {coach ? (
        <>
          <IconLabel icon="person-outline" color={theme.violet}>현재 감독 · {coach.name}</IconLabel>
          <Card accent={theme.violet} flat>
            <Muted>감독 기본 성향 · {coach.archetype}</Muted>
            <Text style={{ color: theme.accent, fontWeight: '700', marginTop: 3 }}>
              핵심 {coach.trainingFocus.primary.map((id) => TRAINING_NAME[id]).join(' · ')}
            </Text>
            <Muted style={{ marginTop: 4 }}>
              보조 {coach.trainingFocus.secondary.map((id) => TRAINING_NAME[id]).join(' · ')}
            </Muted>
          </Card>
        </>
      ) : null}

      <IconLabel icon="options-outline" color={theme.good}>훈련 방침 선택 (단장)</IconLabel>
      <Card accent={theme.good}>
        <Muted>팀의 장기 성장 방향을 직접 고른다. 아래에서 고른 뒤 저장하면 다음 진행부터 반영.</Muted>
        <View style={{ gap: 6, marginTop: 8 }}>
          <FocusOption
            label={`감독 기본 · ${coach?.archetype ?? ''}`}
            selected={draft === null}
            onPress={() => setDraft(null)}
          />
          {ARCHETYPES.map((a) => (
            <FocusOption
              key={a.name}
              label={`${a.name} · ${a.focus.primary.map((id) => TRAINING_NAME[id]).join('/')}`}
              selected={draft !== null && sameFocus(draft, a.focus)}
              onPress={() => setDraft(a.focus)}
            />
          ))}
        </View>
      </Card>

      <Button label={dirty ? `저장 — ${draftLabel}` : '변경 없음'} onPress={onSave} disabled={!dirty} />
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
