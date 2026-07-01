import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconLabel, Loading, PosTag, theme, themeAssets, themedStyles, useDeferredReady } from '../components/Screen';
import { getTeam, shortTeamName as short, teamPlayerIds } from '../data/league';
import { careerLeaderboard, teamCareerLeaderboard, RECORD_CATS, type RecordCat } from '../data/records';
import { useGameStore } from '../store/useGameStore';

const MEDAL = ['🥇', '🥈', '🥉'];

export default function Records() {
  // 통산 리더보드(현역+은퇴 전체 순회·정렬)는 시즌이 쌓일수록 무거워 한 틱 미뤄 로딩부터 그린다
  const ready = useDeferredReady();
  if (!ready) return <Loading title="통산 순위" variant="list" />;
  return <RecordsInner />;
}

function RecordsInner() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cat?: string; scope?: string; team?: string }>();
  const cat = (RECORD_CATS.some((c) => c.key === params.cat) ? params.cat : 'points') as RecordCat;
  const scope = params.scope === 'team' ? 'team' : 'league';
  const teamId = params.team ?? '';

  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const myTeam = useGameStore((s) => s.selectedTeamId);
  const myIds = useMemo(() => new Set(myTeam ? teamPlayerIds(myTeam) : []), [myTeam]);

  const limit = scope === 'team' ? 50 : 100;
  const meta = RECORD_CATS.find((c) => c.key === cat)!;
  const rows = useMemo(
    () => (scope === 'team' ? teamCareerLeaderboard(cat, teamId, hallOfFame) : careerLeaderboard(cat, hallOfFame)).slice(0, limit),
    [cat, scope, teamId, hallOfFame, limit],
  );

  const titleScope = scope === 'team' ? `${getTeam(teamId)?.name ?? short(teamId)} · ` : '';
  const max = rows[0]?.value ?? 1;

  return (
    <ImageBackground source={themeAssets.bg} style={styles.bgRoot} resizeMode="cover">
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: themeAssets.scrim }]} />
      <SafeAreaView style={styles.root} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>{titleScope}{meta.label}</Text>
        <Text style={styles.sub}>현역 · 은퇴 통합 · TOP {limit}</Text>

        <View style={{ marginBottom: 12 }}>
          <IconLabel icon="trophy-outline" color={theme.gold}>통산 리더보드</IconLabel>
        </View>

        {/* 카테고리 칩 */}
        <View style={styles.chips}>
          {RECORD_CATS.map((c) => {
            const on = c.key === cat;
            return (
              <Pressable
                key={c.key}
                onPress={() => router.setParams({ cat: c.key, scope, team: teamId })}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{c.short}</Text>
              </Pressable>
            );
          })}
        </View>

        {rows.length === 0 ? (
          <View style={styles.empty}><Text style={styles.emptyTxt}>아직 기록이 없습니다.</Text></View>
        ) : (
          <View style={styles.list}>
            {rows.map((r, i) => {
              const mine = myIds.has(r.id);
              const top3 = i < 3;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => router.push(`/player/${r.id}`)}
                  style={({ pressed }) => [
                    styles.row,
                    top3 && styles.rowTop,
                    mine && styles.rowMine,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <View style={styles.rankWrap}>
                    {top3 ? <Text style={styles.medal}>{MEDAL[i]}</Text>
                      : <Text style={styles.rank}>{i + 1}</Text>}
                  </View>
                  <PosTag pos={r.position} />
                  <View style={styles.nameWrap}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.name, mine && styles.mine]} numberOfLines={1}>{r.name}</Text>
                      {r.legend ? <Text style={styles.legend}>헌액 번호</Text>
                        : r.retired ? <Text style={styles.retired}>은퇴</Text> : null}
                    </View>
                    <Text style={styles.metaTxt} numberOfLines={1}>
                      {short(r.teamId)} · {r.seasons}시즌
                    </Text>
                  </View>
                  <View style={styles.valWrap}>
                    <Text style={[styles.val, top3 && styles.valTop, mine && styles.mine]}>{r.value.toLocaleString()}</Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${Math.max(3, (r.value / max) * 100)}%`, backgroundColor: top3 ? theme.warn : mine ? theme.accent : theme.border }]} />
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={{ height: 12 }} />
      </ScrollView>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  bgRoot: { flex: 1, backgroundColor: theme.bg },
  root: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: 16, paddingBottom: 28 },
  h1: { color: theme.text, fontSize: 22, fontWeight: '900' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 2, marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 },
  chip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: theme.cardAlt, alignItems: 'center' },
  chipOn: { backgroundColor: theme.accent },
  chipTxt: { color: theme.muted, fontSize: 13, fontWeight: '800' },
  chipTxtOn: { color: '#FFFFFF' },
  list: { backgroundColor: theme.card, borderRadius: 16, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  rowTop: { backgroundColor: theme.warn + '0E' },
  rowMine: { backgroundColor: theme.accent + '12' },
  rankWrap: { width: 26, alignItems: 'center' },
  rank: { color: theme.muted, fontSize: 14, fontWeight: '800' },
  medal: { fontSize: 18 },
  nameWrap: { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: theme.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  mine: { color: theme.accent, fontWeight: '900' },
  legend: { color: theme.warn, fontSize: 10, fontWeight: '900', backgroundColor: theme.warn + '1F', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  retired: { color: theme.muted, fontSize: 10, fontWeight: '800', backgroundColor: theme.cardAlt, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  metaTxt: { color: theme.muted, fontSize: 11.5 },
  valWrap: { width: 88, alignItems: 'flex-end', gap: 4 },
  val: { color: theme.text, fontSize: 15, fontWeight: '800' },
  valTop: { color: theme.warn },
  barTrack: { width: 80, height: 4, backgroundColor: theme.cardAlt, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2 },
  empty: { padding: 32, alignItems: 'center' },
  emptyTxt: { color: theme.muted, fontSize: 14 },
}));
