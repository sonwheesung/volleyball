// 마이페이지 — 구단주의 개인 허브(2026-06-30 네비 개편, 구 "기록" 탭 대체).
// 핵심 게임플레이(구단·일정·선수단·단장실)와 별개인 "애매한 항목"을 한곳에: 공지·상점·업적·설정·튜토리얼.
// 기록(records-archive)은 홈 탭 "리그 기록" 카드로 이동(2026-07-21 — 접근성). 스택 화면 /records-archive는 그대로, 진입점만 홈.
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { ActivityIndicator, InteractionManager, Pressable, StyleSheet, Text, View } from 'react-native';
import { showAlert } from '../../components/AppDialog';
import { Card, Muted, Screen, theme, themedStyles } from '../../components/Screen';
import { NegativeBalanceNote } from '../../components/NegativeBalanceNote';
import { SpotlightOverlay } from '../../components/Spotlight';
import { useGameStore } from '../../store/useGameStore';
import { useAuthStore } from '../../store/useAuthStore';
import { readDevnotesCache, refreshDevnotes } from '../devnotes';
import { useIsFocused } from '@react-navigation/native';
import { AD_REWARD, AD_DAILY_CAP, canWatchAd, unclaimedReward } from '../../engine/diamonds';
import { evalAchievements } from '../../engine/achievements';
import { achTotals } from '../../data/careerTotals';
import { DEV_TOOLS, WORLDCUP_ENABLED } from '../../data/flags';
import { logError } from '../../lib/log';
import { hasRemoveAds } from '../../lib/ads';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function LinkCard({ icon, tint, title, sub, onPress, badge, dot }: { icon: IoniconName; tint: string; title: string; sub: string; onPress: () => void; badge?: number; dot?: boolean }) {
  return (
    <Card accent={tint} onPress={onPress}>
      <View style={styles.row}>
        <View style={[styles.iconChip, { backgroundColor: tint + '22' }]}>
          <Ionicons name={icon} size={20} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          {/* 빨간 점을 제목 오른쪽에(2026-07-29 테스터: 우측 끝이 아니라 텍스트 옆). 숫자 배지(우편·개발자노트)는 우측 유지. */}
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            {dot ? <View style={styles.titleDot} /> : null}
          </View>
          <Muted style={{ fontSize: 12.5, marginTop: 1 }}>{sub}</Muted>
        </View>
        {badge && badge > 0 ? (
          <View style={styles.badge}><Text style={styles.badgeTxt}>{badge > 99 ? '99+' : badge}</Text></View>
        ) : null}
        <Text style={styles.arrow}>›</Text>
      </View>
    </Card>
  );
}

export default function MyPage() {
  const router = useRouter();
  const diamonds = useGameStore((s) => s.diamonds);
  const unreadMailCount = useGameStore((s) => s.unreadMailCount);
  const unclaimedMailCount = useGameStore((s) => s.unclaimedMailCount);
  const watchAdForDiamonds = useGameStore((s) => s.watchAdForDiamonds);
  const syncWallet = useGameStore((s) => s.syncWallet); // 보유 다이아 수동 새로고침(쿠폰 등 갱신 안 될 때, Task4)
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
  const resetSave = useGameStore((s) => s.resetSave);
  const replayOnboarding = useGameStore((s) => s.replayOnboarding);
  // 미수령 업적 수 — **비동기(페인트 후) 계산**(Task2 fix): achTotals는 콜드 시 production+standings 리플레이(폰 ~20~30s)라
  //   렌더 동기 useMemo면 마이페이지 진입이 프리즈했다. InteractionManager로 상호작용 후 계산 → 빨간 점은 한 박자 뒤 뜬다(무해).
  const [unclaimedCount, setUnclaimedCount] = useState(0);
  useEffect(() => {
    if (!myTeamId) { setUnclaimedCount(0); return; }
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      const statuses = evalAchievements({ myTeamId, archive, hof, milestones, cash, fanScore, careerLog, careerTotals: achTotals(myTeamId, careerTotals, results) });
      if (!cancelled) setUnclaimedCount(unclaimedReward(statuses, claimedAch).ids.length);
    });
    return () => { cancelled = true; task.cancel(); };
  }, [myTeamId, archive, hof, milestones, cash, fanScore, careerLog, careerTotals, results, claimedAch]);
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const version = (Constants.expoConfig?.version as string) ?? '0.1.0';

  // 개발자 노트 안읽음 배지(DEVNOTES §3.1) — 캐시 먼저(즉시) → 온라인 갱신(진입 시). 게시글 id 중 readDevnotes에 없는 개수.
  const readDevnotes = useAuthStore((s) => s.readDevnotes);
  const [devnoteIds, setDevnoteIds] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readDevnotesCache();
      if (alive && cached) setDevnoteIds(cached.map((d) => d.id));
      const fresh = await refreshDevnotes();
      if (alive && fresh) setDevnoteIds(fresh.map((d) => d.id));
    })();
    return () => { alive = false; };
  }, []);
  const devnoteUnread = useMemo(() => {
    const read = new Set(readDevnotes);
    return devnoteIds.filter((id) => !read.has(id)).length;
  }, [devnoteIds, readDevnotes]);

  const accountLabel = session
    ? session.displayName || (session.provider === 'dev' ? '개발자 계정' : session.provider === 'google' ? 'Google 계정' : session.provider === 'apple' ? 'Apple 계정' : '계정')
    : null;
  const confirmLogout = () => {
    showAlert('로그아웃', '로그아웃하시겠어요?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => signOut() }, // 세션 제거 → BootGate가 로그인 벽으로 전환
    ]);
  };
  // 개발용 — 첫 진입(온보딩)부터 다시 체험. 파괴적이라 showAlert(커스텀 다이얼로그, UI-21) 확인 후에만.
  const confirmResetToOnboarding = () => {
    showAlert('게임 초기화 (개발용)', '게임을 초기화하고 온보딩부터 다시 시작합니다. 진행 상황이 사라집니다. (개발용)', [
      { text: '취소', style: 'cancel' },
      { text: '초기화', style: 'destructive', onPress: () => {
        resetSave(); // 세이브 초기화(selectedTeamId=null, seenTips 비움 → 스포트라이트 재생). onboarded·claimedAch는 보존됨.
        // resetSave가 claimedAch를 보존하므로 그 뒤에 환영 다이아 센티넬을 제거 → 개발 환영 지급이 다시 트리거되게.
        useGameStore.setState((s) => ({ claimedAch: s.claimedAch.filter((id) => id !== '__welcome_local__') }));
        replayOnboarding(); // onboarded=false → (tabs) 게이트가 온보딩 인트로로. 첫 진입 완전 재현.
        router.replace('/onboarding'); // 진짜 첫 화면(설정 "튜토리얼 다시보기"와 동일 타깃)
      } },
    ]);
  };

  // 광고 쿨다운 실시간 표시(MONETIZATION §11.1) — 1초 틱으로 남은 시간 카운트다운. Date.now()는 UI 런타임(엔진/시드 무관).
  // 발열 검수(2026-07-15): 탭 화면은 방문 후 계속 마운트라 무게이트 [] 틱은 **다른 탭에 있어도 매초 전체 리렌더**를
  // 영구 구동(상시 JS 웨이크업 = 대기 발열 기여). 포커스 중 + 실제 카운트다운 중일 때만 틱.
  const isFocused = useIsFocused();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (isFocused) setNow(Date.now()); }, [isFocused]); // 복귀 시 즉시 갱신(틱 없이도 최신)
  const adAvail = canWatchAd(adState, now);
  const counting = isFocused && !adAvail.ok && adAvail.reason === 'cooldown'; // 쿨다운 표시 중일 때만 초침 필요
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [counting]);
  const fmtLeft = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`; };

  // 광고 보고 다이아(MONETIZATION §11.1) — 서버 확정 후 캐시 갱신(BACKEND §13.12). AdMob SSV는 EAS 후.
  const watchAd = async () => {
    const r = await watchAdForDiamonds();
    // remove_ads 구매자는 광고 없이 즉시 수령(§3.2) — 성공 문구도 "시청 완료" 대신 중립적으로.
    if (r.ok) showAlert(hasRemoveAds() ? '다이아 수령 완료' : '광고 시청 완료', `+${r.reward} 💎 적립되었습니다.`);
    else showAlert(
      r.reason === 'offline' ? '온라인 연결 필요' : r.reason === 'no-ad' ? '광고 준비 안 됨' : r.reason === 'cap' ? '오늘 광고 끝' : '잠시 후 다시',
      r.reason === 'cap' ? `오늘 광고 보상은 모두 받았어요(하루 ${AD_DAILY_CAP}회). 내일 다시 와주세요.`
        : r.reason === 'offline' ? '다이아 적립은 온라인 연결이 필요합니다. 네트워크 확인 후 다시 시도해 주세요.'
        : r.reason === 'no-ad' ? '지금은 광고를 불러오지 못했어요. 잠시 후 다시 시도해 주세요(끝까지 봐야 적립됩니다).'
        : r.reason === 'busy' ? '처리 중입니다. 잠시만 기다려 주세요.'
        : r.reason === 'error' ? '적립에 실패했습니다. 잠시 후 다시 시도해 주세요.'
        : '다음 광고까지 잠시 기다려 주세요(2시간 간격).'); // cooldown
  };
  // 보유 다이아 수동 새로고침(Task4) — 쿠폰/보상 후 캐시가 서버 잔액과 어긋날 때 사용자가 직접 재동기. 도는 동안 스피너.
  const [syncing, setSyncing] = useState(false);
  const refreshBalance = async () => {
    if (syncing) return;
    setSyncing(true);
    try { await syncWallet(); } finally { setSyncing(false); }
  };

  return (
    <Screen insetBottom={false}>
      {/* ── 다이아 (MONETIZATION §11) — 전지훈련 재화 ── */}
      <Card accent={theme.sky} flat>
        <View style={styles.row}>
          <View style={[styles.iconChip, { backgroundColor: theme.sky + '22' }]}><Text style={{ fontSize: 20 }}>💎</Text></View>
          <View style={{ flex: 1 }}>
            <Muted style={{ fontSize: 12.5 }}>보유 다이아</Muted>
            <Text style={styles.balance}>{diamonds.toLocaleString()}</Text>
          </View>
          {/* 새로고침(Task4) — 쿠폰/보상 후 잔액 갱신 안 될 때 서버 잔액 재동기 */}
          <Pressable onPress={refreshBalance} disabled={syncing} hitSlop={10} style={styles.refreshBtn} accessibilityLabel="보유 다이아 새로고침">
            {syncing ? <ActivityIndicator size="small" color={theme.sky} /> : <Ionicons name="refresh" size={20} color={theme.sky} />}
          </Pressable>
        </View>
        <NegativeBalanceNote balance={diamonds} />
        {/* 업적 보상은 여기서 일괄로 받지 않는다 → 업적 화면(카드별 보상받기 + 상단 일괄). 미수령 있으면 아래 업적 카드에 빨간 점. */}
        <Pressable onPress={watchAd} disabled={!adAvail.ok || walletBusy} style={[styles.diaBtn, { marginTop: 10 }, (!adAvail.ok || walletBusy) && styles.diaBtnOff]}>
          <Text style={[styles.diaBtnTxt, (!adAvail.ok || walletBusy) && styles.diaBtnTxtOff]}>
            {walletBusy ? '적립 중…'
              : adAvail.ok ? (hasRemoveAds() ? `💎 +${AD_REWARD} 받기 (광고 제거됨)` : `📺 광고 보고 +${AD_REWARD} 💎`)
              : adAvail.reason === 'cap' ? `오늘 광고 끝 (하루 ${AD_DAILY_CAP}회)`
              : `⏳ ${fmtLeft(adAvail.msLeft)} 후`}
          </Text>
        </Pressable>
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
            {/* 첫 진입(온보딩) 재현 — 세이브 초기화 + 온보딩 인트로부터. 파괴적이라 확인 다이얼로그. */}
            <Pressable onPress={confirmResetToOnboarding} style={{ alignItems: 'center' }}>
              <Text style={{ color: theme.bad, fontSize: 12, fontWeight: '700' }}>🔄 게임 초기화 (온보딩부터)</Text>
            </Pressable>
          </View>
        ) : null}
      </Card>
      {/* 다이아 패스 현황 카드는 상점(buy-diamonds)으로 일원화(2026-07-23 사용자 결정) — 마이페이지에선 제거. */}
      {/* 그룹 사이 여백만 넓혀 자연스럽게 구분(UI polish, item 6 — 구분선 없음, 그룹 내부 간격 12 유지).
          각 group 래퍼 marginTop 10 + 스크롤 gap 12 = 그룹 사이 ~22, 그룹 내부는 12. */}
      {/* ── 자주 보는 것 (공지·상점·업적) ──
          '기록' 카드는 홈 탭(리그 순위 아래)으로 이동(2026-07-21 사용자 지시: 접근성, 마이페이지 깊이가 불편).
          이 카드엔 스포트라이트 앵커·튜토리얼 스텝이 없어(tab-mypage 스포트라이트 2026-07-05 제거) 고아 앵커 생성 없음. */}
      <View style={styles.group}>
        <LinkCard icon="mail-outline" tint={theme.gold} title="우편함"
          sub={unclaimedMailCount > 0 ? `받을 우편 ${unclaimedMailCount}건` : '운영 보상·이벤트 우편을 확인하세요'}
          dot={unreadMailCount > 0}
          onPress={() => router.push('/mailbox')} />

        <LinkCard icon="megaphone-outline" tint={theme.accent} title="공지사항"
          sub="업데이트 · 이벤트 · 안내"
          onPress={() => router.push('/announcements')} />

        <LinkCard icon="sparkles-outline" tint={theme.violet} title="개발자 노트"
          sub="패치노트 · 개발 이야기"
          badge={devnoteUnread}
          onPress={() => router.push('/devnotes')} />

        <LinkCard icon="bag-handle-outline" tint={theme.sky} title="상점"
          sub={WORLDCUP_ENABLED ? '다이아 구매 · 광고 제거 · 월드컵 시즌 · 구매 복원' : '다이아 구매 · 광고 제거 · 구매 복원'}
          onPress={() => router.push('/shop')} />

        <LinkCard icon="ribbon-outline" tint={theme.warn} title="업적"
          sub="구단주의 발자취. 우승 · 시상 · 레전드 · 기록 · 운영"
          dot={unclaimedCount > 0}
          onPress={() => router.push('/achievements')} />
      </View>

      {/* ── 재화 · 가이드 ── */}
      <View style={styles.group}>
        <LinkCard icon="pricetag-outline" tint={theme.gold} title="쿠폰 입력"
          sub="쿠폰 코드를 입력하고 다이아를 받으세요"
          onPress={() => router.push('/coupon')} />

        <LinkCard icon="book-outline" tint={theme.accent} title="게임 가이드"
          sub="경기 · 선수 · FA · 드래프트 등 핵심 개념"
          onPress={() => router.push('/guide')} />
      </View>

      {/* ── 도움 · 약관 (하단) ── */}
      <View style={styles.group}>
        <LinkCard icon="chatbubble-ellipses-outline" tint={theme.sky} title="문의하기"
          sub="오류 · 건의 · 질문. 최근 기록 진단 정보 자동 첨부"
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
      </View>

      {/* ── 계정 · 로그아웃 (최하단) ── */}
      {session ? (
        <View style={{ marginTop: 18, gap: 8 }}>
          {/* 조사 병기 "(으)로" 회피(에뮬 E2E 발견 2026-07-15 — "개발자(로컬)(으)로" 이중 괄호 어색): 받침 고정 명사 "계정"에 조사를 붙인다 */}
          <Muted style={{ fontSize: 12, textAlign: 'center' }}>{accountLabel} 계정으로 로그인됨</Muted>
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
  group: { gap: 12, marginTop: 10 }, // 카드 그룹 래퍼 — 그룹 내부 gap 12 유지, marginTop으로 그룹 사이만 벌림(item 6)
  iconChip: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.text, fontSize: 16, fontWeight: '700' },
  balance: { color: theme.text, fontSize: 26, fontWeight: '900', marginTop: 1 },
  arrow: { color: theme.muted, fontSize: 24, fontWeight: '400' }, // 화살표 = 장식 → 민트 대신 회색으로(민트 희소성, item 9)
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: theme.bad, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  badgeTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  redDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.bad, marginRight: 6 }, // 미확인 우편 빨간 점(MAILBOX §6.3)
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.bad, marginLeft: 6 }, // 제목 옆 빨간 점(업적·우편 미수령)
  diaBtn: { flex: 1, backgroundColor: theme.cardAlt, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  refreshBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.sky + '18' },
  diaBtnTxt: { color: theme.text, fontSize: 13, fontWeight: '700' },
  diaBtnOff: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, opacity: 0.6 }, // 수령 불가 — 회색 비활성
  diaBtnTxtOff: { color: theme.muted },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 22, borderRadius: 11, borderWidth: 1, borderColor: theme.bad + '55', backgroundColor: theme.bad + '12' },
  logoutTxt: { color: theme.bad, fontSize: 13.5, fontWeight: '700' },
}));
