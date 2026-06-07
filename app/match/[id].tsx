import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Muted, theme } from '../../components/Screen';
import { getEvolvedTeamPlayers, getFixture, getTeam } from '../../data/league';
import { teamOverall } from '../../engine/overall';
import { simulateMatch } from '../../engine/match';
import { type PointLog } from '../../engine/simMatch';
import { useGameStore } from '../../store/useGameStore';

interface Frame extends PointLog {
  homeSets: number;
  awaySets: number;
}

export default function MatchBoard() {
  const { id, sandbox, home: homeParam, away: awayParam, seed: seedParam } = useLocalSearchParams<{
    id: string; sandbox?: string; home?: string; away?: string; seed?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const recordResult = useGameStore((s) => s.recordResult);
  const recorded = useRef(false);

  // 테스트(미적용) 경기: 일정과 무관하게 임의 팀끼리 돌려보고 결과를 저장하지 않는다.
  const isSandbox = sandbox === '1';
  const fixture = id && !isSandbox ? getFixture(id) : undefined;

  const data = useMemo(() => {
    let home, away, dayIndex: number, seed: number;
    if (isSandbox) {
      home = homeParam ? getTeam(homeParam) : undefined;
      away = awayParam ? getTeam(awayParam) : undefined;
      if (!home || !away) return null;
      dayIndex = currentDay;            // 현재 시점 스탯으로 시뮬
      seed = Number(seedParam) || 1;
    } else {
      if (!fixture) return null;
      home = getTeam(fixture.homeTeamId);
      away = getTeam(fixture.awayTeamId);
      if (!home || !away) return null;
      dayIndex = fixture.dayIndex;
      seed = fixture.seed;
    }
    const homeSquad = getEvolvedTeamPlayers(home.id, dayIndex);
    const awaySquad = getEvolvedTeamPlayers(away.id, dayIndex);
    const homeOvr = teamOverall(homeSquad);
    const awayOvr = teamOverall(awaySquad);
    const sim = simulateMatch(seed, homeSquad, awaySquad);

    // 프레임마다 "직전까지 완료된 세트 수" 부여
    let hs = 0;
    let as = 0;
    const frames: Frame[] = sim.points.map((p, i) => {
      const frame: Frame = { ...p, homeSets: hs, awaySets: as };
      const isSetEnd = i === sim.points.length - 1 || sim.points[i + 1].setNo !== p.setNo;
      if (isSetEnd) {
        if (p.home > p.away) hs++;
        else as++;
      }
      return frame;
    });
    return { home, away, homeOvr, awayOvr, sim, frames };
  }, [fixture, isSandbox, homeParam, awayParam, seedParam, currentDay]);

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [fast, setFast] = useState(false);

  const total = data?.frames.length ?? 0;
  const finished = idx >= total && total > 0;

  // 애니메이션 틱
  useEffect(() => {
    if (!playing || finished || total === 0) return;
    const t = setInterval(() => setIdx((i) => Math.min(total, i + 1)), fast ? 50 : 200);
    return () => clearInterval(t);
  }, [playing, fast, finished, total]);

  // 종료 시 결과 1회 기록 (테스트 경기는 저장하지 않음)
  useEffect(() => {
    if (finished && data && fixture && !isSandbox && !recorded.current) {
      recorded.current = true;
      recordResult({
        fixtureId: fixture.id,
        homeSets: data.sim.homeSets,
        awaySets: data.sim.awaySets,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  if (!data) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
        <Muted>존재하지 않는 경기입니다.</Muted>
        <Button label="나가기" onPress={() => router.back()} />
      </View>
    );
  }

  const cur: Frame =
    idx === 0
      ? { setNo: 1, home: 0, away: 0, scorer: 'home', homeSets: 0, awaySets: 0 }
      : data.frames[Math.min(idx, total) - 1];

  const homeSets = finished ? data.sim.homeSets : cur.homeSets;
  const awaySets = finished ? data.sim.awaySets : cur.awaySets;
  const completedSets = data.sim.setScores.slice(0, homeSets + awaySets);

  const isMyHome = selectedTeamId === data.home.id;
  const isMyAway = selectedTeamId === data.away.id;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      {isSandbox ? <Text style={styles.sandboxTag}>테스트 경기 · 결과 미적용</Text> : null}
      <Text style={styles.setNo}>{finished ? '경기 종료' : `${cur.setNo}세트`}</Text>

      {/* 스코어보드 */}
      <View style={styles.board}>
        <TeamCol name={data.home.name} ovr={data.homeOvr} sets={homeSets} mine={isMyHome} />
        <View style={styles.center}>
          <Text style={styles.bigScore}>
            {cur.home} : {cur.away}
          </Text>
          <Text style={styles.setCount}>
            세트 {homeSets} - {awaySets}
          </Text>
        </View>
        <TeamCol name={data.away.name} ovr={data.awayOvr} sets={awaySets} mine={isMyAway} alignRight />
      </View>

      {/* 세트 스코어 */}
      <View style={styles.setScores}>
        {completedSets.map((s, i) => (
          <View key={i} style={styles.setChip}>
            <Text style={styles.setChipLabel}>{i + 1}세트</Text>
            <Text style={styles.setChipScore}>
              {s.home}:{s.away}
            </Text>
          </View>
        ))}
      </View>

      {/* 진행 바 */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${total ? (Math.min(idx, total) / total) * 100 : 0}%` }]} />
      </View>

      <View style={{ flex: 1 }} />

      {/* 컨트롤 */}
      {finished ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.resultText}>
            {data.sim.homeSets > data.sim.awaySets ? data.home.name : data.away.name} 승리 ·{' '}
            {data.sim.homeSets} - {data.sim.awaySets}
          </Text>
          <Button label="확인하고 나가기" onPress={() => router.back()} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button label={playing ? '일시정지' : '재생'} variant="ghost" onPress={() => setPlaying((p) => !p)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={fast ? '빠름 ✓' : '빠르게'} variant="ghost" onPress={() => setFast((f) => !f)} />
            </View>
          </View>
          <Button label="즉시 결과 보기" onPress={() => { setPlaying(false); setIdx(total); }} />
        </View>
      )}
    </View>
  );
}

function TeamCol({
  name,
  ovr,
  sets,
  mine,
  alignRight,
}: {
  name: string;
  ovr: number;
  sets: number;
  mine?: boolean;
  alignRight?: boolean;
}) {
  return (
    <View style={[styles.teamCol, alignRight && { alignItems: 'flex-end' }]}>
      <Text numberOfLines={2} style={[styles.teamName, mine && { color: theme.accent }]}>
        {name}
      </Text>
      <Text style={styles.teamOvr}>OVR {ovr}</Text>
      {mine ? <Text style={styles.mineTag}>우리 팀</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 20, gap: 14 },
  setNo: { color: theme.accent, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  sandboxTag: { color: theme.warn, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  board: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamCol: { flex: 1, gap: 3 },
  teamName: { color: theme.text, fontSize: 16, fontWeight: '800' },
  teamOvr: { color: theme.muted, fontSize: 12 },
  mineTag: { color: theme.accent, fontSize: 11, fontWeight: '700' },
  center: { alignItems: 'center', minWidth: 110 },
  bigScore: { color: theme.text, fontSize: 44, fontWeight: '900', letterSpacing: 1 },
  setCount: { color: theme.muted, fontSize: 13, fontWeight: '700' },
  setScores: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  setChip: { backgroundColor: theme.card, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center' },
  setChipLabel: { color: theme.muted, fontSize: 10 },
  setChipScore: { color: theme.text, fontSize: 14, fontWeight: '800' },
  progressTrack: { height: 6, backgroundColor: theme.card, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: theme.accent, borderRadius: 3 },
  resultText: { color: theme.text, fontSize: 16, fontWeight: '800', textAlign: 'center' },
});
