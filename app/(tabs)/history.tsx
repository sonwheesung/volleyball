import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Muted, PosTag, Screen, Title, theme } from '../../components/Screen';
import { currentRosters, getPlayer, getTeam, teamPlayerIds } from '../../data/league';
import { leagueProduction } from '../../data/production';
import { computeStandings, seasonResults } from '../../data/standings';
import { dateForDay, formatDate } from '../../lib/calendar';
import { useGameStore } from '../../store/useGameStore';
import type { ProdLine } from '../../engine/production';
import type { CareerStats, Player } from '../../types';

const short = (teamId: string) => {
  const n = getTeam(teamId)?.name ?? '';
  const parts = n.split(' ');
  return parts.length > 1 ? parts[1] : n;
};

export default function History() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const archive = useGameStore((s) => s.archive);
  const hallOfFame = useGameStore((s) => s.hallOfFame);

  const standings = useMemo(() => computeStandings(currentDay), [currentDay, season]);
  const results = useMemo(
    () => seasonResults(currentDay).slice().sort((a, b) => b.dayIndex - a.dayIndex),
    [currentDay, season],
  );
  // 선수 → 소속팀 (리더보드 팀 표시)
  const teamOfPlayer = useMemo(() => {
    const m: Record<string, string> = {};
    const rs = currentRosters();
    for (const tid of Object.keys(rs)) for (const id of rs[tid]) m[id] = tid;
    return m;
  }, [currentDay, season]);

  const leaders = useMemo(() => {
    const prod = leagueProduction(currentDay);
    const rows = [...prod.entries()].map(([id, l]) => ({ id, l }));
    const top = (key: keyof ProdLine, n = 5) =>
      rows
        .filter((r) => (r.l[key] as number) > 0)
        .sort((a, b) => (b.l[key] as number) - (a.l[key] as number))
        .slice(0, n);
    return { points: top('points'), blocks: top('blocks'), digs: top('digs'), assists: top('assists') };
  }, [currentDay, season]);

  // 통산 기록(현역) — 시즌 누적이 쌓인 "백년" 리더보드
  const careerLeaders = useMemo(() => {
    const all: Player[] = [];
    const rs = currentRosters();
    for (const tid of Object.keys(rs)) for (const id of rs[tid]) { const p = getPlayer(id); if (p) all.push(p); }
    const top = (key: keyof CareerStats, n = 5) =>
      all.filter((p) => (p.career[key] as number) > 0)
        .sort((a, b) => (b.career[key] as number) - (a.career[key] as number))
        .slice(0, n);
    return { points: top('points'), blocks: top('blocks'), digs: top('digs') };
  }, [currentDay, season]);

  return (
    <Screen title={`${season + 1}시즌 기록`}>
      {archive.length > 0 ? (
        <>
          <Title>역대 우승</Title>
          <Card>
            {archive.slice().reverse().map((a) => (
              <View key={a.season} style={styles.row}>
                <Text style={[styles.team, { flex: 0, width: 70 }]}>{a.season + 1}시즌</Text>
                <Text style={[styles.team, a.championId === teamId && styles.mine]}>
                  🏆 {getTeam(a.championId)?.name ?? a.championId}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {hallOfFame.length > 0 ? (
        <>
          <Title>명예의전당 · 은퇴 레전드</Title>
          <Card>
            {[...hallOfFame].sort((a, b) => b.points - a.points).map((h) => (
              <View key={h.id} style={styles.hofRow}>
                <PosTag pos={h.position} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.team, h.teamId === teamId && styles.mine]} numberOfLines={1}>
                    {h.legend ? '🎖️ ' : '🏅 '}{h.name}
                    {h.legend ? <Text style={{ color: theme.warn, fontSize: 11 }}>  영구결번</Text> : null}
                  </Text>
                  <Muted style={{ fontSize: 11 }}>
                    {short(h.teamId)} · {h.seasons}시즌 · {h.retiredSeason + 1}시즌 은퇴
                  </Muted>
                </View>
                <Text style={styles.lbVal}>{h.points.toLocaleString()}점</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Title>순위표</Title>
      <Card>
        <View style={[styles.row, styles.head]}>
          <Text style={[styles.rank, styles.h]}>#</Text>
          <Text style={[styles.team, styles.h]}>팀</Text>
          <Text style={[styles.cell, styles.h]}>경기</Text>
          <Text style={[styles.cell, styles.h]}>승</Text>
          <Text style={[styles.cell, styles.h]}>패</Text>
          <Text style={[styles.cell, styles.h]}>득실</Text>
        </View>
        {standings.map((s, i) => {
          const mine = s.teamId === teamId;
          return (
            <View key={s.teamId} style={styles.row}>
              <Text style={[styles.rank, mine && styles.mine]}>{i + 1}</Text>
              <Text style={[styles.team, mine && styles.mine]} numberOfLines={1}>
                {getTeam(s.teamId)?.name ?? s.teamId}
              </Text>
              <Text style={styles.cell}>{s.played}</Text>
              <Text style={[styles.cell, styles.mine]}>{s.wins}</Text>
              <Text style={styles.cell}>{s.losses}</Text>
              <Text style={[styles.cell, { color: s.setDiff >= 0 ? theme.good : theme.bad }]}>
                {s.setDiff > 0 ? '+' : ''}{s.setDiff}
              </Text>
            </View>
          );
        })}
      </Card>

      <Title>개인 기록 리더보드</Title>
      {([
        { label: '득점', list: leaders.points, key: 'points' as const },
        { label: '블로킹', list: leaders.blocks, key: 'blocks' as const },
        { label: '디그', list: leaders.digs, key: 'digs' as const },
        { label: '세트', list: leaders.assists, key: 'assists' as const },
      ]).map((cat) => (
        <Card key={cat.label}>
          <Text style={{ color: theme.text, fontWeight: '800', marginBottom: 2 }}>{cat.label} TOP 5</Text>
          {cat.list.length === 0 ? (
            <Muted style={{ fontSize: 12 }}>기록 없음</Muted>
          ) : (
            cat.list.map((r, i) => {
              const p = getPlayer(r.id);
              const mine = !!teamId && teamPlayerIds(teamId).includes(r.id);
              return (
                <View key={r.id} style={styles.lbRow}>
                  <Text style={styles.lbRank}>{i + 1}</Text>
                  {p ? <PosTag pos={p.position} /> : null}
                  <Text style={[styles.lbName, mine && styles.mine]} numberOfLines={1}>
                    {p?.name ?? r.id}
                  </Text>
                  <Text style={styles.lbTeam} numberOfLines={1}>
                    {teamOfPlayer[r.id] ? short(teamOfPlayer[r.id]) : '-'}
                  </Text>
                  <Text style={styles.lbVal}>{r.l[cat.key]}</Text>
                </View>
              );
            })
          )}
        </Card>
      ))}

      <Title>통산 기록 · 현역 (백년 누적)</Title>
      {([
        { label: '통산 득점', list: careerLeaders.points, key: 'points' as const },
        { label: '통산 블로킹', list: careerLeaders.blocks, key: 'blocks' as const },
        { label: '통산 디그', list: careerLeaders.digs, key: 'digs' as const },
      ]).map((cat) => (
        <Card key={cat.label}>
          <Text style={{ color: theme.text, fontWeight: '800', marginBottom: 2 }}>{cat.label} TOP 5</Text>
          {cat.list.length === 0 ? (
            <Muted style={{ fontSize: 12 }}>기록 없음</Muted>
          ) : (
            cat.list.map((p, i) => {
              const mine = !!teamId && teamPlayerIds(teamId).includes(p.id);
              return (
                <View key={p.id} style={styles.lbRow}>
                  <Text style={styles.lbRank}>{i + 1}</Text>
                  <PosTag pos={p.position} />
                  <Text style={[styles.lbName, mine && styles.mine]} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.lbTeam} numberOfLines={1}>{p.career.seasons}시즌</Text>
                  <Text style={styles.lbVal}>{p.career[cat.key].toLocaleString()}</Text>
                </View>
              );
            })
          )}
        </Card>
      ))}

      <Title>경기 결과 (전 구단)</Title>
      {results.length === 0 ? (
        <Card><Muted>아직 치른 경기가 없습니다.</Muted></Card>
      ) : (
        results.map((r) => {
          const mine = r.homeTeamId === teamId || r.awayTeamId === teamId;
          const homeWin = r.homeSets > r.awaySets;
          return (
            <Pressable
              key={r.fixtureId}
              onPress={() => router.push(`/matchresult/${r.fixtureId}`)}
              style={({ pressed }) => [styles.match, mine && { borderColor: theme.accent, borderWidth: 1 }, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.date}>{formatDate(dateForDay(r.dayIndex))}</Text>
              <View style={styles.matchRow}>
                <Text style={[styles.mTeam, { textAlign: 'right' }, homeWin && styles.win]} numberOfLines={1}>
                  {short(r.homeTeamId)}
                </Text>
                <Text style={styles.score}>{r.homeSets} : {r.awaySets}</Text>
                <Text style={[styles.mTeam, !homeWin && styles.win]} numberOfLines={1}>
                  {short(r.awayTeamId)}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  head: { borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 2, paddingBottom: 6 },
  h: { color: theme.muted, fontSize: 12, fontWeight: '700' },
  rank: { width: 24, color: theme.text, fontSize: 14, fontWeight: '700' },
  team: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  cell: { width: 40, textAlign: 'center', color: theme.text, fontSize: 14 },
  mine: { color: theme.accent, fontWeight: '800' },
  match: { backgroundColor: theme.card, borderRadius: 10, padding: 10, marginBottom: 6 },
  date: { color: theme.muted, fontSize: 11, marginBottom: 4, textAlign: 'center' },
  matchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  mTeam: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  score: { color: theme.text, fontSize: 16, fontWeight: '800', minWidth: 50, textAlign: 'center' },
  win: { color: theme.good, fontWeight: '800' },
  lbRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  lbRank: { width: 18, color: theme.muted, fontSize: 13, fontWeight: '700' },
  lbName: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  lbTeam: { color: theme.muted, fontSize: 12, width: 52, textAlign: 'right' },
  lbVal: { color: theme.text, fontSize: 14, fontWeight: '800', minWidth: 36, textAlign: 'right' },
  hofRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
});

