// 다이아 구매 화면 (MONETIZATION §11.1) — 6단계 팩(100·500·1,000·2,500·5,000·10,000), 큰 팩일수록 개당 저렴.
//   dev=구매 시뮬(미지급). prod=RC 소모품 결제 → 서버 웹훅 지급 → syncWallet로 잔액 반영. 실지급은 서버 권위.
// + 출석 패스 카드(ATTENDANCE_PASS_SYSTEM §UI.1, 4상태) + 월 1+1 뱃지(§UI.3). 노출은 플래그(§7) 뒤 — false면 기존 상점과 바이트 동일.
import Ionicons from '@expo/vector-icons/Ionicons';
import { type ComponentProps, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { showAlert } from '../components/AppDialog';
import { Muted, Screen, theme, themedStyles } from '../components/Screen';
import { NegativeBalanceNote } from '../components/NegativeBalanceNote';
import { useGameStore } from '../store/useGameStore';
import { purchaseDiamonds, purchasePass } from '../lib/iap';
import { DIAMOND_TIERS, tierDiscountPct, formatKrw, type DiamondTier } from '../data/diamondTiers';
import { ATTENDANCE_PASS_ENABLED, PROMO_1P1_ENABLED } from '../data/flags';
import { PASS_PRICE_KRW, PASS_DAILY_REWARD, PASS_DURATION_DAYS, PASS_MAX_TOTAL, PASS_GRACE_DAYS, passView } from '../engine/diamonds';
import { todayKstReset } from '../lib/passClient';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function TierCard({ tier, busy, active, onePlusOne, onBuy }: { tier: DiamondTier; busy: boolean; active: boolean; onePlusOne: boolean; onBuy: () => void }) {
  const off = tierDiscountPct(tier);
  return (
    <Pressable onPress={onBuy} disabled={busy} style={[styles.card, busy && { opacity: 0.5 }]}>
      <View style={styles.diaIcon}>
        <Ionicons name={'diamond' as IoniconName} size={22} color={theme.sky} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.amount}>{tier.amount.toLocaleString()} 다이아</Text>
        {onePlusOne ? <Text style={styles.onePlusOneTxt}>이번 달 1+1 · 2배 지급</Text> : null}
      </View>
      {onePlusOne ? (
        <View style={styles.oppBadge}><Text style={styles.oppBadgeTxt}>1+1</Text></View>
      ) : off > 0 ? (
        <View style={styles.badge}><Text style={styles.badgeTxt}>-{off}%</Text></View>
      ) : null}
      {active ? (
        <View style={styles.processing}>
          <ActivityIndicator size="small" color={theme.sky} />
          <Text style={styles.processingTxt}>처리 중</Text>
        </View>
      ) : (
        <Text style={styles.price}>{formatKrw(tier.priceKrw)}</Text>
      )}
    </Pressable>
  );
}

// 출석 패스 카드(§UI.1) — 4상태: 미보유 / 활성 / 활성+예약 / 만료임박(활성의 하위 강조).
function PassCard({ busy, onBuy }: { busy: boolean; onBuy: () => void }) {
  const passStatus = useGameStore((s) => s.passStatus);
  const active = !!passStatus?.active && !!passStatus.endDate;
  const view = active ? passView(passStatus!.endDate!, todayKstReset()) : null;
  const queued = !!passStatus?.queued;

  // ── 미보유: 가격 + 고지 6항(§8·UI.1) + 즉시 1일차 안내 ──
  if (!active) {
    return (
      <View style={[styles.passCard, busy && { opacity: 0.6 }]}>
        <View style={styles.passHead}>
          <View style={styles.passIcon}><Ionicons name={'calendar' as IoniconName} size={20} color={theme.gold} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.passTitle}>다이아 출석 패스</Text>
            <Text style={styles.passSub}>{PASS_DURATION_DAYS}일 · 매일 {PASS_DAILY_REWARD}💎 · 최대 {PASS_MAX_TOTAL.toLocaleString()}💎</Text>
          </View>
          <Text style={styles.price}>{formatKrw(PASS_PRICE_KRW)}</Text>
        </View>
        <View style={styles.noticeBox}>
          {[
            `${PASS_DURATION_DAYS}일간 매일 접속 시 ${PASS_DAILY_REWARD}💎 자동 지급 (구매 즉시 1일차 지급)`,
            `미접속일 보상은 ${PASS_GRACE_DAYS}일 내 접속 시 수령, 경과분은 소멸됩니다`,
            `28일 모두 수령 시 최대 ${PASS_MAX_TOTAL.toLocaleString()}💎`,
            '오프라인에서는 수령할 수 없어요 (온라인 접속 시 지급)',
            '일일 수령 기준 시각은 매일 오전 4시(KST)예요',
            '자동 갱신은 없어요 — 만료 후 다시 구매해야 합니다',
          ].map((t) => (
            <View key={t} style={styles.noticeRow}>
              <Text style={styles.noticeDot}>·</Text>
              <Text style={styles.noticeTxt}>{t}</Text>
            </View>
          ))}
        </View>
        <Pressable onPress={onBuy} disabled={busy} style={[styles.passBtn, busy && styles.passBtnOff]}>
          <Text style={styles.passBtnTxt}>{busy ? '처리 중…' : '구매'}</Text>
        </Pressable>
      </View>
    );
  }

  // ── 활성 / 활성+예약 / 만료임박 ──
  const dayNumber = view!.dayNumber;
  const claimedToday = !!passStatus!.claimedToday;
  return (
    <View style={[styles.passCard, busy && { opacity: 0.6 }]}>
      <View style={styles.passHead}>
        <View style={styles.passIcon}><Ionicons name={'calendar' as IoniconName} size={20} color={theme.gold} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.passTitle}>다이아 출석 패스 · 이용 중</Text>
          <Text style={styles.passSub}>D-{view!.daysRemaining} · {claimedToday ? '오늘 수령 ✓' : '오늘 수령 대기'}</Text>
        </View>
      </View>
      {/* 만료 임박 인앱 배너(D-3~, §UI.1 만료임박) — 푸시 없음, 재구매 유도 */}
      {view!.expiringSoon ? (
        <View style={styles.banner}>
          <Ionicons name={'alert-circle' as IoniconName} size={15} color={theme.warn} />
          <Text style={styles.bannerTxt}>패스가 곧 만료돼요 (D-{view!.daysRemaining}). 이어서 재구매하면 공백 없이 예약됩니다.</Text>
        </View>
      ) : null}
      {queued ? (
        <View style={styles.queuedRow}>
          <Ionicons name={'time-outline' as IoniconName} size={15} color={theme.sky} />
          <Text style={styles.queuedTxt}>예약 +{PASS_DURATION_DAYS}일 — 현재 패스 만료 후 이어서 시작</Text>
        </View>
      ) : null}
      {/* 28칸 진행 스탬프(§UI.1) */}
      <View style={styles.stampGrid}>
        {Array.from({ length: PASS_DURATION_DAYS }, (_, i) => {
          const dnum = i + 1;
          const isToday = dnum === dayNumber;
          const elapsed = dnum <= dayNumber;
          return (
            <View
              key={i}
              style={[
                styles.stamp,
                elapsed && styles.stampElapsed,
                isToday && (claimedToday ? styles.stampClaimed : styles.stampPending),
              ]}
            />
          );
        })}
      </View>
      <Text style={styles.stampLabel}>출석 {dayNumber}/{PASS_DURATION_DAYS}일</Text>
      {/* 활성 중 구매 = 예약 큐잉(§2.2 Q1). 큐 만석(예약 보유)이면 비활성. */}
      <Pressable onPress={onBuy} disabled={busy || queued} style={[styles.passBtn, (busy || queued) && styles.passBtnOff]}>
        <Text style={[styles.passBtnTxt, (busy || queued) && styles.passBtnTxtOff]}>
          {queued ? '예약됨' : busy ? '처리 중…' : `예약 구매 (+${PASS_DURATION_DAYS}일)`}
        </Text>
      </Pressable>
    </View>
  );
}

/** 다음 달 1일(KST) 'M월 1일' — 1+1 초기화 안내(UI.3). */
function nextMonthResetLabel(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60_000);
  const m = kst.getUTCMonth(); // 0-based
  const nextM = (m + 1) % 12;
  return `${nextM + 1}월 1일`;
}

export default function BuyDiamonds() {
  const diamonds = useGameStore((s) => s.diamonds);
  const walletBusy = useGameStore((s) => s.walletBusy);
  const syncWallet = useGameStore((s) => s.syncWallet);
  const passStatus = useGameStore((s) => s.passStatus);
  const active = !!passStatus?.active;
  // 구매 중 팩 id(로컬 래치) — 이 화면의 구매 경로는 walletBusy를 안 켜므로, 연타·동시구매 차단과
  // "처리 중" 피드백을 위해 별도 로컬 상태를 둔다(서버/결제 로직 불변, 표시·게이팅만).
  const [buyingTier, setBuyingTier] = useState<string | null>(null);
  const [buyingPass, setBuyingPass] = useState(false);

  // 진입 시 서버 잔액·패스 상태·1+1 가용 리싱크(§2.4 메모 — 낙관 표시 금지, 서버 파생). 오프라인이면 no-op.
  useEffect(() => { void syncWallet(); }, [syncWallet]);

  const bonusAvail = passStatus?.bonus1p1Available ?? {};
  const promoOn = PROMO_1P1_ENABLED && Object.keys(bonusAvail).length > 0; // 서버가 프로모 데이터를 내려줄 때만(서버 게이트가 최종)

  const buy = async (tier: DiamondTier) => {
    if (buyingTier || buyingPass) return; // 이미 처리 중 — 중복 호출 차단
    setBuyingTier(tier.id);
    try {
      const r = await purchaseDiamonds(tier.id);
      if (!r.ok) {
        if (r.reason === 'cancelled') return; // 유저 취소 — 조용히
        showAlert('구매 실패',
          r.reason === 'unavailable' ? '결제는 출시 빌드에서 연결됩니다. 지금은 광고·업적으로 다이아를 모을 수 있어요.'
            : r.reason === 'network' ? '네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
              : '잠시 후 다시 시도해 주세요.');
        return;
      }
      if (__DEV__) { showAlert('구매 흐름 확인 (개발)', `${r.amount.toLocaleString()} 💎. 운영 빌드에선 결제·서버 검증 후 실제로 지급됩니다.`); return; }
      // 잔액 전후 비교로 지급 반영 여부를 확인 — RC 웹훅이 비동기라 리싱크 시점에 아직 안 들어왔을 수 있다.
      const before = useGameStore.getState().diamonds;
      await syncWallet(); // RC 웹훅이 서버 원장에 지급 → 캐시 리싱크로 잔액 반영
      const after = useGameStore.getState().diamonds;
      if (after > before) {
        showAlert('구매 완료', `${r.amount.toLocaleString()} 💎가 지급되었습니다. 감사합니다!`);
      } else {
        // 아직 반영 전 — "지급 완료"로 단정하지 않고 잠시 후 반영 안내(오지급 오인 방지).
        showAlert('결제 확인됨', '결제가 확인되면 다이아가 잠시 후 반영됩니다. 반영이 늦으면 잔액을 다시 확인해 주세요.');
      }
    } finally {
      setBuyingTier(null);
    }
  };

  const buyPass = async () => {
    if (buyingPass || buyingTier) return;
    setBuyingPass(true);
    try {
      const wasActive = active;
      const r = await purchasePass();
      if (!r.ok) {
        if (r.reason === 'cancelled') return;
        showAlert('구매 실패',
          r.reason === 'unavailable' ? '결제는 출시 빌드에서 연결됩니다. 지금은 광고·업적으로 다이아를 모을 수 있어요.'
            : r.reason === 'network' ? '네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
              : '잠시 후 다시 시도해 주세요.');
        return;
      }
      if (__DEV__) {
        await syncWallet();
        showAlert('구매 흐름 확인 (개발)', wasActive
          ? '이미 이용 중이라 운영 빌드에선 만료 후 이어지는 예약(+28일)으로 큐잉됩니다.'
          : `운영 빌드에선 결제·서버 검증 후 ${PASS_DURATION_DAYS}일 패스가 시작되고 1일차 ${PASS_DAILY_REWARD}💎가 즉시 지급됩니다.`);
        return;
      }
      await syncWallet(); // 웹훅/confirm이 서버에 패스 창 생성 → passStatus 반영
      const st = useGameStore.getState().passStatus;
      if (st?.queued && wasActive) showAlert('예약 완료', '현재 패스가 만료되면 새 패스가 이어서 시작됩니다.');
      else if (st?.active) showAlert('구매 완료', `출석 패스가 시작됐어요. 1일차 ${PASS_DAILY_REWARD}💎가 지급됩니다. 매일 접속해 받아가세요!`);
      else showAlert('결제 확인됨', '결제가 확인되면 패스가 잠시 후 활성화됩니다. 반영이 늦으면 잔액·패스 상태를 다시 확인해 주세요.');
    } finally {
      setBuyingPass(false);
    }
  };

  const anyBusy = walletBusy || buyingTier !== null || buyingPass;

  return (
    <Screen>
      <Text style={styles.title}>다이아 구매</Text>
      <View style={styles.balance}>
        <Ionicons name={'diamond' as IoniconName} size={18} color={theme.sky} />
        <Text style={styles.balanceTxt}>보유 <Text style={{ fontWeight: '900', color: theme.text }}>{diamonds.toLocaleString()}</Text></Text>
      </View>
      <NegativeBalanceNote balance={diamonds} />

      {ATTENDANCE_PASS_ENABLED ? <PassCard busy={anyBusy} onBuy={buyPass} /> : null}

      {DIAMOND_TIERS.map((t) => (
        <TierCard key={t.id} tier={t} busy={anyBusy} active={buyingTier === t.id}
          onePlusOne={promoOn && bonusAvail[t.id] === true} onBuy={() => buy(t)} />
      ))}

      {promoOn ? (
        <Muted style={styles.note}>
          월 1+1은 매월 1일(KST) 초기화됩니다 — 팩별 그 달 첫 구매 시 2배 지급. 다음 초기화: {nextMonthResetLabel()}.
        </Muted>
      ) : null}

      <Muted style={styles.note}>
        전지훈련(선수 강화)에 쓰입니다. 큰 팩일수록 다이아 개당 가격이 저렴해요.{'\n'}
        결제·다이아 잔액은 서버(온라인)에서 확인됩니다. 광고·업적으로도 다이아를 모을 수 있어요.{'\n'}
        미사용 유상 다이아는 구매 후 7일 이내 청약철회(환불)할 수 있습니다. 환불 신청은 접수되며 실제 환불은 스토어 정책에 따라 집행되고, 이미 수령·사용한 다이아는 정산에 반영됩니다. 자세한 내용은 이용약관(마이페이지)을 확인하세요.
      </Muted>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  title: { fontSize: 22, fontWeight: '900', color: theme.text, marginBottom: 12 },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  balanceTxt: { fontSize: 14, color: theme.muted, fontWeight: '700' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.card, borderRadius: 14, borderLeftWidth: 4, borderLeftColor: theme.sky,
    paddingVertical: 14, paddingHorizontal: 14, marginBottom: 10,
  },
  diaIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: theme.sky + '22', alignItems: 'center', justifyContent: 'center' },
  amount: { fontSize: 16.5, fontWeight: '800', color: theme.text },
  onePlusOneTxt: { fontSize: 11.5, fontWeight: '800', color: theme.gold, marginTop: 2 },
  badge: { backgroundColor: theme.good, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  oppBadge: { backgroundColor: theme.gold, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  oppBadgeTxt: { color: '#1A1206', fontSize: 11.5, fontWeight: '900' },
  price: { fontSize: 15.5, fontWeight: '900', color: theme.text, minWidth: 74, textAlign: 'right' },
  processing: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 74, justifyContent: 'flex-end' },
  processingTxt: { fontSize: 12.5, fontWeight: '800', color: theme.muted },
  note: { fontSize: 12.5, marginTop: 12, lineHeight: 19 },

  // ── 출석 패스 카드 ──
  passCard: {
    backgroundColor: theme.card, borderRadius: 14, borderLeftWidth: 4, borderLeftColor: theme.gold,
    padding: 14, marginBottom: 14,
  },
  passHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  passIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: theme.gold + '22', alignItems: 'center', justifyContent: 'center' },
  passTitle: { fontSize: 16.5, fontWeight: '800', color: theme.text },
  passSub: { fontSize: 12.5, fontWeight: '700', color: theme.muted, marginTop: 2 },
  noticeBox: { marginTop: 12, gap: 5 },
  noticeRow: { flexDirection: 'row', gap: 6 },
  noticeDot: { color: theme.muted, fontSize: 12.5, lineHeight: 18 },
  noticeTxt: { flex: 1, color: theme.muted, fontSize: 12.5, lineHeight: 18 },
  passBtn: { marginTop: 12, backgroundColor: theme.gold, borderRadius: 11, paddingVertical: 12, alignItems: 'center' },
  passBtnOff: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, opacity: 0.7 },
  passBtnTxt: { color: '#1A1206', fontSize: 14.5, fontWeight: '900' },
  passBtnTxtOff: { color: theme.muted },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, backgroundColor: theme.warn + '18', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11 },
  bannerTxt: { flex: 1, color: theme.text, fontSize: 12.5, fontWeight: '700', lineHeight: 17 },
  queuedRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 },
  queuedTxt: { color: theme.sky, fontSize: 12.5, fontWeight: '800' },
  stampGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 14 },
  stamp: { width: 16, height: 16, borderRadius: 5, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border },
  stampElapsed: { backgroundColor: theme.gold + '55', borderColor: theme.gold + '55' },
  stampClaimed: { backgroundColor: theme.gold, borderColor: theme.gold },
  stampPending: { backgroundColor: theme.bg, borderColor: theme.gold, borderWidth: 2 },
  stampLabel: { marginTop: 8, color: theme.muted, fontSize: 12, fontWeight: '800' },
}));
