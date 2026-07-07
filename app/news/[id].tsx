// 뉴스 기사 상세 — 목록(/news)에서 진입. 헤드라인 + 분류 + 시즌/구단 + 분류별 리드 문장.
// 뉴스는 저장 없이 archive·milestones·hallOfFame 등에서 파생되므로(결정론), 목록과 동일 피드를
// 재구성해 id(인덱스)로 같은 기사를 집어낸다.
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Card, IconLabel, Loading, Muted, Screen, SCREEN_LOADING_MIN_MS, theme, themedStyles, useDeferredReady } from '../../components/Screen';
import { buildNewsFeed, newsKey } from '../../data/news';
import { seasonYear } from '../../data/seasonLabel';
import { leagueDisplayDay } from '../../data/standings';
import { KIND_KO } from '../news';
import { getTeam } from '../../data/league';
import { useGameStore } from '../../store/useGameStore';
import type { NewsItem } from '../../types';

// 본문 데이터가 없으면(구결과·예외) 분류별 리드 문단으로 폴백(헤드라인이 구체 사실을 담는다).
const LEAD: Record<NewsItem['kind'], string> = {
  champion: '정규리그와 포스트시즌을 모두 통과하며 시즌 정상에 올랐다. 한 시즌의 모든 여정이 이 한 줄로 남는다.',
  award: '한 시즌의 활약을 인정받아 수상의 영예를 안았다. 코트 위 생산이 만든 결과다.',
  milestone: '리그 역사에 남을 기록이 새로 쓰였다. 세월이 쌓여 만들어진 한 페이지다.',
  hof: '오랜 커리어를 마치고 명예의전당에 이름을 올렸다. 통산 기록은 영원히 보존된다.',
  injury: '부상으로 당분간 코트를 비우게 됐다. 팀 전력과 로테이션에 변수가 생겼다.',
  scandal: '리그를 뒤흔든 소식이다. 해당 선수와 구단은 적지 않은 후폭풍을 마주하게 됐다.',
  owner: '간판 선수의 기용을 두고 팬심이 출렁였다. 구단 운영은 성적만큼이나 정서도 함께 살펴야 한다.',
  streak: '시즌의 흐름을 가른 연속 기록이다. 분위기가 곧 순위로 이어졌다.',
  standing: '한 시즌의 성적표가 순위로 정리됐다. 다음 시즌의 출발선이 여기서 정해진다.',
  match: '한 경기에서 나온 인상적인 장면이다. 코트 위 활약이 기록으로 남았다.',
  debut: '새 얼굴이 코트에 첫발을 디뎠다. 데뷔 무대의 기록이 커리어의 출발점이 된다.',
  transfer: '오프시즌 시장이 움직였다. 한 선수가 새 유니폼을 입고 새 도전을 시작한다.',
  release: '한 선수가 정든 팀을 떠나 FA 시장에 나왔다. 재계약 불발 끝에 새 둥지를 찾아야 하는 처지다.',
  retire: '오랜 커리어를 마치고 한 선수가 코트를 떠난다. 통산 기록과 함께 긴 여정이 마무리된다.',
  sponsor: '다가오는 FA 시장을 앞두고 구단 안팎의 기류가 전해졌다. 어디까지나 소문, 시장이 열려봐야 안다.',
};

export default function NewsArticle() {
  // 뉴스 상세는 무겁다(전 리그 뉴스 피드 재구성 후 id로 조회). 한 틱 미뤄 로딩부터 그린다.
  const ready = useDeferredReady(SCREEN_LOADING_MIN_MS);
  if (!ready) return <Loading variant="list" />;
  return <NewsArticleInner />;
}

function NewsArticleInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const archive = useGameStore((s) => s.archive);
  const milestones = useGameStore((s) => s.milestones);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const expelledLog = useGameStore((s) => s.expelledLog);
  const benchDirectives = useGameStore((s) => s.benchDirectives);
  const transfers = useGameStore((s) => s.transfers);
  const retirements = useGameStore((s) => s.retirements);
  const teamId = useGameStore((s) => s.selectedTeamId);

  const feed = useMemo(
    () => buildNewsFeed(archive, milestones, hallOfFame, season, expelledLog, benchDirectives, leagueDisplayDay(currentDay), teamId ?? '', transfers, retirements),
    [archive, milestones, hallOfFame, season, currentDay, expelledLog, benchDirectives, teamId, transfers, retirements],
  );
  const n = feed[Number(id)];
  const markNewsRead = useGameStore((s) => s.markNewsRead);

  // 읽음 처리는 **상세를 실제로 열 때만**(목록 진입만으론 안 됨 — NEWS_SYSTEM §6). 이 기사 하나만.
  useEffect(() => {
    if (n) markNewsRead([newsKey(n)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!n) {
    return (
      <Screen title="뉴스">
        <Muted>기사를 찾을 수 없습니다.</Muted>
      </Screen>
    );
  }

  const team = n.teamId ? getTeam(n.teamId) : undefined;

  return (
    <Screen title="">
      <Card accent={theme.violet}>
        <IconLabel icon="newspaper-outline" color={theme.violet}>{KIND_KO[n.kind]}{n.big ? ' · 헤드라인' : ''}</IconLabel>
        <Text style={styles.headline}>{n.headline}</Text>
        <Text style={styles.byline}>{seasonYear(n.season)}{team ? ` · ${team.name}` : ''}</Text>
      </Card>
      <Card accent={theme.violet}>
        <Text style={styles.body}>{n.body ?? LEAD[n.kind]}</Text>
      </Card>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  category: { color: theme.accent, fontSize: 13, fontWeight: '800' },
  headline: { color: theme.text, fontSize: 22, fontWeight: '900', lineHeight: 30, marginTop: 4 },
  byline: { color: theme.muted, fontSize: 13, marginTop: 8 },
  body: { color: theme.text, fontSize: 15, lineHeight: 24 },
}));
