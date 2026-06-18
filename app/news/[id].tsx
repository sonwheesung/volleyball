// 뉴스 기사 상세 — 목록(/news)에서 진입. 헤드라인 + 분류 + 시즌/구단 + 분류별 리드 문장.
// 뉴스는 저장 없이 archive·milestones·hallOfFame 등에서 파생되므로(결정론), 목록과 동일 피드를
// 재구성해 id(인덱스)로 같은 기사를 집어낸다.
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Card, Muted, Screen, theme } from '../../components/Screen';
import { buildNewsFeed } from '../../data/news';
import { getTeam } from '../../data/league';
import { useGameStore } from '../../store/useGameStore';
import type { NewsItem } from '../../types';

const KIND_KO: Record<NewsItem['kind'], string> = {
  champion: '우승', award: '시상', milestone: '기록 경신', hof: '명예의전당', injury: '부상', scandal: '사건·사고', owner: '구단',
};

// 본문 데이터가 없으므로 분류별 리드 문단을 구성(헤드라인이 구체 사실을 담는다).
const LEAD: Record<NewsItem['kind'], string> = {
  champion: '정규리그와 포스트시즌을 모두 통과하며 시즌 정상에 올랐다. 한 시즌의 모든 여정이 이 한 줄로 남는다.',
  award: '한 시즌의 활약을 인정받아 수상의 영예를 안았다. 코트 위 생산이 만든 결과다.',
  milestone: '리그 역사에 남을 기록이 새로 쓰였다. 세월이 쌓여 만들어진 한 페이지다.',
  hof: '오랜 커리어를 마치고 명예의전당에 이름을 올렸다. 통산 기록은 영원히 보존된다.',
  injury: '부상으로 당분간 코트를 비우게 됐다. 팀 전력과 로테이션에 변수가 생겼다.',
  scandal: '리그를 뒤흔든 소식이다. 해당 선수와 구단은 적지 않은 후폭풍을 마주하게 됐다.',
  owner: '간판 선수의 기용을 두고 팬심이 출렁였다. 구단 운영은 성적만큼이나 정서도 함께 살펴야 한다.',
};

export default function NewsArticle() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const archive = useGameStore((s) => s.archive);
  const milestones = useGameStore((s) => s.milestones);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const expelledLog = useGameStore((s) => s.expelledLog);
  const benchDirectives = useGameStore((s) => s.benchDirectives);
  const teamId = useGameStore((s) => s.selectedTeamId);

  const feed = useMemo(
    () => buildNewsFeed(archive, milestones, hallOfFame, season, expelledLog, benchDirectives, currentDay, teamId ?? ''),
    [archive, milestones, hallOfFame, season, currentDay, expelledLog, benchDirectives, teamId],
  );
  const n = feed[Number(id)];

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
      <Card>
        <Text style={styles.category}>{KIND_KO[n.kind]}{n.big ? ' · 헤드라인' : ''}</Text>
        <Text style={styles.headline}>{n.headline}</Text>
        <Text style={styles.byline}>{n.season + 1}시즌{team ? ` · ${team.name}` : ''}</Text>
      </Card>
      <Card>
        <Text style={styles.body}>{n.body ?? LEAD[n.kind]}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  category: { color: theme.accent, fontSize: 13, fontWeight: '800' },
  headline: { color: theme.text, fontSize: 22, fontWeight: '900', lineHeight: 30, marginTop: 4 },
  byline: { color: theme.muted, fontSize: 13, marginTop: 8 },
  body: { color: theme.text, fontSize: 15, lineHeight: 24 },
});
