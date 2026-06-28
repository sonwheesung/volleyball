// 리그 뉴스 목록 전용 화면 — 대시보드 "리그 뉴스"에서 진입.
// 한 행 = 기사 제목(헤드라인)만. 누르면 기사 상세(/news/[id]).
// 읽음/안읽음 구분: readNews를 live 구독 — 상세를 읽으면 목록에 즉시 반영(NEWS_SYSTEM 6b, 즉시성). 진입만으론 마킹 안 함.
import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EmptyState, Loading, Screen, theme, useDeferredReady } from '../components/Screen';
import { buildNewsFeed, newsKey } from '../data/news';
import { useGameStore } from '../store/useGameStore';
import type { NewsItem } from '../types';

export const KIND_KO: Record<NewsItem['kind'], string> = {
  champion: '우승', award: '시상', milestone: '기록 경신', hof: '명예의전당', injury: '부상', scandal: '사건·사고', owner: '구단',
  streak: '연승·연패', standing: '순위', match: '경기', debut: '데뷔', transfer: '이적', release: '방출', retire: '은퇴',
};

export default function NewsList() {
  // 뉴스 피드 생성(buildNewsFeed = 전 시즌·경기 순회)은 무거워 한 틱 미뤄 로딩부터 그린다
  const ready = useDeferredReady();
  if (!ready) return <Loading title="리그 뉴스" variant="list" />;
  return <NewsListInner />;
}

function NewsListInner() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const archive = useGameStore((s) => s.archive);
  const milestones = useGameStore((s) => s.milestones);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const expelledLog = useGameStore((s) => s.expelledLog);
  const readNews = useGameStore((s) => s.readNews);
  const benchDirectives = useGameStore((s) => s.benchDirectives);
  const transfers = useGameStore((s) => s.transfers);
  const retirements = useGameStore((s) => s.retirements);

  const feed = useMemo(
    () => buildNewsFeed(archive, milestones, hallOfFame, season, expelledLog, benchDirectives, currentDay, teamId ?? '', transfers, retirements),
    [archive, milestones, hallOfFame, season, currentDay, expelledLog, benchDirectives, teamId, transfers],
  );

  // readNews를 live로 구독(상세를 열면 그 기사만 markNewsRead → 목록 즉시 갱신 = 즉시성, 6b 정정). **목록 진입만으론
  // 읽음 처리 안 함**(읽음은 상세 news/[id]를 열 때만 — NEWS_SYSTEM §6). 진입 시 마킹이 없으니 강조 안정성은 그대로 유지.
  const readSet = useMemo(() => new Set(readNews), [readNews]);

  if (feed.length === 0) {
    return (
      <Screen title="리그 뉴스" scroll={false}>
        <EmptyState message="아직 전해진 소식이 없습니다." />
      </Screen>
    );
  }

  return (
    <Screen title="리그 뉴스">
      {feed.map((n, i) => {
          const unread = !readSet.has(newsKey(n));
          const headColor = !unread ? theme.muted : n.teamId === teamId ? theme.accent : n.big ? theme.warn : theme.text;
          return (
            <Pressable
              key={i}
              onPress={() => router.push(`/news/${i}`)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            >
              <View style={[styles.dot, { backgroundColor: unread ? theme.accent : 'transparent' }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.head, { color: headColor, fontWeight: unread ? '700' : '600' }]} numberOfLines={2}>
                  {n.big ? '★ ' : ''}{n.headline}
                </Text>
                <Text style={styles.meta}>{n.season + 1}시즌 · {KIND_KO[n.kind]}</Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          );
        })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: theme.border,
  },
  dot: { width: 7, height: 7, borderRadius: 4 }, // 안읽음 = accent 점, 읽음 = 투명(자리만)
  head: { color: theme.text, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  meta: { color: theme.muted, fontSize: 12, marginTop: 4 },
  arrow: { color: theme.accent, fontSize: 22, fontWeight: '900' },
});
