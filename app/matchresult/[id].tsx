import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Muted, Screen, Title, theme } from '../../components/Screen';
import { BoxScoreTable } from '../../components/BoxScoreTable';
import { coachInfoOf, getFixture, getTeam } from '../../data/league';
import { availableTeamPlayers } from '../../data/injury';
import { restedOnDay } from '../../data/rotation';
import { simulateMatch } from '../../engine/match';
import type { BoxSink } from '../../engine/rally';

export default function MatchResult() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const fixture = id ? getFixture(id) : undefined;

  if (!fixture) {
    return (
      <Screen title="경기">
        <Muted>존재하지 않는 경기입니다.</Muted>
      </Screen>
    );
  }

  // 관전 보드·정사(production·standings)와 동일 명단(부상·정지·벤치 + 휴식 #3 반영) — 박스스코어 완전 일치.
  const dayIndex = fixture.dayIndex;
  const homeRest = restedOnDay(fixture.homeTeamId, dayIndex);
  const awayRest = restedOnDay(fixture.awayTeamId, dayIndex);
  const home = homeRest.size ? availableTeamPlayers(fixture.homeTeamId, dayIndex).filter((p) => !homeRest.has(p.id)) : availableTeamPlayers(fixture.homeTeamId, dayIndex);
  const away = awayRest.size ? availableTeamPlayers(fixture.awayTeamId, dayIndex).filter((p) => !awayRest.has(p.id)) : availableTeamPlayers(fixture.awayTeamId, dayIndex);
  // 경기 보드 스코어박스와 동일 — 실제 스윙 단위 박스 싱크(클론만, 승패 불변). box는 최종 누적.
  const box: BoxSink = new Map();
  const sim = simulateMatch(fixture.seed, home, away, {
    home: coachInfoOf(fixture.homeTeamId), away: coachInfoOf(fixture.awayTeamId), box,
  });

  const homeName = getTeam(fixture.homeTeamId)?.name ?? '';
  const awayName = getTeam(fixture.awayTeamId)?.name ?? '';

  return (
    <Screen title="경기 상세">
      <Card>
        <View style={styles.scoreboard}>
          <Text style={[styles.bigTeam, { textAlign: 'right' }]} numberOfLines={2}>{homeName}</Text>
          <Text style={styles.bigScore}>{sim.homeSets} : {sim.awaySets}</Text>
          <Text style={styles.bigTeam} numberOfLines={2}>{awayName}</Text>
        </View>
        <View style={styles.sets}>
          {sim.setScores.map((s, i) => (
            <View key={i} style={styles.setChip}>
              <Text style={styles.setLabel}>{i + 1}세트</Text>
              <Text style={styles.setScore}>{s.home}:{s.away}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Title>{homeName}</Title>
      <Card><BoxScoreTable squad={home} box={box} /></Card>
      <Title>{awayName}</Title>
      <Card><BoxScoreTable squad={away} box={box} /></Card>
      <Text style={styles.hint}>득점=공격+블록+에이스 · 공격=성공/시도/성공률 · 리시브=효율((정확−실패)/시도)</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scoreboard: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bigTeam: { flex: 1, color: theme.text, fontSize: 16, fontWeight: '800' },
  bigScore: { color: theme.text, fontSize: 30, fontWeight: '900', minWidth: 84, textAlign: 'center' },
  sets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 8 },
  setChip: { backgroundColor: theme.cardAlt, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center' },
  setLabel: { color: theme.muted, fontSize: 10 },
  setScore: { color: theme.text, fontSize: 14, fontWeight: '800' },
  hint: { color: theme.muted, fontSize: 10.5, lineHeight: 15, marginTop: 2 },
});
