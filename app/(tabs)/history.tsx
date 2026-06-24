import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Loading, Muted, PosTag, Screen, Title, theme, useDeferredReady } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { getPlayer, getTeam, teamPlayerIds, shortTeamName as short } from '../../data/league';
import { leagueProduction } from '../../data/production';
import { buildNewsFeed } from '../../data/news';
import { computeStandings, leagueDisplayDay } from '../../data/standings';
import { careerLeaderboard, teamCareerLeaderboard, RECORD_CATS, seasonSnapshot, type RecordCat } from '../../data/records';
import { useGameStore } from '../../store/useGameStore';
import type { ProdLine } from '../../engine/production';
import type { AwardWinner, Position, SeasonAwards } from '../../types';

const FINISHED = 164; // 시즌 종료 기준일(잠정 라벨)
const AWARD_MIN_GAMES = 12; // 잠정 시상 노출 최소 경기수(팀당, 36경기 시즌의 1/3)
const MEDAL = ['🥇', '🥈', '🥉'];

// ─── 작은 세그먼트 컨트롤 ──────────────────────────────────────
function Seg({ items, value, onChange }: { items: string[]; value: number; onChange: (i: number) => void }) {
  return (
    <View style={styles.seg}>
      {items.map((it, i) => (
        <Pressable key={it} onPress={() => onChange(i)} style={[styles.segItem, value === i && styles.segOn]}>
          <Text style={[styles.segTxt, value === i && styles.segTxtOn]} numberOfLines={1}>{it}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function History() {
  // 기록 탭은 무겁다(뉴스 피드 생성 + 리그 생산 집계 + 시즌 스냅샷). 한 틱 미뤄 로딩부터 그린다
  const ready = useDeferredReady();
  if (!ready) return <Loading title="기록" message="기록을 불러오는 중…" />;
  return <HistoryInner />;
}

function HistoryInner() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const archive = useGameStore((s) => s.archive);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const milestones = useGameStore((s) => s.milestones);
  const expelledLog = useGameStore((s) => s.expelledLog);
  const benchDirectives = useGameStore((s) => s.benchDirectives);
  const transfers = useGameStore((s) => s.transfers);

  const [tab, setTab] = useState(0);          // 0 시즌 · 1 통산 · 2 명예의전당 · 3 연표
  const [viewSeason, setViewSeason] = useState(season);
  const [scope, setScope] = useState<'league' | 'team'>('league'); // 통산 범위

  // 은퇴 선수 이름/포지션 (과거 시즌 수상자 표시용) ─ 현역은 getPlayer, 은퇴는 HOF
  const hofMap = useMemo(() => {
    const m = new Map<string, { name: string; position: Position }>();
    for (const h of hallOfFame) m.set(h.id, { name: h.name, position: h.position });
    return m;
  }, [hallOfFame]);
  const pName = (id: string) => getPlayer(id)?.name ?? hofMap.get(id)?.name ?? id;
  const pPos = (id: string): Position => getPlayer(id)?.position ?? hofMap.get(id)?.position ?? 'OH';
  const isMine = (id: string) => !!teamId && teamPlayerIds(teamId).includes(id);

  const snap = useMemo(
    () => seasonSnapshot(viewSeason, season, currentDay, archive),
    [viewSeason, season, currentDay, archive],
  );

  // 현재 진행 시즌 라이브 리더보드 — 리그 진행 기준(§3.2 leagueDisplayDay: 현재 경기일 직전까지).
  // 구버전 `currentDay` 직접 사용은 결과/순위(관전 기준)와 어긋났고 day0에 미플레이 시즌을 선반영(스포일러)했다.
  const leaders = useMemo(() => {
    const prod = leagueProduction(leagueDisplayDay(currentDay));
    const rows = [...prod.entries()].map(([id, l]) => ({ id, l }));
    const top = (key: keyof ProdLine, n = 5) =>
      rows.filter((r) => (r.l[key] as number) > 0)
        .sort((a, b) => (b.l[key] as number) - (a.l[key] as number)).slice(0, n);
    return [
      { label: '득점', key: 'points' as const, list: top('points') },
      { label: '블로킹', key: 'blocks' as const, list: top('blocks') },
      { label: '디그', key: 'digs' as const, list: top('digs') },
      { label: '어시스트', key: 'assists' as const, list: top('assists') },
    ];
  }, [currentDay, season]);

  const newsFeed = useMemo(
    () => buildNewsFeed(archive, milestones, hallOfFame, season, expelledLog, benchDirectives, currentDay, teamId ?? '', transfers).slice(0, 40),
    [archive, milestones, hallOfFame, season, currentDay, expelledLog, benchDirectives, teamId, transfers],
  );

  return (
    <Screen title="기록">
      <SpotlightTarget id="history-ach">
        <Card onPress={() => router.push('/achievements')}>
          <View style={styles.achLink}>
            <Text style={styles.achLinkText}>🏆 업적 — 구단주의 발자취</Text>
            <Text style={styles.achLinkArrow}>›</Text>
          </View>
        </Card>
      </SpotlightTarget>

      <SpotlightTarget id="history-top">
        <Seg items={['시즌', '통산', '명예의전당', '연표']} value={tab} onChange={setTab} />
      </SpotlightTarget>

      {tab === 0 ? (
        <SeasonView
          snap={snap} viewSeason={viewSeason} maxSeason={season} setViewSeason={setViewSeason}
          currentDay={currentDay} teamId={teamId} leaders={leaders}
          pName={pName} pPos={pPos} isMine={isMine}
        />
      ) : null}

      {tab === 1 ? (
        <CareerView
          scope={scope} setScope={setScope} teamId={teamId} hallOfFame={hallOfFame} isMine={isMine}
          onMore={(cat) => router.push(`/records?cat=${cat}&scope=${scope}&team=${teamId ?? ''}`)}
          onPlayer={(id) => router.push(`/player/${id}`)}
        />
      ) : null}

      {tab === 2 ? (
        <HofView hallOfFame={hallOfFame} teamId={teamId} />
      ) : null}

      {tab === 3 ? (
        <ChronicleView
          archive={archive} milestones={milestones} newsFeed={newsFeed} teamId={teamId}
          onSeason={(s) => { setViewSeason(s); setTab(0); }}
        />
      ) : null}
      <SpotlightOverlay screen="tab-history" />
    </Screen>
  );
}

// ─── 탭 0 · 시즌 ───────────────────────────────────────────────
function SeasonView({
  snap, viewSeason, maxSeason, setViewSeason, currentDay, teamId, leaders, pName, pPos, isMine,
}: {
  snap: ReturnType<typeof seasonSnapshot>; viewSeason: number; maxSeason: number;
  setViewSeason: (s: number) => void; currentDay: number; teamId: string | null;
  leaders: { label: string; key: keyof ProdLine; list: { id: string; l: ProdLine }[] }[];
  pName: (id: string) => string; pPos: (id: string) => Position; isMine: (id: string) => boolean;
}) {
  const aw = snap.awards;
  const provisional = snap.isCurrent && currentDay < FINISHED;
  // 잠정 시상은 시즌이 무르익은 뒤에만 — 2~3경기에 "MVP·득점왕"은 무의미(36경기 중 1/3=12 경과 기준).
  const gamesPlayed = snap.standings.reduce((mx, s) => Math.max(mx, s.wins + s.losses), 0);
  const awardsReady = !snap.isCurrent || gamesPlayed >= AWARD_MIN_GAMES;

  const awName = (w: AwardWinner | null) => (w ? pName(w.playerId) : '—');

  return (
    <>
      {/* 시즌 스텝퍼 */}
      <View style={styles.stepper}>
        <Pressable disabled={viewSeason <= 0} onPress={() => setViewSeason(viewSeason - 1)} hitSlop={10}
          style={[styles.stepBtn, viewSeason <= 0 && styles.stepOff]}>
          <Text style={styles.stepArrow}>‹</Text>
        </Pressable>
        <View style={styles.stepCenter}>
          <Text style={styles.stepSeason}>{viewSeason + 1}시즌</Text>
          {snap.isCurrent ? (
            <Text style={[styles.stepTag, { color: theme.accent }]}>진행 중{provisional ? ' · 잠정' : ''}</Text>
          ) : snap.championId ? (
            <Text style={[styles.stepTag, { color: theme.warn }]}>🏆 {getTeam(snap.championId)?.name ?? short(snap.championId)}</Text>
          ) : null}
        </View>
        <Pressable disabled={viewSeason >= maxSeason} onPress={() => setViewSeason(viewSeason + 1)} hitSlop={10}
          style={[styles.stepBtn, viewSeason >= maxSeason && styles.stepOff]}>
          <Text style={styles.stepArrow}>›</Text>
        </Pressable>
      </View>

      {/* 시상식 — 시즌이 충분히 진행된 뒤에만(잠정 포함) */}
      {aw && aw.mvp && awardsReady ? (
        <>
          <Card>
            <Text style={styles.cardHead}>시상식{provisional ? ' (잠정)' : ''}</Text>
            {([
              { label: '정규 MVP', w: aw.mvp, hi: true, suffix: '' },
              { label: '챔프전 MVP', w: aw.finalsMvp, hi: true, suffix: '' },
              { label: '신인상', w: aw.rookie, hi: false, suffix: '' },
              { label: '기량발전상', w: aw.mostImproved, hi: false, suffix: ' OVR' },
            ]).map((a) => a.w ? (
              <View key={a.label} style={styles.awRow}>
                <Text style={[styles.awLabel, a.hi && { color: theme.warn }]}>{a.label}</Text>
                <PosTag pos={pPos(a.w.playerId)} />
                <Text style={[styles.awName, isMine(a.w.playerId) && styles.mine]} numberOfLines={1}>{awName(a.w)}</Text>
                <Text style={styles.lbTeam} numberOfLines={1}>{short(a.w.teamId)}</Text>
                <Text style={styles.lbVal}>{a.w.value}{a.suffix}</Text>
              </View>
            ) : null)}
          </Card>

          <Card>
            <Text style={styles.cardHead}>부문 기록왕</Text>
            {([
              { label: '득점', w: aw.titles.scoring }, { label: '공격', w: aw.titles.spike },
              { label: '블로킹', w: aw.titles.block }, { label: '서브', w: aw.titles.serve },
              { label: '디그', w: aw.titles.dig }, { label: '어시스트', w: aw.titles.set },
              { label: '리시브', w: aw.titles.receive },
            ]).map((a) => (
              <View key={a.label} style={styles.awRow}>
                <Text style={styles.awLabel}>{a.label}왕</Text>
                <Text style={[styles.awName, a.w && isMine(a.w.playerId) && styles.mine]} numberOfLines={1}>{awName(a.w)}</Text>
                <Text style={styles.lbTeam} numberOfLines={1}>{a.w ? short(a.w.teamId) : ''}</Text>
                <Text style={styles.lbVal}>{a.w?.value ?? ''}</Text>
              </View>
            ))}
          </Card>

          <Card>
            <Text style={styles.cardHead}>베스트7</Text>
            {aw.best7.map((s, i) => (
              <View key={`${s.pos}${i}`} style={styles.awRow}>
                <PosTag pos={s.pos} />
                <Text style={[styles.awName, s.winner && isMine(s.winner.playerId) && styles.mine]} numberOfLines={1}>{awName(s.winner)}</Text>
                <Text style={styles.lbTeam} numberOfLines={1}>{s.winner ? short(s.winner.teamId) : ''}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : snap.isCurrent && !awardsReady ? (
        <Card>
          <Text style={styles.cardHead}>시상식</Text>
          <Muted style={{ fontSize: 12.5 }}>
            아직 시즌 초반입니다 ({gamesPlayed}경기). 정규리그가 1/3({AWARD_MIN_GAMES}경기) 넘게 진행되면
            잠정 MVP·기록왕 윤곽이 잡힙니다. 지금은 아래 순위·리더보드로 흐름을 보세요.
          </Muted>
        </Card>
      ) : (
        <Card><Muted>이 시즌의 시상 기록이 없습니다.</Muted></Card>
      )}

      {/* 최종 순위 */}
      {snap.standings.length > 0 ? (
        <Card>
          <Text style={styles.cardHead}>{snap.isCurrent ? '순위표' : '최종 순위'}</Text>
          <View style={[styles.row, styles.head]}>
            <Text style={[styles.rank, styles.h]}>#</Text>
            <Text style={[styles.team, styles.h]}>팀</Text>
            <Text style={[styles.cell, styles.h]}>승</Text>
            <Text style={[styles.cell, styles.h]}>패</Text>
          </View>
          {snap.standings.map((s, i) => {
            const mine = s.teamId === teamId;
            const champ = s.teamId === snap.championId;
            return (
              <View key={s.teamId} style={styles.row}>
                <Text style={[styles.rank, mine && styles.mine]}>{i + 1}</Text>
                <Text style={[styles.team, mine && styles.mine]} numberOfLines={1}>
                  {champ ? '🏆 ' : ''}{getTeam(s.teamId)?.name ?? s.teamId}
                </Text>
                <Text style={[styles.cell, styles.win]}>{s.wins}</Text>
                <Text style={styles.cell}>{s.losses}</Text>
              </View>
            );
          })}
        </Card>
      ) : null}

      {/* 현재 시즌만: 라이브 리더보드 + 경기 결과 */}
      {snap.isCurrent ? (
        <>
          <Title>개인 기록 리더보드</Title>
          {leaders.map((cat) => (
            <Card key={cat.label}>
              <Text style={styles.cardHead}>{cat.label} TOP 5</Text>
              {cat.list.length === 0 ? <Muted style={{ fontSize: 12 }}>기록 없음</Muted> : cat.list.map((r, i) => (
                <View key={r.id} style={styles.lbRow}>
                  <Text style={styles.lbRank}>{i + 1}</Text>
                  <PosTag pos={pPos(r.id)} />
                  <Text style={[styles.lbName, isMine(r.id) && styles.mine]} numberOfLines={1}>{pName(r.id)}</Text>
                  <Text style={styles.lbVal}>{r.l[cat.key] as number}</Text>
                </View>
              ))}
            </Card>
          ))}
        </>
      ) : null}
    </>
  );
}

// ─── 탭 1 · 통산 ───────────────────────────────────────────────
function CareerView({
  scope, setScope, teamId, hallOfFame, isMine, onMore, onPlayer,
}: {
  scope: 'league' | 'team'; setScope: (s: 'league' | 'team') => void; teamId: string | null;
  hallOfFame: Parameters<typeof careerLeaderboard>[1]; isMine: (id: string) => boolean;
  onMore: (cat: RecordCat) => void; onPlayer: (id: string) => void;
}) {
  const limit = scope === 'team' ? 50 : 100;
  return (
    <>
      <Seg items={['리그 전체', '우리 구단']} value={scope === 'team' ? 1 : 0}
        onChange={(i) => setScope(i === 1 ? 'team' : 'league')} />
      {scope === 'team' && !teamId ? (
        <Card><Muted>구단을 먼저 선택하세요.</Muted></Card>
      ) : (
        RECORD_CATS.map((c) => {
          const rows = (scope === 'team' ? teamCareerLeaderboard(c.key, teamId ?? '', hallOfFame) : careerLeaderboard(c.key, hallOfFame));
          const top = rows.slice(0, 5);
          return (
            <Card key={c.key}>
              <View style={styles.careerHead}>
                <Text style={styles.cardHead}>{c.label}</Text>
                <Pressable onPress={() => onMore(c.key)} hitSlop={8}>
                  <Text style={styles.moreLink}>TOP {limit} ›</Text>
                </Pressable>
              </View>
              {top.length === 0 ? <Muted style={{ fontSize: 12 }}>아직 기록 없음</Muted> : top.map((r, i) => (
                <Pressable key={r.id} onPress={() => onPlayer(r.id)} style={({ pressed }) => [styles.lbRow, pressed && { opacity: 0.6 }]}>
                  <Text style={styles.lbRankMedal}>{i < 3 ? MEDAL[i] : i + 1}</Text>
                  <PosTag pos={r.position} />
                  <Text style={[styles.lbName, isMine(r.id) && styles.mine]} numberOfLines={1}>
                    {r.name}{r.legend ? ' 🎖️' : r.retired ? ' ·은' : ''}
                  </Text>
                  <Text style={styles.lbTeam} numberOfLines={1}>{short(r.teamId)}</Text>
                  <Text style={styles.lbVal}>{r.value.toLocaleString()}</Text>
                </Pressable>
              ))}
            </Card>
          );
        })
      )}
      <Muted style={{ fontSize: 11.5, textAlign: 'center', marginTop: 2 }}>
        현역 + 은퇴(명예의전당) 통합 · 🎖️ 영구결번 · ·은 은퇴
      </Muted>
    </>
  );
}

// ─── 탭 2 · 명예의전당 ─────────────────────────────────────────
function HofView({ hallOfFame, teamId }: { hallOfFame: ReturnType<typeof useGameStore.getState>['hallOfFame']; teamId: string | null }) {
  const sorted = [...hallOfFame].sort((a, b) => Number(b.legend) - Number(a.legend) || b.points - a.points);
  if (sorted.length === 0) {
    return <Card><Muted>아직 은퇴한 레전드가 없습니다. 세월이 쌓이면 이곳에 명예가 새겨집니다.</Muted></Card>;
  }
  return (
    <Card>
      <Text style={styles.cardHead}>은퇴 레전드 · {sorted.length}명</Text>
      {sorted.map((h) => (
        <View key={h.id} style={styles.hofRow}>
          <PosTag pos={h.position} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.team, h.teamId === teamId && styles.mine]} numberOfLines={1}>
              {h.legend ? '🎖️ ' : '🏅 '}{h.name}
              {h.legend ? <Text style={{ color: theme.warn, fontSize: 11 }}>  영구결번</Text> : null}
            </Text>
            <Muted style={{ fontSize: 11 }}>{short(h.teamId)} · {h.seasons}시즌 · {h.retiredSeason + 1}시즌 은퇴</Muted>
          </View>
          <Text style={styles.lbVal}>{h.points.toLocaleString()}점</Text>
        </View>
      ))}
    </Card>
  );
}

// ─── 탭 3 · 연표 ───────────────────────────────────────────────
function ChronicleView({
  archive, milestones, newsFeed, teamId, onSeason,
}: {
  archive: ReturnType<typeof useGameStore.getState>['archive'];
  milestones: ReturnType<typeof useGameStore.getState>['milestones'];
  newsFeed: { season: number; headline: string; big: boolean; teamId?: string }[];
  teamId: string | null; onSeason: (s: number) => void;
}) {
  return (
    <>
      {archive.length > 0 ? (
        <>
          <Title>역대 우승</Title>
          <Card>
            {archive.slice().reverse().map((a) => (
              <Pressable key={a.season} onPress={() => onSeason(a.season)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
                <Text style={[styles.team, { flex: 0, width: 64 }]}>{a.season + 1}시즌</Text>
                <Text style={[styles.team, a.championId === teamId && styles.mine]} numberOfLines={1}>
                  🏆 {getTeam(a.championId)?.name ?? a.championId}
                </Text>
                {a.awards?.mvp ? <Muted style={{ fontSize: 11 }}>MVP {getPlayer(a.awards.mvp.playerId)?.name ?? ''}</Muted> : null}
                <Text style={styles.achLinkArrow}>›</Text>
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}

      {newsFeed.length > 0 ? (
        <>
          <Title>📰 리그 뉴스</Title>
          <Card>
            {newsFeed.map((n, i) => (
              <View key={`${n.season}-${i}`} style={styles.msRow}>
                <Text style={styles.msSeason}>{n.season + 1}시즌</Text>
                <Text style={[styles.msText, n.big && { color: theme.warn, fontWeight: '800' }, n.teamId === teamId && styles.mine]} numberOfLines={1}>
                  {n.big ? '★ ' : ''}{n.headline}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {milestones.length > 0 ? (
        <>
          <Title>기록 경신 · 마일스톤</Title>
          <Card>
            {milestones.slice(-40).reverse().map((m, i) => (
              <View key={`${m.season}-${m.playerId}-${i}`} style={styles.msRow}>
                <Text style={styles.msSeason}>{m.season + 1}시즌</Text>
                <Text style={[styles.msText, m.big && { color: theme.warn, fontWeight: '800' }, m.teamId === teamId && styles.mine]} numberOfLines={1}>
                  {m.big ? '★ ' : ''}{m.text}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {archive.length === 0 && newsFeed.length === 0 && milestones.length === 0 ? (
        <Card><Muted>첫 시즌이 끝나면 이곳에 리그의 역사가 기록됩니다.</Muted></Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  achLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  achLinkText: { color: theme.text, fontSize: 15, fontWeight: '800' },
  achLinkArrow: { color: theme.accent, fontSize: 22, fontWeight: '900' },

  seg: { flexDirection: 'row', backgroundColor: theme.cardAlt, borderRadius: 12, padding: 3, gap: 2 },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segOn: { backgroundColor: theme.card, shadowColor: '#1B2A4A', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segTxt: { color: theme.muted, fontSize: 12.5, fontWeight: '800' },
  segTxtOn: { color: theme.text },

  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 6, paddingVertical: 8 },
  stepBtn: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepOff: { opacity: 0.25 },
  stepArrow: { color: theme.text, fontSize: 28, fontWeight: '800', lineHeight: 30 },
  stepCenter: { flex: 1, alignItems: 'center' },
  stepSeason: { color: theme.text, fontSize: 18, fontWeight: '900' },
  stepTag: { fontSize: 12, fontWeight: '800', marginTop: 1 },

  cardHead: { color: theme.text, fontWeight: '800', fontSize: 14, marginBottom: 4 },
  careerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moreLink: { color: theme.accent, fontSize: 13, fontWeight: '800' },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 4 },
  head: { borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 2, paddingBottom: 6 },
  h: { color: theme.muted, fontSize: 12, fontWeight: '700' },
  rank: { width: 24, color: theme.text, fontSize: 14, fontWeight: '700' },
  team: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  cell: { width: 36, textAlign: 'center', color: theme.text, fontSize: 14 },
  win: { color: theme.good, fontWeight: '800' },
  mine: { color: theme.accent, fontWeight: '800' },

  lbRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  lbRank: { width: 18, color: theme.muted, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  lbRankMedal: { width: 20, color: theme.muted, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  lbName: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  lbTeam: { color: theme.muted, fontSize: 12, width: 52, textAlign: 'right' },
  lbVal: { color: theme.text, fontSize: 14, fontWeight: '800', minWidth: 44, textAlign: 'right' },

  hofRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  awRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  awLabel: { width: 76, color: theme.muted, fontSize: 13, fontWeight: '700' },
  awName: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '700' },

  msRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  msSeason: { width: 52, color: theme.muted, fontSize: 11, fontWeight: '700' },
  msText: { flex: 1, color: theme.text, fontSize: 13 },
});
