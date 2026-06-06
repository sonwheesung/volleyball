import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Muted, PosTag, Screen, Title, theme } from '../../components/Screen';
import { getEvolvedTeamPlayers, getFixture, getTeam } from '../../data/league';
import { teamOverall } from '../../engine/overall';
import { attributeProduction, emptyProd, type ProdLine } from '../../engine/production';
import { simulateMatchSimple } from '../../engine/simMatch';
import type { Player } from '../../types';

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

  const home = getEvolvedTeamPlayers(fixture.homeTeamId, fixture.dayIndex);
  const away = getEvolvedTeamPlayers(fixture.awayTeamId, fixture.dayIndex);
  const sim = simulateMatchSimple(fixture.seed, teamOverall(home), teamOverall(away));
  const box = attributeProduction(sim, home, away, fixture.seed);

  const homeName = getTeam(fixture.homeTeamId)?.name ?? '';
  const awayName = getTeam(fixture.awayTeamId)?.name ?? '';

  const lines = (players: Player[]) =>
    players
      .map((p) => ({ p, l: box.get(p.id) ?? emptyProd() }))
      .filter((x) => x.l.points || x.l.assists || x.l.digs)
      .sort((a, b) => b.l.points - a.l.points || b.l.digs - a.l.digs);

  const TeamBox = ({ name, players }: { name: string; players: Player[] }) => (
    <>
      <Title>{name}</Title>
      <Card>
        <View style={[styles.row, styles.head]}>
          <Text style={[styles.name, styles.h]}>선수</Text>
          <Text style={[styles.col, styles.h]}>득점</Text>
          <Text style={[styles.col, styles.h]}>블록</Text>
          <Text style={[styles.col, styles.h]}>서브</Text>
          <Text style={[styles.col, styles.h]}>디그</Text>
          <Text style={[styles.col, styles.h]}>세트</Text>
        </View>
        {lines(players).map(({ p, l }) => (
          <View key={p.id} style={styles.row}>
            <View style={styles.nameCell}>
              <PosTag pos={p.position} />
              <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
            </View>
            <Text style={[styles.col, styles.pts]}>{l.points}</Text>
            <Text style={styles.col}>{l.blocks}</Text>
            <Text style={styles.col}>{l.aces}</Text>
            <Text style={styles.col}>{l.digs}</Text>
            <Text style={styles.col}>{l.assists}</Text>
          </View>
        ))}
      </Card>
    </>
  );

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

      <TeamBox name={homeName} players={home} />
      <TeamBox name={awayName} players={away} />
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
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  head: { borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: 6, marginBottom: 2 },
  h: { color: theme.muted, fontSize: 12, fontWeight: '700' },
  nameCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  col: { width: 38, textAlign: 'center', color: theme.text, fontSize: 13 },
  pts: { fontWeight: '800' },
});
