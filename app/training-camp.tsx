// 전지훈련 (MONETIZATION §11.2 코스형, 2026-07-02) — 오프시즌 해외 캠프. 다이아로 선수 1명을 보내
// 5코스(공격/수비/블로킹/세터/서브) 중 하나로 관련 3스탯을 현재+2·포텐+7(최대 99). 선수당 오프시즌 1회.
// 오프시즌(currentDay 0)에만 — 재시뮬/소급 방지. 포텐 +7이 본체: 젊을수록 성장으로 실현되는 폭이 크다(H2).
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Muted, PosTag, Screen, theme, themedStyles } from '../components/Screen';
import { useGameStore } from '../store/useGameStore';
import { getPlayer, teamPlayerIds } from '../data/league';
import { CAMP_COURSES, CAMP_COURSE_COST, CAMP_CUR_GAIN, CAMP_POT_GAIN, courseUpgradable, type CampCourse } from '../engine/diamonds';
import type { Player, TrainableStat } from '../types';

const LABEL: Record<TrainableStat, string> = {
  jump: '점프력', agility: '민첩성', staminaMax: '체력', staminaRegen: '체젠',
  reaction: '반응속도', positioning: '위치선정', focus: '집중력', consistency: '기복', vq: 'VQ',
  skSpike: '공격기술', skBlock: '블로킹기술', skDig: '디그기술', skReceive: '리시브기술', skSet: '세팅기술', skServe: '서브기술',
};
const COURSE_KEYS: CampCourse[] = ['attack', 'defense', 'block', 'setter', 'serve'];

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
  const walletBusy = useGameStore((s) => s.walletBusy);
  const [picked, setPicked] = useState<string | null>(null);
  const [course, setCourse] = useState<CampCourse | null>(null);
  const [, force] = useState(0); // 적용 후 리렌더

  const offseason = currentDay === 0;
  const roster: Player[] = my ? teamPlayerIds(my).map((id) => getPlayer(id)).filter((p): p is Player => !!p) : [];
  const player = picked ? getPlayer(picked) : null;
  const canAfford = diamonds >= CAMP_COURSE_COST;

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
            선수 한 명을 특별훈련 코스로 보냅니다. 코스의 관련 능력치 3개가 <Text style={{ color: theme.good, fontWeight: '800' }}>현재 +{CAMP_CUR_GAIN} · 성장 한계(포텐) +{CAMP_POT_GAIN}</Text> (최대 99).{'\n'}
            • 코스당 <Text style={{ color: theme.good, fontWeight: '800' }}>{CAMP_COURSE_COST} 💎</Text> · 선수 1명당 오프시즌 1회 · 코스 1개{'\n'}
            • 포텐이 크게 열리므로 <Text style={{ color: theme.text, fontWeight: '700' }}>어린 선수일수록 효과가 큽니다</Text> — 이후 시즌 성장으로 실현 · 영구(환불 불가)
          </Muted>
        </Card>
        <IconLabel icon="people-outline" color={theme.accent}>선수 선택</IconLabel>
        {roster.map((p) => {
          const done = camped.includes(p.id);
          return (
            <Pressable key={p.id} disabled={done} onPress={() => { setPicked(p.id); setCourse(null); }}
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

  // ── 코스 선택 ──
  const cur = player as unknown as Record<string, number>;
  const send = async () => {
    if (!course || walletBusy) return;
    const r = await trainingCamp(player.id, course); // 서버 차감 확정 후에만 반영(BACKEND §13.12)
    if (r.ok) {
      Alert.alert('전지훈련 완료', `${player.name} 선수가 ${CAMP_COURSES[course].label}을 마치고 왔습니다. 열린 성장 한계는 이후 시즌 성장으로 실현됩니다.`);
      setPicked(null); setCourse(null); force((n) => n + 1);
    } else {
      Alert.alert(r.reason === 'offline' ? '온라인 연결 필요' : '전지훈련 불가',
        r.reason === 'no-diamonds' ? '다이아가 부족합니다.'
        : r.reason === 'offline' ? '다이아 사용(전지훈련)은 온라인 연결이 필요합니다. 네트워크 확인 후 다시 시도해 주세요.'
        : r.reason === 'busy' ? '처리 중입니다. 잠시만 기다려 주세요.'
        : r.reason === 'error' ? '전지훈련 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'
        : r.reason === 'already' ? '이 선수는 이번 오프시즌에 이미 다녀왔습니다.'
        : r.reason === 'not-offseason' ? '오프시즌에만 가능합니다.'
        : r.reason === 'maxed' ? '이 코스의 능력치가 모두 한계(99)입니다.'
        : '전지훈련을 보낼 수 없습니다.');
    }
  };

  return (
    <Screen title="전지훈련" scroll={false}>
      {balance}
      <View style={styles.phead}>
        <PosTag pos={player.position} />
        <Text style={styles.pnameBig} numberOfLines={1}>{player.name}</Text>
        <Text style={styles.psub}>{player.age}세</Text>
        <Pressable onPress={() => { setPicked(null); setCourse(null); }}><Text style={styles.change}>선수 변경</Text></Pressable>
      </View>
      <Muted style={{ fontSize: 12.5, marginBottom: 6 }}>코스를 선택하세요 — 관련 3개 능력치가 현재 +{CAMP_CUR_GAIN} · 포텐 +{CAMP_POT_GAIN}</Muted>
      <ScrollView style={{ flex: 1 }}>
        {COURSE_KEYS.map((key) => {
          const c = CAMP_COURSES[key];
          const on = course === key;
          const disabled = !courseUpgradable(player, key); // 3스탯 전부 현재·포텐 99
          const mismatch = !c.forPos.includes(player.position); // 포지션-코스 미스매치 경고(차단 아님 — 유저 자유)
          return (
            <Pressable key={key} disabled={disabled} onPress={() => setCourse(key)}
              style={({ pressed }) => [styles.crow, disabled && { opacity: 0.4 }, on && styles.crowOn, pressed && { opacity: 0.75 }]}>
              <View style={styles.chead}>
                <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMk}>✓</Text> : null}</View>
                <Text style={styles.clabel}>{c.label}</Text>
                <Text style={styles.cprice}>{CAMP_COURSE_COST.toLocaleString()} 💎</Text>
              </View>
              <Muted style={{ fontSize: 12, marginTop: 2, marginLeft: 32 }}>{c.desc}</Muted>
              <View style={styles.cstats}>
                {c.stats.map((s) => {
                  const v = cur[s]; const pot = player.potential[s] ?? v;
                  return (
                    <View key={s} style={styles.cstat}>
                      <Text style={styles.csname}>{LABEL[s]}</Text>
                      <Text style={styles.csval}>{v}{v < 99 ? <Text style={{ color: theme.good, fontWeight: '800' }}>→{Math.min(99, v + CAMP_CUR_GAIN)}</Text> : null}</Text>
                      <Text style={styles.cspot}>포텐 {pot}{pot < 99 ? <Text style={{ color: theme.good }}>→{Math.min(99, pot + CAMP_POT_GAIN)}</Text> : ''}</Text>
                    </View>
                  );
                })}
              </View>
              {mismatch ? (
                <Text style={styles.mismatch}>⚠ {player.position} 포지션과 결이 다른 코스입니다 — 보낼 수는 있어요</Text>
              ) : null}
            </Pressable>
          );
        })}
        <View style={{ height: 12 }} />
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.costTxt}>
          {course ? CAMP_COURSES[course].label : '코스 미선택'} · <Text style={{ color: canAfford ? theme.good : theme.bad, fontWeight: '900' }}>{CAMP_COURSE_COST.toLocaleString()} 💎</Text>
        </Text>
        <Button label={walletBusy ? '보내는 중…' : !course ? '코스를 선택하세요' : canAfford ? '전지훈련 보내기 ▶' : '다이아 부족'} onPress={send} disabled={walletBusy || !course} />
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
  crow: { backgroundColor: theme.card, borderRadius: 14, borderWidth: 1.5, borderColor: theme.border, padding: 12, marginTop: 8 },
  crowOn: { backgroundColor: theme.good + '14', borderColor: theme.good },
  chead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: theme.good, borderColor: theme.good },
  checkMk: { color: '#04150E', fontSize: 14, fontWeight: '900' },
  clabel: { flex: 1, color: theme.text, fontSize: 15.5, fontWeight: '800' },
  cprice: { color: theme.text, fontSize: 13, fontWeight: '800' },
  cstats: { flexDirection: 'row', gap: 8, marginTop: 8, marginLeft: 32 },
  cstat: { flex: 1, backgroundColor: theme.cardAlt, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, gap: 1 },
  csname: { color: theme.muted, fontSize: 11, fontWeight: '700' },
  csval: { color: theme.text, fontSize: 13, fontWeight: '800' },
  cspot: { color: theme.muted, fontSize: 11 },
  mismatch: { color: theme.warn, fontSize: 11.5, marginTop: 7, marginLeft: 32, fontWeight: '600' },
  footer: { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10, gap: 6 },
  costTxt: { color: theme.text, fontSize: 14, fontWeight: '700', textAlign: 'center' },
}));
