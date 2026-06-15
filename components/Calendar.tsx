import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { dayKey, formatMonth, monthGrid, WEEKDAYS } from '../lib/calendar';
import { dateForDay } from '../lib/calendar';
import { getTeam } from '../data/league';
import type { MatchResult, ScheduleEntry } from '../types';
import { theme } from './Screen';

function shortName(teamId: string): string {
  const n = getTeam(teamId)?.name ?? '';
  const parts = n.split(' ');
  return parts.length > 1 ? parts[1] : n;
}

interface Props {
  entries: ScheduleEntry[];
  results: Record<string, MatchResult>;
  focusDayIndex: number;
}

export function Calendar({ entries, results, focusDayIndex }: Props) {
  const focusDate = dateForDay(focusDayIndex);
  const [ym, setYm] = useState({ y: focusDate.getFullYear(), m: focusDate.getMonth() });

  // 진행으로 현재(다음 일정) 날짜가 바뀌면 캘린더를 그 달로 따라오게 한다
  useEffect(() => {
    setYm({ y: focusDate.getFullYear(), m: focusDate.getMonth() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDayIndex]);

  // 날짜 키 → 항목
  const byKey = new Map<string, ScheduleEntry[]>();
  for (const e of entries) {
    const k = dayKey(dateForDay(e.dayIndex));
    const arr = byKey.get(k) ?? [];
    arr.push(e);
    byKey.set(k, arr);
  }

  const focusKey = dayKey(focusDate);
  const cells = monthGrid(ym.y, ym.m);

  const prev = () => setYm((s) => (s.m === 0 ? { y: s.y - 1, m: 11 } : { y: s.y, m: s.m - 1 }));
  const next = () => setYm((s) => (s.m === 11 ? { y: s.y + 1, m: 0 } : { y: s.y, m: s.m + 1 }));

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable onPress={prev} hitSlop={10}><Text style={styles.nav}>‹</Text></Pressable>
        <Text style={styles.month}>{formatMonth(ym.y, ym.m)}</Text>
        <Pressable onPress={next} hitSlop={10}><Text style={styles.nav}>›</Text></Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={w} style={[styles.weekday, i === 0 && { color: theme.bad }, i === 6 && { color: theme.accent }]}>
            {w}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === ym.m;
          const k = dayKey(d);
          const dayEntries = byKey.get(k) ?? [];
          const match = dayEntries.find((e) => e.kind === 'match') as
            | Extract<ScheduleEntry, { kind: 'match' }>
            | undefined;
          const hasEvent = dayEntries.some((e) => e.kind === 'event');
          const isFocus = k === focusKey;

          let resultBadge: { text: string; color: string } | null = null;
          if (match) {
            const res = results[match.fixture.id];
            if (res) {
              const myWin = match.isHome ? res.homeSets > res.awaySets : res.awaySets > res.homeSets;
              resultBadge = myWin
                ? { text: '승', color: theme.good }
                : { text: '패', color: theme.bad };
            }
          }

          return (
            <View key={i} style={[styles.cell, isFocus && styles.cellFocus]}>
              <Text style={[styles.dayNum, !inMonth && { color: '#C2C9D4' }]}>{d.getDate()}</Text>
              {match ? (
                <View style={styles.matchTag}>
                  <Text numberOfLines={1} style={styles.matchText}>
                    {match.isHome ? '홈' : '원'} {shortName(match.opponentId)}
                  </Text>
                  {resultBadge ? (
                    <Text style={[styles.resBadge, { color: resultBadge.color }]}>{resultBadge.text}</Text>
                  ) : null}
                </View>
              ) : hasEvent ? (
                <View style={styles.eventDot} />
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.card, borderRadius: 14, padding: 10, gap: 6, borderWidth: 1, borderColor: theme.border },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  month: { color: theme.text, fontSize: 17, fontWeight: '800' },
  nav: { color: theme.accent, fontSize: 26, fontWeight: '800', paddingHorizontal: 12 },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: theme.muted, fontSize: 12, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 0.78,
    padding: 3,
    borderRadius: 6,
    alignItems: 'center',
  },
  cellFocus: { backgroundColor: theme.accent + '22', borderWidth: 1, borderColor: theme.accent },
  dayNum: { color: theme.text, fontSize: 12, fontWeight: '600' },
  matchTag: { marginTop: 2, alignItems: 'center' },
  matchText: { color: theme.accent, fontSize: 9, fontWeight: '700' },
  resBadge: { fontSize: 10, fontWeight: '800' },
  eventDot: { marginTop: 4, width: 5, height: 5, borderRadius: 3, backgroundColor: theme.muted },
});
