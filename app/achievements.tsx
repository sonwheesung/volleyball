// 업적 화면 (ACHIEVEMENT_SYSTEM) — 구단주의 장기 발자취를 트로피로.
// 달성 여부는 저장 없이 세이브 상태(archive/hof/milestones/cash/fanScore)에서 재계산.
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Muted, Screen, Title, theme } from '../components/Screen';
import { evalAchievements, achievementSummary, type AchCategory, type AchStatus } from '../engine/achievements';
import { formatMoney } from '../engine/salary';
import { useGameStore } from '../store/useGameStore';

const CATEGORY_ORDER: AchCategory[] = ['우승', '시상', '레전드', '기록', '서사', '단장', '통산', '운영'];
const CATEGORY_ICON: Record<AchCategory, string> = { 우승: '🏆', 시상: '🎖️', 레전드: '⭐', 기록: '📖', 서사: '📜', 단장: '🧑‍💼', 통산: '📊', 운영: '💰' };

// 진행치 표시 — 운영 자금만 금액 포맷, 나머지는 숫자
const progressLabel = (s: AchStatus): string => {
  if (s.ach.target <= 1) return s.unlocked ? '달성' : '미달성';
  if (s.ach.id === 'cash_200k') return `${formatMoney(s.cur)} / ${formatMoney(s.ach.target)}`;
  return `${s.cur} / ${s.ach.target}`;
};

export default function Achievements() {
  const router = useRouter();
  const myTeamId = useGameStore((s) => s.selectedTeamId) ?? '';
  const archive = useGameStore((s) => s.archive);
  const hof = useGameStore((s) => s.hallOfFame);
  const milestones = useGameStore((s) => s.milestones);
  const cash = useGameStore((s) => s.cash);
  const fanScore = useGameStore((s) => s.fanScore);
  const careerLog = useGameStore((s) => s.careerLog);
  const careerTotals = useGameStore((s) => s.careerTotals);

  const statuses = useMemo(
    () => evalAchievements({ myTeamId, archive, hof, milestones, cash, fanScore, careerLog, careerTotals }),
    [myTeamId, archive, hof, milestones, cash, fanScore, careerLog, careerTotals],
  );
  const { done, total } = achievementSummary(statuses);
  const byCat = useMemo(() => {
    const m = new Map<AchCategory, AchStatus[]>();
    for (const s of statuses) { const arr = m.get(s.ach.category) ?? []; arr.push(s); m.set(s.ach.category, arr); }
    return m;
  }, [statuses]);

  return (
    <Screen title="업적">
      <Card>
        <Row>
          <Title>구단주의 발자취</Title>
          <Text style={styles.count}>{done} / {total}</Text>
        </Row>
        <View style={styles.track}><View style={[styles.fill, { width: `${total ? (done / total) * 100 : 0}%` }]} /></View>
        <Muted style={{ fontSize: 12 }}>장기 목표를 눈앞에 — 우승·시상·레전드·기록·운영의 발자취가 트로피로 남는다.</Muted>
      </Card>

      {CATEGORY_ORDER.map((cat) => {
        const items = byCat.get(cat);
        if (!items?.length) return null;
        const catDone = items.filter((s) => s.unlocked).length;
        return (
          <View key={cat} style={{ gap: 6 }}>
            <Text style={styles.catHead}>{CATEGORY_ICON[cat]} {cat} <Text style={styles.catCount}>{catDone}/{items.length}</Text></Text>
            {items.map((s) => (
              <View key={s.ach.id} style={[styles.ach, s.unlocked && styles.achDone]}>
                <Text style={[styles.icon, !s.unlocked && styles.iconLocked]}>{s.unlocked ? '✓' : '🔒'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, s.unlocked && { color: theme.text }]}>{s.ach.title}</Text>
                  <Text style={styles.desc}>{s.ach.desc}</Text>
                  {s.ach.target > 1 && !s.unlocked ? (
                    <View style={styles.miniTrack}><View style={[styles.miniFill, { width: `${Math.min(100, (s.cur / s.ach.target) * 100)}%` }]} /></View>
                  ) : null}
                </View>
                <Text style={[styles.prog, s.unlocked && { color: theme.good }]}>{progressLabel(s)}</Text>
              </View>
            ))}
          </View>
        );
      })}

      <Button label="나가기" onPress={() => router.back()} />
    </Screen>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { color: theme.accent, fontSize: 18, fontWeight: '900' },
  track: { height: 8, backgroundColor: theme.cardAlt, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: theme.accent },
  catHead: { color: theme.text, fontSize: 15, fontWeight: '800', marginTop: 6 },
  catCount: { color: theme.muted, fontSize: 13, fontWeight: '700' },
  ach: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'transparent', opacity: 0.7,
  },
  achDone: { opacity: 1, borderColor: theme.good + '66' },
  icon: { fontSize: 18, width: 24, textAlign: 'center' },
  iconLocked: { opacity: 0.6 },
  title: { color: theme.muted, fontSize: 15, fontWeight: '800' },
  desc: { color: theme.muted, fontSize: 12, marginTop: 1 },
  prog: { color: theme.muted, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  miniTrack: { height: 4, backgroundColor: theme.cardAlt, borderRadius: 2, overflow: 'hidden', marginTop: 5 },
  miniFill: { height: 4, backgroundColor: theme.accent },
});
