// 시즌 결산 (SEASON_SYSTEM §5.5) — 포스트시즌 → [결산] → 외국인 트라이아웃.
// 강제 도착·선택 정독·단일 한 장(스크롤 + 하단 버튼 하나). 다단계 캐러셀 금지.
// endSeason 이전이라 시상은 재계산(seasonSnapshot=currentSeasonAwards+computeStandings, leagueProduction). 새 영속 0.
import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Text, View, StyleSheet } from 'react-native';
import { Button, Card, IconLabel, Loading, Muted, PosTag, Row, Screen, theme, useDeferredReady } from '../components/Screen';
import { seasonSnapshot } from '../data/records';
import { computeStandings, leagueDisplayDay } from '../data/standings';
import { leagueProduction } from '../data/production';
import { getPlayer, getTeam, teamPlayerIds } from '../data/league';
import { formatMoney } from '../engine/salary';
import { useGameStore } from '../store/useGameStore';
import type { ProdLine } from '../engine/production';
import type { AwardWinner } from '../types';

export default function SeasonRecap() {
  const ready = useDeferredReady(); // leagueProduction 풀시즌 재계산이 무거움 — 로딩부터(SEASON §5.5)
  if (!ready) return <Loading title="시즌 결산" variant="list" />;
  return <RecapInner />;
}

function RecapInner() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const archive = useGameStore((s) => s.archive);
  const fanScore = useGameStore((s) => s.fanScore);
  const cash = useGameStore((s) => s.cash);

  const day = leagueDisplayDay(currentDay);
  const snap = useMemo(() => seasonSnapshot(season, season, currentDay, archive), [season, currentDay, archive]);
  const aw = snap.awards;
  // 우승팀 = 포스트시즌 recordChampion이 박은 archive 부분기록(이번 시즌, endSeason 전)
  const championId = useMemo(() => archive.find((a) => a.season === season)?.championId ?? null, [archive, season]);

  const standings = useMemo(() => computeStandings(day), [day]);
  const myIdx = standings.findIndex((s) => s.teamId === my);
  const myRank = myIdx + 1;
  const myStanding = standings[myIdx];
  const teamCount = standings.length;

  const pName = (id: string) => getPlayer(id)?.name ?? id;
  const isMine = (w: AwardWinner | null) => !!w && w.teamId === my;

  // 우리 선수 생산 상위(단장 결정의 성적표) — leagueProduction 중 내 로스터
  const myTop = useMemo(() => {
    const prod = leagueProduction(day);
    const ids = new Set(teamPlayerIds(my));
    const rows = [...prod.entries()].filter(([id]) => ids.has(id)).map(([id, l]) => ({ id, l }));
    return rows.filter((r) => r.l.points > 0).sort((a, b) => b.l.points - a.l.points).slice(0, 3);
  }, [day, my]);

  const headline = championId === my ? { text: '🏆 우승!', color: theme.gold }
    : myRank > 0 && myRank <= 3 ? { text: `포스트시즌 진출 · ${myRank}위`, color: theme.accent }
    : myRank > 0 ? { text: `정규리그 ${myRank}위`, color: theme.text }
    : { text: '시즌 종료', color: theme.text };

  // 우리 선수 수상(있으면 강조)
  const myAwards: string[] = [];
  if (aw) {
    if (isMine(aw.mvp)) myAwards.push(`정규 MVP — ${pName(aw.mvp!.playerId)}`);
    if (isMine(aw.finalsMvp)) myAwards.push(`챔프전 MVP — ${pName(aw.finalsMvp!.playerId)}`);
    if (isMine(aw.rookie)) myAwards.push(`신인상 — ${pName(aw.rookie!.playerId)}`);
    if (isMine(aw.mostImproved)) myAwards.push(`기량발전상 — ${pName(aw.mostImproved!.playerId)}`);
  }
  const myBest7 = aw ? aw.best7.filter((s) => isMine(s.winner)).length : 0;

  const prodLine = (l: ProdLine) => `${l.matches}경기 · ${l.points}점 (스${l.spikes}·블${l.blocks}·서${l.aces})`
    + (l.assists > 0 ? ` · 세트${l.assists}` : '') + (l.digs > 0 ? ` · 디그${l.digs}` : '');

  return (
    <Screen title={`${season + 1}시즌 결산`}>
      {/* ① 우리 팀 헤드라인 한 줄 */}
      <Card accent={headline.color}>
        <Muted>{getTeam(my)?.name ?? my} · {season + 1}시즌</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
          <Text style={{ color: headline.color, fontSize: 22, fontWeight: '900' }}>{headline.text}</Text>
          {myStanding ? (
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{myStanding.wins}승 {myStanding.losses}패</Text>
          ) : null}
        </View>
        {(myAwards.length > 0 || myBest7 > 0) ? (
          <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700', marginTop: 6 }}>
            {[...myAwards, myBest7 > 0 ? `베스트7 ${myBest7}명` : null].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </Card>

      {/* ② 우리 선수 하이라이트(단장 결정의 성적표) */}
      <IconLabel icon="people-outline" color={theme.elite}>우리 선수 활약</IconLabel>
      <Card accent={theme.elite}>
        {myTop.length === 0 ? (
          <Muted style={{ fontSize: 13 }}>이번 시즌 집계된 생산 기록이 없습니다.</Muted>
        ) : myTop.map((r, i) => (
          <View key={r.id} style={styles.pRow}>
            <Text style={styles.rank}>{i + 1}</Text>
            <PosTag pos={getPlayer(r.id)?.position ?? 'OH'} />
            <View style={{ flex: 1 }}>
              <Text style={styles.pName} numberOfLines={1}>{pName(r.id)}</Text>
              <Text style={styles.pSub} numberOfLines={1}>{prodLine(r.l)}</Text>
            </View>
          </View>
        ))}
      </Card>

      {/* 리그 시상·베스트7은 시상식 화면(awards-ceremony)으로 이관(삼중 표시 방지, AWARDS_SYSTEM §7). 여기선 ① 내 팀 수상 요약만 */}

      {/* 재정·팬덤 한 줄(선택) */}
      <Card accent={theme.warn}>
        <Row><Muted>운영 자금</Muted><Text style={styles.fin}>{formatMoney(cash)}</Text></Row>
        <Row><Muted>팬심</Muted><Text style={styles.fin}>{fanScore}</Text></Row>
      </Card>

      <Muted style={{ fontSize: 12, textAlign: 'center' }}>한 시즌이 끝났습니다. 통산 기록·연표는 마이페이지 → 기록에서.</Muted>
      <Button label="오프시즌 · 외국인 트라이아웃 →" onPress={() => router.push('/tryout')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  rank: { width: 18, color: theme.muted, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  pName: { color: theme.text, fontSize: 15, fontWeight: '700' },
  pSub: { color: theme.muted, fontSize: 12.5, marginTop: 1 },
  fin: { color: theme.text, fontWeight: '800', fontSize: 15 },
});
