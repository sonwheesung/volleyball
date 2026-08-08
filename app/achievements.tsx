// 업적 화면 (ACHIEVEMENT_SYSTEM) — 구단주의 장기 발자취를 트로피로.
// 달성 여부는 저장 없이 세이브 상태(archive/hof/milestones/cash/fanScore)에서 재계산.
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Loading, Muted, Screen, SCREEN_LOADING_MIN_MS, Title, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { Popup } from '../components/Popup';
import { showAlert } from '../components/AppDialog';
import { MeterBar } from '../components/MeterBar';
import { achievementSummary, achReward, type AchCategory, type AchStatus } from '../engine/achievements';
import { unclaimedReward } from '../engine/diamonds';
import { achEvalFor } from '../data/achSelect';
import { formatMoney } from '../engine/salary';
import { useGameStore } from '../store/useGameStore';

const CATEGORY_ORDER: AchCategory[] = ['우승', '시상', '레전드', '기록', '서사', '단장', '통산', '운영'];
const CATEGORY_ICON: Record<AchCategory, string> = { 우승: '🏆', 시상: '🎖️', 레전드: '⭐', 기록: '📖', 서사: '📜', 단장: '🧑‍💼', 통산: '📊', 운영: '💰' };

// 진행치 표시 — 운영 자금만 금액 포맷, 나머지는 숫자
const progressLabel = (s: AchStatus): string => {
  if (s.unlocked) return '달성'; // 달성 완료 — 카운터형(백점돌파 100/100 등)도 "100/100"이 아니라 "달성"으로(진행바와 일관)
  if (s.ach.target <= 1) return '미달성';
  // 운영 자금 업적 3종(20억·50억·100억)은 모두 금액 포맷 — 500k/1m이 원시 숫자로 새던 오표시 교정(UV-8)
  if (s.ach.id === 'cash_200k' || s.ach.id === 'cash_500k' || s.ach.id === 'cash_1m') {
    return `${formatMoney(s.cur)} / ${formatMoney(s.ach.target)}`;
  }
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
  const season = useGameStore((s) => s.season);
  const archive = useGameStore((s) => s.archive);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const milestones = useGameStore((s) => s.milestones);
  const cash = useGameStore((s) => s.cash);
  const fanScore = useGameStore((s) => s.fanScore);
  const careerLog = useGameStore((s) => s.careerLog);
  const careerTotals = useGameStore((s) => s.careerTotals);
  const results = useGameStore((s) => s.results);
  const noteAchTotals = useGameStore((s) => s.noteAchTotals);

  // 통산 업적을 시즌 중에도 반영: 셀렉터 'exact'(저장 careerTotals + 이번 시즌 진행분). endSeason 누적과 이음매 없음.
  const ev = useMemo(
    () => achEvalFor({ selectedTeamId: myTeamId, season, archive, hallOfFame, milestones, cash, fanScore, careerLog, careerTotals, results }, 'exact'),
    [myTeamId, season, archive, hallOfFame, milestones, cash, fanScore, careerLog, careerTotals, results],
  );
  const statuses = ev.statuses;
  // 계산한 정확값을 비영속 캐시에 남긴다(탭 빨간 점이 재활용 — 탭은 시뮬을 못 돌린다). **렌더 중이 아니라 커밋 후**(setState-in-render 금지).
  useEffect(() => { noteAchTotals(ev.key, ev.totals); }, [ev, noteAchTotals]);
  const { done, total } = achievementSummary(statuses);
  const byCat = useMemo(() => {
    const m = new Map<AchCategory, AchStatus[]>();
    for (const s of statuses) { const arr = m.get(s.ach.category) ?? []; arr.push(s); m.set(s.ach.category, arr); }
    return m;
  }, [statuses]);

  // 업적 보상 수령(2026-07-28 재설계) — 카드별 개별(claim([id])) + 상단 일괄(claim()). statuses가 이미 웜이라 claim의 재평가는 1ms(느림은 마이페이지 렌더서 제거).
  const claimedAch = useGameStore((s) => s.claimedAch);
  const claimAchDiamonds = useGameStore((s) => s.claimAchDiamonds);
  const walletBusy = useGameStore((s) => s.walletBusy);
  const unclaimedIds = useMemo(() => unclaimedReward(statuses, claimedAch).ids, [statuses, claimedAch]);
  const [claiming, setClaiming] = useState(false);
  const claim = async (only?: string[]) => {
    if (claiming || walletBusy) return;
    setClaiming(true);
    try {
      const r = await claimAchDiamonds(only);
      if (r.granted > 0) showAlert('업적 보상 수령', `보상 +${r.granted} 💎 받았습니다.`);
      else if (r.reason === 'cap') showAlert('수령 한도', '업적 보상 지급 한도에 도달했습니다.');
      else if (r.reason === 'offline') showAlert('연결이 불안정합니다', '보상이 이미 지급됐을 수 있어요. 잔액을 확인해 주세요.');
      else if (r.reason === 'already') showAlert('보상 반영 완료', '이 보상은 이미 다이아로 지급돼 잔액에 반영돼 있습니다.');
      else if (r.reason !== 'busy') showAlert('수령할 보상 없음', '받을 업적 보상이 없습니다.');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <Screen title="업적">
      <Card accent={theme.gold} flat>
        <Row>
          <Title>구단주의 발자취</Title>
          <Text style={styles.count}>{done} / {total}</Text>
        </Row>
        <MeterBar pct={total ? (done / total) * 100 : 0} color={theme.accent} />
        <Muted style={{ fontSize: 12 }}>장기 목표를 눈앞에. 우승·시상·레전드·기록·운영의 발자취가 트로피로 남는다.</Muted>
        {/* 상단 일괄 보상 받기(2026-07-28) — 미수령 있을 때만. 카드별로도 받을 수 있고, 여기서 한 번에. */}
        {unclaimedIds.length > 0 ? (
          <Button label={`🎁 보상 일괄 받기 (${unclaimedIds.length})`} onPress={() => claim()} disabled={claiming || walletBusy} />
        ) : null}
      </Card>

      {CATEGORY_ORDER.map((cat) => {
        const items = byCat.get(cat);
        if (!items?.length) return null;
        const catDone = items.filter((s) => s.unlocked).length;
        return (
          <View key={cat} style={{ gap: 6 }}>
            <Text style={styles.catHead}>{CATEGORY_ICON[cat]} {cat} <Text style={styles.catCount}>{catDone}/{items.length}</Text></Text>
            {items.map((s) => {
              const claimed = claimedAch.includes(s.ach.id);   // 서버 확정 후 담긴 수령 id
              const claimable = s.unlocked && !claimed;         // 달성했는데 아직 안 받음 → 빨간 점 + 보상받기 버튼
              return (
              <View key={s.ach.id} style={[styles.ach, s.unlocked && styles.achDone, claimable && styles.achClaimable]}>
                {claimable ? <View style={styles.cardDot} /> : null}
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
                {/* 우측: 달성·미수령 → 보상받기 버튼 / 달성·수령완료 → 받음 ✓ / 미달성 → 진행 */}
                {claimable ? (
                  <Pressable onPress={() => claim([s.ach.id])} disabled={claiming || walletBusy} style={[styles.claimBtn, (claiming || walletBusy) && styles.claimBtnOff]} accessibilityRole="button">
                    <Text style={styles.claimBtnTxt}>보상받기</Text>
                  </Pressable>
                ) : claimed ? (
                  <Text style={styles.claimedTxt}>받음 ✓</Text>
                ) : (
                  <Text style={styles.prog}>{progressLabel(s)}</Text>
                )}
              </View>
              );
            })}
          </View>
        );
      })}

      <Button label="나가기" onPress={() => router.back()} />

      {/* 보상 수령 중 블로킹 로딩 — 서버 왕복 수초를 가림(마이페이지서 이동). statuses는 웜이라 compute는 즉시, 대기는 네트워크. */}
      <Popup visible={claiming}>
        <View style={{ alignItems: 'center', gap: 14, paddingVertical: 6 }}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={styles.title}>보상 받는 중…</Text>
          <Muted style={{ fontSize: 12.5, textAlign: 'center' }}>온라인으로 안전하게 적립하고 있어요. 잠시만 기다려 주세요.</Muted>
        </View>
      </Popup>
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
  achClaimable: { borderColor: theme.accent + '88', backgroundColor: theme.accent + '0E' }, // 미수령 강조
  cardDot: { position: 'absolute', top: -3, right: -3, width: 11, height: 11, borderRadius: 6, backgroundColor: theme.bad, borderWidth: 2, borderColor: theme.bg },
  claimBtn: { backgroundColor: theme.accent, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  claimBtnOff: { opacity: 0.5 },
  claimBtnTxt: { color: '#06231F', fontSize: 12.5, fontWeight: '900' },
  claimedTxt: { color: theme.good, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  icon: { fontSize: 18, width: 24, textAlign: 'center' },
  iconLocked: { opacity: 0.6 },
  title: { color: theme.muted, fontSize: 15, fontWeight: '800' },
  desc: { color: theme.muted, fontSize: 12, marginTop: 1 },
  reward: { color: theme.muted, fontSize: 11.5, fontWeight: '800', marginTop: 3, opacity: 0.7 },
  rewardOn: { color: theme.sky, opacity: 1 },
  prog: { color: theme.muted, fontSize: 12, fontWeight: '700', textAlign: 'right' },
}));
