// 포스트시즌 브라켓/시리즈 현황 (SEASON_SYSTEM §5, 2026-07-08 달력 편입 후 재편).
//   ★ 진입 즉시 recordChampion·세리머니 발화 제거(스포일러). 진행/우승 노출은 일정 화면(schedule)이 담당 —
//   이 화면은 currentDay 기준 **치른(공개) 경기까지만** 읽는 읽기 전용 브라켓. postseasonReveal 컷오프.
//   ★ deep-link 방어(2026-07-08): 정규 종료(inPostseason) 전 진입은 진출 시드(=최종 top3)가 스포일러라 안내로 가림.
import { StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';
import { Card, IconLabel, Loading, Muted, Screen, SCREEN_LOADING_MIN_MS, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { getTeam } from '../data/league';
import { seasonYear } from '../data/seasonLabel';
import { buildPlayoffs, type Matchup } from '../data/playoffs';
import { postseasonReveal, inPostseason } from '../data/postseason';
import { useGameStore } from '../store/useGameStore';

export default function Playoffs() {
  const ready = useDeferredReady(SCREEN_LOADING_MIN_MS);
  if (!ready) return <Loading title="포스트시즌" variant="list" />;
  return <PlayoffsInner />;
}

function PlayoffsInner() {
  const my = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);

  const po = useMemo(() => buildPlayoffs(season), [season]);
  const reveal = useMemo(() => postseasonReveal(po, currentDay), [po, currentDay]);
  const name = (id: string) => getTeam(id)?.name ?? id;

  // 정규 종료(포스트시즌 진입) 전엔 진출 시드(=최종 순위 top3)가 스포일러 — 딥링크로 들어와도 가린다(§5.2).
  //   inPostseason(currentDay)=165..183만 true. 그 전(오프시즌 0·정규 1~164)엔 브라켓 대신 안내.
  if (!inPostseason(currentDay)) {
    return (
      <Screen title={`${seasonYear(season)} 포스트시즌`}>
        <Card accent={theme.muted} flat>
          <IconLabel icon="lock-closed-outline" color={theme.muted}>대기 중</IconLabel>
          <Muted style={{ marginTop: 6, lineHeight: 20 }}>포스트시즌은 정규 리그가 끝나면 열립니다. 진출 팀과 대진도 그때 공개돼요.</Muted>
        </Card>
      </Screen>
    );
  }

  const SeriesCard = ({ title, m, revealed }: { title: string; m: Matchup; revealed: number }) => {
    const games = m.series.games.slice(0, revealed); // 공개된 게임만(스포일러 컷오프)
    const hiW = games.filter((g) => g.hiSets > g.loSets).length;
    const loW = games.filter((g) => g.loSets > g.hiSets).length;
    const decided = revealed === m.series.games.length; // 시리즈 확정 공개 여부
    return (
      <Card accent={theme.gold} flat>
        <IconLabel icon="trophy-outline" color={theme.gold}>{title}</IconLabel>
        <View style={styles.matchup}>
          <Text style={[styles.team, { textAlign: 'right' }, decided && m.winnerId === m.hiId && styles.win, m.hiId === my && styles.mine]} numberOfLines={1}>{name(m.hiId)}</Text>
          <Text style={styles.score}>{hiW} : {loW}</Text>
          <Text style={[styles.team, decided && m.winnerId === m.loId && styles.win, m.loId === my && styles.mine]} numberOfLines={1}>{name(m.loId)}</Text>
        </View>
        {games.length > 0 ? <Text style={styles.games}>{games.map((g) => `${g.hiSets}-${g.loSets}`).join('  ')}</Text> : <Muted style={{ fontSize: 12, textAlign: 'center', marginTop: 4 }}>대기 중</Muted>}
      </Card>
    );
  };

  return (
    <Screen title={`${seasonYear(season)} 포스트시즌`}>
      <Card accent={theme.accent} flat>
        <IconLabel icon="podium-outline" color={theme.accent}>진출 (상위 3팀)</IconLabel>
        {po.seeds.map((id, i) => (
          <Text key={id} style={[styles.seed, id === my && styles.mine]}>{i + 1}위 {name(id)} {i === 0 ? '(챔프전 직행)' : ''}</Text>
        ))}
      </Card>
      {po.po && reveal.poRevealed > 0 ? <SeriesCard title="플레이오프 (2위 vs 3위 · 3전2선승)" m={po.po} revealed={reveal.poRevealed} /> : null}
      {po.final && reveal.finalRevealed > 0 ? <SeriesCard title="챔피언결정전 (5전3선승)" m={po.final} revealed={reveal.finalRevealed} /> : null}
      {reveal.championRevealed && po.championId ? (
        <Card accent={theme.gold} flat><Text style={styles.champ}>🏆 우승 ({name(po.championId)})</Text></Card>
      ) : null}
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
  champ: { color: theme.text, fontSize: 20, fontWeight: '900' },
}));
