// 뉴스 기사 상세 — 목록(/news)에서 진입. 헤드라인 + 분류 + 시즌/구단 + 분류별 리드 문장.
// 뉴스는 저장 없이 archive·milestones·hallOfFame 등에서 파생되므로(결정론), 목록과 **완전히 동일한 피드**를
// 재구성해 안정 키(newsKey)로 같은 기사를 집어낸다(인덱스 금지 — 목록/상세 필터 비대칭으로 어긋났던 F1, NEWS §3.6).
//
// **모든 kind가 리치 레이아웃**(NEWS §11): 카테고리 칩·부제·본문 + 사건별 실데이터 카드 + 관련 기사.
//   kind='draft'는 전용 리치(DraftArticle, §11 Phase1 승인본, 무변경), 그 외는 공통 RichArticle로 확장.
//   ★ 인터뷰·가짜 드라마·가짜 수치 금지(§11.2): 3인칭 기자 총평만, 이름·팀·수치는 전부 store/파생 실값(없으면 생략).
//   안개(fog): 내 팀 아닌 선수 스탯은 fogOvr/teamScoutReveal. 전부 기존 상태 읽기전용 파생 — 신규 영속 0·결정론(Date.now/random 금지).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, IconLabel, Loading, Muted, Screen, SCREEN_LOADING_MIN_MS, theme, themedStyles, useDeferredReady } from '../../components/Screen';
import { POS_LABEL } from '../../components/posTokens';
import { buildNewsFeed, freshNews, newsKey } from '../../data/news';
import { seasonYear } from '../../data/seasonLabel';
import { displayCutoff } from '../../data/standings';
import { KIND_KO } from '../news';
import { getPlayer, getTeam, teamScoutReveal, reconstructForeignName } from '../../data/league';
import { TITLE_LABELS } from '../../data/awards'; // 부문 기록상 라벨 단일 출처(사용자 결정 2026-07-15 — KOVO "~상")
import { fogOvr, potentialEstimate, revealedCount } from '../../data/prospectScout';
import { overallRaw, displayOvr, REVEAL_PRECISE } from '../../engine/overall';
import { seasonInjuryReport } from '../../data/injury';
import { seasonScandals } from '../../data/dynamics';
import { SEVERITY_KO } from '../../engine/injury';
import { SCANDAL_KO } from '../../engine/scandal';
import { popularityNow } from '../../data/owner';
import { sponsorStanceOf } from '../../engine/sponsorStance';
import { formatMoney } from '../../engine/salary';
import { jerseyNumber } from '../../engine/jersey';
import { resolveJosa } from '../../lib/josa';
import { useGameStore } from '../../store/useGameStore';
import type { DraftPickRecord, ForeignSwapRecord, HofEntry, Milestone, NewsItem, Player, RetireRecord, SeasonArchive, SeasonAwards, Transfer } from '../../types';

// 본문 데이터가 없으면(구결과·예외) 분류별 리드 문단으로 폴백(헤드라인이 구체 사실을 담는다).
const LEAD: Record<NewsItem['kind'], string> = {
  champion: '정규리그와 포스트시즌을 모두 통과하며 시즌 정상에 올랐다. 긴 시즌의 마지막 승자가 결정됐다.',
  award: '한 시즌의 활약을 인정받아 수상의 영예를 안았다. 코트 위 생산이 만든 결과다.',
  milestone: '리그 역사에 남을 기록이 새로 쓰였다. 세월이 쌓여 만들어진 한 페이지다.',
  hof: '오랜 커리어를 마치고 명예의전당에 이름을 올렸다. 통산 기록은 리그 역사 속에 남게 됐다.',
  injury: '부상으로 당분간 코트를 비우게 됐다. 팀 전력과 로테이션에 변수가 생겼다.',
  scandal: '리그를 뒤흔든 소식이다. 해당 선수와 구단은 적지 않은 후폭풍을 마주하게 됐다.',
  owner: '간판 선수의 기용을 두고 팬심이 출렁였다. 구단 운영은 성적만큼이나 정서도 함께 살펴야 한다.',
  streak: '시즌의 흐름을 가른 연속 기록이다. 분위기가 곧 순위로 이어졌다.',
  standing: '한 시즌의 성적표가 순위로 정리됐다. 다음 시즌의 출발선이 여기서 정해진다.',
  match: '한 경기에서 나온 인상적인 장면이다. 코트 위 활약이 기록됐다.',
  debut: '새 얼굴이 코트에 첫발을 디뎠다. 데뷔 무대의 기록이 커리어의 출발점이 된다.',
  transfer: '오프시즌 시장이 움직였다. 한 선수가 새 유니폼을 입고 새 도전을 시작한다.',
  release: '한 선수가 정든 팀을 떠나 FA 시장에 나왔다. 재계약 불발 끝에 새 둥지를 찾아야 하는 처지다.',
  retire: '오랜 커리어를 마치고 한 선수가 코트를 떠난다. 통산 기록과 함께 긴 여정이 마무리된다.',
  sponsor: '다가오는 FA 시장을 앞두고 구단 안팎의 기류가 전해졌다. 어디까지나 소문, 시장이 열려봐야 안다.',
  offseason: '새 시즌을 앞두고 선수 이동이 마무리됐다. 누가 들어오고 누가 떠났는지, 개막 진용이 정리됐다.',
  draft: '신인 드래프트가 미래의 자원을 호명했다. 잠재력은 이제 코트에서 확인될 것이다.',
  foreign: '외국인 선수 자리의 주인이 바뀌었다. 외국인 선수 영입은 한 시즌의 성패를 가르는 가장 큰 도박이다.',
  playoff: '봄배구의 무대에서 한 경기가 끝났다. 단기전은 한 경기 한 경기가 시즌의 운명을 가른다.',
  clinch: '치른 경기만으로 순위가 확정된 순간이다. 남은 경기 결과와 무관하게 봄배구 진출·정규 1위·탈락의 향방이 굳어졌다.',
};

// ── 결정론 변주(§4.2와 동일 계열: FNV-1a + murmur3 fmix). id 해시 픽 — 같은 기사=같은 표현(리플레이 일치). Date.now/random 금지. ──
const dhash = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
  return h >>> 0;
};
const dpick = <T,>(arr: T[], key: string, salt = 0): T => arr[dhash(`${key}|${salt}`) % arr.length];

// ── 부제(teal 한 줄) — kind별 톤(§11.3): 우승=축하 / 부상·징계=담담 / 이적·외인·모기업=시장 / 데뷔=기대 /
//    은퇴·HOF=회고 / 수상·기록·순위=객관. 변형은 뉴스키 해시(결정론). 억지 사실 금지 — 톤 프레이밍만(실사실은 카드가 전달). ──
const SUBTITLE_BY_KIND: Record<NewsItem['kind'], string[]> = {
  champion: ['긴 시즌의 마지막 정상, 그 무게를 증명했다', '정규리그부터 봄배구까지, 모든 길의 끝에 섰다', '한 시즌을 관통한 저력이 왕좌에서 확인됐다'],
  award: ['코트 위 생산이 만든 한 시즌의 훈장', '기록이 증명한 그해의 이름', '한 시즌의 꾸준함이 상으로 이어졌다'],
  milestone: ['세월이 쌓여 새겨진 통산의 이정표', '오랜 누적이 마침내 한 고비를 넘었다', '커리어에 굵은 이정표가 하나 세워졌다'],
  hof: ['코트를 떠나 전당에 이름을 새기다', '긴 여정의 끝, 기록은 역사로 남는다', '한 시대를 마감하고 전당으로 향한다'],
  injury: ['전력 공백, 로테이션에 변수가 생겼다', '반갑지 않은 소식, 복귀 시점이 관건이다', '팀은 당분간 빈자리를 메워야 한다'],
  scandal: ['코트 밖에서 불거진 사건, 후폭풍이 남았다', '팀은 핵심 자원을 잃은 채 일정을 소화한다', '징계의 무게가 시즌에 그림자를 드리웠다'],
  owner: ['성적과 정서 사이, 팬심이 출렁였다', '간판의 기용을 두고 여론이 움직였다', '구단 운영은 성적만큼 정서도 살펴야 한다'],
  streak: ['분위기가 곧 순위로 이어진 흐름', '한 시즌의 물길을 가른 연속 기록', '흐름을 탄 순간이 시즌을 흔들었다'],
  standing: ['한 시즌의 성적표가 순위로 정리됐다', '다음 시즌의 출발선이 여기서 정해졌다', '성적은 팬심과 구단 살림으로 이어진다'],
  match: ['한 경기에 새겨진 인상적인 기록', '코트 위 활약이 숫자로 남았다', '시즌을 통틀어 손꼽을 한 장면이다'],
  debut: ['미래의 자원이 코트에 첫발을 디뎠다', '데뷔 무대의 기록이 커리어의 출발점이 된다', '다음 세대의 성장 곡선이 여기서 시작된다'],
  transfer: ['시장이 움직였다, 새 유니폼의 도전', 'FA 시장에 또 하나의 계약이 성사됐다', '익숙한 코트를 떠나 새 도전을 시작한다'],
  release: ['재계약 불발, 새 둥지를 찾아야 하는 처지', 'FA 시장에 새 이름이 나왔다', '한 시즌의 마침표이자 새 출발선이다'],
  retire: ['긴 여정의 마침표, 남는 것은 기록', '오랜 시간 코트를 지킨 이름이 떠난다', '한 시대를 함께한 선수가 유니폼을 벗는다'],
  sponsor: ['다가오는 FA 시장, 구단 안팎의 기류', '어디까지나 소문, 시장이 열려봐야 안다', '오프시즌을 앞둔 모기업의 온도차'],
  offseason: ['겨울의 전력 재편, 개막 진용이 섰다', '누가 오고 누가 떠났는지, 스쿼드가 정리됐다', '새 시즌의 밑그림이 그려졌다'],
  draft: ['잠재력 높은 신인 자원, 미래를 위한 투자', '즉시 전력보다 성장 여지에 무게를 실었다', '미래의 씨앗이 새 유니폼을 입는다'],
  foreign: ['외국인 자리의 주인이 바뀌었다', '팀 공격의 핵을 다시 짰다', '외인 결정은 늘 시즌 최대의 도박이다'],
  playoff: ['봄배구, 한 경기가 시즌의 운명을 가른다', '단기전엔 내일이 없다', '가을부터 달려온 여정의 끝자락이다'],
  clinch: ['치른 경기만으로 굳어진 순위의 향방', '남은 결과와 무관하게 방향이 정해졌다', '수학이 순위를 먼저 확정했다'],
};

// 관련 기사(§11 골격 6) — 같은 kind + 연관 kind. 실제 피드 링크만(없으면 생략).
const RELATED_KINDS: Record<NewsItem['kind'], NewsItem['kind'][]> = {
  champion: ['playoff', 'award', 'clinch'], award: ['award', 'milestone', 'match'], milestone: ['milestone', 'award', 'match'],
  hof: ['retire', 'milestone', 'award'], injury: ['injury', 'scandal'], scandal: ['scandal', 'injury'],
  owner: ['owner', 'standing'], streak: ['streak', 'standing', 'clinch'], standing: ['standing', 'streak', 'clinch'],
  match: ['match', 'debut', 'award'], debut: ['debut', 'draft', 'match'], transfer: ['transfer', 'release', 'foreign'],
  release: ['release', 'transfer', 'foreign'], retire: ['retire', 'hof'], sponsor: ['sponsor', 'transfer', 'offseason'],
  offseason: ['offseason', 'transfer', 'foreign', 'draft'], draft: ['draft', 'foreign', 'offseason'],
  foreign: ['foreign', 'transfer', 'offseason'], playoff: ['playoff', 'champion', 'clinch'], clinch: ['clinch', 'standing', 'playoff'],
};

// 오프시즌 결산(offseason) 구조화 섹션 — 산문 한 문단에 몰아넣던 영입/재계약/방출을 라벨+칩 목록 카드로(§11.3 B·§3.7).
//   값은 news.ts가 만든 실데이터 라벨(예 "발디아(외인)", "현한정(→김천 코메츠)"). 빈 섹션은 렌더 안 함.
const MOVE_SECTIONS: { key: 'in' | 'kept' | 'out'; label: string; icon: ComponentProps<typeof Ionicons>['name']; color: string }[] = [
  { key: 'in', label: '영입·입단', icon: 'log-in-outline', color: theme.good },
  { key: 'kept', label: '재계약 유지', icon: 'refresh-outline', color: theme.sky },
  { key: 'out', label: '방출·이적', icon: 'log-out-outline', color: theme.warn },
];

/** 오프시즌 이동 칩 목록 카드(구조화) — 각 섹션(영입/재계약/방출)을 색 구분 칩으로. 빈 섹션 생략. */
function MovesCard({ moves }: { moves: NonNullable<NewsItem['moves']> }) {
  const sections = MOVE_SECTIONS.filter((s) => moves[s.key].length > 0);
  if (sections.length === 0) return null;
  return (
    <Card flat accent={theme.sky}>
      <IconLabel icon="swap-horizontal-outline" color={theme.sky}>선수 이동</IconLabel>
      {sections.map((s) => (
        <View key={s.key} style={styles.moveSection}>
          <IconLabel icon={s.icon} color={s.color}>{s.label} · {moves[s.key].length}</IconLabel>
          <View style={styles.chipRow}>
            {moves[s.key].map((name, i) => (
              <View key={i} style={[styles.chip, { borderColor: s.color }]}>
                <Text style={styles.chipText} numberOfLines={1}>{name}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </Card>
  );
}

// kind별 헤더 아이콘(카테고리 시각 구분). Ionicons 글리프 — 오타는 tsc가 잡음.
const KIND_ICON: Record<NewsItem['kind'], ComponentProps<typeof Ionicons>['name']> = {
  champion: 'trophy-outline', award: 'medal-outline', milestone: 'flag-outline', hof: 'ribbon-outline',
  injury: 'medkit-outline', scandal: 'warning-outline', owner: 'megaphone-outline', streak: 'trending-up-outline',
  standing: 'podium-outline', match: 'flame-outline', debut: 'sparkles-outline', transfer: 'swap-horizontal-outline',
  release: 'exit-outline', retire: 'flower-outline', sponsor: 'business-outline', offseason: 'construct-outline',
  draft: 'sparkles-outline', foreign: 'globe-outline', playoff: 'flash-outline', clinch: 'checkmark-circle-outline',
};

// 선수 포지션별 대표 통산 스탯 한 줄(실값만) — 밀스톤/커리어 카드 보강. 값 0은 생략(가짜 드라마 방지).
function careerStatRow(p: Player): { label: string; value: string } | null {
  const c = p.career;
  if (!c || c.matches <= 0) return null;
  const v = p.position === 'L' ? { label: '통산 디그', value: `${c.digs.toLocaleString()}개` }
    : p.position === 'S' ? { label: '통산 세트', value: `${c.assists.toLocaleString()}개` }
    : p.position === 'MB' ? { label: '통산 블로킹', value: `${c.blocks.toLocaleString()}개` }
    : { label: '통산 득점', value: `${c.points.toLocaleString()}점` };
  return v;
}

type PosGroup = 'attack' | 'set' | 'libero';
const posGroup = (pos: Player['position']): PosGroup => (pos === 'S' ? 'set' : pos === 'L' ? 'libero' : 'attack');

// 부제(teal 한 줄) — 포지션(공개 사실) + 신인=미래 투자 톤. 변형은 id 해시(결정론).
const SUBTITLE: Record<PosGroup, string[]> = {
  attack: ['잠재력 높은 공격 자원 확보, 미래를 위한 투자', '즉시 전력감보다 성장 여지에 무게를 실었다', '높이와 파워, 성장 곡선을 내다본 지명'],
  set: ['미래의 사령탑 후보, 길게 보는 선택', '팀의 다음 세대 세터에 투자했다', '경기 운영의 미래를 내다본 지명'],
  libero: ['수비 라인의 미래를 채울 자원 확보', '끈질긴 수비, 성장 여지에 기대를 건다', '뒷문을 책임질 다음 세대 후보'],
};

// 스카우트 코멘트(기자 총평 = 3인칭 분석, 인터뷰 아님, §11.2). 내 팀=풀스카우팅이라 유형 단정 / 타팀=포지션 역할 프레이밍(안개).
const COMMENT_MINE: Record<PosGroup, string[]> = {
  attack: ['공격 타이밍과 높이가 돋보이는 유형이다.', '파워와 점프력에서 강점이 뚜렷한 공격 자원이다.', '네트 앞에서의 파괴력이 기대되는 카드다.'],
  set: ['코트를 넓게 읽는 배급 감각이 강점으로 꼽힌다.', '토스의 안정감과 경기 운영이 돋보이는 유형이다.', '공격 전개의 속도를 살릴 세터감이다.'],
  libero: ['수비 범위와 리시브 안정감이 강점이다.', '끈질긴 디그와 리시브가 돋보이는 수비 자원이다.', '뒷선을 든든하게 지킬 유형이다.'],
};
const COMMENT_OTHER: Record<PosGroup, string[]> = {
  attack: ['공격력과 높이가 관건인 포지션인 만큼 성장 여하가 주목된다.', '득점 생산을 책임질 공격 자원으로 분류된다.'],
  set: ['팀 공격의 배급을 맡을 세터 자원으로 분류된다.', '경기 운영이 관건인 포지션이라 성장 곡선이 관건이다.'],
  libero: ['수비 라인을 책임질 리베로 자원으로 분류된다.', '리시브와 디그가 생명인 포지션이라 완성도가 관건이다.'],
};
const GROWTH_YOUNG = ['아직 경험은 부족하지만 성장 여지가 크다는 평가다.', '다듬어야 할 부분은 있으나 잠재력은 분명하다.', '시간을 두고 지켜볼 만한 자원이다.'];
const GROWTH_READY = ['비교적 완성형에 가까워 이른 기여도 기대해 볼 만하다.', '기본기가 갖춰져 있어 적응 후 전력에 보탬이 될 전망이다.'];

export default function NewsArticle() {
  // 뉴스 상세는 무겁다(전 리그 뉴스 피드 재구성 후 id로 조회). 한 틱 미뤄 로딩부터 그린다.
  const ready = useDeferredReady(SCREEN_LOADING_MIN_MS);
  if (!ready) return <Loading variant="list" />;
  return <NewsArticleInner />;
}

function NewsArticleInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const results = useGameStore((s) => s.results);
  const archive = useGameStore((s) => s.archive);
  const milestones = useGameStore((s) => s.milestones);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const expelledLog = useGameStore((s) => s.expelledLog);
  const benchDirectives = useGameStore((s) => s.benchDirectives);
  const transfers = useGameStore((s) => s.transfers);
  const retirements = useGameStore((s) => s.retirements);
  const seasonDraftLog = useGameStore((s) => s.seasonDraftLog);
  const seasonForeignLog = useGameStore((s) => s.seasonForeignLog);
  const teamId = useGameStore((s) => s.selectedTeamId);

  // 목록(news.tsx)과 **완전히 동일한 파생**(displayCutoff §3.3 + freshNews) — 안정 키로 같은 기사를 집어야 어긋나지 않는다(F1).
  const cutoff = displayCutoff(currentDay, results, teamId ?? undefined);
  const feed = useMemo(
    () => freshNews(buildNewsFeed(archive, milestones, hallOfFame, season, expelledLog, benchDirectives, cutoff, teamId ?? '', transfers, retirements, seasonDraftLog, seasonForeignLog, currentDay), cutoff),
    [archive, milestones, hallOfFame, season, cutoff, currentDay, expelledLog, benchDirectives, teamId, transfers, retirements, seasonDraftLog, seasonForeignLog],
  );
  const key = id ? decodeURIComponent(id) : '';
  const n = feed.find((x) => newsKey(x) === key);
  const markNewsRead = useGameStore((s) => s.markNewsRead);

  // 읽음 처리는 **상세를 실제로 열 때만**(목록 진입만으론 안 됨 — NEWS_SYSTEM §6). 이 기사 하나만.
  useEffect(() => {
    if (n) markNewsRead([newsKey(n)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!n) {
    // 만료(2주 지난 인게임 뉴스)·부재 시 graceful 안내(F1, NEWS §3.6) — 목록에서 만료된 기사로 딥링크된 경우.
    return (
      <Screen title="뉴스">
        <Muted>만료됐거나 찾을 수 없는 기사입니다. 오래된 소식은 목록에서 사라집니다.</Muted>
      </Screen>
    );
  }

  const onOpen = (k: string) => router.push(`/news/${encodeURIComponent(k)}`);
  // 드래프트는 전용 리치(§11 Phase1 승인본, 무변경). 그 외 전 kind는 공통 RichArticle로 리치 확장(§11).
  if (n.kind === 'draft') {
    return <DraftArticle n={n} feed={feed} myTeamId={teamId ?? ''} seasonDraftLog={seasonDraftLog} onOpen={onOpen} />;
  }
  return (
    <RichArticle
      n={n} feed={feed} myTeamId={teamId ?? ''} currentSeason={season} leagueDay={cutoff}
      archive={archive} milestones={milestones} hallOfFame={hallOfFame} retirements={retirements}
      transfers={transfers} seasonForeignLog={seasonForeignLog} onOpen={onOpen}
    />
  );
}

// ── 드래프트 리치 기사(NEWS §11 Phase1) — 실데이터 카드. 안개: 내 팀=전체공개 / 타팀=스카우터 등급만큼 흐릿. ──
function InfoRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, accent ? { color: theme.accent } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function DraftArticle({ n, feed, myTeamId, seasonDraftLog, onOpen }: {
  n: NewsItem; feed: NewsItem[]; myTeamId: string; seasonDraftLog: DraftPickRecord[]; onOpen: (key: string) => void;
}) {
  const team = n.teamId ? getTeam(n.teamId) : undefined;
  // n.ref = 드래프트 선수의 playerId(§3.7 ②). playerId는 고유 — 시즌 필터 없이 안전하게 찾는다.
  const rec = seasonDraftLog.find((d) => d.playerId === n.ref);
  const p = n.ref ? getPlayer(n.ref) : undefined;
  const isMyTeam = !!n.teamId && n.teamId === myTeamId;

  const grp = p ? posGroup(p.position) : 'attack';
  const subtitle = p ? dpick(SUBTITLE[grp], p.id, 0) : '';

  // 선수 카드 값 — 안개 준수. 내 팀=전체공개(reveal 1) / 타팀=내 스카우터 공개도만큼.
  let scoutOvr = '', immediate = '', growth = '', comment = '';
  if (p) {
    const reveal = isMyTeam ? 1 : teamScoutReveal(myTeamId);
    // 스카우트 평가 = fog OVR 문자열(정밀=정확치, 아니면 범위). draft 화면과 동일 표기(표시 sanctioned).
    scoutOvr = fogOvr(p, reveal);
    // 예상 즉시 전력감 = 현재 OVR 3버킷(coarse). 안개: 정밀 공개(내 팀·최고 스카우터)일 때만 — 흐린 범위보다
    // 날카로운 버킷을 노출하지 않도록 정보부족 처리(fog 준수).
    const dov = displayOvr(overallRaw(p));
    immediate = reveal >= REVEAL_PRECISE
      ? (dov >= 80 ? '높음' : dov >= 72 ? '보통' : '낮음')
      : '스카우트 정보 부족';
    // 성장 잠재력 = potentialEstimate(reveal 게이트) − 현재 추정(reveal 0)의 격차(coarse). 숫자 미표시(§ 표시금지, 버킷만).
    const revealedN = revealedCount(p.position, reveal);
    const headroom = potentialEstimate(p, reveal) - potentialEstimate(p, 0);
    growth = revealedN === 0 ? '스카우트 정보 부족'
      : headroom >= 10 ? '매우 높음' : headroom >= 4 ? '높음' : '보통';
    // 기자 총평(3인칭) — 내 팀=유형 단정 / 타팀=역할 프레이밍(안개) + 나이 기반 성장 문구(실데이터).
    const arche = dpick(isMyTeam ? COMMENT_MINE[grp] : COMMENT_OTHER[grp], p.id, 3);
    const growthClause = p.age <= 21 ? dpick(GROWTH_YOUNG, p.id, 4) : dpick(GROWTH_READY, p.id, 5);
    comment = `${arche} ${growthClause}`;
  }

  // 본문 — n.body(조립식 draft 본문)를 1문단으로, 실스탯(신장·포지션·나이)으로 사실 문단 한 겹 추가(감정·인용 금지).
  const paras: string[] = [];
  if (n.body) paras.push(n.body);
  if (p) {
    const posLabel = POS_LABEL[p.position];
    paras.push(`신장 ${p.height}cm의 ${posLabel} 자원이다. ${p.age <= 21
      ? '아직 어린 나이인 만큼 앞으로의 성장 곡선이 지명의 성패를 가를 전망이다.'
      : '기본기가 갖춰져 있어 적응 여하에 따라 이른 기여도 기대할 수 있다.'}`);
  }
  if (paras.length === 0) paras.push(LEAD.draft);

  // 구단 N번째 지명 — seasonDraftLog에서 계산(가능할 때만, 지어내기 금지). 타팀은 1R만 로그돼 1번째.
  let teamNth: number | null = null;
  if (rec) {
    const teamPicks = seasonDraftLog
      .filter((d) => d.season === rec.season && d.teamId === rec.teamId)
      .sort((a, b) => a.overallPick - b.overallPick);
    const idx = teamPicks.findIndex((d) => d.playerId === rec.playerId);
    if (idx >= 0) teamNth = idx + 1;
  }

  // 관련 기사 — 같은 피드의 다른 draft/foreign 기사 최대 3(있을 때만). 링크는 목록과 동일 안정 키 라우팅.
  const related = feed
    .filter((x) => (x.kind === 'draft' || x.kind === 'foreign') && newsKey(x) !== newsKey(n))
    .slice(0, 3);

  return (
    <Screen title="">
      {/* 1) 카테고리 칩 + 인게임 날짜(시즌)·구단 + 헤드라인 + 부제(teal) */}
      <Card accent={theme.accent} flat>
        <IconLabel icon="sparkles-outline" color={theme.accent}>{KIND_KO.draft}{n.big ? ' · 헤드라인' : ''}</IconLabel>
        <Text style={styles.byline}>{seasonYear(n.season)}{team ? ` · ${team.name}` : ''}</Text>
        <Text style={styles.headline}>{n.headline}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </Card>

      {/* 2) 본문(사실 문단) */}
      <Card accent={theme.accent} flat>
        {paras.map((t, i) => (
          <Text key={i} style={[styles.body, i > 0 ? { marginTop: 10 } : null]}>{t}</Text>
        ))}
      </Card>

      {/* 3) 선수 정보 카드(안개 준수) */}
      {p ? (
        <Card flat accent={theme.sky}>
          <IconLabel icon="person-outline" color={theme.sky}>선수 정보</IconLabel>
          <View style={styles.infoGrid}>
            <InfoRow label="포지션" value={`${p.position} (${POS_LABEL[p.position]})`} />
            <InfoRow label="나이" value={`${p.age}세`} />
            <InfoRow label="신장" value={`${p.height}cm`} />
            <InfoRow label="스카우트 평가" value={`OVR ${scoutOvr}${isMyTeam ? '' : ' (추정)'}`} accent />
            <InfoRow label="예상 즉시 전력감" value={immediate} />
            <InfoRow label="성장 잠재력" value={growth} accent />
          </View>
          {!isMyTeam ? <Muted style={styles.fogNote}>※ 타 구단 지명, 스카우터 공개도만큼만 파악됩니다.</Muted> : null}
        </Card>
      ) : null}

      {/* 4) 스카우트 코멘트(기자 총평 — 인터뷰 아님) */}
      {comment ? (
        <Card flat accent={theme.violet}>
          <IconLabel icon="clipboard-outline" color={theme.violet}>스카우트 코멘트</IconLabel>
          <Text style={styles.comment}>{comment}</Text>
        </Card>
      ) : null}

      {/* 5) 드래프트 정보 카드 — 실제 값만(예상 순위 등 없는 데이터는 지어내지 않음) */}
      {rec ? (
        <Card flat accent={theme.gold}>
          <IconLabel icon="trophy-outline" color={theme.gold}>드래프트 정보</IconLabel>
          <View style={styles.infoGrid}>
            <InfoRow label="전체 순번" value={`${rec.overallPick}순위`} accent />
            <InfoRow label="라운드" value={`${rec.round}라운드`} />
            {team ? <InfoRow label="지명 구단" value={team.name} /> : null}
            {teamNth != null ? <InfoRow label="구단 지명 순서" value={`${teamNth}번째`} /> : null}
          </View>
        </Card>
      ) : null}

      {/* 6) 관련 기사 — 같은 피드 draft/foreign 링크(있을 때만) */}
      {related.length > 0 ? (
        <Card flat accent={theme.muted}>
          <IconLabel icon="link-outline" color={theme.mutedBright}>관련 기사</IconLabel>
          {related.map((x) => (
            <Text key={newsKey(x)} style={styles.relLink} numberOfLines={2} onPress={() => onOpen(newsKey(x))}>
              › {x.headline}
            </Text>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

// ── 공통 리치 기사(NEWS §11) — 드래프트 외 전 kind. 사건별 실데이터 카드 + 기자 총평(인터뷰 아님). ──
const teamNameOf = (id?: string): string => (id ? getTeam(id)?.name ?? id : '');
const pNameOf = (id: string): string => getPlayer(id)?.name ?? reconstructForeignName(id) ?? id;

/** 한 시즌 시상 결과에서 특정 선수가 받은 상 목록(라벨+근거 수치, 실값만). */
function awardsForPlayer(aw: SeasonAwards, playerId: string): { label: string; value?: string }[] {
  const out: { label: string; value?: string }[] = [];
  if (aw.mvp?.playerId === playerId) out.push({ label: '정규리그 MVP' });
  if (aw.finalsMvp?.playerId === playerId) out.push({ label: '챔프전 MVP' });
  if (aw.rookie?.playerId === playerId) out.push({ label: '신인상' });
  if (aw.mostImproved?.playerId === playerId) out.push({ label: '기량발전상' });
  const TITLE_UNIT: Record<string, string> = { scoring: '점', spike: '개', block: '개', serve: '개', dig: '개', set: '개', receive: '개' };
  for (const [k, label] of Object.entries(TITLE_LABELS)) { // 라벨=단일 출처(data/awards.ts), 단위만 화면 로컬
    const w = aw.titles[k as keyof SeasonAwards['titles']];
    if (w?.playerId === playerId) out.push({ label, value: `${w.value.toLocaleString()}${TITLE_UNIT[k]}` });
  }
  for (const s of aw.best7 ?? []) if (s.winner?.playerId === playerId) out.push({ label: `베스트7 (${POS_LABEL[s.pos]})` });
  (aw.roundMvps ?? []).forEach((w, i) => { if (w?.playerId === playerId) out.push({ label: `${i + 1}라운드 MVP` }); });
  return out;
}

/** 관측된 연속 우승 수(왕조) — archive 우승 시즌만으로(가짜 드라마 아님, buildNewsFeed와 동일 규칙). */
function dynastyRunOf(archive: SeasonArchive[], teamId: string, season: number): number {
  const ss = archive.filter((a) => a.championId === teamId).map((a) => a.season).sort((x, y) => x - y);
  const idx = ss.indexOf(season);
  if (idx < 0) return 1;
  let run = 1;
  for (let i = idx; i > 0 && ss[i] === ss[i - 1] + 1; i--) run++;
  return run;
}

function RichArticle({ n, feed, myTeamId, currentSeason, leagueDay, archive, milestones, hallOfFame, retirements, transfers, seasonForeignLog, onOpen }: {
  n: NewsItem; feed: NewsItem[]; myTeamId: string; currentSeason: number; leagueDay: number;
  archive: SeasonArchive[]; milestones: Milestone[]; hallOfFame: HofEntry[]; retirements: RetireRecord[];
  transfers: Transfer[]; seasonForeignLog: ForeignSwapRecord[]; onOpen: (key: string) => void;
}) {
  const nk = newsKey(n);
  const team = n.teamId ? getTeam(n.teamId) : undefined;
  const p = n.ref ? getPlayer(n.ref) : undefined; // ref가 실제 선수일 때만(champion/clinch/sponsor 등 팀 ref·플옵 게임키는 undefined)
  const isMyTeam = !!n.teamId && n.teamId === myTeamId;
  const accent = KIND_ACCENT()[n.kind];
  const subtitle = dpick(SUBTITLE_BY_KIND[n.kind], nk, 0);

  // 오프시즌 결산은 이동 목록을 구조화 카드(MovesCard)로 렌더한다(산문 몰아넣기 해소, §11.3 B). body는 이미 리드·마무리 산문만.
  const offMoves = n.kind === 'offseason' && n.moves && (n.moves.in.length + n.moves.kept.length + n.moves.out.length) > 0 ? n.moves : null;
  // 본문 — n.body(사실 조립본) 또는 분류 리드 + 선수 주인공이면 신체·역할 사실 한 줄(실값, 감정 금지).
  const paras: string[] = [n.body ?? LEAD[n.kind]];
  if (p) paras.push(`신장 ${p.height}cm · ${p.age}세 ${POS_LABEL[p.position]}.`);

  // 선수 정보 카드(안개 준수 — 내 팀=정확 OVR / 타팀=스카우터 등급만큼 범위). draft 기사와 동일 처리.
  const reveal = isMyTeam ? 1 : teamScoutReveal(myTeamId);
  const scoutOvr = p ? fogOvr(p, reveal) : '';

  // ── kind별 실데이터 카드(있는 것만 — 지어내기 금지) ──
  const rows: { label: string; value: string; accent?: boolean }[] = [];
  let cardTitle = '', cardIcon: ComponentProps<typeof Ionicons>['name'] = 'clipboard-outline', cardColor = accent, cardNote = '';

  if (n.kind === 'injury' && n.season === currentSeason) {
    const s = seasonInjuryReport().find((x) => x.playerId === n.ref);
    if (s) {
      cardTitle = '부상 정보'; cardIcon = 'medkit-outline'; cardColor = theme.bad;
      rows.push({ label: '부상 정도', value: SEVERITY_KO[s.severity], accent: true });
      rows.push({ label: '예상 결장', value: s.severity === 'season' ? '시즌아웃' : `약 ${s.missMatches}경기` });
      if (p) rows.push({ label: '포지션 공백', value: POS_LABEL[p.position] });
    }
  } else if (n.kind === 'scandal') {
    const s = seasonScandals().find((x) => x.playerId === n.ref);
    if (s) {
      cardTitle = '징계 정보'; cardIcon = 'warning-outline'; cardColor = theme.warn;
      rows.push({ label: '사유', value: SCANDAL_KO[s.kind], accent: true });
      rows.push({ label: '출장 정지', value: `${s.missMatches}경기` });
      if (p) rows.push({ label: '포지션 공백', value: POS_LABEL[p.position] });
    }
  } else if (n.kind === 'champion') {
    const a = archive.find((x) => x.season === n.season);
    if (a?.championId) {
      cardTitle = '우승 여정'; cardIcon = 'trophy-outline'; cardColor = theme.gold;
      const rank = a.standings ? a.standings.indexOf(a.championId) + 1 : 0;
      if (rank > 0) rows.push({ label: '정규리그 순위', value: `${rank}위` });
      // 우승 방식은 챔피언의 **마지막 시리즈**(=결승, seriesByTeam PO 먼저·결승 나중)로 판정 — 비-1시드 PO 2-1 오매칭 방지(UV-9).
      const seriesArr = a.series?.[a.championId];
      const series = seriesArr && seriesArr.length ? seriesArr[seriesArr.length - 1] : undefined;
      const sweep = series && series.length === 3 && series.every((g) => g === 'W');
      const reverse = series && series.length === 5 && series[0] === 'L' && series[1] === 'L' && series.slice(2).every((g) => g === 'W');
      rows.push({ label: '우승 방식', value: reverse ? '리버스 스윕 대역전' : sweep ? '챔프전 3-0 스윕' : '챔프전 제패', accent: true });
      const run = dynastyRunOf(archive, a.championId, a.season);
      if (run >= 2) rows.push({ label: '연속 우승', value: `${run}연패` });
      if (a.awards?.mvp && a.awards.mvp.teamId === a.championId) rows.push({ label: '정규 MVP', value: pNameOf(a.awards.mvp.playerId) });
    }
  } else if (n.kind === 'award') {
    const a = archive.find((x) => x.season === n.season);
    if (a?.awards && n.ref) {
      const list = awardsForPlayer(a.awards, n.ref);
      if (list.length) {
        cardTitle = '수상 내역'; cardIcon = 'medal-outline'; cardColor = theme.gold;
        // 수상 이력 원장처럼 각 상에 시즌 연도를 붙인다(2026-07-12 사용자 — "몇 년도인지 나오면 좋겠다").
        //   byline에도 연도가 있지만 상 줄 자체에 붙어야 "2025-26 챔프전 MVP"로 한눈에 읽힌다.
        const yr = seasonYear(n.season);
        for (const w of list) rows.push({ label: `${yr} ${w.label}`, value: w.value ?? '수상', accent: !w.value });
      }
    }
  } else if (n.kind === 'milestone') {
    const m = milestones.find((mm) => mm.season === n.season && mm.playerId === n.ref && resolveJosa(mm.text) === n.headline)
      ?? milestones.find((mm) => mm.season === n.season && mm.playerId === n.ref);
    if (m) {
      cardTitle = '통산 기록'; cardIcon = 'flag-outline'; cardColor = theme.sky;
      rows.push({ label: '기록 구분', value: m.kind === 'league' ? '리그 역대 기록' : m.kind === 'club' ? '구단 통산 기록' : '개인 통산 기록', accent: true });
      const cs = p ? careerStatRow(p) : null;
      if (cs) rows.push({ label: cs.label, value: cs.value });
    }
  } else if (n.kind === 'retire') {
    const r = retirements.find((rr) => rr.season === n.season && rr.playerId === n.ref);
    if (r) {
      cardTitle = '커리어 요약'; cardIcon = 'time-outline'; cardColor = theme.violet;
      rows.push({ label: '통산', value: `${r.seasons}시즌`, accent: true });
      const stat = r.position === 'L' ? (r.digs > 0 ? { l: '통산 디그', v: `${r.digs.toLocaleString()}개` } : null)
        : r.position === 'S' ? (r.assists > 0 ? { l: '통산 세트', v: `${r.assists.toLocaleString()}개` } : null)
        : r.position === 'MB' ? (r.blocks > 0 ? { l: '통산 블로킹', v: `${r.blocks.toLocaleString()}개` } : null)
        : (r.points > 0 ? { l: '통산 득점', v: `${r.points.toLocaleString()}점` } : null);
      if (stat) rows.push({ label: stat.l, value: stat.v });
      if (r.age != null) rows.push({ label: '은퇴 나이', value: `${r.age}세` });
      if (r.legend) rows.push({ label: '영구결번급', value: '헌액' });
      else if (r.hof) rows.push({ label: '명예의전당', value: '헌액' });
    }
  } else if (n.kind === 'hof') {
    const h = hallOfFame.find((hh) => hh.id === n.ref && hh.retiredSeason === n.season);
    if (h) {
      cardTitle = '통산 커리어'; cardIcon = 'ribbon-outline'; cardColor = theme.gold;
      rows.push({ label: '통산', value: `${h.seasons}시즌`, accent: true });
      if (h.points > 0) rows.push({ label: '통산 득점', value: `${h.points.toLocaleString()}점` });
      if (h.blocks > 0) rows.push({ label: '통산 블로킹', value: `${h.blocks.toLocaleString()}개` });
      if (h.digs > 0) rows.push({ label: '통산 디그', value: `${h.digs.toLocaleString()}개` });
      if (h.legend) rows.push({ label: '헌액 번호', value: `${jerseyNumber(h.id)}번` });
    }
  } else if (n.kind === 'transfer' || n.kind === 'release') {
    const t = transfers.find((tt) => tt.season === n.season && tt.playerId === n.ref && (n.kind === 'release' ? tt.kind === 'release' : tt.kind !== 'release'));
    if (t) {
      cardTitle = '이동 정보'; cardIcon = 'swap-horizontal-outline'; cardColor = theme.sky;
      rows.push({ label: '전 소속', value: teamNameOf(t.fromTeam) });
      if (n.kind === 'release') {
        rows.push({ label: '거취', value: t.satOut ? '제안 거절·무소속' : 'FA 시장(미계약)', accent: true });
        if (t.reason) rows.push({ label: '사유', value: t.reason === 'capSqueezed' ? '샐러리캡 압박' : t.reason === 'refused' ? '재계약 거절' : '재계약 미제안' });
      } else {
        rows.push({ label: '새 소속', value: teamNameOf(t.toTeam), accent: true });
        if (typeof t.counteredTo === 'number') rows.push({ label: '계약', value: formatMoney(t.counteredTo) });
      }
      if (t.ovr) rows.push({ label: '이동 시점 OVR', value: `${t.ovr}` });
    }
  } else if (n.kind === 'foreign') {
    const f = seasonForeignLog.find((ff) => ff.season === n.season - 1 && ff.teamId === n.teamId && (ff.inId ?? ff.outId) === n.ref)
      ?? seasonForeignLog.find((ff) => ff.season === n.season - 1 && ff.teamId === n.teamId);
    if (f) {
      cardTitle = '외국인 이동'; cardIcon = 'globe-outline'; cardColor = theme.elite;
      rows.push({ label: '유형', value: f.asian ? '아시아쿼터' : '외국인 선수', accent: true });
      if (f.inName) rows.push({ label: '영입', value: f.inName });
      if (f.outName) rows.push({ label: '결별', value: f.outName });
    }
  } else if (n.kind === 'owner' && p) {
    cardTitle = '팬심'; cardIcon = 'heart-outline'; cardColor = theme.rose;
    rows.push({ label: '팬 인기도', value: `${Math.round(popularityNow(p, leagueDay, archive))}/100`, accent: true });
  } else if (n.kind === 'sponsor' && n.teamId) {
    const stance = sponsorStanceOf(n.teamId, n.season, archive);
    cardTitle = '모기업 기조'; cardIcon = 'business-outline'; cardColor = theme.gold;
    rows.push({ label: '다가오는 FA', value: stance === 'aggressive' ? '공격적 투자 예고' : stance === 'thrifty' ? '긴축·관망 기조' : '평년 기조', accent: true });
    cardNote = '※ 어디까지나 전망, 시장이 열려봐야 안다.';
  } else if (n.kind === 'standing') {
    const a = archive.find((x) => x.season === n.season);
    if (a && n.teamId) {
      cardTitle = '팀 성적'; cardIcon = 'podium-outline'; cardColor = theme.sky;
      const rank = a.standings ? a.standings.indexOf(n.teamId) + 1 : 0;
      if (rank > 0) rows.push({ label: '최종 순위', value: `${rank}위`, accent: true });
      const rec = a.record?.[n.teamId];
      if (rec) rows.push({ label: '정규리그 성적', value: `${rec[0]}승 ${rec[1]}패` });
    }
  } else if (n.kind === 'streak') {
    const a = archive.find((x) => x.season === n.season);
    const s = a?.streaks?.[n.teamId ?? ''];
    if (s) {
      cardTitle = '연속 기록'; cardIcon = 'trending-up-outline'; cardColor = theme.accent;
      if (s[0] > 0) rows.push({ label: '시즌 최장 연승', value: `${s[0]}연승`, accent: true });
      if (s[1] > 0) rows.push({ label: '시즌 최장 연패', value: `${s[1]}연패` });
      const rec = a?.record?.[n.teamId ?? ''];
      if (rec) rows.push({ label: '정규리그 성적', value: `${rec[0]}승 ${rec[1]}패` });
    }
  }

  // 관련 기사 — 같은 kind + 연관 kind(§11 골격 6). 실제 피드 링크만.
  const rel = feed.filter((x) => newsKey(x) !== nk && (x.kind === n.kind || RELATED_KINDS[n.kind].includes(x.kind))).slice(0, 3);

  return (
    <Screen title="">
      {/* 1) 카테고리 칩 + 인게임 날짜·구단 + 헤드라인 + 부제(teal) */}
      <Card accent={accent} flat>
        <IconLabel icon={KIND_ICON[n.kind]} color={accent}>{KIND_KO[n.kind]}{n.big ? ' · 헤드라인' : ''}</IconLabel>
        <Text style={styles.byline}>{seasonYear(n.season)}{team ? ` · ${team.name}` : ''}</Text>
        <Text style={styles.headline}>{n.headline}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </Card>

      {/* 2) 본문(사실 문단) */}
      <Card accent={accent} flat>
        {paras.map((t, i) => (
          <Text key={i} style={[styles.body, i > 0 ? { marginTop: 10 } : null]}>{t}</Text>
        ))}
      </Card>

      {/* 2b) 오프시즌 결산 — 영입/재계약/방출 구조화 칩 카드(산문 대신) */}
      {offMoves ? <MovesCard moves={offMoves} /> : null}

      {/* 3) 선수 정보 카드(안개 준수) — ref가 실제 선수일 때만 */}
      {p ? (
        <Card flat accent={theme.sky}>
          <IconLabel icon="person-outline" color={theme.sky}>선수 정보</IconLabel>
          <View style={styles.infoGrid}>
            <InfoRow label="포지션" value={`${p.position} (${POS_LABEL[p.position]})`} />
            <InfoRow label="나이" value={`${p.age}세`} />
            <InfoRow label="신장" value={`${p.height}cm`} />
            <InfoRow label="종합 능력" value={`OVR ${scoutOvr}${isMyTeam ? '' : ' (추정)'}`} accent />
          </View>
          {!isMyTeam ? <Muted style={styles.fogNote}>※ 타 구단 선수, 스카우터 공개도만큼만 파악됩니다.</Muted> : null}
        </Card>
      ) : null}

      {/* 4) kind별 실데이터 카드(있을 때만 — 지어내기 금지) */}
      {rows.length > 0 ? (
        <Card flat accent={cardColor}>
          <IconLabel icon={cardIcon} color={cardColor}>{cardTitle}</IconLabel>
          <View style={styles.infoGrid}>
            {rows.map((r, i) => <InfoRow key={i} label={r.label} value={r.value} accent={r.accent} />)}
          </View>
          {cardNote ? <Muted style={styles.fogNote}>{cardNote}</Muted> : null}
        </Card>
      ) : null}

      {/* 5) 관련 기사 — 같은/연관 kind 링크(있을 때만) */}
      {rel.length > 0 ? (
        <Card flat accent={theme.muted}>
          <IconLabel icon="link-outline" color={theme.mutedBright}>관련 기사</IconLabel>
          {rel.map((x) => (
            <Text key={newsKey(x)} style={styles.relLink} numberOfLines={2} onPress={() => onOpen(newsKey(x))}>
              › {x.headline}
            </Text>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

// kind별 헤더 액센트 색(전부 SHARED 팔레트 = 다크/라이트 동일 — 렌더 시 읽어 토글 안전).
function KIND_ACCENT(): Record<NewsItem['kind'], string> {
  return {
    champion: theme.gold, award: theme.gold, milestone: theme.sky, hof: theme.gold,
    injury: theme.bad, scandal: theme.warn, owner: theme.rose, streak: theme.accent,
    standing: theme.sky, match: theme.bad, debut: theme.accent, transfer: theme.sky,
    release: theme.warn, retire: theme.violet, sponsor: theme.gold, offseason: theme.sky,
    draft: theme.accent, foreign: theme.elite, playoff: theme.rose, clinch: theme.good,
  };
}

const styles = themedStyles(() => StyleSheet.create({
  category: { color: theme.accent, fontSize: 13, fontWeight: '800' },
  headline: { color: theme.text, fontSize: 22, fontWeight: '900', lineHeight: 30, marginTop: 4 },
  byline: { color: theme.muted, fontSize: 13, marginTop: 8 },
  subtitle: { color: theme.accent, fontSize: 15, fontWeight: '700', lineHeight: 21, marginTop: 8 },
  body: { color: theme.text, fontSize: 15, lineHeight: 24 },
  infoGrid: { gap: 2, marginTop: 2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  infoLabel: { color: theme.muted, fontSize: 14 },
  infoValue: { color: theme.text, fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  fogNote: { fontSize: 12, marginTop: 8 },
  comment: { color: theme.text, fontSize: 15, lineHeight: 23, marginTop: 2 },
  relLink: { color: theme.accent, fontSize: 14, lineHeight: 21, fontWeight: '600', marginTop: 6 },
  moveSection: { marginTop: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { backgroundColor: theme.cardAlt, borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11, maxWidth: '100%' },
  chipText: { color: theme.text, fontSize: 13, fontWeight: '600' },
}));
