// 시즌 결산 (SEASON_SYSTEM §5.5) — 포스트시즌 → [결산] → 외국인 트라이아웃.
// 강제 도착·선택 정독·단일 한 장(스크롤 + 하단 버튼 하나). 다단계 캐러셀 금지.
// 구조(2026-07-08 사용자 결정): 요약 카드(1~3줄) + "상세 보기 ›" → **별도 상세 스택 화면**(app/season-recap-detail/[section]).
//   3초 안에 시즌을 파악할 수치는 요약에, 명단·부문별 나열은 상세 화면으로(화면 이탈 후 뒤로가기 복귀 — 마이페이지 패턴).
//   ~~인라인 아코디언(ExpandCard)~~ → 담을 양이 적어 "결산이 시즌 결말을 못 말한다"는 피드백을 못 풀어 상세 화면으로 격상.
// endSeason 이전이라 시상은 재계산(seasonSnapshot=currentSeasonAwards+computeStandings, leagueProduction). 새 영속 0.
import { useMemo, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, IconLabel, Loading, Muted, PosTag, Row, Screen, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { seasonSnapshot } from '../data/records';
import { computeStandings, displayCutoff, seasonStreaks } from '../data/standings';
import { leagueProduction } from '../data/production';
import { getPlayer, getTeam } from '../data/league';
import { rosterIdsOnDay } from '../data/dynamics';
import { recapBriefing } from '../data/recapBriefing';
import { buildPlayoffs, myPostseasonOutcome } from '../data/playoffs';
import { seasonYear } from '../data/seasonLabel';
import { repRecordLine } from '../data/recordLine';
import { formatMoney } from '../engine/salary';
import { formatMoneyShort } from '../data/money';
import { useGameStore } from '../store/useGameStore';
import type { ProdLine } from '../engine/production';
import type { AwardWinner } from '../types';

// 부문 기록왕 라벨(awards.titles 키 → 한국어) — data/awards.ts TITLE_KO의 사본(표시 전용). ⚠ set 키만 다름: 여기 '세트왕' vs awards.ts '어시스트왕'(라벨 통일 OPEN Q — AWARDS_SYSTEM §1).
const TITLE_KO: Record<string, string> = {
  scoring: '득점왕', spike: '공격상', block: '블로킹왕',
  serve: '서브왕', dig: '디그왕', set: '세트왕', receive: '리시브왕',
};

/** 요약 카드 + "상세 보기 ›" — 탭하면 별도 상세 화면으로(인라인 확장 아님, 화면 이탈 후 뒤로가기 복귀). */
function NavCard({ accent, children, onPress }: { accent: string; children: ReactNode; onPress: () => void }) {
  return (
    <Card accent={accent} onPress={onPress}>
      {children}
      <View style={styles.moreRow}>
        <Text style={styles.moreText}>상세 보기</Text>
        <Ionicons name="chevron-forward" size={15} color={theme.muted} />
      </View>
    </Card>
  );
}

export default function SeasonRecap() {
  const ready = useDeferredReady(); // leagueProduction 풀시즌 + buildPlayoffs 재계산이 무거움 — 로딩부터(SEASON §5.5)
  if (!ready) return <Loading title="시즌 결산" variant="list" />;
  return <RecapInner />;
}

function RecapInner() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const results = useGameStore((s) => s.results);
  const archive = useGameStore((s) => s.archive);
  const fanScore = useGameStore((s) => s.fanScore);
  const cash = useGameStore((s) => s.cash);
  const lastFinance = useGameStore((s) => s.lastFinance);
  const overrides = useGameStore((s) => s.contractOverrides); // 시즌 중 재계약(잔여 갱신) — willBeFA 판정에 반영
  const released = useGameStore((s) => s.released);            // 시즌 중 방출 — 숙제 명단에서 제외

  // 결과 인지 표시 컷오프(§3.3) — 결산은 시즌 종료 직후라 seasonComplete=true → 리그 최종일 전체 공개(SEASON_DAYS).
  const day = displayCutoff(currentDay, results, my);
  const snap = useMemo(() => seasonSnapshot(season, season, currentDay, archive, results, my), [season, currentDay, archive, results, my]);
  const aw = snap.awards;
  // 우승팀 = 포스트시즌 recordChampion이 박은 archive 부분기록(이번 시즌, endSeason 전) — 이 화면 진입 게이트(챔프 시상식 통과).
  const championId = useMemo(() => archive.find((a) => a.season === season)?.championId ?? null, [archive, season]);

  const standings = useMemo(() => computeStandings(day), [day]);
  const myIdx = standings.findIndex((s) => s.teamId === my);
  const myRank = myIdx + 1;
  const myStanding = standings[myIdx];

  const pName = (id: string) => getPlayer(id)?.name ?? id;
  const isMine = (w: AwardWinner | null) => !!w && w.teamId === my;

  // ① 포스트시즌 여정 — championId 존재(챔프 시상식 통과) 후에만 buildPlayoffs 전부 공개 상태(스포일러 안전, §5.2).
  const outcome = useMemo(() => (championId ? myPostseasonOutcome(buildPlayoffs(season), my) : null), [championId, season, my]);
  const headline = (() => {
    if (outcome) {
      switch (outcome.kind) {
        case 'integrated': return { text: '통합 우승 🏆', color: theme.gold };
        case 'champion': return { text: '우승 🏆', color: theme.gold };
        case 'runnerUp': return { text: `챔피언결정전 준우승 (${outcome.myWins}-${outcome.myLosses})`, color: theme.accent };
        case 'poOut': return { text: `플레이오프 탈락 (${outcome.myWins}-${outcome.myLosses})`, color: theme.text };
        case 'missed': return { text: `포스트시즌 진출 실패 · ${myRank}위`, color: theme.text };
      }
    }
    // 폴백(championId 미확정 — 정상 흐름에선 도달 안 함)
    return myRank > 0 && myRank <= 3 ? { text: `포스트시즌 진출 · ${myRank}위`, color: theme.accent }
      : myRank > 0 ? { text: `정규리그 ${myRank}위`, color: theme.text }
      : { text: '시즌 종료', color: theme.text };
  })();

  // ② 우리 팀 수상 종합 — MVP·챔프MVP·신인·기량발전 + 부문 기록왕 전부. 같은 poDay 게이트(snap.awards).
  const awardLines: string[] = [];
  if (aw) {
    if (isMine(aw.mvp)) awardLines.push(`정규 MVP — ${pName(aw.mvp!.playerId)}`);
    if (isMine(aw.finalsMvp)) awardLines.push(`챔프전 MVP — ${pName(aw.finalsMvp!.playerId)}`);
    if (isMine(aw.rookie)) awardLines.push(`신인상 — ${pName(aw.rookie!.playerId)}`);
    if (isMine(aw.mostImproved)) awardLines.push(`기량발전상 — ${pName(aw.mostImproved!.playerId)}`);
    for (const [k, w] of Object.entries(aw.titles)) {
      if (isMine(w)) awardLines.push(`${TITLE_KO[k] ?? k} — ${pName(w!.playerId)}`);
    }
    const b7 = aw.best7.filter((s) => isMine(s.winner)).length;
    if (b7 > 0) awardLines.push(`베스트7 선정 — ${b7}명`);
  }

  // ③ 시즌 스토리 수치 — 최다 연승(정규 결과 파생). 팬심·재정은 직전 정산(lastFinance) 문맥.
  const maxWinStreak = useMemo(() => seasonStreaks(day)[my]?.[0] ?? 0, [day, my]);

  // ④ 다음 시즌 숙제 — 내 최종 명단(시즌 중 이동 반영)에서 FA 예정/계약 만료/정년 임박(현재 39세). 은퇴 확정 예측 금지.
  //   endSeason이 실제로 쓰는 정본과 일치: rosterIdsOnDay(영입 포함·방출 제외) × contractOverrides(재계약 잔여 갱신). §5.5 ④
  const briefing = useMemo(() => recapBriefing(my, day, overrides, released), [my, day, overrides, released]);
  const briefCount = briefing.faSoon.length + briefing.expiring.length + briefing.retireSoon.length;
  // 요약 = 우선순위 3줄 스택(FA > 계약 만료 > 정년 — 색+아이콘 시선 유도, 사용자+GPT 검토 2026-07-08). 해당 없는 줄 생략.
  const briefStack = [
    briefing.faSoon.length ? { icon: '🔥', text: `FA 자격 ${briefing.faSoon.length}명`, color: theme.bad } : null,
    briefing.expiring.length ? { icon: '⚠', text: `계약 만료 ${briefing.expiring.length}명`, color: theme.warn } : null,
    briefing.retireSoon.length ? { icon: 'ℹ', text: `정년 임박 ${briefing.retireSoon.length}명`, color: theme.muted } : null,
  ].filter((x): x is { icon: string; text: string; color: string } => !!x);

  // ⑤ 우리 선수 생산 상위(단장 결정의 성적표) — leagueProduction 중 내 최종 명단(시즌 중 영입 포함·방출 제외, §5.5)
  const myTop = useMemo(() => {
    const prod = leagueProduction(day);
    const ids = new Set(rosterIdsOnDay(my, day));
    const rows = [...prod.entries()].filter(([id]) => ids.has(id)).map(([id, l]) => ({ id, l }));
    return rows.filter((r) => r.l.points > 0).sort((a, b) => b.l.points - a.l.points);
  }, [day, my]);

  // 요약 카드는 포지션 대표 기록 한 줄(리스트 표면). 전 기록(스·블·서 세부)은 상세 화면(season-recap-detail)이 그대로 보여준다.
  const prodRow = (r: { id: string; l: ProdLine }, i: number) => {
    const pos = getPlayer(r.id)?.position ?? 'OH';
    return (
      <View key={r.id} style={styles.pRow}>
        <Text style={styles.rank}>{i + 1}</Text>
        <PosTag pos={pos} />
        <View style={{ flex: 1 }}>
          <Text style={styles.pName} numberOfLines={1}>{pName(r.id)}</Text>
          <Text style={styles.pSub} numberOfLines={1}>{repRecordLine(pos, r.l)}</Text>
        </View>
      </View>
    );
  };

  const go = (section: string) => router.push(`/season-recap-detail/${section}`);

  return (
    <Screen title={`${seasonYear(season)} 결산`}>
      {/* ① 포스트시즌 여정 헤드라인 — 시즌 결말은 즉시 보여야 함(카드 아닌 최상단 고정). */}
      <Card accent={headline.color}>
        <Muted>{getTeam(my)?.name ?? my} · {seasonYear(season)}</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
          <Text style={{ color: headline.color, fontSize: 22, fontWeight: '900' }}>{headline.text}</Text>
          {myStanding ? (
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>정규 {myRank}위 · {myStanding.wins}승 {myStanding.losses}패</Text>
          ) : null}
        </View>
      </Card>

      {/* ② 우리 선수 활약 — 요약 = 최고 생산 1명, 상세 = 전 선수 생산 정렬 */}
      <IconLabel icon="people-outline" color={theme.elite}>우리 선수 활약</IconLabel>
      {myTop.length === 0 ? (
        <Card accent={theme.elite}><Muted style={{ fontSize: 13 }}>이번 시즌 집계된 생산 기록이 없습니다.</Muted></Card>
      ) : (
        <NavCard accent={theme.elite} onPress={() => go('squad')}>
          {prodRow(myTop[0], 0)}
        </NavCard>
      )}

      {/* ③ 우리 팀 수상 종합(내 수상 있을 때만) — 요약 = 첫 수상 + 개수, 상세 = 리그 전체 시상 요약본 */}
      {awardLines.length > 0 ? (
        <>
          <IconLabel icon="trophy-outline" color={theme.gold}>우리 팀 수상</IconLabel>
          <NavCard accent={theme.gold} onPress={() => go('awards')}>
            <Text style={styles.awardRow}>{awardLines[0]}</Text>
            {awardLines.length > 1 ? <Muted style={{ fontSize: 12.5, marginTop: 2 }}>수상 {awardLines.length}건</Muted> : null}
          </NavCard>
        </>
      ) : null}

      {/* ④ 시즌 스토리 — 요약 = 3초 파악 수치, 상세 = 순위·연승·재정·주요 사건 */}
      <IconLabel icon="stats-chart-outline" color={theme.accent}>시즌 스토리</IconLabel>
      <NavCard accent={theme.accent} onPress={() => go('story')}>
        {maxWinStreak >= 2 ? <Row><Muted>최다 연승</Muted><Text style={styles.fin}>{maxWinStreak}연승</Text></Row> : null}
        <Row><Muted>팬심</Muted><Text style={styles.fin}>{fanScore}</Text></Row>
        <Row><Muted>운영 자금</Muted><Text style={styles.fin}>{formatMoney(cash)}</Text></Row>
        {lastFinance ? (
          <>
            <Row><Muted>전 시즌 순익</Muted><Text style={[styles.fin, { color: lastFinance.net >= 0 ? theme.good : theme.bad }]}>{lastFinance.net >= 0 ? '+' : ''}{formatMoneyShort(lastFinance.net)}</Text></Row>
            <Row><Muted>평균 관중</Muted><Text style={styles.fin}>{lastFinance.attendance.toLocaleString()}명</Text></Row>
          </>
        ) : null}
      </NavCard>

      {/* ⑤ 다음 시즌 숙제 — 요약 = 우선순위 3줄 스택, 상세 = 전 명단(나이·계약) */}
      {briefCount > 0 ? (
        <>
          <IconLabel icon="clipboard-outline" color={theme.warn}>다음 시즌 숙제</IconLabel>
          <NavCard accent={theme.warn} onPress={() => go('tasks')}>
            {briefStack.map((b) => (
              <View key={b.text} style={styles.briefRow}>
                <Text style={styles.briefIcon}>{b.icon}</Text>
                <Text style={[styles.briefText, { color: b.color }]}>{b.text}</Text>
              </View>
            ))}
            <Muted style={{ fontSize: 12.5, marginTop: 2 }}>다음 오프시즌에 챙길 선수들</Muted>
          </NavCard>
        </>
      ) : null}

      {/* 리그 시상·베스트7은 시상식 화면(champion/awards-ceremony)으로 이관(삼중 표시 방지, AWARDS_SYSTEM §7). 결산 상세(awards)는 그 요약본. */}

      {/* 하단 안내 문구 제거(2026-07-08 검토) — 다른 메뉴 이동 유도 대신 시즌의 여운 유지. 버튼만. */}
      <Button label="오프시즌 · 외국인 트라이아웃 →" onPress={() => router.push('/tryout')} />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  pRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  rank: { width: 18, color: theme.muted, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  pName: { color: theme.text, fontSize: 15, fontWeight: '700' },
  pSub: { color: theme.muted, fontSize: 12.5, marginTop: 1 },
  fin: { color: theme.text, fontWeight: '800', fontSize: 15 },
  awardRow: { color: theme.text, fontSize: 14, fontWeight: '700', paddingVertical: 2 },
  briefRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  briefIcon: { fontSize: 13, width: 18, textAlign: 'center' },
  briefText: { fontSize: 14.5, fontWeight: '800' },
  moreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginTop: 6 },
  moreText: { color: theme.muted, fontSize: 12.5, fontWeight: '700' },
}));
