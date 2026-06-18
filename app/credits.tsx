import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Muted, Screen, theme } from '../components/Screen';
import { useGameStore } from '../store/useGameStore';

const ROSE = '#FF5C8D';

function Line({ role, name }: { role: string; name: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.role}>{role}</Text>
      <Text style={styles.name}>{name}</Text>
    </View>
  );
}

export default function Credits() {
  const router = useRouter();
  const supporter = useGameStore((s) => s.supporter);

  return (
    <Screen title="크레딧">
      <View style={styles.headWrap}>
        <Text style={styles.logo}>백년배구</Text>
        <Muted style={{ textAlign: 'center' }}>가상 V리그를 수십 시즌 운영하는 관전형 배구 시뮬</Muted>
      </View>

      <Text style={styles.section}>만든 사람</Text>
      <View style={styles.group}>
        <Line role="기획 · 개발 · 디자인" name="1인 개발" />
        <Line role="폰트" name="Pretendard" />
      </View>

      <Text style={styles.section}>응원해주신 분들</Text>
      <View style={[styles.group, styles.thanksGroup]}>
        {supporter ? (
          <View style={styles.youRow}>
            <View style={styles.heart}><Ionicons name="heart" size={15} color="#FFFFFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.youTxt}>당신이 이 게임의 서포터입니다</Text>
              <Muted style={{ fontSize: 12, marginTop: 1 }}>덕분에 다음 시즌이 이어집니다 — 진심으로 고맙습니다 ♥</Muted>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => router.push('/supporter')} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}>
            <Ionicons name="heart-outline" size={17} color={ROSE} />
            <Text style={styles.ctaTxt}>서포터가 되어 이름을 남겨보세요</Text>
            <Ionicons name="chevron-forward" size={16} color={ROSE} />
          </Pressable>
        )}
        <Muted style={{ fontSize: 11.5, lineHeight: 16, marginTop: 4 }}>
          백년배구를 응원해주신 모든 서포터분들께 감사드립니다.
        </Muted>
      </View>

      <View style={{ height: 8 }} />
      <Muted style={{ textAlign: 'center', fontSize: 11 }}>Made with ♥ · 천천히, 백년처럼</Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headWrap: { alignItems: 'center', gap: 6, paddingVertical: 14 },
  logo: { color: theme.text, fontSize: 28, fontWeight: '900' },
  section: { color: theme.muted, fontSize: 12, fontWeight: '800', marginTop: 16, marginBottom: 6, marginLeft: 2 },
  group: { backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14 },
  thanksGroup: { paddingVertical: 12, gap: 10 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  role: { color: theme.muted, fontSize: 13 },
  name: { color: theme.text, fontSize: 14, fontWeight: '700' },
  youRow: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: ROSE + '12', borderRadius: 12, borderWidth: 1, borderColor: ROSE + '33', padding: 12 },
  heart: { width: 30, height: 30, borderRadius: 10, backgroundColor: ROSE, alignItems: 'center', justifyContent: 'center' },
  youTxt: { color: theme.text, fontSize: 14, fontWeight: '800' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: ROSE + '12', borderRadius: 12, borderWidth: 1, borderColor: ROSE + '33', paddingVertical: 13, paddingHorizontal: 12 },
  ctaTxt: { flex: 1, color: ROSE, fontSize: 14, fontWeight: '800' },
});
