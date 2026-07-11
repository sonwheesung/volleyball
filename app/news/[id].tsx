// 뉴스 기사 상세 — 목록(/news)에서 진입. 헤드라인 + 분류 + 시즌/구단 + 분류별 리드 문장.
// 뉴스는 저장 없이 archive·milestones·hallOfFame 등에서 파생되므로(결정론), 목록과 **완전히 동일한 피드**를
// 재구성해 안정 키(newsKey)로 같은 기사를 집어낸다(인덱스 금지 — 목록/상세 필터 비대칭으로 어긋났던 F1, NEWS §3.6).
//
// kind='draft'는 실제 스포츠 기사처럼 **리치 레이아웃**(선수 정보·스카우트 총평·드래프트 정보 카드, NEWS §11 Phase1).
// 나머지 kind는 기존 단순 레이아웃(헤드라인+본문). 전부 기존 상태 읽기전용 파생 — 신규 영속 0·결정론(Date.now/random 금지).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, IconLabel, Loading, Muted, Screen, SCREEN_LOADING_MIN_MS, theme, themedStyles, useDeferredReady } from '../../components/Screen';
import { POS_LABEL } from '../../components/posTokens';
import { buildNewsFeed, freshNews, newsKey } from '../../data/news';
import { seasonYear } from '../../data/seasonLabel';
import { displayCutoff } from '../../data/standings';
import { KIND_KO } from '../news';
import { getPlayer, getTeam, teamScoutReveal } from '../../data/league';
import { fogOvr, potentialEstimate, revealedCount } from '../../data/prospectScout';
import { overallRaw, displayOvr, REVEAL_PRECISE } from '../../engine/overall';
import { useGameStore } from '../../store/useGameStore';
import type { DraftPickRecord, NewsItem, Player } from '../../types';

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

type PosGroup = 'attack' | 'set' | 'libero';
const posGroup = (pos: Player['position']): PosGroup => (pos === 'S' ? 'set' : pos === 'L' ? 'libero' : 'attack');

// 부제(teal 한 줄) — 포지션(공개 사실) + 신인=미래 투자 톤. 변형은 id 해시(결정론).
const SUBTITLE: Record<PosGroup, string[]> = {
  attack: ['잠재력 높은 공격 자원 확보 — 미래를 위한 투자', '즉시 전력감보다 성장 여지에 무게를 실었다', '높이와 파워, 성장 곡선을 내다본 지명'],
  set: ['미래의 사령탑 후보 — 길게 보는 선택', '팀의 다음 세대 세터에 투자했다', '경기 운영의 미래를 내다본 지명'],
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

  // 드래프트 기사만 리치 레이아웃(NEWS §11 Phase1). 나머지는 기존 단순 레이아웃 유지.
  if (n.kind === 'draft') {
    return <DraftArticle n={n} feed={feed} myTeamId={teamId ?? ''} seasonDraftLog={seasonDraftLog} onOpen={(k) => router.push(`/news/${encodeURIComponent(k)}`)} />;
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
      <Card accent={theme.accent}>
        <IconLabel icon="sparkles-outline" color={theme.accent}>{KIND_KO.draft}{n.big ? ' · 헤드라인' : ''}</IconLabel>
        <Text style={styles.byline}>{seasonYear(n.season)}{team ? ` · ${team.name}` : ''}</Text>
        <Text style={styles.headline}>{n.headline}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </Card>

      {/* 2) 본문(사실 문단) */}
      <Card accent={theme.accent}>
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
          {!isMyTeam ? <Muted style={styles.fogNote}>※ 타 구단 지명 — 스카우터 공개도만큼만 파악됩니다.</Muted> : null}
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
}));
