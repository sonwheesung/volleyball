// 마이페이지 — 구단주의 개인 허브(2026-06-30 네비 개편, 구 "기록" 탭 대체).
// 핵심 게임플레이(구단·일정·선수단·단장실)와 별개인 "애매한 항목"을 한곳에: 기록·업적·설정·튜토리얼.
// 기록 본문은 무거워 스택 화면(/records-archive)으로 분리 — 여기선 진입점만(허브는 가볍게).
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, type ComponentProps } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Muted, Screen, theme, themedStyles } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { useGameStore } from '../../store/useGameStore';
import { useAuthStore } from '../../store/useAuthStore';
import { AD_REWARD, AD_DAILY_CAP, canWatchAd } from '../../engine/diamonds';
import { DEV_TOOLS } from '../../data/flags';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function LinkCard({ icon, tint, title, sub, onPress }: { icon: IoniconName; tint: string; title: string; sub: string; onPress: () => void }) {
  return (
    <Card accent={tint} onPress={onPress}>
      <View style={styles.row}>
        <View style={[styles.iconChip, { backgroundColor: tint + '22' }]}>
          <Ionicons name={icon} size={20} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Muted style={{ fontSize: 12.5, marginTop: 1 }}>{sub}</Muted>
        </View>
        <Text style={styles.arrow}>›</Text>
      </View>
    </Card>
  );
}

export default function MyPage() {
  const router = useRouter();
  const diamonds = useGameStore((s) => s.diamonds);
  const watchAdForDiamonds = useGameStore((s) => s.watchAdForDiamonds);
  const claimAchDiamonds = useGameStore((s) => s.claimAchDiamonds);
  const adState = useGameStore((s) => s.adState);
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const version = (Constants.expoConfig?.version as string) ?? '0.1.0';

  const accountLabel = session
    ? session.displayName || (session.provider === 'dev' ? '개발자 계정' : session.provider === 'google' ? 'Google 계정' : session.provider === 'apple' ? 'Apple 계정' : '계정')
    : null;
  const confirmLogout = () => {
    Alert.alert('로그아웃', '로그아웃하시겠어요? 다시 로그인하면 다이아·구매 내역이 그대로 복원됩니다.', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => signOut() }, // 세션 제거 → BootGate가 로그인 벽으로 전환
    ]);
  };

  // 광고 쿨다운 실시간 표시(MONETIZATION §11.1) — 1초 틱으로 남은 시간 카운트다운. Date.now()는 UI 런타임(엔진/시드 무관).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const adAvail = canWatchAd(adState, now);
  const fmtLeft = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`; };

  // 광고 보고 다이아(MONETIZATION §11.1) — AdMob은 EAS 후 lib/ads 연결, 지금은 스텁(즉시 지급)으로 로컬 테스트.
  const watchAd = () => {
    const r = watchAdForDiamonds();
    if (r.ok) Alert.alert('광고 시청 완료', `+${r.reward} 💎 적립되었습니다.`);
    else Alert.alert('잠시 후 다시', r.reason === 'cap' ? '오늘 광고 보상은 모두 받았어요(하루 8회). 내일 다시 와주세요.' : '다음 광고까지 잠시 기다려 주세요(30분 간격).');
  };
  const claimAch = () => {
    const got = claimAchDiamonds();
    Alert.alert(got > 0 ? '업적 보상 수령' : '수령할 보상 없음', got > 0 ? `달성 업적 보상 +${got} 💎` : '새로 달성한 업적이 없습니다.');
  };

  return (
    <Screen>
      {/* ── 다이아 (MONETIZATION §11) — 전지훈련 재화 ── */}
      <Card accent={theme.sky}>
        <View style={styles.row}>
          <View style={[styles.iconChip, { backgroundColor: theme.sky + '22' }]}><Text style={{ fontSize: 20 }}>💎</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>다이아 {diamonds.toLocaleString()}</Text>
            <Muted style={{ fontSize: 12.5, marginTop: 1 }}>전지훈련으로 선수 능력을 키웁니다</Muted>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Pressable onPress={watchAd} disabled={!adAvail.ok} style={[styles.diaBtn, !adAvail.ok && { opacity: 0.5 }]}>
            <Text style={styles.diaBtnTxt}>
              {adAvail.ok ? `📺 광고 보고 +${AD_REWARD} 💎`
                : adAvail.reason === 'cap' ? `오늘 광고 끝 (하루 ${AD_DAILY_CAP}회)`
                : `⏳ ${fmtLeft(adAvail.msLeft)} 후`}
            </Text>
          </Pressable>
          <Pressable onPress={claimAch} style={styles.diaBtn}><Text style={styles.diaBtnTxt}>🏅 업적 보상 받기</Text></Pressable>
        </View>
        {DEV_TOOLS ? (
          <Pressable onPress={() => useGameStore.setState({ diamonds: diamonds + 1000 })} style={{ alignItems: 'center', paddingTop: 8 }}>
            <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700' }}>＋1000 💎 (개발용)</Text>
          </Pressable>
        ) : null}
      </Card>
      <LinkCard icon="airplane-outline" tint={theme.good} title="전지훈련"
        sub="오프시즌 — 다이아로 선수 능력 강화"
        onPress={() => router.push('/training-camp')} />

      <LinkCard icon="bag-handle-outline" tint={theme.sky} title="상점"
        sub="다이아 구매 · 광고 제거 · 월드컵 시즌 · 구매 복원"
        onPress={() => router.push('/shop')} />

      <SpotlightTarget id="history-top">
        <LinkCard icon="trophy-outline" tint={theme.gold} title="기록"
          sub="시즌 · 통산 리더보드 · 명예의전당 · 연표"
          onPress={() => router.push('/records-archive')} />
      </SpotlightTarget>

      <SpotlightTarget id="history-ach">
        <LinkCard icon="ribbon-outline" tint={theme.warn} title="업적"
          sub="구단주의 발자취 — 우승 · 시상 · 레전드 · 기록 · 운영"
          onPress={() => router.push('/achievements')} />
      </SpotlightTarget>

      <LinkCard icon="settings-outline" tint={theme.accent} title="설정"
        sub="효과음 · 세이브 관리 · 버전"
        onPress={() => router.push('/settings')} />

      <LinkCard icon="chatbubble-ellipses-outline" tint={theme.sky} title="문의하기"
        sub="오류 · 건의 · 질문 — 최근 기록 진단 정보 자동 첨부"
        onPress={() => router.push('/support')} />

      {/* ── 계정 · 로그아웃 (최하단) ── */}
      {session ? (
        <View style={{ marginTop: 18, gap: 8 }}>
          <Muted style={{ fontSize: 12, textAlign: 'center' }}>{accountLabel}(으)로 로그인됨</Muted>
          <Pressable onPress={confirmLogout} style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}>
            <Ionicons name="log-out-outline" size={18} color={theme.bad} />
            <Text style={styles.logoutTxt}>로그아웃</Text>
          </Pressable>
        </View>
      ) : null}

      <Muted style={{ fontSize: 11.5, textAlign: 'center', marginTop: 14 }}>배구명가 v{version}</Muted>
      <SpotlightOverlay screen="tab-mypage" />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconChip: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.text, fontSize: 16, fontWeight: '800' },
  arrow: { color: theme.accent, fontSize: 24, fontWeight: '900' },
  diaBtn: { flex: 1, backgroundColor: theme.cardAlt, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  diaBtnTxt: { color: theme.text, fontSize: 13, fontWeight: '800' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 22, borderRadius: 11, borderWidth: 1, borderColor: theme.bad + '55', backgroundColor: theme.bad + '12' },
  logoutTxt: { color: theme.bad, fontSize: 13.5, fontWeight: '800' },
}));
