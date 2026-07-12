// 업적 화면 (ACHIEVEMENT_SYSTEM) — 구단주의 장기 발자취를 트로피로.
// 달성 여부는 저장 없이 세이브 상태(archive/hof/milestones/cash/fanScore)에서 재계산.
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Loading, Muted, Screen, SCREEN_LOADING_MIN_MS, Title, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { MeterBar } from '../components/MeterBar';
import { evalAchievements, achievementSummary, achReward, type AchCategory, type AchStatus } from '../engine/achievements';
import { achTotals } from '../data/careerTotals';
import { formatMoney } from '../engine/salary';
import { useGameStore } from '../store/useGameStore';

const CATEGORY_ORDER: AchCategory[] = ['우승', '시상', '레전드', '기록', '서사', '단장', '통산', '운영'];
const CATEGORY_ICON: Record<AchCategory, string> = { 우승: '🏆', 시상: '🎖️', 레전드: '⭐', 기록: '📖', 서사: '📜', 단장: '🧑‍💼', 통산: '📊', 운영: '💰' };

// 진행치 표시 — 운영 자금만 금액 포맷, 나머지는 숫자
const progressLabel = (s: AchStatus): string => {
  if (s.unlocked) return '달성'; // 달성 완료 — 카운터형(백점돌파 100/100 등)도 "100/100"이 아니라 "달성"으로(진행바와 일관)
  if (s.ach.target <= 1) return '미달성';
  if (s.ach.id === 'cash_200k') return `${formatMoney(s.cur)} / ${formatMoney(s.ach.target)}`;
  return `${s.cur} / ${s.ach.target}`;
};

export default function Achievements() {
  // 업적은 무겁다(전 업적 재평가 evalAchievements + 통산 집계). 한 틱 미뤄 로딩부터 그린다.
  const ready = useDeferredReady(SCREEN_LOADING_MIN_MS);
  if (!ready) return <Loading title="업적" variant="list" />;
  return <AchievementsInner />;
}

function AchievementsInner() {
  const router = useRouter();
  const myTeamId = useGameStore((s) => s.selectedTeamId) ?? '';
  const archive = useGameStore((s) => s.archive);
  const hof = useGameStore((s) => s.hallOfFame);
  const milestones = useGameStore((s) => s.milestones);
  const cash = useGameStore((s) => s.cash);
  const fanScore = useGameStore((s) => s.fanScore);
  const careerLog = useGameStore((s) => s.careerLog);
  const careerTotals = useGameStore((s) => s.careerTotals);
  const results = useGameStore((s) => s.results);

  // 통산 업적을 시즌 중에도 반영: 저장 careerTotals + 이번 시즌 진행분(achTotals). endSeason 누적과 이음매 없음.
  const statuses = useMemo(
    () => evalAchievements({ myTeamId, archive, hof, milestones, cash, fanScore, careerLog, careerTotals: achTotals(myTeamId, careerTotals, results) }),
    [myTeamId, archive, hof, milestones, cash, fanScore, careerLog, careerTotals, results],
  );
  const { done, total } = achievementSummary(statuses);
  const byCat = useMemo(() => {
    const m = new Map<AchCategory, AchStatus[]>();
    for (const s of statuses) { const arr = m.get(s.ach.category) ?? []; arr.push(s); m.set(s.ach.category, arr); }
    return m;
  }, [statuses]);

  return (
    <Screen title="업적">
      <Card accent={theme.gold} flat>
        <Row>
          <Title>구단주의 발자취</Title>
          <Text style={styles.count}>{done} / {total}</Text>
        </Row>
        <MeterBar pct={total ? (done / total) * 100 : 0} color={theme.accent} />
        <Muted style={{ fontSize: 12 }}>장기 목표를 눈앞에. 우승·시상·레전드·기록·운영의 발자취가 트로피로 남는다.</Muted>
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
                {/* 달성 아이콘: 어두운 배경에 묻히던 체크(✓)→트로피(색 있는 이모지라 잘 보임, 테스터 제보 2026-07-11) */}
                <Text style={[styles.icon, !s.unlocked && styles.iconLocked]}>{s.unlocked ? '🏆' : '🔒'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, s.unlocked && { color: theme.text }]}>{s.ach.title}</Text>
                  <Text style={styles.desc}>{s.ach.desc}</Text>
                  {/* 보상 다이아 명시(테스터 요청 2026-07-11) — 달성 전엔 연하게, 달성 시 또렷하게 */}
                  <Text style={[styles.reward, s.unlocked && styles.rewardOn]}>보상 +{achReward(s.ach.id)} 💎</Text>
                  {s.ach.target > 1 && !s.unlocked ? (
                    <View style={{ marginTop: 5 }}>
                      <MeterBar pct={Math.min(100, (s.cur / s.ach.target) * 100)} color={theme.accent} height={4} />
                    </View>
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

const styles = themedStyles(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { color: theme.accent, fontSize: 18, fontWeight: '900' },
  catHead: { color: theme.text, fontSize: 15, fontWeight: '800', marginTop: 6 },
  catCount: { color: theme.muted, fontSize: 13, fontWeight: '700' },
  ach: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: theme.border, opacity: 0.7,
  },
  achDone: { opacity: 1, borderColor: theme.good + '66' },
  icon: { fontSize: 18, width: 24, textAlign: 'center' },
  iconLocked: { opacity: 0.6 },
  title: { color: theme.muted, fontSize: 15, fontWeight: '800' },
  desc: { color: theme.muted, fontSize: 12, marginTop: 1 },
  reward: { color: theme.muted, fontSize: 11.5, fontWeight: '800', marginTop: 3, opacity: 0.7 },
  rewardOn: { color: theme.sky, opacity: 1 },
  prog: { color: theme.muted, fontSize: 12, fontWeight: '700', textAlign: 'right' },
}));
