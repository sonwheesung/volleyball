import { StyleSheet, Text, View } from 'react-native';
import { theme } from './Screen';
import { themedStyles } from './theme';
import type { SimResult } from '../engine/simMatch';

// 공용 세트 스코어보드 — 팀명(홈/원정) + 세트 스코어(3:1) + 세트별 점수 칩.
// 경기 상세(matchresult)와 경기 뉴스 상세(news/[id])가 같은 표기를 쓰도록 추출(NEWS §11.5).
// 카드 래핑은 호출부 책임(각 화면이 <Card accent flat>로 감싼다) — 동작 불변 리팩터.
export function SetScoreboard({ homeName, awayName, sim }: { homeName: string; awayName: string; sim: SimResult }) {
  return (
    <>
      <View style={styles.scoreboard}>
        <Text style={[styles.bigTeam, { textAlign: 'right' }]} numberOfLines={2}>{homeName}</Text>
        <Text style={styles.bigScore}>{sim.homeSets} : {sim.awaySets}</Text>
        <Text style={styles.bigTeam} numberOfLines={2}>{awayName}</Text>
      </View>
      <View style={styles.sets}>
        {sim.setScores.map((s, i) => (
          <View key={i} style={styles.setChip}>
            <Text style={styles.setLabel}>{i + 1}세트</Text>
            <Text style={styles.setScore}>{s.home}:{s.away}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  scoreboard: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bigTeam: { flex: 1, color: theme.text, fontSize: 16, fontWeight: '800' },
  bigScore: { color: theme.text, fontSize: 30, fontWeight: '900', minWidth: 84, textAlign: 'center' },
  sets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 8 },
  setChip: { backgroundColor: theme.cardAlt, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center' },
  setLabel: { color: theme.muted, fontSize: 10 },
  setScore: { color: theme.text, fontSize: 14, fontWeight: '800' },
}));
