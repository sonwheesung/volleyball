// 다이아 구매 화면 (MONETIZATION §11.1) — 6단계 팩(100·500·1,000·2,500·5,000·10,000), 큰 팩일수록 개당 저렴.
//   dev=구매 시뮬(미지급). prod=RC 소모품 결제 → 서버 웹훅 지급 → syncWallet로 잔액 반영. 실지급은 서버 권위.
import Ionicons from '@expo/vector-icons/Ionicons';
import { type ComponentProps, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { showAlert } from '../components/AppDialog';
import { Muted, Screen, theme, themedStyles } from '../components/Screen';
import { NegativeBalanceNote } from '../components/NegativeBalanceNote';
import { useGameStore } from '../store/useGameStore';
import { purchaseDiamonds } from '../lib/iap';
import { DIAMOND_TIERS, tierDiscountPct, formatKrw, type DiamondTier } from '../data/diamondTiers';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function TierCard({ tier, busy, active, onBuy }: { tier: DiamondTier; busy: boolean; active: boolean; onBuy: () => void }) {
  const off = tierDiscountPct(tier);
  return (
    <Pressable onPress={onBuy} disabled={busy} style={[styles.card, busy && { opacity: 0.5 }]}>
      <View style={styles.diaIcon}>
        <Ionicons name={'diamond' as IoniconName} size={22} color={theme.sky} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.amount}>{tier.amount.toLocaleString()} 다이아</Text>
      </View>
      {off > 0 ? (
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

export default function BuyDiamonds() {
  const diamonds = useGameStore((s) => s.diamonds);
  const walletBusy = useGameStore((s) => s.walletBusy);
  const syncWallet = useGameStore((s) => s.syncWallet);
  // 구매 중 팩 id(로컬 래치) — 이 화면의 구매 경로는 walletBusy를 안 켜므로, 연타·동시구매 차단과
  // "처리 중" 피드백을 위해 별도 로컬 상태를 둔다(서버/결제 로직 불변, 표시·게이팅만).
  const [buyingTier, setBuyingTier] = useState<string | null>(null);

  const buy = async (tier: DiamondTier) => {
    if (buyingTier) return; // 이미 처리 중 — 중복 호출 차단
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

  return (
    <Screen>
      <Text style={styles.title}>다이아 구매</Text>
      <View style={styles.balance}>
        <Ionicons name={'diamond' as IoniconName} size={18} color={theme.sky} />
        <Text style={styles.balanceTxt}>보유 <Text style={{ fontWeight: '900', color: theme.text }}>{diamonds.toLocaleString()}</Text></Text>
      </View>
      <NegativeBalanceNote balance={diamonds} />

      {DIAMOND_TIERS.map((t) => (
        <TierCard key={t.id} tier={t} busy={walletBusy || buyingTier !== null} active={buyingTier === t.id} onBuy={() => buy(t)} />
      ))}

      <Muted style={styles.note}>
        전지훈련(선수 강화)에 쓰입니다. 큰 팩일수록 다이아 개당 가격이 저렴해요.{'\n'}
        결제·다이아 잔액은 서버(온라인)에서 확인됩니다. 광고·업적으로도 다이아를 모을 수 있어요.{'\n'}
        미사용 유상 다이아는 구매 후 7일 이내 청약철회(환불)할 수 있습니다. 자세한 내용은 이용약관(마이페이지)을 확인하세요.
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
  badge: { backgroundColor: theme.good, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  price: { fontSize: 15.5, fontWeight: '900', color: theme.text, minWidth: 74, textAlign: 'right' },
  processing: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 74, justifyContent: 'flex-end' },
  processingTxt: { fontSize: 12.5, fontWeight: '800', color: theme.muted },
  note: { fontSize: 12.5, marginTop: 12, lineHeight: 19 },
}));
