// 리그 뉴스 목록 전용 화면 — 대시보드 "리그 뉴스"에서 진입.
// 한 행 = 기사 제목(헤드라인)만. 누르면 기사 상세(/news/[id]).
// 읽음/안읽음 구분: readNews를 live 구독 — 상세를 읽으면 목록에 즉시 반영(NEWS_SYSTEM 6b, 즉시성). 진입만으론 마킹 안 함.
import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EmptyState, Loading, Screen, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { buildNewsFeed, freshNews, newsKey } from '../data/news';
import { seasonYear } from '../data/seasonLabel';
import { displayCutoff } from '../data/standings';
import { useGameStore } from '../store/useGameStore';
import type { NewsItem } from '../types';

export const KIND_KO: Record<NewsItem['kind'], string> = {
  champion: '우승', award: '시상', milestone: '기록 경신', hof: '명예의전당', injury: '부상', scandal: '사건·사고', owner: '구단',
  streak: '연승·연패', standing: '순위', match: '경기', debut: '데뷔', transfer: '이적', release: '방출', retire: '은퇴', sponsor: '모기업',
  offseason: '오프시즌', draft: '드래프트', foreign: '외국인',
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
  const results = useGameStore((s) => s.results);
  const archive = useGameStore((s) => s.archive);
  const milestones = useGameStore((s) => s.milestones);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const expelledLog = useGameStore((s) => s.expelledLog);
  const readNews = useGameStore((s) => s.readNews);
  const markNewsRead = useGameStore((s) => s.markNewsRead);
  const benchDirectives = useGameStore((s) => s.benchDirectives);
  const transfers = useGameStore((s) => s.transfers);
  const retirements = useGameStore((s) => s.retirements);
  const seasonDraftLog = useGameStore((s) => s.seasonDraftLog);
  const seasonForeignLog = useGameStore((s) => s.seasonForeignLog);

  // 결과 인지 표시 컷오프(§3.3) — 상세(news/[id])와 **완전히 동일한 인자**로 피드를 파생해야 목록↔상세가 일치(F1, NEWS §3.6).
  const cutoff = displayCutoff(currentDay, results, teamId ?? undefined);
  const feed = useMemo(
    () => freshNews(buildNewsFeed(archive, milestones, hallOfFame, season, expelledLog, benchDirectives, cutoff, teamId ?? '', transfers, retirements, seasonDraftLog, seasonForeignLog), cutoff),
    [archive, milestones, hallOfFame, season, cutoff, expelledLog, benchDirectives, teamId, transfers, retirements, seasonDraftLog, seasonForeignLog],
  );

  // readNews를 live로 구독(상세를 열면 그 기사만 markNewsRead → 목록 즉시 갱신 = 즉시성, 6b 정정). **목록 진입만으론
  // 읽음 처리 안 함**(읽음은 상세 news/[id]를 열 때만 — NEWS_SYSTEM §6). 진입 시 마킹이 없으니 강조 안정성은 그대로 유지.
  const readSet = useMemo(() => new Set(readNews), [readNews]);
  // 안읽음이 하나라도 있으면 "모두 읽기" 노출 — 누르면 목록 전체 키를 markNewsRead(상세 열 때와 동일 처리, 즉시 반영).
  const unreadKeys = useMemo(() => feed.map(newsKey).filter((k) => !readSet.has(k)), [feed, readSet]);

  if (feed.length === 0) {
    return (
      <Screen title="리그 뉴스" scroll={false}>
        <EmptyState message="아직 전해진 소식이 없습니다." />
      </Screen>
    );
  }

  return (
    <Screen
      title="리그 뉴스"
      headerRight={
        unreadKeys.length > 0 ? (
          <Pressable
            onPress={() => markNewsRead(unreadKeys)}
            style={({ pressed }) => [styles.readAllBtn, pressed && { opacity: 0.6 }]}
            hitSlop={8}
          >
            <Text style={styles.readAllTxt}>모두 읽기 ({unreadKeys.length})</Text>
          </Pressable>
        ) : null
      }
    >
      {feed.map((n) => {
          const key = newsKey(n);
          const unread = !readSet.has(key);
          const headColor = !unread ? theme.muted : n.teamId === teamId ? theme.accent : n.big ? theme.warn : theme.text;
          return (
            <Pressable
              key={key}
              onPress={() => router.push(`/news/${encodeURIComponent(key)}`)} // 인덱스 대신 안정 키 라우팅(F1, NEWS §3.6)
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            >
              <View style={[styles.dot, { backgroundColor: unread ? theme.accent : 'transparent' }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.head, { color: headColor, fontWeight: unread ? '700' : '600' }]} numberOfLines={2}>
                  {n.big ? '★ ' : ''}{n.headline}
                </Text>
                <Text style={styles.meta}>{seasonYear(n.season)} · {KIND_KO[n.kind]}</Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          );
        })}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: theme.border,
  },
  readAllBtn: {
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: theme.cardAlt, borderWidth: 1, borderColor: theme.border,
  },
  readAllTxt: { color: theme.accent, fontSize: 13, fontWeight: '700' },
  dot: { width: 7, height: 7, borderRadius: 4 }, // 안읽음 = accent 점, 읽음 = 투명(자리만)
  head: { color: theme.text, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  meta: { color: theme.muted, fontSize: 12, marginTop: 4 },
  arrow: { color: theme.accent, fontSize: 22, fontWeight: '900' },
}));
