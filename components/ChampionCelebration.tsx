// 우승 축하 화면 — 우승 확정 순간(플레이오프) 내 구단이 챔피언일 때 표시(관전형 연출, BROADCAST_SYSTEM 우승 연출).
// 어두운 팀색 카드 위에 ChampionIllustration + 팀명·N시즌 챔피언·(선택)MVP·계속 버튼.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChampionIllustration } from './ChampionIllustration';
import { teamColors } from '../lib/teamColor';

interface Props {
  teamName: string;
  teamId: string;
  season: number;       // 0-based(표시는 +1)
  mvpName?: string;     // 챔프전 MVP(시즌 종료 후에만 — 없으면 줄 생략)
  onDone?: () => void;  // "시즌 마무리 →"
}

export function ChampionCelebration({ teamName, teamId, season, mvpName, onDone }: Props) {
  const c = teamColors(teamId);
  return (
    <View style={[styles.card, { backgroundColor: c.bg }]}>
      <Text style={styles.top}>🏆 챔피언 결정전 우승</Text>
      <ChampionIllustration primary={c.primary} arm={c.arm} badge={c.badge} width={300} />
      <Text style={styles.name}>{teamName}</Text>
      <Text style={[styles.season, { color: c.light }]}>{season + 1}시즌 챔피언</Text>
      {mvpName ? <Text style={styles.mvp}>챔프전 MVP · {mvpName}</Text> : null}
      {onDone ? (
        <Pressable style={styles.btn} onPress={onDone}>
          <Text style={styles.btnTxt}>시즌 마무리 →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, paddingTop: 18, paddingBottom: 22, alignItems: 'center', overflow: 'hidden' },
  top: { color: '#FFD879', fontSize: 12, fontWeight: '800', letterSpacing: 2, marginBottom: 4 },
  name: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', marginTop: 4 },
  season: { fontSize: 15, fontWeight: '800', marginTop: 2 },
  mvp: { color: '#9FB0C4', fontSize: 12, marginTop: 8 },
  btn: { marginTop: 16, backgroundColor: '#FFD879', paddingVertical: 11, paddingHorizontal: 28, borderRadius: 999 },
  btnTxt: { color: '#3A2A08', fontSize: 13, fontWeight: '800' },
});
