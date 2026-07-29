import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Muted, PosTag, Screen, Title, theme, themedStyles } from '../../components/Screen';
import { BoxScoreTable } from '../../components/BoxScoreTable';
import { SetScoreboard } from '../../components/SetScoreboard';
import { getFixture, getTeam, coachInfoOf } from '../../data/league';
import { buildMatchBox } from '../../data/matchBox';
import { interventionsFor } from '../../data/dynamics';
import { matchMvp } from '../../data/matchAward';

export default function MatchResult() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const router = useRouter();
  const fromWatch = from === 'watch'; // 관전 종료 후 경유 진입 — "홈으로"로 뉴스 확인(2026-07-28)
  const fixture = id ? getFixture(id) : undefined;

  if (!fixture) {
    return (
      <Screen title="경기">
        <Muted>존재하지 않는 경기입니다.</Muted>
      </Screen>
    );
  }

  // 관전 보드와 동일 단일 소스(buildMatchBox) — 명단(부상·정지·벤치+휴식 #3)·시뮬·박스가 항상 일치.
  const { homeSquad: home, awaySquad: away, sim, box } = buildMatchBox(fixture.homeTeamId, fixture.awayTeamId, fixture.dayIndex, fixture.seed, interventionsFor(fixture.id));

  const homeName = getTeam(fixture.homeTeamId)?.name ?? '';
  const awayName = getTeam(fixture.awayTeamId)?.name ?? '';
  const mvp = matchMvp(box, home, away, sim, homeName, awayName);

  return (
    <Screen title="경기 상세">
      <Card accent={theme.sky} flat>
        <SetScoreboard homeName={homeName} awayName={awayName} sim={sim} />
      </Card>

      {mvp ? (
        <>
          <Title>MVP</Title>
          <Card accent={theme.warn} flat>
          <View style={styles.mvpRow}>
            <PosTag pos={mvp.position} />
            <View style={{ flex: 1 }}>
              <Text style={styles.mvpName}>{mvp.name}</Text>
              <Text style={styles.mvpStat}>
                {mvp.points}득점{mvp.blocks ? ` · 블로킹 ${mvp.blocks}` : ''}{mvp.aces ? ` · 서브 ${mvp.aces}` : ''}{mvp.digs ? ` · 디그 ${mvp.digs}` : ''}
              </Text>
            </View>
          </View>
          <Text style={styles.mvpLine}>{mvp.line}</Text>
          </Card>
        </>
      ) : null}

      <Title>{homeName}</Title>
      <Card accent={theme.elite} flat><BoxScoreTable squad={home} box={box} dvPhilosophy={coachInfoOf(fixture.homeTeamId)?.dvPhilosophy ?? 0} /></Card>
      <Title>{awayName}</Title>
      <Card accent={theme.elite} flat><BoxScoreTable squad={away} box={box} dvPhilosophy={coachInfoOf(fixture.awayTeamId)?.dvPhilosophy ?? 0} /></Card>
      <Text style={styles.hint}>득점=공격+블록+에이스 · 공격=성공/시도/성공률 · 디그=상대 스파이크 수비</Text>

      {fromWatch ? (
        // 관전 종료 후 나가기 경유 — 홈(대시보드)으로 보내 뉴스·기록을 보게 한다(사용자 요청).
        <View style={styles.homeBtnWrap}>
          <Button label="홈으로" onPress={() => router.replace('/(tabs)/')} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  hint: { color: theme.muted, fontSize: 10.5, lineHeight: 15, marginTop: 2 },
  mvpRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  mvpName: { color: theme.text, fontSize: 16, fontWeight: '800' },
  mvpStat: { color: theme.muted, fontSize: 12.5, marginTop: 1 },
  mvpLine: { color: theme.text, fontSize: 13, marginTop: 8, lineHeight: 18 },
  homeBtnWrap: { marginTop: 14 },
}));
