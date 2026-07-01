// 전지훈련 (MONETIZATION §11.2) — 오프시즌 해외 캠프. 다이아로 선수 1명을 보내 능력치 여러 부위를
// 현재+1·포텐+1(최대 99). 선수당 오프시즌 1회. 오프시즌(currentDay 0)에만 — 재시뮬/소급 방지.
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Muted, PosTag, Screen, theme, themedStyles } from '../components/Screen';
import { useGameStore } from '../store/useGameStore';
import { getPlayer, teamPlayerIds } from '../data/league';
import { TRAINABLE_STATS } from '../engine/training';
import { CAMP_PER_STAT, campCost, upgradableStats } from '../engine/diamonds';
import type { Player, TrainableStat } from '../types';

const LABEL: Record<TrainableStat, string> = {
  jump: '점프력', agility: '민첩성', staminaMax: '체력', staminaRegen: '체젠',
  reaction: '반응속도', positioning: '위치선정', focus: '집중력', consistency: '기복', vq: 'VQ',
  skSpike: '공격기술', skBlock: '블로킹기술', skDig: '디그기술', skReceive: '리시브기술', skSet: '세팅기술', skServe: '서브기술',
};

export default function TrainingCamp() {
  const router = useRouter();
  // 오프시즌 체인 진입(season-start → 여기 → enshrine, A3)이면 chain=1 — "새 시즌으로 ▶"로 다음 단계(헌액) 진행.
  // replace 로 들어와 뒤로 가도 season-start(endSeason)를 재실행하지 않음. 비-chain(마이페이지)은 뒤로가기만.
  const { chain } = useLocalSearchParams<{ chain?: string }>();
  const inChain = chain === '1';
  const goNext = () => router.replace('/enshrine'); // 헌액(0명이면 자동 통과 → 대시보드)
  const my = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const diamonds = useGameStore((s) => s.diamonds);
  const camped = useGameStore((s) => s.campTrainedThisOffseason);
  const trainingCamp = useGameStore((s) => s.trainingCamp);
  const [picked, setPicked] = useState<string | null>(null);
  const [stats, setStats] = useState<TrainableStat[]>([]);
  const [, force] = useState(0); // 적용 후 리렌더

  const offseason = currentDay === 0;
  const roster: Player[] = my ? teamPlayerIds(my).map((id) => getPlayer(id)).filter((p): p is Player => !!p) : [];
  const player = picked ? getPlayer(picked) : null;

  const toggle = (s: TrainableStat) => setStats((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  const cost = campCost(stats);
  const canAfford = diamonds >= cost;

  const balance = (
    <View style={styles.bal}><Text style={styles.gem}>💎</Text><Text style={styles.balN}>{diamonds.toLocaleString()}</Text></View>
  );

  if (!offseason) {
    return (
      <Screen title="전지훈련">
        {balance}
        <Card accent={theme.warn}>
          <IconLabel icon="airplane-outline" color={theme.warn}>오프시즌에만 가능</IconLabel>
          <Muted style={{ fontSize: 13, marginTop: 4 }}>전지훈련은 시즌이 끝난 뒤(새 시즌 시작 전)에만 보낼 수 있습니다. 이번 시즌을 마치고 오프시즌에 다시 오세요.</Muted>
        </Card>
        {/* 체인 진입인데 day0이 아닌 예외(endSeason 실패 등) — 막다른 화면이 되지 않게 진행 버튼 보장 */}
        {inChain ? <View style={{ marginTop: 14 }}><Button label="새 시즌으로 ▶" onPress={goNext} /></View> : null}
      </Screen>
    );
  }

  // ── 선수 선택 ──
  if (!player) {
    return (
      <Screen title="전지훈련">
        {balance}
        {inChain ? (
          <Card accent={theme.warn}>
            <IconLabel icon="flag-outline" color={theme.warn}>새 시즌 준비 — 마지막 단계</IconLabel>
            <Muted style={{ fontSize: 13, marginTop: 4, lineHeight: 19 }}>
              영입·드래프트가 끝났습니다. 새 시즌이 시작되기 전, 다이아로 선수를 전지훈련 보낼 수 있습니다. 보낼 선수가 없으면 아래 <Text style={{ color: theme.warn, fontWeight: '800' }}>새 시즌으로 ▶</Text> 로 진행하세요.
            </Muted>
          </Card>
        ) : null}
        <Card accent={theme.good}>
          <IconLabel icon="airplane-outline" color={theme.good}>오프시즌 해외 캠프</IconLabel>
          <Muted style={{ fontSize: 13, marginTop: 4, lineHeight: 19 }}>
            선수 한 명을 캠프로 보내 능력치를 키웁니다. 능력치 하나당 <Text style={{ color: theme.good, fontWeight: '800' }}>현재 +1 · 성장 한계(포텐) +1</Text> (최대 99).{'\n'}
            • 부위당 <Text style={{ color: theme.good, fontWeight: '800' }}>{CAMP_PER_STAT} 💎</Text> · 여러 부위 가능{'\n'}
            • <Text style={{ color: theme.text, fontWeight: '700' }}>선수 1명당 오프시즌 1회</Text> · 다음 시즌부터 반영 · 영구(환불 불가)
          </Muted>
        </Card>
        <IconLabel icon="people-outline" color={theme.accent}>선수 선택</IconLabel>
        {roster.map((p) => {
          const done = camped.includes(p.id);
          return (
            <Pressable key={p.id} disabled={done} onPress={() => { setPicked(p.id); setStats([]); }}
              style={({ pressed }) => [styles.prow, done && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}>
              <PosTag pos={p.position} />
              <Text style={styles.pname} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.psub}>{p.age}세</Text>
              {done ? <Text style={styles.doneTag}>완료</Text> : <Text style={styles.arrow}>›</Text>}
            </Pressable>
          );
        })}
        {inChain ? (
          <View style={{ marginTop: 14 }}>
            <Button label="새 시즌으로 ▶" onPress={goNext} />
          </View>
        ) : null}
      </Screen>
    );
  }

  // ── 부위 선택 ──
  const up = upgradableStats(player, [...TRAINABLE_STATS]);
  const cur = player as unknown as Record<string, number>;
  const send = () => {
    const r = trainingCamp(player.id, stats);
    if (r.ok) {
      Alert.alert('전지훈련 완료', `${player.name} 선수가 ${stats.length}개 부위를 키우고 왔습니다. 다음 시즌부터 반영됩니다.`);
      setPicked(null); setStats([]); force((n) => n + 1);
    } else {
      Alert.alert('전지훈련 불가',
        r.reason === 'no-diamonds' ? '다이아가 부족합니다.'
        : r.reason === 'already' ? '이 선수는 이번 오프시즌에 이미 다녀왔습니다.'
        : r.reason === 'not-offseason' ? '오프시즌에만 가능합니다.'
        : '전지훈련을 보낼 수 없습니다.');
    }
  };

  return (
    <Screen title="전지훈련" scroll={false}>
      {balance}
      <View style={styles.phead}>
        <PosTag pos={player.position} />
        <Text style={styles.pnameBig} numberOfLines={1}>{player.name}</Text>
        <Pressable onPress={() => { setPicked(null); setStats([]); }}><Text style={styles.change}>선수 변경</Text></Pressable>
      </View>
      <Muted style={{ fontSize: 12.5, marginBottom: 6 }}>올릴 부위를 선택하세요 (각 현재+1·포텐+1, 최대 99)</Muted>
      <ScrollView style={{ flex: 1 }}>
        {TRAINABLE_STATS.map((s) => {
          const on = stats.includes(s);
          const disabled = !up.includes(s); // 현재·포텐 모두 99
          const c = cur[s]; const pot = player.potential[s] ?? c;
          return (
            <Pressable key={s} disabled={disabled} onPress={() => toggle(s)}
              style={({ pressed }) => [styles.srow, disabled && { opacity: 0.4 }, on && styles.srowOn, pressed && { opacity: 0.7 }]}>
              <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMk}>✓</Text> : null}</View>
              <Text style={styles.slabel}>{LABEL[s]}</Text>
              <Text style={styles.sval}>{c}{c < 99 ? <Text style={{ color: theme.good }}> → {Math.min(99, c + 1)}</Text> : null}</Text>
              <Text style={styles.spot}>포텐 {pot}{pot < 99 ? <Text style={{ color: theme.good }}>→{Math.min(99, pot + 1)}</Text> : ' (MAX)'}</Text>
            </Pressable>
          );
        })}
        <View style={{ height: 12 }} />
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.costTxt}>{stats.length}부위 · <Text style={{ color: canAfford ? theme.good : theme.bad, fontWeight: '900' }}>{cost.toLocaleString()} 💎</Text></Text>
        <Button label={stats.length === 0 ? '부위를 선택하세요' : canAfford ? '전지훈련 보내기 ▶' : '다이아 부족'} onPress={send} />
      </View>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  bal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginBottom: 6 },
  gem: { fontSize: 16 }, balN: { color: theme.text, fontSize: 18, fontWeight: '900' },
  prow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 11, marginTop: 6 },
  pname: { flex: 1, color: theme.text, fontSize: 15, fontWeight: '700' },
  psub: { color: theme.muted, fontSize: 13 },
  doneTag: { color: theme.muted, fontSize: 12, fontWeight: '800' },
  arrow: { color: theme.accent, fontSize: 22, fontWeight: '900' },
  phead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  pnameBig: { flex: 1, color: theme.text, fontSize: 20, fontWeight: '900' },
  change: { color: theme.accent, fontSize: 13, fontWeight: '700' },
  srow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10, marginTop: 4, borderWidth: 1, borderColor: 'transparent' },
  srowOn: { backgroundColor: theme.good + '18', borderColor: theme.good },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: theme.good, borderColor: theme.good },
  checkMk: { color: '#04150E', fontSize: 14, fontWeight: '900' },
  slabel: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  sval: { color: theme.text, fontSize: 13, fontWeight: '800', width: 70, textAlign: 'right' },
  spot: { color: theme.muted, fontSize: 12, width: 96, textAlign: 'right' },
  footer: { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10, gap: 6 },
  costTxt: { color: theme.text, fontSize: 14, fontWeight: '700', textAlign: 'center' },
}));
