// 시즌 결산 상세 (SEASON_SYSTEM §5.5) — 결산 요약 카드의 "상세 보기 ›" 대상(마이페이지식 심화).
// 단일 동적 라우트 4섹션: awards | squad | story | tasks. **전부 재계산 파생**(신규 영속 0) — 결산 본문과 동일 셀렉터 재사용.
// 스포일러 게이트: awards의 챔프MVP·story의 우승 표기는 archive championId 존재(champion-ceremony 통과) 후에만.
//   (결산 진입 자체가 championId 게이트지만 상세는 독립 라우트라 자체 이중 가드.) finalsMvp는 currentSeasonAwards poDay 게이트로 자동 미노출.
import { useMemo } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Card, IconLabel, Loading, Muted, PosTag, Row, Screen, theme, themedStyles, useDeferredReady } from '../../components/Screen';
import { Best7Court } from '../../components/Best7Court';
import { AwardIllustration } from '../../components/AwardIllustration';
import { teamColors } from '../../lib/teamColor';
import { seasonSnapshot } from '../../data/records';
import { fmtMatches } from '../../data/recordLine';
import { computeStandings, displayCutoff, seasonStreaks } from '../../data/standings';
import { leagueProduction } from '../../data/production';
import { getPlayer, getTeam, shortTeamName as short, reconstructForeignName } from '../../data/league';
import { TITLE_LABELS } from '../../data/awards'; // 부문 기록상 라벨 단일 출처(사용자 결정 2026-07-15 — KOVO "~상")
import { rosterIdsOnDay } from '../../data/dynamics';
import { recapBriefing } from '../../data/recapBriefing';
import { seasonYear } from '../../data/seasonLabel';
import { formatMoney } from '../../engine/salary';
import { formatMoneyShort } from '../../data/money';
import { useGameStore } from '../../store/useGameStore';
import type { ProdLine } from '../../engine/production';
import type { AwardWinner, Player, Position } from '../../types';

type Section = 'awards' | 'squad' | 'story' | 'tasks';
const SECTION_TITLE: Record<Section, string> = {
  awards: '우리 팀 수상', squad: '우리 선수 활약', story: '시즌 스토리', tasks: '다음 시즌 숙제',
};

export default function SeasonRecapDetail() {
  const { section: raw } = useLocalSearchParams<{ section: string }>();
  const section = (['awards', 'squad', 'story', 'tasks'].includes(raw ?? '') ? raw : 'awards') as Section;
  const title = SECTION_TITLE[section];
  const ready = useDeferredReady(); // leagueProduction 풀시즌 재계산이 무거움 — 로딩부터(결산 본문과 동일)
  if (!ready) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <Loading title={title} variant="list" />
      </>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title }} />
      <DetailInner section={section} title={title} />
    </>
  );
}

function DetailInner({ section, title }: { section: Section; title: string }) {
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const results = useGameStore((s) => s.results);
  const archive = useGameStore((s) => s.archive);
  const fanScore = useGameStore((s) => s.fanScore);
  const cash = useGameStore((s) => s.cash);
  const lastFinance = useGameStore((s) => s.lastFinance);
  const milestones = useGameStore((s) => s.milestones);
  const overrides = useGameStore((s) => s.contractOverrides);
  const released = useGameStore((s) => s.released);

  const day = displayCutoff(currentDay, results, my); // 시즌 종료 직후 → 전체 공개(SEASON_DAYS)
  // 우승 스포일러 게이트: archive에 이번 시즌 championId가 박혀 있어야(= champion-ceremony 통과) 우승/챔프MVP 노출.
  const championId = useMemo(() => archive.find((a) => a.season === season)?.championId ?? null, [archive, season]);
  const snap = useMemo(() => seasonSnapshot(season, season, currentDay, archive, results, my), [season, currentDay, archive, results, my]);
  const aw = snap.awards;

  const pName = (id: string) => getPlayer(id)?.name ?? reconstructForeignName(id) ?? id;
  const pPos = (id: string): Position => getPlayer(id)?.position ?? 'OH';
  const isMineW = (w: AwardWinner | null) => !!w && w.teamId === my; // 수상자 귀속(구단 강조)

  return (
    <Screen title={`${seasonYear(season)} · ${title}`}>
      {section === 'awards' ? (
        <AwardsDetail aw={aw} championId={championId} my={my} pName={pName} pPos={pPos} isMineW={isMineW} />
      ) : section === 'squad' ? (
        <SquadDetail my={my} day={day} pName={pName} pPos={pPos} />
      ) : section === 'story' ? (
        <StoryDetail
          my={my} day={day} championId={championId} fanScore={fanScore} cash={cash}
          lastFinance={lastFinance} milestones={milestones} season={season} pName={pName}
        />
      ) : (
        <TasksDetail my={my} day={day} overrides={overrides} released={released} pPos={pPos} />
      )}
    </Screen>
  );
}

// ─── awards · 리그 전체 시상 요약본(내 팀 강조) ─────────────────────────────
function AwardsDetail({
  aw, championId, my, pName, pPos, isMineW,
}: {
  aw: ReturnType<typeof seasonSnapshot>['awards']; championId: string | null; my: string;
  pName: (id: string) => string; pPos: (id: string) => Position; isMineW: (w: AwardWinner | null) => boolean;
}) {
  if (!aw || !aw.mvp) {
    return <Card flat><Muted>이 시즌의 시상 기록이 없습니다.</Muted></Card>;
  }
  const awRow = (label: string, w: AwardWinner | null, opts?: { hi?: boolean; suffix?: string; growth?: boolean }) => w ? (
    <View key={label} style={styles.awRow}>
      <Text style={[styles.awLabel, opts?.hi && { color: theme.warn }]}>{label}</Text>
      <PosTag pos={pPos(w.playerId)} />
      <Text style={[styles.awName, isMineW(w) && styles.mine]} numberOfLines={1}>{pName(w.playerId)}</Text>
      <Text style={styles.awTeam} numberOfLines={1}>{short(w.teamId)}</Text>
      {/* 기량발전상=시즌 생산 증가폭(Δ, AWARDS_SYSTEM §9) → ▲N 초록. 나머지는 값+접미사 */}
      <Text style={[styles.awVal, opts?.growth && { color: theme.good }]}>{opts?.growth ? `▲${w.value}` : `${w.value}${opts?.suffix ?? ''}`}</Text>
    </View>
  ) : null;

  return (
    <>
      {/* MVP 배너(구단색) */}
      <Card accent={theme.gold} flat>
        <View style={[styles.mvpBanner, { backgroundColor: teamColors(aw.mvp.teamId).bg }]}>
          <AwardIllustration width={104} />
          <Text style={styles.mvpKick}>시즌 MVP</Text>
          <Text style={styles.mvpName} numberOfLines={1}>{pName(aw.mvp.playerId)}</Text>
          <Text style={[styles.mvpTeam, { color: teamColors(aw.mvp.teamId).light }]} numberOfLines={1}>
            {getTeam(aw.mvp.teamId)?.name ?? short(aw.mvp.teamId)}
          </Text>
        </View>
        <Text style={styles.cardHead}>시상식</Text>
        {awRow('정규 MVP', aw.mvp, { hi: true })}
        {/* 챔프MVP는 우승 확정(championId) 후에만 — 결승 전 딥링크 스포일러 차단(finalsMvp도 poDay 게이트) */}
        {championId ? awRow('챔프전 MVP', aw.finalsMvp, { hi: true }) : null}
        {awRow('신인상', aw.rookie)}
        {awRow('기량발전상', aw.mostImproved, { growth: true })}
      </Card>

      <Card accent={theme.gold} flat>
        <Text style={styles.cardHead}>부문 기록상</Text>
        {([
          { label: TITLE_LABELS.scoring, w: aw.titles.scoring }, { label: TITLE_LABELS.spike, w: aw.titles.spike },
          { label: TITLE_LABELS.block, w: aw.titles.block }, { label: TITLE_LABELS.serve, w: aw.titles.serve },
          { label: TITLE_LABELS.dig, w: aw.titles.dig }, { label: TITLE_LABELS.set, w: aw.titles.set },
          { label: TITLE_LABELS.receive, w: aw.titles.receive },
        ]).map((a) => a.w ? (
          <View key={a.label} style={styles.awRow}>
            <Text style={styles.awLabel}>{a.label}</Text>
            <PosTag pos={pPos(a.w.playerId)} />
            <Text style={[styles.awName, isMineW(a.w) && styles.mine]} numberOfLines={1}>{pName(a.w.playerId)}</Text>
            <Text style={styles.awTeam} numberOfLines={1}>{short(a.w.teamId)}</Text>
            <Text style={styles.awVal}>{a.w.value}</Text>
          </View>
        ) : null)}
      </Card>

      {aw.best7.some((s) => s.winner) ? (
        <Card accent={theme.gold} flat>
          <Text style={styles.cardHead}>베스트7</Text>
          <Best7Court best7={aw.best7} myTeamId={my} nameOf={pName} />
        </Card>
      ) : null}

      <Muted style={styles.footNote}>우리 구단 선수는 파란색으로 강조됩니다.</Muted>
    </>
  );
}

// ─── squad · 우리 팀 전 선수 시즌 생산 정렬 ─────────────────────────────────
function SquadDetail({
  my, day, pName, pPos,
}: { my: string; day: number; pName: (id: string) => string; pPos: (id: string) => Position }) {
  const rows = useMemo(() => {
    const prod = leagueProduction(day);
    const ids = rosterIdsOnDay(my, day);
    const zero: ProdLine = { matches: 0, points: 0, spikes: 0, backSpikes: 0, blocks: 0, aces: 0, assists: 0, digs: 0, receives: 0 };
    return ids.map((id) => ({ id, l: prod.get(id) ?? zero }))
      // 생산 많은 순 → 무기록(0점)은 뒤로. 동점은 경기수.
      .sort((a, b) => b.l.points - a.l.points || b.l.matches - a.l.matches);
  }, [my, day]);

  if (rows.length === 0) return <Card flat><Muted>이번 시즌 집계된 명단이 없습니다.</Muted></Card>;
  return (
    <>
      <IconLabel icon="people-outline" color={theme.elite}>선수 {rows.length}명 · 생산 순</IconLabel>
      <Card accent={theme.elite} flat>
        {rows.map((r, i) => (
          <View key={r.id} style={styles.pRow}>
            <Text style={styles.rank}>{i + 1}</Text>
            <PosTag pos={pPos(r.id)} />
            <View style={{ flex: 1 }}>
              <Text style={styles.pName} numberOfLines={1}>{pName(r.id)}</Text>
              <Text style={styles.pSub} numberOfLines={1}>{prodLine(r.l)}</Text>
            </View>
            <Text style={styles.pPts}>{r.l.points}<Text style={styles.pPtsUnit}>점</Text></Text>
          </View>
        ))}
      </Card>
      <Muted style={styles.footNote}>스 공격 · 블 블로킹 · 서 서브에이스 · 세 세트 · 디 디그</Muted>
    </>
  );
}

// ─── story · 최종 순위·연승·재정·주요 사건 ─────────────────────────────────
function StoryDetail({
  my, day, championId, fanScore, cash, lastFinance, milestones, season, pName,
}: {
  my: string; day: number; championId: string | null; fanScore: number; cash: number;
  lastFinance: ReturnType<typeof useGameStore.getState>['lastFinance'];
  milestones: ReturnType<typeof useGameStore.getState>['milestones']; season: number; pName: (id: string) => string;
}) {
  const standings = useMemo(() => computeStandings(day), [day]);
  const streak = useMemo(() => seasonStreaks(day)[my] ?? [0, 0], [day, my]);
  const events = useMemo(
    () => milestones.filter((m) => m.season === season && m.teamId === my),
    [milestones, season, my],
  );

  return (
    <>
      {/* 최종 순위표 */}
      <IconLabel icon="podium-outline" color={theme.accent}>최종 순위</IconLabel>
      <Card accent={theme.accent} flat>
        <View style={[styles.stRow, styles.stHead]}>
          <Text style={[styles.stRank, styles.stH]}>#</Text>
          <Text style={[styles.stTeam, styles.stH]}>팀</Text>
          <Text style={[styles.stCell, styles.stH]}>승</Text>
          <Text style={[styles.stCell, styles.stH]}>패</Text>
        </View>
        {standings.map((s, i) => {
          const mine = s.teamId === my;
          const champ = !!championId && s.teamId === championId; // 우승 표기는 championId 게이트 후에만
          return (
            <View key={s.teamId} style={styles.stRow}>
              <Text style={[styles.stRank, mine && styles.mine]}>{i + 1}</Text>
              <Text style={[styles.stTeam, mine && styles.mine]} numberOfLines={1}>
                {champ ? '🏆 ' : ''}{getTeam(s.teamId)?.name ?? s.teamId}
              </Text>
              <Text style={[styles.stCell, styles.stWin]}>{s.wins}</Text>
              <Text style={styles.stCell}>{s.losses}</Text>
            </View>
          );
        })}
      </Card>

      {/* 연승/연패 + 팬심 + 자금 */}
      <IconLabel icon="stats-chart-outline" color={theme.accent}>시즌 지표</IconLabel>
      <Card accent={theme.accent} flat>
        {streak[0] >= 2 ? <Row><Muted>최다 연승</Muted><Text style={styles.fin}>{streak[0]}연승</Text></Row> : null}
        {streak[1] >= 2 ? <Row><Muted>최다 연패</Muted><Text style={styles.fin}>{streak[1]}연패</Text></Row> : null}
        <Row><Muted>팬심</Muted><Text style={styles.fin}>{fanScore}</Text></Row>
        <Row><Muted>운영 자금</Muted><Text style={styles.fin}>{formatMoney(cash)}</Text></Row>
      </Card>

      {/* 재정 상세(직전 정산) */}
      {lastFinance ? (
        <>
          <IconLabel icon="cash-outline" color={theme.good}>전 시즌 정산</IconLabel>
          <Card accent={theme.good} flat>
            <Row><Muted>모기업 후원</Muted><Text style={styles.fin}>{formatMoney(lastFinance.sponsor)}</Text></Row>
            {lastFinance.bonus > 0 ? <Row><Muted>성적 보너스</Muted><Text style={styles.fin}>{formatMoney(lastFinance.bonus)}</Text></Row> : null}
            <Row><Muted>입장 수입</Muted><Text style={styles.fin}>{formatMoney(lastFinance.gate)}</Text></Row>
            <Row><Muted>굿즈 수입</Muted><Text style={styles.fin}>{formatMoney(lastFinance.merch)}</Text></Row>
            <Row><Muted>인건비</Muted><Text style={[styles.fin, { color: theme.bad }]}>-{formatMoney(lastFinance.payroll)}</Text></Row>
            <Row><Muted>스태프 급여</Muted><Text style={[styles.fin, { color: theme.bad }]}>-{formatMoney(lastFinance.staff)}</Text></Row>
            <View style={styles.finDivider} />
            <Row><Text style={styles.finNetLabel}>순익</Text><Text style={[styles.finNet, { color: lastFinance.net >= 0 ? theme.good : theme.bad }]}>{lastFinance.net >= 0 ? '+' : ''}{formatMoneyShort(lastFinance.net)}</Text></Row>
            <Row><Muted>평균 관중</Muted><Text style={styles.fin}>{lastFinance.attendance.toLocaleString()}명</Text></Row>
            {lastFinance.bailout ? <Muted style={{ fontSize: 12, color: theme.warn, marginTop: 4 }}>⚠ 잔고 바닥. 모기업 적자 보전 발생</Muted> : null}
          </Card>
        </>
      ) : null}

      {/* 주요 사건 — 이번 시즌 우리 팀 마일스톤(실데이터, 없으면 생략) */}
      {events.length > 0 ? (
        <>
          <IconLabel icon="flag-outline" color={theme.gold}>주요 사건</IconLabel>
          <Card accent={theme.gold} flat>
            {events.map((m, i) => (
              <View key={`${m.playerId}-${i}`} style={styles.evRow}>
                <Text style={[styles.evText, m.big && { color: theme.warn, fontWeight: '800' }]} numberOfLines={2}>
                  {m.big ? '★ ' : '· '}{m.text}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}

// ─── tasks · 다음 시즌 숙제 전 명단 ─────────────────────────────────────────
function TasksDetail({
  my, day, overrides, released, pPos,
}: {
  my: string; day: number; overrides: ReturnType<typeof useGameStore.getState>['contractOverrides'];
  released: string[]; pPos: (id: string) => Position;
}) {
  const b = useMemo(() => recapBriefing(my, day, overrides, released), [my, day, overrides, released]);
  const total = b.faSoon.length + b.expiring.length + b.retireSoon.length;
  if (total === 0) return <Card flat><Muted>다음 시즌 챙길 선수가 없습니다. 명단이 안정적입니다.</Muted></Card>;

  const group = (icon: string, label: string, color: string, list: Player[], note: string) => list.length > 0 ? (
    <View style={{ marginBottom: 4 }}>
      <IconLabel icon="ellipse" color={color}>{icon} {label} · {list.length}명</IconLabel>
      <Card accent={color} flat>
        {list.map((p) => (
          <View key={p.id} style={styles.tRow}>
            <PosTag pos={pPos(p.id)} />
            <Text style={styles.tName} numberOfLines={1}>{p.name}</Text>
            <Text style={styles.tAge}>{p.age}세</Text>
            <Text style={styles.tContract}>잔여 {p.contract.remaining}년</Text>
          </View>
        ))}
        <Muted style={{ fontSize: 12, marginTop: 4 }}>{note}</Muted>
      </Card>
    </View>
  ) : null;

  return (
    <>
      {group('🔥', 'FA 자격 도래', theme.bad, b.faSoon, '다음 시즌 FA 자격을 얻습니다. 재계약을 서두르지 않으면 시장에 나갈 수 있습니다.')}
      {group('⚠', '계약 만료 임박', theme.warn, b.expiring, '계약이 곧 끝납니다. 재계약 여부를 결정하세요.')}
      {group('ℹ', '정년 임박(39세)', theme.muted, b.retireSoon, '이번 롤오버에 40세가 되어 은퇴가 확정됩니다.')}
    </>
  );
}

const prodLine = (l: ProdLine) => `${fmtMatches(l.matches)}경기 · 스${l.spikes}·블${l.blocks}·서${l.aces}`
  + (l.assists > 0 ? ` · 세${l.assists}` : '') + (l.digs > 0 ? ` · 디${l.digs}` : '');

const styles = themedStyles(() => StyleSheet.create({
  mine: { color: theme.accent, fontWeight: '800' },
  footNote: { fontSize: 11.5, textAlign: 'center', marginTop: 2 },

  cardHead: { color: theme.text, fontWeight: '800', fontSize: 14, marginBottom: 4 },
  mvpBanner: { alignItems: 'center', borderRadius: 16, paddingTop: 12, paddingBottom: 14, marginBottom: 10, overflow: 'hidden' },
  mvpKick: { color: '#FFD879', fontSize: 11, fontWeight: '800', letterSpacing: 2, marginTop: 2 },
  mvpName: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', marginTop: 2 },
  mvpTeam: { fontSize: 12, fontWeight: '700', marginTop: 1 },
  awRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  awLabel: { width: 76, color: theme.muted, fontSize: 13, fontWeight: '700' },
  awName: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '700' },
  awTeam: { color: theme.muted, fontSize: 12, width: 52, textAlign: 'right' },
  awVal: { color: theme.text, fontSize: 14, fontWeight: '800', minWidth: 44, textAlign: 'right' },

  pRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  rank: { width: 20, color: theme.muted, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  pName: { color: theme.text, fontSize: 15, fontWeight: '700' },
  pSub: { color: theme.muted, fontSize: 12.5, marginTop: 1 },
  pPts: { color: theme.text, fontSize: 16, fontWeight: '900', minWidth: 44, textAlign: 'right' },
  pPtsUnit: { color: theme.muted, fontSize: 11, fontWeight: '700' },

  stRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 4 },
  stHead: { borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 2, paddingBottom: 6 },
  stH: { color: theme.muted, fontSize: 12, fontWeight: '700' },
  stRank: { width: 24, color: theme.text, fontSize: 14, fontWeight: '700' },
  stTeam: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  stCell: { width: 36, textAlign: 'center', color: theme.text, fontSize: 14 },
  stWin: { color: theme.good, fontWeight: '800' },

  fin: { color: theme.text, fontWeight: '800', fontSize: 15 },
  finDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginVertical: 6 },
  finNetLabel: { color: theme.text, fontWeight: '800', fontSize: 15 },
  finNet: { fontWeight: '900', fontSize: 16 },

  evRow: { paddingVertical: 4 },
  evText: { color: theme.text, fontSize: 13.5, lineHeight: 19 },

  tRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  tName: { flex: 1, color: theme.text, fontSize: 15, fontWeight: '700' },
  tAge: { color: theme.muted, fontSize: 13, fontWeight: '700', width: 44, textAlign: 'right' },
  tContract: { color: theme.muted, fontSize: 12.5, width: 66, textAlign: 'right' },
}));
