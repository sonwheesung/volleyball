// 훈련 방침 — 단장이 팀 장기 성장 방향을 고른다(감독 기본 또는 아키타입 오버라이드).
// 감독 정보 화면에 있던 "훈련 방향 변경(단장)" 셀렉터를 단장실로 이동(2026-07-04 사용자 요청).
// 즉시 적용 → **초안 선택 후 저장(confirm) 확정** 방식으로 변경(오조작 방지). 저장은 오늘부터 적용(지난 경기·성장은 불변).
import { useRouter, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, IconLabel, Muted, Screen, theme } from '../components/Screen';
import { BusyOverlay, useBusyRun } from '../components/BusyOverlay';
import { showAlert } from '../components/AppDialog';
import { getTeamCoach } from '../data/league';
import { computeStandings } from '../data/standings';
import { leagueProduction } from '../data/production';
import { availableTeamPlayers } from '../data/injury';
import { TRAINING_NAME } from '../engine/training';
import { ARCHETYPES } from '../data/seed';
import { useGameStore } from '../store/useGameStore';
import type { TrainingFocus } from '../types';

// 방침 저장 = setTrainingFocus → setFocusTimeline이 baseVersion++ (순위·생산·dyn 캐시 무효화).
// 그 재계산 비용이 다음 도착 화면(시즌 중 FA 영입·대시보드)으로 떠넘겨져 20~30s 프리즈를 유발했다(#62 누락분).
// → 저장 오버레이 안에서 무효화된 캐시를 미리 데운다(warmCachesForIntro 패턴): 도착 화면은 캐시히트로 즉시.
function warmAfterPolicyChange(teamId: string): void {
  try {
    computeStandings(Number.MAX_SAFE_INTEGER);
    leagueProduction(Number.MAX_SAFE_INTEGER);
    const st = useGameStore.getState();
    availableTeamPlayers(teamId, st.currentDay); // dyn 워밍 — transactions rosterIdsOnDay/availableFAsOnDay가 캐시히트
  } catch { /* 워밍 실패해도 저장은 완료 — 도착 화면이 폴백 재계산 */ }
}

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
  const busy = useBusyRun(); // 저장(setTrainingFocus)은 성장 파이프라인을 건드려 재계산 유발 → 오버레이로 마스킹(UI-27)
  const [draft, setDraft] = useState<TrainingFocus | null>(trainingFocus); // 아직 저장 안 한 선택

  const dirty = !focusEq(draft, trainingFocus);

  // 저장 안 한 변경이 있을 때만 뒤로가기(하드웨어/헤더/제스처) 확인 — 오조작으로 초안 유실 방지(P3).
  //   dirtyRef로 fresh 값 읽기(staleness 함정). 저장 후엔 dirty=false라 무개입. onSave의 router.back()은 이미 저장돼 통과.
  const navigation = useNavigation();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const unsub = (navigation as any).addListener('beforeRemove', (e: any) => {
      const t = e?.data?.action?.type;
      if (!dirtyRef.current || (t !== 'GO_BACK' && t !== 'POP')) return;
      e.preventDefault();
      showAlert('변경사항이 있습니다', '변경사항을 저장하지 않고 나갈까요?', [
        { text: '계속 편집', style: 'cancel' },
        { text: '저장 안 함', style: 'destructive', onPress: () => { dirtyRef.current = false; (navigation as any).dispatch(e.data.action); } },
      ]);
    });
    return unsub;
  }, [navigation]);

  const draftLabel = draft === null
    ? `감독 기본 · ${coach?.archetype ?? ''}`
    : ARCHETYPES.find((a) => sameFocus(a.focus, draft))?.name ?? '선택한 방향';

  const onSave = () => {
    showAlert('훈련 방침 저장', `팀을 "${draftLabel}" 방향으로 육성할까요?\n오늘부터 적용됩니다 — 지난 경기·성장은 그대로예요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '저장',
        onPress: () => busy.run('새 훈련 방침을 반영해\n전력을 다시 계산하는 중…', () => {
          setTrainingFocus(draft);          // baseVersion++ — 순위·생산·dyn 캐시 무효
          warmAfterPolicyChange(teamId);    // 무효화된 캐시를 이 오버레이 안에서 다시 데운다(도착 화면 프리즈 제거)
          showAlert('저장 완료', '오늘부터 새 훈련 방침이 적용됩니다. 지난 경기·성장은 그대로예요.', [
            { text: '확인', onPress: () => router.back() },
          ]);
        }),
      },
    ]);
  };

  return (
    <Screen title="훈련 방침">
      <BusyOverlay visible={busy.busy} message={busy.message} />
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
        <Muted>팀의 장기 성장 방향을 직접 고른다.</Muted>
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
