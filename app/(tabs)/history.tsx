import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Muted, PosTag, Screen, Title, theme } from '../../components/Screen';
import { currentRosters, getPlayer, getTeam, teamPlayerIds, shortTeamName as short } from '../../data/league';
import { leagueProduction } from '../../data/production';
import { currentSeasonAwards } from '../../data/awards';
import { buildNewsFeed } from '../../data/news';
import { computeStandings, seasonResults } from '../../data/standings';
import { dateForDay, formatDate } from '../../lib/calendar';
import { useGameStore } from '../../store/useGameStore';
import type { ProdLine } from '../../engine/production';
import type { AwardWinner, CareerStats, Player } from '../../types';

export default function History() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const archive = useGameStore((s) => s.archive);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const milestones = useGameStore((s) => s.milestones);
  const expelledLog = useGameStore((s) => s.expelledLog);
  const benchDirectives = useGameStore((s) => s.benchDirectives);

  const awards = useMemo(() => currentSeasonAwards(season, currentDay), [currentDay, season]);
  const newsFeed = useMemo(
    () => buildNewsFeed(archive, milestones, hallOfFame, season, expelledLog, benchDirectives, currentDay, teamId ?? '').slice(0, 40),
    [archive, milestones, hallOfFame, season, currentDay, expelledLog, benchDirectives, teamId],
  );
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

  const awName = (w: AwardWinner | null) => (w ? getPlayer(w.playerId)?.name ?? w.playerId : '—');
  const awMine = (w: AwardWinner | null) => !!w && !!teamId && teamPlayerIds(teamId).includes(w.playerId);
  const awTeam = (w: AwardWinner | null) => (w ? short(teamOfPlayer[w.playerId] ?? w.teamId) : '');

  return (
    <Screen title={`${season + 1}시즌 기록`}>
      <Card onPress={() => router.push('/achievements')}>
        <View style={styles.achLink}>
          <Text style={styles.achLinkText}>🏆 업적 — 구단주의 발자취</Text>
          <Text style={styles.achLinkArrow}>›</Text>
        </View>
      </Card>
      {awards.mvp ? (
        <>
          <Title>{season + 1}시즌 시상식{currentDay < 164 ? ' (잠정)' : ''}</Title>
          <Card>
            {([
              { label: '정규 MVP', w: awards.mvp, hi: true, suffix: '' },
              { label: '챔프전 MVP', w: awards.finalsMvp, hi: true, suffix: '' },
              { label: '신인상', w: awards.rookie, hi: false, suffix: '' },
              { label: '기량발전상', w: awards.mostImproved, hi: false, suffix: ' OVR' },
            ]).map((a) => a.w ? (
              <View key={a.label} style={styles.awRow}>
                <Text style={[styles.awLabel, a.hi && { color: theme.warn }]}>{a.label}</Text>
                <PosTag pos={getPlayer(a.w.playerId)?.position ?? 'OH'} />
                <Text style={[styles.awName, awMine(a.w) && styles.mine]} numberOfLines={1}>{awName(a.w)}</Text>
                <Text style={styles.lbTeam} numberOfLines={1}>{awTeam(a.w)}</Text>
                <Text style={styles.lbVal}>{a.w.value}{a.suffix}</Text>
              </View>
            ) : null)}
          </Card>

          <Card>
            <Text style={styles.awHead}>부문 기록왕</Text>
            {([
              { label: '득점', w: awards.titles.scoring },
              { label: '공격', w: awards.titles.spike },
              { label: '블로킹', w: awards.titles.block },
              { label: '서브', w: awards.titles.serve },
              { label: '디그', w: awards.titles.dig },
              { label: '세트', w: awards.titles.set },
              { label: '리시브', w: awards.titles.receive },
            ]).map((a) => (
              <View key={a.label} style={styles.awRow}>
                <Text style={styles.awLabel}>{a.label}왕</Text>
                <Text style={[styles.awName, awMine(a.w) && styles.mine]} numberOfLines={1}>{awName(a.w)}</Text>
                <Text style={styles.lbTeam} numberOfLines={1}>{awTeam(a.w)}</Text>
                <Text style={styles.lbVal}>{a.w?.value ?? ''}</Text>
              </View>
            ))}
          </Card>

          <Card>
            <Text style={styles.awHead}>베스트7</Text>
            {awards.best7.map((s, i) => (
              <View key={`${s.pos}${i}`} style={styles.awRow}>
                <PosTag pos={s.pos} />
                <Text style={[styles.awName, awMine(s.winner) && styles.mine]} numberOfLines={1}>{awName(s.winner)}</Text>
                <Text style={styles.lbTeam} numberOfLines={1}>{awTeam(s.winner)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {archive.length > 0 ? (
        <>
          <Title>역대 우승</Title>
          <Card>
            {archive.slice().reverse().map((a) => (
              <View key={a.season} style={styles.row}>
                <Text style={[styles.team, { flex: 0, width: 64 }]}>{a.season + 1}시즌</Text>
                <Text style={[styles.team, a.championId === teamId && styles.mine]} numberOfLines={1}>
                  🏆 {getTeam(a.championId)?.name ?? a.championId}
                </Text>
                {a.awards?.mvp ? (
                  <Muted style={{ fontSize: 11 }}>MVP {getPlayer(a.awards.mvp.playerId)?.name ?? ''}</Muted>
                ) : null}
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

      {newsFeed.length > 0 ? (
        <>
          <Title>📰 리그 뉴스</Title>
          <Card>
            {newsFeed.map((n, i) => (
              <View key={`${n.season}-${i}`} style={styles.msRow}>
                <Text style={styles.msSeason}>{n.season + 1}시즌</Text>
                <Text
                  style={[styles.msText, n.big && { color: theme.warn, fontWeight: '800' }, n.teamId === teamId && styles.mine]}
                  numberOfLines={1}
                >
                  {n.big ? '★ ' : ''}{n.headline}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {milestones.length > 0 ? (
        <>
          <Title>기록 경신 · 마일스톤</Title>
          <Card>
            {milestones.slice(-30).reverse().map((m, i) => {
              const mine = m.teamId === teamId;
              return (
                <View key={`${m.season}-${m.playerId}-${i}`} style={styles.msRow}>
                  <Text style={styles.msSeason}>{m.season + 1}시즌</Text>
                  <Text style={[styles.msText, m.big && { color: theme.warn, fontWeight: '800' }, mine && styles.mine]} numberOfLines={1}>
                    {m.big ? '★ ' : ''}{m.text}
                  </Text>
                </View>
              );
            })}
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
  achLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  achLinkText: { color: theme.text, fontSize: 15, fontWeight: '800' },
  achLinkArrow: { color: theme.accent, fontSize: 22, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  head: { borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 2, paddingBottom: 6 },
  h: { color: theme.muted, fontSize: 12, fontWeight: '700' },
  rank: { width: 24, color: theme.text, fontSize: 14, fontWeight: '700' },
  team: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  cell: { width: 40, textAlign: 'center', color: theme.text, fontSize: 14 },
  mine: { color: theme.accent, fontWeight: '800' },
  match: { backgroundColor: theme.card, borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: theme.border },
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
  awRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  awLabel: { width: 76, color: theme.muted, fontSize: 13, fontWeight: '700' },
  awName: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '700' },
  awHead: { color: theme.text, fontWeight: '800', marginBottom: 2 },
  msRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  msSeason: { width: 52, color: theme.muted, fontSize: 11, fontWeight: '700' },
  msText: { flex: 1, color: theme.text, fontSize: 13 },
});

