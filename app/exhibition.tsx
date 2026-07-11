// 테스트 경기 — 일정과 무관하게 임의 두 팀을 골라 경기를 돌려본다. 결과는 저장하지 않는다.
import { Redirect, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Loading, Muted, OvrBadge, Row, Screen, SCREEN_LOADING_MIN_MS, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { LEAGUE, shortTeamName as shortName } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { restedOnDay } from '../data/rotation';
import { teamOverallRaw } from '../engine/overall';
import { DEV_TOOLS } from '../data/flags';
import { useGameStore } from '../store/useGameStore';

export default function Exhibition() {
  if (!DEV_TOOLS) return <Redirect href="/(tabs)/" />; // 테스트 경기 — 실전 빌드 차단
  // 프리뷰 전력이 availableTeamPlayers(dyn) 재계산에 의존 → 세션 중 baseVersion 범프 뒤 진입 프리즈 방지(UI-4).
  // DEV_TOOLS는 모듈 상수라 위 조기 반환 뒤 훅 순서는 렌더마다 안정(기존 useState/useRouter도 동일).
  const ready = useDeferredReady(SCREEN_LOADING_MIN_MS);
  if (!ready) return <Loading title="테스트 경기" variant="list" />;
  return <ExhibitionInner />;
}

function ExhibitionInner() {
  const router = useRouter();
  const currentDay = useGameStore((s) => s.currentDay);
  const myId = useGameStore((s) => s.selectedTeamId);

  const teams = LEAGUE.teams;
  const firstId = myId ?? teams[0].id;
  const [homeId, setHomeId] = useState(firstId);
  const [awayId, setAwayId] = useState(() => (teams.find((t) => t.id !== firstId) ?? teams[0]).id);
  const [seed, setSeed] = useState(1);

  // 프리뷰 전력 = sandbox 경기(buildMatchBox)가 실제로 쓰는 명단과 동일 — 출전 가능(부상·정지·벤치) + 주전 휴식(restedOnDay) 제외.
  const rosterFor = (teamId: string) => {
    const rest = restedOnDay(teamId, currentDay);
    const avail = availableTeamPlayers(teamId, currentDay);
    return rest.size ? avail.filter((p) => !rest.has(p.id)) : avail;
  };
  const homeOvr = useMemo(() => teamOverallRaw(rosterFor(homeId)), [homeId, currentDay]);
  const awayOvr = useMemo(() => teamOverallRaw(rosterFor(awayId)), [awayId, currentDay]);

  const same = homeId === awayId;

  const run = () => {
    if (same) return;
    router.push(`/match/sandbox?sandbox=1&home=${homeId}&away=${awayId}&seed=${seed}`);
  };

  const TeamRow = ({ label, value, onPick }: { label: string; value: string; onPick: (id: string) => void }) => (
    <View style={{ gap: 6 }}>
      <Muted style={{ fontSize: 12 }}>{label}</Muted>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {teams.map((t) => {
          const on = t.id === value;
          return (
            <Pressable
              key={t.id}
              onPress={() => onPick(t.id)}
              style={[styles.chip, on && { borderColor: theme.accent, backgroundColor: theme.accent + '22' }]}
            >
              <Text style={{ color: on ? theme.accent : theme.muted, fontWeight: '800', fontSize: 13 }}>
                {shortName(t.id)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <Screen title="테스트 경기">
      <Card>
        <Muted style={{ fontSize: 12 }}>
          일정과 무관하게 두 팀을 골라 경기를 돌려봅니다. 현재 시점 스탯으로 시뮬하며
          결과는 시즌에 반영되지 않습니다.
        </Muted>
      </Card>

      <Card>
        <TeamRow label="홈" value={homeId} onPick={setHomeId} />
        <View style={{ height: 12 }} />
        <TeamRow label="원정" value={awayId} onPick={setAwayId} />
      </Card>

      <Card>
        <Row>
          <View style={{ alignItems: 'center', gap: 2, flex: 1 }}>
            <Text style={styles.tname} numberOfLines={1}>{shortName(homeId)}</Text>
            <OvrBadge value={homeOvr} />
          </View>
          <Text style={{ color: theme.muted, fontWeight: '800' }}>VS</Text>
          <View style={{ alignItems: 'center', gap: 2, flex: 1 }}>
            <Text style={styles.tname} numberOfLines={1}>{shortName(awayId)}</Text>
            <OvrBadge value={awayOvr} />
          </View>
        </Row>
      </Card>

      {same ? <Muted style={{ fontSize: 12, color: theme.bad }}>서로 다른 두 팀을 골라주세요.</Muted> : null}

      <Button label="경기 실행" onPress={run} />
      <Button label="다른 결과로 다시 (시드 변경)" variant="ghost" onPress={() => setSeed((s) => s + 1)} />
      <Muted style={{ fontSize: 11 }}>현재 시드: {seed}</Muted>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  chip: {
    borderWidth: 1, borderColor: theme.border, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.card,
  },
  tname: { color: theme.text, fontSize: 15, fontWeight: '800' },
}));
