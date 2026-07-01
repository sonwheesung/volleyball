import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Muted, Screen, Title, theme, themedStyles } from '../components/Screen';
import { getTeam, getPlayer } from '../data/league';
import { buildPlayoffs, type Matchup } from '../data/playoffs';
import { currentSeasonAwards } from '../data/awards';
import { useGameStore } from '../store/useGameStore';
import { ChampionCelebration } from '../components/ChampionCelebration';

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
      <Card accent={theme.gold}>
        <IconLabel icon="trophy-outline" color={theme.gold}>{title}</IconLabel>
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

  const iWon = po.championId === my && !!my;
  // 챔프전 MVP — 시즌 종료 시점이라 currentSeasonAwards로 이미 산출 가능(우승 세리머니에 표시). 우승 시에만 계산(무거움 회피)
  const finalsMvpName = useMemo(() => {
    if (!iWon) return undefined;
    const id = currentSeasonAwards(season).finalsMvp?.playerId;
    return id ? getPlayer(id)?.name : undefined;
  }, [iWon, season]);

  // ── 단계별 공개(A2, 스포일러 제거) — 존재하는 시리즈만 순서대로. 탭마다 한 단계씩 공개. ──
  // 진출 3팀은 진입 시 보이고, 그 뒤 PO결과 → 챔프전결과 → 우승(+세리머니)을 능동 공개.
  const order = useMemo(() => {
    const seq: ('po' | 'final' | 'champ')[] = [];
    if (po.po) seq.push('po');
    if (po.final) seq.push('final');
    seq.push('champ');
    return seq;
  }, [po.po, po.final]);
  const [revealed, setRevealed] = useState(0); // order[0..revealed-1]까지 공개됨
  const next = order[revealed] as 'po' | 'final' | 'champ' | undefined;
  const champRevealed = revealed >= order.indexOf('champ') + 1 && order.includes('champ');
  const nextLabel =
    next === 'po' ? '플레이오프 결과 보기 ▶'
    : next === 'final' ? '챔피언결정전 보기 ▶'
    : next === 'champ' ? '우승 팀 확인 ▶'
    : '시상식 →';
  const onNext = () => (next ? setRevealed((r) => r + 1) : router.push('/awards-ceremony'));
  const shown = (item: 'po' | 'final' | 'champ') => { const i = order.indexOf(item); return i >= 0 && i < revealed; };

  return (
    <Screen title={`${season + 1}시즌 포스트시즌`}>
      {/* 우승 세리머니는 우승팀이 공개되는 마지막 단계에서만(진입 즉시 발화=스포일러 차단) */}
      {iWon && champRevealed ? (
        <ChampionCelebration
          teamName={champ}
          teamId={my!}
          season={season}
          mvpName={finalsMvpName}
          onDone={() => router.push('/awards-ceremony')}
        />
      ) : null}

      <Card accent={theme.accent}>
        <IconLabel icon="podium-outline" color={theme.accent}>진출 (상위 3팀)</IconLabel>
        {po.seeds.map((id, i) => (
          <Text key={id} style={[styles.seed, id === my && styles.mine]}>
            {i + 1}위 {name(id)} {i === 0 ? '(챔프전 직행)' : ''}
          </Text>
        ))}
      </Card>

      {shown('po') && po.po ? <SeriesCard title="플레이오프 (2위 vs 3위 · 3전2선승)" m={po.po} /> : null}
      {shown('final') && po.final ? <SeriesCard title="챔피언결정전 (5전3선승)" m={po.final} /> : null}
      {shown('champ') ? (
        <Card accent={theme.gold}>
          <Title>🏆 우승 — {champ}</Title>
        </Card>
      ) : null}

      {!champRevealed ? (
        <Muted style={{ textAlign: 'center', fontSize: 12, marginTop: 2 }}>
          탭하여 한 단계씩 결과를 확인하세요 (스포일러 방지)
        </Muted>
      ) : null}
      <Button label={nextLabel} onPress={onNext} />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  seed: { color: theme.text, fontSize: 15, fontWeight: '600', marginTop: 2 },
  matchup: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  team: { flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' },
  score: { color: theme.text, fontSize: 18, fontWeight: '900', minWidth: 52, textAlign: 'center' },
  games: { color: theme.muted, fontSize: 12, textAlign: 'center', marginTop: 4 },
  win: { color: theme.good, fontWeight: '800' },
  mine: { color: theme.accent },
}));
