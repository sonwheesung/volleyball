// 우리 팀 일정 — 리스트(날짜+요일 · 홈/원정 · 상대 · 결과/예정). 일정 화면 "우리 팀 일정 보기"에서 진입.
// (구 캘린더 그리드 → 리스트로 전환, 2026-07-04 사용자 요청 — "전 구단 경기 결과처럼 요일·경기·홈/원정"). 치른 경기만 결과, 미래는 예정(스포일러 안전).
import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen, theme, themedStyles } from '../components/Screen';
import { SEASON, getTeam } from '../data/league';
import { seasonYear } from '../data/seasonLabel';
import { teamScheduleEntries } from '../engine/season';
import { planNextAction } from '../engine/advance';
import { dateForDay, formatDate } from '../lib/calendar';
import { useGameStore } from '../store/useGameStore';

export default function CalendarScreen() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const results = useGameStore((s) => s.results);
  const season = useGameStore((s) => s.season);

  const entries = useMemo(() => teamScheduleEntries(SEASON, teamId), [teamId]);
  const action = planNextAction(SEASON, teamId, results);
  const nextId = action.kind === 'match' ? action.fixture.id : null;

  return (
    <Screen title={`${seasonYear(season)} 우리 팀 일정`}>
      <View style={styles.card}>
        {entries.map((e, i) => {
          if (e.kind !== 'match') return null; // 유니온 narrow — teamScheduleEntries는 'match'만 담지만 타입 안전
          const res = results[e.fixture.id];
          const oppName = getTeam(e.opponentId)?.name ?? '';
          const isNext = e.fixture.id === nextId;
          const my = res ? (e.isHome ? res.homeSets : res.awaySets) : 0;
          const opp = res ? (e.isHome ? res.awaySets : res.homeSets) : 0;
          const win = res ? my > opp : false;
          return (
            <Pressable key={e.fixture.id}
              onPress={() => { if (res) router.push(`/matchresult/${e.fixture.id}`); }}
              style={({ pressed }) => [styles.row, i > 0 && styles.divider, isNext && styles.nextRow, pressed && res ? { opacity: 0.6 } : null]}>
              <Text style={styles.date} numberOfLines={1}>{formatDate(dateForDay(e.dayIndex))}</Text>
              <View style={[styles.ha, { backgroundColor: (e.isHome ? theme.sky : theme.warn) + '22' }]}>
                <Text style={[styles.haTxt, { color: e.isHome ? theme.sky : theme.warn }]}>{e.isHome ? '홈' : '원정'}</Text>
              </View>
              <Text style={styles.opp} numberOfLines={1}>{oppName}</Text>
              {res ? (
                <Text style={[styles.score, win ? styles.win : styles.lose]}>{win ? '승' : '패'} {my}:{opp}</Text>
              ) : (
                <Text style={[styles.pending, isNext && styles.next]}>{isNext ? '다음 경기' : '예정'}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  card: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 13 },
  divider: { borderTopWidth: 1, borderTopColor: theme.border },
  nextRow: { backgroundColor: theme.accent + '14' },
  date: { color: theme.muted, fontSize: 13, fontWeight: '700', width: 108 },
  ha: { minWidth: 40, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignItems: 'center' },
  haTxt: { fontSize: 11.5, fontWeight: '800' },
  opp: { flex: 1, color: theme.text, fontSize: 15, fontWeight: '700' },
  score: { fontSize: 14, fontWeight: '800', minWidth: 56, textAlign: 'right' },
  win: { color: theme.good }, lose: { color: theme.bad },
  pending: { color: theme.muted, fontSize: 13, fontWeight: '700', minWidth: 56, textAlign: 'right' },
  next: { color: theme.accent, fontWeight: '800' },
}));
