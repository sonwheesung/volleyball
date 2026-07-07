// 전지훈련 (MONETIZATION §11.2 코스형, 2026-07-02) — 오프시즌 해외 캠프. 다이아로 선수 1명을 보내
// 5코스(공격/수비/블로킹/세터/서브) 중 하나로 관련 3스탯을 현재+3·포텐+3(최대 99 — 2026-07-08 사용자 결정 +2/+7→+3/+3 대칭). 선수당 오프시즌 1회.
// 오프시즌(currentDay 0)에만 — 재시뮬/소급 방지. 현재·포텐 대칭(+3/+3) — 즉효 체감과 성장 여지를 함께(기구매는 레거시 +2/+7 보존, cur/pot 내장).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { showAlert } from '../components/AppDialog';
import { BusyOverlay, useBusyRun } from '../components/BusyOverlay';
import { Button, Card, IconLabel, Muted, PosTag, Screen, theme, themedStyles } from '../components/Screen';
import { RoleBadge } from '../components/RoleBadge';
import { useGameStore } from '../store/useGameStore';
import { getPlayer, teamPlayerIds } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { buildLineup } from '../engine/lineup';
import { overall } from '../engine/overall';
import { POS_ORDER } from '../components/posTokens';
import { CAMP_COURSES, CAMP_COURSE_COST, CAMP_CUR_GAIN, CAMP_POT_GAIN, WELCOME_DIAMONDS, courseUpgradable, type CampCourse } from '../engine/diamonds';
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
  // 무거운 작업 마스킹(UI-27): finishCamp+귀환(base 재계산)=동기 → useBusyRun, 전지훈련 보내기(서버 차감)=비동기 → sending 로컬 state.
  const busy = useBusyRun();
  const [sending, setSending] = useState<string | null>(null);
  // 스케줄 오프시즌 게이트에서 진입(비-chain) — 캠프를 마치면 campDoneSeason 세팅 → 스케줄에 개막전(다음 경기) 노출(2026-07-04).
  const finishToOpener = () => {
    showAlert('전지훈련 마치기', '전지훈련을 마치고 개막전을 시작할까요?\n이후에는 이번 시즌 전지훈련을 보낼 수 없어요.', [
      { text: '더 훈련하기', style: 'cancel' },
      { text: '마치고 개막전으로', onPress: () => busy.run('선수들이 전지훈련에서 구슬땀을 흘리고 있습니다…', () => { finishCamp(); router.back(); }) },
    ]);
  };
  const my = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const diamonds = useGameStore((s) => s.diamonds);
  const camped = useGameStore((s) => s.campTrainedThisOffseason);
  const trainingCamp = useGameStore((s) => s.trainingCamp);
  const finishCamp = useGameStore((s) => s.finishCamp);
  const walletBusy = useGameStore((s) => s.walletBusy);
  const claimWelcomeDiamonds = useGameStore((s) => s.claimWelcomeDiamonds);
  const [picked, setPicked] = useState<string | null>(null);
  const [course, setCourse] = useState<CampCourse | null>(null);
  const [, force] = useState(0); // 적용 후 리렌더

  // 2단계 뒤로가기(2026-07-07 버그수정): 코스 화면(picked!==null)에서 ← / 안드로이드 하드웨어백 / iOS 제스처백은
  //   화면을 pop(일정으로 이탈)하지 말고 선수 목록으로 돌아가야 한다. beforeRemove로 뒤로가기 액션만 가로챈다.
  //   staleness 함정: 리스너 클로저가 초기 picked(null)만 보면 안 됨 → pickedRef를 매 렌더 최신화해 리스너가 fresh 값을 읽는다.
  //   chain 흐름(goNext=router.replace)은 REPLACE 액션이라 미개입(GO_BACK/POP만 가로챔) — 개막전/헌액 진행 안 막힘.
  const navigation = useNavigation();
  const pickedRef = useRef<string | null>(null);
  pickedRef.current = picked;
  // 체인 모드(오프시즌 진행): 헤더 뒤로가기 버튼·iOS 엣지 제스처를 숨겨 소비된 스택(드래프트/FA)으로의 이탈을 원천 차단.
  //   비-chain(마이페이지·스케줄 게이트)은 기존대로 노출 — 2단계 뒤로가기 동작 유지.
  useEffect(() => {
    (navigation as any).setOptions({ headerBackVisible: !inChain, gestureEnabled: !inChain });
  }, [navigation, inChain]);
  useEffect(() => {
    const unsub = (navigation as any).addListener('beforeRemove', (e: any) => {
      const t = e?.data?.action?.type;
      if (t !== 'GO_BACK' && t !== 'POP') return; // REPLACE(goNext)·POP_TO_TOP는 통과 — 개막전/헌액 진행 안 막힘
      if (inChain) { e.preventDefault(); return; } // 체인 모드: 뒤로가기 전면 무력화(picked 무관 — 소비된 스택 잔재 이탈 차단)
      if (pickedRef.current !== null) { // 비-chain 2단계: 코스 화면 → 선수 목록으로(일정 이탈 방지)
        e.preventDefault();
        setPicked(null);
        setCourse(null);
      }
    });
    return unsub;
  }, [navigation, inChain]);

  // 첫 전지훈련 진입 환영 선물(계정당 1회, 서버 멱등) — 신규 유저가 다이아 0이라 온보딩이 막히던 문제 해결.
  //   applied=true(첫 지급)일 때만 팝업. 오프라인이면 다음 온라인 진입에서 재시도(서버가 진실).
  const welcomeTried = useRef(false);
  useEffect(() => {
    if (welcomeTried.current) return;
    welcomeTried.current = true;
    void (async () => {
      const r = await claimWelcomeDiamonds();
      if (r.applied) {
        showAlert('환영 선물 🎁', `환영합니다! 전지훈련에 쓸 다이아 ${WELCOME_DIAMONDS.toLocaleString()}💎를 드립니다.\n마음에 드는 선수를 골라 능력을 키워보세요.`);
      }
    })();
  }, [claimWelcomeDiamonds]);

  const offseason = currentDay === 0;
  const roster: Player[] = my ? teamPlayerIds(my).map((id) => getPlayer(id)).filter((p): p is Player => !!p) : [];
  const player = picked ? getPlayer(picked) : null;
  const canAfford = diamonds >= CAMP_COURSE_COST;

  // 예상 주전/리베로 — 개막전이 실제로 쓰는 라인업(engine/lineup.buildLineup)을 그날(오프시즌=day0) 출전 가능
  // 로스터에 적용해 도출 → 신규 유저가 "누구에게 다이아를 쓸지"를 진실되게 판단(squad.tsx와 동일 경로).
  // availableTeamPlayers는 스토어 스냅샷(dyn())을 읽어 오프시즌 동안 정적 → my 기준으로만 memo.
  const roleOf = useMemo(() => {
    const map: Record<string, '주전' | '리베로'> = {};
    if (my) {
      const avail = availableTeamPlayers(my, 0);
      if (avail.length) {
        const lu = buildLineup(avail);
        for (const p of lu.six) map[p.id] = '주전';
        if (lu.libero) map[lu.libero.id] = '리베로';
      }
    }
    return map;
  }, [my]);
  const isStarter = (id: string) => roleOf[id] === '주전' || roleOf[id] === '리베로';
  // 정렬: 주전+리베로를 한 그룹으로 위에(주전 먼저 → 포지션순), 벤치를 아래에(포지션순). 기존 행 스타일은 유지.
  const sortedRoster = useMemo(
    () => [...roster].sort((a, b) => {
      const ga = isStarter(a.id) ? 0 : 1, gb = isStarter(b.id) ? 0 : 1;
      if (ga !== gb) return ga - gb;
      return POS_ORDER[a.position] - POS_ORDER[b.position] || overall(b) - overall(a);
    }),
    [roster, roleOf], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const firstBenchIdx = sortedRoster.findIndex((p) => !isStarter(p.id));
  const showGroups = firstBenchIdx > 0; // 주전·벤치가 둘 다 있을 때만 구분 라벨

  const balance = (
    <View style={styles.bal}><Text style={styles.gem}>💎</Text><Text style={styles.balN}>{diamonds.toLocaleString()}</Text></View>
  );
  // 무거운 작업 오버레이(UI-27) — 어느 오프시즌 화면(선수목록=finish / 코스=send)에서 눌러도 뜨도록 각 return에 배치.
  const busyOverlay = <BusyOverlay visible={busy.busy || !!sending} message={busy.message || sending || ''} />;

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
        {busyOverlay}
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
            선수 한 명을 코스 하나로 보내면, 관련 능력치 3개에 두 가지가 함께 붙습니다.{'\n'}
            ① <Text style={{ color: theme.good, fontWeight: '800' }}>지금 실력 +{CAMP_CUR_GAIN}</Text> — 아래 카드의 82→85처럼 바로 오릅니다.{'\n'}
            ② <Text style={{ color: theme.good, fontWeight: '800' }}>앞으로 클 수 있는 천장(포텐) +{CAMP_POT_GAIN}</Text> — 카드의 포텐 87→90(최대 99). 천장은 당장 오르는 게 아니라 <Text style={{ color: theme.text, fontWeight: '700' }}>다음 시즌부터 훈련·경기로 천천히 채워집니다.</Text>{'\n'}
            • 비용 <Text style={{ color: theme.good, fontWeight: '800' }}>{CAMP_COURSE_COST}💎</Text> · 선수 1명당 오프시즌 1회 · 어릴수록 천장 채울 시간이 많아 이득 · 효과는 영구(환불 불가)
          </Muted>
        </Card>
        <IconLabel icon="people-outline" color={theme.accent}>선수 선택</IconLabel>
        <Muted style={{ fontSize: 12.5, marginTop: 2, marginBottom: 2, lineHeight: 18 }}>
          <Text style={{ color: theme.good, fontWeight: '800' }}>주전</Text>은 출전이 많아 키운 실력이 성장으로 빨리 실현됩니다. 어린 벤치 선수는 훗날 주전을 꿰찰 재목일 때 값어치가 커요 — 누구에게 투자할지, 이 표시가 기준선입니다.
        </Muted>
        {sortedRoster.map((p, i) => {
          const done = camped.includes(p.id);
          const role = roleOf[p.id]; // '주전' | '리베로' | undefined(벤치)
          return (
            <View key={p.id}>
              {showGroups && i === 0 ? <Text style={styles.groupLabel}>주전</Text> : null}
              {showGroups && i === firstBenchIdx ? <Text style={styles.groupLabel}>벤치</Text> : null}
              <Pressable disabled={done} onPress={() => { setPicked(p.id); setCourse(null); }}
                style={({ pressed }) => [styles.prow, done && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}>
                <PosTag pos={p.position} />
                <Text style={styles.pname} numberOfLines={1}>{p.name}</Text>
                <RoleBadge role={role} />
                <Text style={styles.psub}>{p.age}세</Text>
                {done ? <Text style={styles.doneTag}>완료</Text> : <Text style={styles.arrow}>›</Text>}
              </Pressable>
            </View>
          );
        })}
        <View style={{ marginTop: 14 }}>
          {inChain
            ? <Button label="새 시즌으로 ▶" onPress={goNext} />
            : <Button label="전지훈련 마치고 개막전으로 →" onPress={finishToOpener} />}
        </View>
      </Screen>
    );
  }

  // ── 코스 선택 ──
  const cur = player as unknown as Record<string, number>;
  const send = async () => {
    if (!course || walletBusy || sending) return;
    setSending('코치진이 훈련 프로그램을 준비하는 중…'); // 서버 왕복(await) 동안 오버레이 유지(UI-27, 비동기 경로)
    let r: { ok: boolean; reason?: string };
    try {
      r = await trainingCamp(player.id, course); // 서버 차감 확정 후에만 반영(BACKEND §13.12)
    } finally {
      setSending(null);
    }
    if (r.ok) {
      showAlert('전지훈련 완료', `${player.name} 선수가 ${CAMP_COURSES[course].label}을 마치고 왔습니다. 열린 성장 한계는 이후 시즌 성장으로 실현됩니다.`);
      setPicked(null); setCourse(null); force((n) => n + 1);
    } else {
      showAlert(r.reason === 'offline' ? '온라인 연결 필요' : '전지훈련 불가',
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
      {busyOverlay}
      {balance}
      <View style={styles.phead}>
        <PosTag pos={player.position} />
        <Text style={styles.pnameBig} numberOfLines={1}>{player.name}</Text>
        <RoleBadge role={roleOf[player.id]} />
        <Text style={styles.psub}>{player.age}세</Text>
        <Pressable onPress={() => { setPicked(null); setCourse(null); }}><Text style={styles.change}>선수 변경</Text></Pressable>
      </View>
      <Muted style={{ fontSize: 12.5, marginBottom: 6 }}>코스 1개 선택 — 관련 3개 능력치: 지금 실력 +{CAMP_CUR_GAIN} · 성장 천장(포텐) +{CAMP_POT_GAIN}</Muted>
      <ScrollView style={{ flex: 1 }}>
        {/* 포지션에 맞는 코스만 노출(2026-07-05 사용자 결정) — 세터에게 공격훈련 등 결이 다른 코스는 숨긴다.
            모든 포지션이 ≥1개 적합 코스 보유(engine/diamonds forPos): S=세터·서브 / L=수비 / OH·OP·MB=다수. */}
        {COURSE_KEYS.filter((key) => CAMP_COURSES[key].forPos.includes(player.position)).map((key) => {
          const c = CAMP_COURSES[key];
          const on = course === key;
          const disabled = !courseUpgradable(player, key); // 3스탯 전부 현재·포텐 99
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
  groupLabel: { color: theme.muted, fontSize: 12, fontWeight: '700', marginTop: 8, marginLeft: 2 },
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
