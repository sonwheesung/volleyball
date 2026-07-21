import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Muted, PosTag, Screen, Title, theme, themedStyles } from '../../components/Screen';
import { BoxScoreTable } from '../../components/BoxScoreTable';
import { getFixture, getTeam, coachInfoOf } from '../../data/league';
import { buildMatchBox } from '../../data/matchBox';
import { interventionsFor } from '../../data/dynamics';
import { matchMvp } from '../../data/matchAward';

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

  // 관전 보드와 동일 단일 소스(buildMatchBox) — 명단(부상·정지·벤치+휴식 #3)·시뮬·박스가 항상 일치.
  const { homeSquad: home, awaySquad: away, sim, box } = buildMatchBox(fixture.homeTeamId, fixture.awayTeamId, fixture.dayIndex, fixture.seed, interventionsFor(fixture.id));

  const homeName = getTeam(fixture.homeTeamId)?.name ?? '';
  const awayName = getTeam(fixture.awayTeamId)?.name ?? '';
  const mvp = matchMvp(box, home, away, sim, homeName, awayName);

  return (
    <Screen title="경기 상세">
      <Card accent={theme.sky} flat>
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

      {mvp ? (
        <>
          <Title>MVP</Title>
          <Card accent={theme.warn} flat>
          <View style={styles.mvpRow}>
            <PosTag pos={mvp.position} />
            <View style={{ flex: 1 }}>
              <Text style={styles.mvpName}>{mvp.name}</Text>
              <Text style={styles.mvpStat}>
                {mvp.points}득점{mvp.blocks ? ` · 블로킹 ${mvp.blocks}` : ''}{mvp.aces ? ` · 서브 ${mvp.aces}` : ''}{mvp.digs ? ` · 디그 ${mvp.digs}` : ''}
              </Text>
            </View>
          </View>
          <Text style={styles.mvpLine}>{mvp.line}</Text>
          </Card>
        </>
      ) : null}

      <Title>{homeName}</Title>
      <Card accent={theme.elite} flat><BoxScoreTable squad={home} box={box} dvPhilosophy={coachInfoOf(fixture.homeTeamId)?.dvPhilosophy ?? 0} /></Card>
      <Title>{awayName}</Title>
      <Card accent={theme.elite} flat><BoxScoreTable squad={away} box={box} dvPhilosophy={coachInfoOf(fixture.awayTeamId)?.dvPhilosophy ?? 0} /></Card>
      <Text style={styles.hint}>득점=공격+블록+에이스 · 공격=성공/시도/성공률 · 리시브=효율((정확−실패)/시도)</Text>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  scoreboard: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bigTeam: { flex: 1, color: theme.text, fontSize: 16, fontWeight: '800' },
  bigScore: { color: theme.text, fontSize: 30, fontWeight: '900', minWidth: 84, textAlign: 'center' },
  sets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 8 },
  setChip: { backgroundColor: theme.cardAlt, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center' },
  setLabel: { color: theme.muted, fontSize: 10 },
  setScore: { color: theme.text, fontSize: 14, fontWeight: '800' },
  hint: { color: theme.muted, fontSize: 10.5, lineHeight: 15, marginTop: 2 },
  mvpRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  mvpName: { color: theme.text, fontSize: 16, fontWeight: '800' },
  mvpStat: { color: theme.muted, fontSize: 12.5, marginTop: 1 },
  mvpLine: { color: theme.text, fontSize: 13, marginTop: 8, lineHeight: 18 },
}));
