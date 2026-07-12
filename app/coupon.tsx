// 쿠폰 입력 (BACKEND_SYSTEM §13.14) — 마이페이지 진입점. 코드 입력·등록 → 서버 확정 후 syncWallet로 캐시 갱신.
// 서버 진실([[server-authoritative-currency]]): 낙관적 반영 없음. 결과 reason은 typed(invalid·expired·used·not-eligible·offline).
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { showAlert } from '../components/AppDialog';
import { useRouter } from 'expo-router';
import { Button, Card, IconLabel, Muted, Screen, theme, themedStyles } from '../components/Screen';
import { redeemCoupon } from '../lib/server';
import { useGameStore } from '../store/useGameStore';
import { useAuthStore } from '../store/useAuthStore';

export default function Coupon() {
  const router = useRouter();
  const diamonds = useGameStore((s) => s.diamonds);
  const syncWallet = useGameStore((s) => s.syncWallet);
  const session = useAuthStore((s) => s.session);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const c = code.trim();
    if (!c || busy) return;
    if (!session) { showAlert('로그인 필요', '쿠폰 사용은 로그인이 필요합니다.'); return; }
    setBusy(true);
    const r = await redeemCoupon(c);
    if (r.ok) {
      await syncWallet(); // 서버 확정 잔액으로 캐시 갱신(낙관적 반영 금지)
      setCode('');
      showAlert('쿠폰 사용 완료', `+${r.reward} 💎 지급되었습니다.`, [{ text: '확인', onPress: () => router.back() }]);
    } else {
      showAlert(
        r.reason === 'offline' ? '온라인 연결 필요' : '쿠폰 사용 불가',
        r.reason === 'used' ? '이미 사용한 쿠폰입니다.'
          : r.reason === 'expired' ? '사용 기간이 아닌 쿠폰입니다.'
          : r.reason === 'not-eligible' ? '이 계정으로는 사용할 수 없습니다.'
          : r.reason === 'offline' ? '쿠폰 사용은 온라인 연결이 필요합니다. 네트워크 확인 후 다시 시도해 주세요.'
          : r.reason === 'unauthorized' ? '로그인이 만료되었습니다. 다시 로그인해 주세요.'
          : r.reason === 'error' ? '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'
          : '유효하지 않은 쿠폰입니다.', // invalid — 코드없음/타겟불일치 뭉뚱그림
      );
    }
    setBusy(false);
  };

  return (
    <Screen title="쿠폰 입력" keyboard>
      <View style={styles.bal}><Text style={styles.gem}>💎</Text><Text style={styles.balN}>{diamonds.toLocaleString()}</Text></View>
      <Card accent={theme.gold} flat>
        <IconLabel icon="pricetag-outline" color={theme.gold}>쿠폰 코드</IconLabel>
        <Muted style={{ fontSize: 13, marginTop: 4, lineHeight: 19 }}>
          받은 쿠폰 코드를 입력하면 다이아가 지급됩니다. 대소문자는 구분하지 않아요. 쿠폰당 한 번만 사용할 수 있어요.
        </Muted>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="쿠폰 코드 입력"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={30}
          style={styles.input}
          editable={!busy}
        />
        <Button label={busy ? '확인 중…' : '쿠폰 사용'} onPress={submit} disabled={busy || !code.trim()} />
      </Card>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  bal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginBottom: 6 },
  gem: { fontSize: 16 }, balN: { color: theme.text, fontSize: 18, fontWeight: '900' },
  input: { marginTop: 12, marginBottom: 12, backgroundColor: theme.cardAlt, borderRadius: 10, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12, color: theme.text, fontSize: 16, fontWeight: '700', letterSpacing: 1 },
}));
