import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Muted, Screen, Title, theme } from '../components/Screen';
import { getTeam } from '../data/league';
import { buildPlayoffs, type Matchup } from '../data/playoffs';
import { useGameStore } from '../store/useGameStore';

export default function Playoffs() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const recordChampion = useGameStore((s) => s.recordChampion);

  const po = useMemo(() => buildPlayoffs(season), [season]);

  useEffect(() => {
    if (po.championId) recordChampion(season, po.championId);
  }, [season, po.championId, recordChampion]);

  const name = (id: string) => getTeam(id)?.name ?? id;
  const champ = po.championId ? name(po.championId) : '-';

  const SeriesCard = ({ title, m }: { title: string; m: Matchup }) => {
    const hiName = name(m.hiId);
    const loName = name(m.loId);
    return (
      <Card>
        <Muted>{title}</Muted>
        <View style={styles.matchup}>
          <Text style={[styles.team, { textAlign: 'right' }, m.winnerId === m.hiId && styles.win, m.hiId === my && styles.mine]} numberOfLines={1}>
            {hiName}
          </Text>
          <Text style={styles.score}>{m.series.hiWins} : {m.series.loWins}</Text>
          <Text style={[styles.team, m.winnerId === m.loId && styles.win, m.loId === my && styles.mine]} numberOfLines={1}>
            {loName}
          </Text>
        </View>
        <Text style={styles.games}>
          {m.series.games.map((g) => `${g.hiSets}-${g.loSets}`).join('  ')}
        </Text>
      </Card>
    );
  };

  return (
    <Screen title={`${season + 1}시즌 포스트시즌`} scroll={false}>
      <Card>
        <Muted>진출 (상위 3팀)</Muted>
        {po.seeds.map((id, i) => (
          <Text key={id} style={[styles.seed, id === my && styles.mine]}>
            {i + 1}위 {name(id)} {i === 0 ? '(챔프전 직행)' : ''}
          </Text>
        ))}
      </Card>

      {po.po ? <SeriesCard title="플레이오프 (2위 vs 3위 · 3전2선승)" m={po.po} /> : null}
      {po.final ? <SeriesCard title="챔피언결정전 (5전3선승)" m={po.final} /> : null}

      <Card>
        <Title>🏆 우승 — {champ}</Title>
        {po.championId === my ? <Muted style={{ color: theme.good }}>우리 구단이 우승했습니다!</Muted> : null}
      </Card>

      <Button label="오프시즌 · 외국인 트라이아웃 →" onPress={() => router.push('/tryout')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  seed: { color: theme.text, fontSize: 15, fontWeight: '600', marginTop: 2 },
  matchup: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  team: { flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' },
  score: { color: theme.text, fontSize: 18, fontWeight: '900', minWidth: 52, textAlign: 'center' },
  games: { color: theme.muted, fontSize: 12, textAlign: 'center', marginTop: 4 },
  win: { color: theme.good, fontWeight: '800' },
  mine: { color: theme.accent },
});
