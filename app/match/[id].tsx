import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Muted, theme } from '../../components/Screen';
import { MatchCourt } from '../../components/MatchCourt';
import { coachInfoOf, getFixture, getTeam } from '../../data/league';
import { availableTeamPlayers } from '../../data/injury';
import { teamOverall } from '../../engine/overall';
import { simulateMatch } from '../../engine/match';
import { useGameStore } from '../../store/useGameStore';

export default function MatchBoard() {
  const { id, sandbox, home: homeParam, away: awayParam, seed: seedParam } = useLocalSearchParams<{
    id: string; sandbox?: string; home?: string; away?: string; seed?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const subPolicy = useGameStore((s) => s.subPolicy);
  const setSubPolicy = useGameStore((s) => s.setSubPolicy);
  const recordResult = useGameStore((s) => s.recordResult);
  const recorded = useRef(false);

  const isSandbox = sandbox === '1';
  const fixture = id && !isSandbox ? getFixture(id) : undefined;

  const data = useMemo(() => {
    let home, away, dayIndex: number, seed: number;
    if (isSandbox) {
      home = homeParam ? getTeam(homeParam) : undefined;
      away = awayParam ? getTeam(awayParam) : undefined;
      if (!home || !away) return null;
      dayIndex = currentDay;
      seed = Number(seedParam) || 1;
    } else {
      if (!fixture) return null;
      home = getTeam(fixture.homeTeamId);
      away = getTeam(fixture.awayTeamId);
      if (!home || !away) return null;
      dayIndex = fixture.dayIndex;
      seed = fixture.seed;
    }
    // 그날 출전 가능 명단(부상·시즌 중 이동 반영) — 결장 선수가 코트에 보이지 않게, 순위표 리플레이와 동일 소스
    const homeSquad = availableTeamPlayers(home.id, dayIndex);
    const awaySquad = availableTeamPlayers(away.id, dayIndex);
    // 내 팀 경기엔 내 작전 방침 적용(관전=내 프리셋 반영). 상대는 AI 기본.
    const sim = simulateMatch(seed, homeSquad, awaySquad, {
      home: coachInfoOf(home.id), away: coachInfoOf(away.id),
      homePolicy: selectedTeamId === home.id ? subPolicy : undefined,
      awayPolicy: selectedTeamId === away.id ? subPolicy : undefined,
    });
    return {
      home, away, homeSquad, awaySquad, seed, sim,
      homeOvr: teamOverall(homeSquad), awayOvr: teamOverall(awaySquad),
    };
  }, [fixture, isSandbox, homeParam, awayParam, seedParam, currentDay, selectedTeamId, subPolicy]);

  const onFinished = useCallback(() => {
    if (isSandbox || !data || !fixture || recorded.current) return;
    recorded.current = true;
    recordResult({ fixtureId: fixture.id, homeSets: data.sim.homeSets, awaySets: data.sim.awaySets });
  }, [isSandbox, data, fixture, recordResult]);

  if (!data) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
        <Muted>존재하지 않는 경기입니다.</Muted>
        <Button label="나가기" onPress={() => router.back()} />
      </View>
    );
  }

  const mineSide = selectedTeamId === data.home.id ? 'home' : selectedTeamId === data.away.id ? 'away' : null;
  const winnerName = data.sim.homeSets > data.sim.awaySets ? data.home.name : data.away.name;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 16 }]}
    >
      {isSandbox ? <Text style={styles.sandboxTag}>테스트 경기 · 결과 미적용</Text> : null}

      <View style={styles.header}>
        <View style={styles.teamHead}>
          <Text style={[styles.teamName, mineSide === 'home' && { color: theme.accent }]} numberOfLines={1}>
            {data.home.name}
          </Text>
          <Text style={styles.teamOvr}>OVR {data.homeOvr}</Text>
        </View>
        <Text style={styles.vs}>VS</Text>
        <View style={[styles.teamHead, { alignItems: 'flex-end' }]}>
          <Text style={[styles.teamName, { textAlign: 'right' }, mineSide === 'away' && { color: theme.accent }]} numberOfLines={1}>
            {data.away.name}
          </Text>
          <Text style={styles.teamOvr}>OVR {data.awayOvr}</Text>
        </View>
      </View>

      {mineSide && !recorded.current ? (
        <View style={styles.policyPanel}>
          <Text style={styles.policyTitle}>작전 방침 (내 팀)</Text>
          {([
            ['pinchServer', '핀치 서버'],
            ['blockSub', '블로킹 강화'],
            ['defSub', '수비 강화'],
          ] as const).map(([key, label]) => (
            <View key={key} style={styles.policyRow}>
              <Text style={styles.policyLabel}>{label}</Text>
              <Switch
                value={subPolicy[key]}
                onValueChange={(v) => setSubPolicy({ [key]: v })}
                trackColor={{ true: theme.accent, false: theme.cardAlt }}
              />
            </View>
          ))}
          <Muted style={{ fontSize: 11 }}>방침을 바꾸면 경기가 다시 계산됩니다.</Muted>
        </View>
      ) : null}

      <MatchCourt
        sim={data.sim}
        home={data.homeSquad}
        away={data.awaySquad}
        seed={data.seed}
        mineSide={mineSide}
        onFinished={onFinished}
      />

      {/* 세트 스코어 */}
      <View style={styles.setScores}>
        {data.sim.setScores.map((s, i) => (
          <View key={i} style={styles.setChip}>
            <Text style={styles.setChipLabel}>{i + 1}세트</Text>
            <Text style={styles.setChipScore}>{s.home}:{s.away}</Text>
          </View>
        ))}
      </View>

      <View style={{ height: 4 }} />
      <Button label={`나가기 (${winnerName} 승)`} onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { paddingHorizontal: 16, gap: 12 },
  sandboxTag: { color: theme.warn, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamHead: { flex: 1, gap: 2 },
  teamName: { color: theme.text, fontSize: 17, fontWeight: '800' },
  teamOvr: { color: theme.muted, fontSize: 12 },
  vs: { color: theme.muted, fontSize: 13, fontWeight: '800' },
  setScores: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  setChip: { backgroundColor: theme.card, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center' },
  setChipLabel: { color: theme.muted, fontSize: 10 },
  setChipScore: { color: theme.text, fontSize: 14, fontWeight: '800' },
  policyPanel: { backgroundColor: theme.card, borderRadius: 12, padding: 12, gap: 6 },
  policyTitle: { color: theme.text, fontSize: 14, fontWeight: '800', marginBottom: 2 },
  policyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  policyLabel: { color: theme.text, fontSize: 14 },
});
