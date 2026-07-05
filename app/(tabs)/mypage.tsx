// 마이페이지 — 구단주의 개인 허브(2026-06-30 네비 개편, 구 "기록" 탭 대체).
// 핵심 게임플레이(구단·일정·선수단·단장실)와 별개인 "애매한 항목"을 한곳에: 기록·업적·설정·튜토리얼.
// 기록 본문은 무거워 스택 화면(/records-archive)으로 분리 — 여기선 진입점만(허브는 가볍게).
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { showAlert } from '../../components/AppDialog';
import { Card, Muted, Screen, theme, themedStyles } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { useGameStore } from '../../store/useGameStore';
import { useAuthStore } from '../../store/useAuthStore';
import { AD_REWARD, AD_DAILY_CAP, canWatchAd, unclaimedReward } from '../../engine/diamonds';
import { evalAchievements } from '../../engine/achievements';
import { achTotals } from '../../data/careerTotals';
import { DEV_TOOLS, WORLDCUP_ENABLED } from '../../data/flags';
import { logError } from '../../lib/log';

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
  const walletBusy = useGameStore((s) => s.walletBusy);
  const adState = useGameStore((s) => s.adState);
  // 수령 가능한 업적 보상 유무 — 없으면 버튼 비활성(색·무동작). achTotals로 시즌중 통산 업적도 반영.
  const myTeamId = useGameStore((s) => s.selectedTeamId) ?? '';
  const archive = useGameStore((s) => s.archive);
  const hof = useGameStore((s) => s.hallOfFame);
  const milestones = useGameStore((s) => s.milestones);
  const cash = useGameStore((s) => s.cash);
  const fanScore = useGameStore((s) => s.fanScore);
  const careerLog = useGameStore((s) => s.careerLog);
  const careerTotals = useGameStore((s) => s.careerTotals);
  const results = useGameStore((s) => s.results);
  const claimedAch = useGameStore((s) => s.claimedAch);
  const unclaimedCount = useMemo(() => {
    if (!myTeamId) return 0;
    const statuses = evalAchievements({ myTeamId, archive, hof, milestones, cash, fanScore, careerLog, careerTotals: achTotals(myTeamId, careerTotals, results) });
    return unclaimedReward(statuses, claimedAch).ids.length;
  }, [myTeamId, archive, hof, milestones, cash, fanScore, careerLog, careerTotals, results, claimedAch]);
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const version = (Constants.expoConfig?.version as string) ?? '0.1.0';

  const accountLabel = session
    ? session.displayName || (session.provider === 'dev' ? '개발자 계정' : session.provider === 'google' ? 'Google 계정' : session.provider === 'apple' ? 'Apple 계정' : '계정')
    : null;
  const confirmLogout = () => {
    showAlert('로그아웃', '로그아웃하시겠어요? 다시 로그인하면 다이아·구매 내역이 그대로 복원됩니다.', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => signOut() }, // 세션 제거 → BootGate가 로그인 벽으로 전환
    ]);
  };

  // 광고 쿨다운 실시간 표시(MONETIZATION §11.1) — 1초 틱으로 남은 시간 카운트다운. Date.now()는 UI 런타임(엔진/시드 무관).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const adAvail = canWatchAd(adState, now);
  const fmtLeft = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`; };

  // 광고 보고 다이아(MONETIZATION §11.1) — 서버 확정 후 캐시 갱신(BACKEND §13.12). AdMob SSV는 EAS 후.
  const watchAd = async () => {
    const r = await watchAdForDiamonds();
    if (r.ok) showAlert('광고 시청 완료', `+${r.reward} 💎 적립되었습니다.`);
    else showAlert(
      r.reason === 'offline' ? '온라인 연결 필요' : r.reason === 'no-ad' ? '광고 준비 안 됨' : '잠시 후 다시',
      r.reason === 'cap' ? '오늘 광고 보상은 모두 받았어요(하루 8회). 내일 다시 와주세요.'
        : r.reason === 'offline' ? '다이아 적립은 온라인 연결이 필요합니다. 네트워크 확인 후 다시 시도해 주세요.'
        : r.reason === 'no-ad' ? '지금은 광고를 불러오지 못했어요. 잠시 후 다시 시도해 주세요(끝까지 봐야 적립됩니다).'
        : r.reason === 'busy' ? '처리 중입니다. 잠시만 기다려 주세요.'
        : r.reason === 'error' ? '적립에 실패했습니다. 잠시 후 다시 시도해 주세요.'
        : '다음 광고까지 잠시 기다려 주세요(30분 간격).');
  };
  const claimAch = async () => {
    const r = await claimAchDiamonds();
    if (r.granted > 0) showAlert('업적 보상 수령', `달성 업적 보상 +${r.granted} 💎`);
    else if (r.reason === 'offline') showAlert('온라인 연결 필요', '업적 보상 수령은 온라인 연결이 필요합니다. 네트워크 확인 후 다시 시도해 주세요.');
    else if (r.reason === 'busy') showAlert('처리 중', '잠시만 기다려 주세요.');
    else showAlert('수령할 보상 없음', '새로 달성한 업적이 없습니다.');
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
          <Pressable onPress={watchAd} disabled={!adAvail.ok || walletBusy} style={[styles.diaBtn, (!adAvail.ok || walletBusy) && { opacity: 0.5 }]}>
            <Text style={styles.diaBtnTxt}>
              {adAvail.ok ? `📺 광고 보고 +${AD_REWARD} 💎`
                : adAvail.reason === 'cap' ? `오늘 광고 끝 (하루 ${AD_DAILY_CAP}회)`
                : `⏳ ${fmtLeft(adAvail.msLeft)} 후`}
            </Text>
          </Pressable>
          <Pressable onPress={claimAch} disabled={walletBusy || unclaimedCount === 0} style={[styles.diaBtn, (walletBusy || unclaimedCount === 0) && styles.diaBtnOff]}>
            <Text style={[styles.diaBtnTxt, unclaimedCount === 0 && styles.diaBtnTxtOff]}>{unclaimedCount > 0 ? `🏅 업적 보상 받기 (${unclaimedCount})` : '🏅 받을 보상 없음'}</Text>
          </Pressable>
        </View>
        {DEV_TOOLS ? (
          <View style={{ paddingTop: 8, gap: 6 }}>
            <Pressable onPress={() => useGameStore.setState({ diamonds: diamonds + 1000 })} style={{ alignItems: 'center' }}>
              <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700' }}>＋1000 💎 (개발용)</Text>
            </Pressable>
            {/* 에러 캡처 파이프라인 검증(§13.20 ④) — logError 경로 / 미처리 예외 경로 각각 */}
            <Pressable onPress={() => logError('dev-test', new Error('의도적 logError 테스트 — 진단버퍼 캡처 확인'))} style={{ alignItems: 'center' }}>
              <Text style={{ color: theme.warn, fontSize: 12, fontWeight: '700' }}>🧪 logError 캡처 테스트</Text>
            </Pressable>
            <Pressable onPress={() => { setTimeout(() => { throw new Error('의도적 미처리 예외 크래시 테스트 — 전역 핸들러 확인'); }, 0); }} style={{ alignItems: 'center' }}>
              <Text style={{ color: theme.bad, fontSize: 12, fontWeight: '700' }}>🧪 미처리 예외 크래시 테스트</Text>
            </Pressable>
          </View>
        ) : null}
      </Card>
      {/* ── 자주 보는 것 (공지·상점·기록·업적) ── */}
      <LinkCard icon="megaphone-outline" tint={theme.accent} title="공지사항"
        sub="업데이트 · 이벤트 · 안내"
        onPress={() => router.push('/announcements')} />

      <LinkCard icon="bag-handle-outline" tint={theme.sky} title="상점"
        sub={WORLDCUP_ENABLED ? '다이아 구매 · 광고 제거 · 월드컵 시즌 · 구매 복원' : '다이아 구매 · 광고 제거 · 구매 복원'}
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

      {/* ── 재화 · 가이드 ── */}
      <LinkCard icon="pricetag-outline" tint={theme.gold} title="쿠폰 입력"
        sub="쿠폰 코드를 입력하고 다이아를 받으세요"
        onPress={() => router.push('/coupon')} />

      <LinkCard icon="book-outline" tint={theme.accent} title="게임 가이드"
        sub="경기 · 선수 · FA · 드래프트 등 핵심 개념"
        onPress={() => router.push('/guide')} />

      {/* ── 도움 · 약관 (하단) ── */}
      <LinkCard icon="chatbubble-ellipses-outline" tint={theme.sky} title="문의하기"
        sub="오류 · 건의 · 질문 — 최근 기록 진단 정보 자동 첨부"
        onPress={() => router.push('/support')} />

      <LinkCard icon="document-text-outline" tint={theme.muted} title="이용약관"
        sub="서비스 이용 조건 · 결제 · 환불 안내"
        onPress={() => router.push('/terms')} />

      <LinkCard icon="shield-checkmark-outline" tint={theme.muted} title="운영정책"
        sub="문의 · 환불 기준 · 제재 · 데이터 운영"
        onPress={() => router.push('/policy')} />

      <LinkCard icon="lock-closed-outline" tint={theme.muted} title="개인정보처리방침"
        sub="수집 항목 · 목적 · 보관 · 위탁 · 이용자 권리"
        onPress={() => router.push('/privacy')} />

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
  diaBtnOff: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, opacity: 0.6 }, // 수령 불가 — 회색 비활성
  diaBtnTxtOff: { color: theme.muted },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 22, borderRadius: 11, borderWidth: 1, borderColor: theme.bad + '55', backgroundColor: theme.bad + '12' },
  logoutTxt: { color: theme.bad, fontSize: 13.5, fontWeight: '800' },
}));
