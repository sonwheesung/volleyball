// 리그 뉴스 목록 전용 화면 — 대시보드 "리그 뉴스"에서 진입.
// 한 행 = 기사 제목(헤드라인)만. 누르면 기사 상세(/news/[id]).
import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Muted, Screen, theme } from '../components/Screen';
import { buildNewsFeed } from '../data/news';
import { useGameStore } from '../store/useGameStore';
import type { NewsItem } from '../types';

export const KIND_KO: Record<NewsItem['kind'], string> = {
  champion: '우승', award: '시상', milestone: '기록 경신', hof: '명예의전당', injury: '부상', scandal: '사건·사고',
};

export default function NewsList() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const archive = useGameStore((s) => s.archive);
  const milestones = useGameStore((s) => s.milestones);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const expelledLog = useGameStore((s) => s.expelledLog);

  const feed = useMemo(
    () => buildNewsFeed(archive, milestones, hallOfFame, season, expelledLog),
    [archive, milestones, hallOfFame, season, currentDay, expelledLog],
  );

  return (
    <Screen title="리그 뉴스">
      {feed.length === 0 ? (
        <Muted>아직 전해진 소식이 없습니다.</Muted>
      ) : (
        feed.map((n, i) => (
          <Pressable
            key={i}
            onPress={() => router.push(`/news/${i}`)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.head, n.big && { color: theme.warn }, n.teamId === teamId && { color: theme.accent }]}
                numberOfLines={2}
              >
                {n.big ? '★ ' : ''}{n.headline}
              </Text>
              <Text style={styles.meta}>{n.season + 1}시즌 · {KIND_KO[n.kind]}</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: theme.border,
  },
  head: { color: theme.text, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  meta: { color: theme.muted, fontSize: 12, marginTop: 4 },
  arrow: { color: theme.accent, fontSize: 22, fontWeight: '900' },
});
