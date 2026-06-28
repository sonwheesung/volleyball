// 구단 선택 — 시네마틱 글래스 테마(2026-06-27). 다크 경기장 톤 + 글래스 카드 + 팀컬러(hue) 액센트 + 엠블럼 + 순위 그래프.
// 레이아웃: 폰 폭에서 이름 잘림/칩 2줄 방지 — 이름·칩·태그라인을 전체폭 위 영역, 우승·창단·그래프는 그 아래로 분리(목업 구조).
import { useRouter, Stack } from 'expo-router';
import { Image, ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SpotlightOverlay, SpotlightTarget } from '../components/Spotlight';
import { LEAGUE, getTeamCoach, getTeamPlayers } from '../data/league';
import { clubIdentity } from '../data/clubIdentity';

const EMBLEMS = [
  require('../assets/clubs/incheon.png'),
  require('../assets/clubs/suwon.png'),
  require('../assets/clubs/daejeon.png'),
  require('../assets/clubs/gwangju.png'),
  require('../assets/clubs/gimcheon.png'),
  require('../assets/clubs/hwaseong.png'),
  require('../assets/clubs/seoul.png'),
];

const C = {
  bg0: '#0B1018', bg1: '#131C2B',
  // 다크 글래스(2026-06-28) — 흰색 반투명은 배경이 비쳐 가독성↓(Screen 테마와 동기). 다크 틴트로 차폐.
  glass: 'rgba(16,22,34,0.84)', glassBorder: 'rgba(255,255,255,0.14)',
  divider: 'rgba(255,255,255,0.10)',
  text: '#F2F5FA', sub: '#9AA7BC', faint: '#6B7892', gold: '#E8C46A',
};
const teamHue = (id: string): number => clubIdentity(id)?.hue ?? 210;
const accent = (h: number) => `hsl(${h}, 74%, 62%)`;
const tint = (h: number) => `hsla(${h}, 65%, 50%, 0.10)`;
const SEASONS = ['20-21', '21-22', '22-23', '23-24', '24-25'];

/** 최근 5시즌 순위 — 시즌별 등수를 숫자 셀로. recentRanks index0=최신 → 좌(과거)→우(최신). 1위=골드 강조. */
function RecentRanks({ ranks, accentColor }: { ranks: number[]; accentColor: string }) {
  if (!ranks.length) {
    return <Text style={{ color: C.faint, fontSize: 11.5 }}>창단 첫 시즌 — 기록 없음</Text>;
  }
  const series = [...ranks].reverse();
  const labels = SEASONS.slice(-series.length);
  const rankColor = (r: number) => (r === 1 ? C.gold : r <= 3 ? accentColor : C.sub);
  return (
    <View>
      <Text style={{ color: C.faint, fontSize: 10.5, marginBottom: 4 }}>최근 {series.length}시즌 순위</Text>
      <View style={{ flexDirection: 'row' }}>
        {series.map((r, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: C.faint, fontSize: 9 }}>{labels[i]}</Text>
            <Text style={{ color: rankColor(r), fontSize: 16, fontWeight: '800', marginTop: 1 }}>
              {r}<Text style={{ fontSize: 9.5, fontWeight: '600', color: C.faint }}>위</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function SelectTeam() {
  const router = useRouter();

  return (
    <ImageBackground source={require('../assets/bg/court.png')} style={{ flex: 1, backgroundColor: C.bg0 }} resizeMode="cover">
      <Stack.Screen options={{ headerShown: false }} />
      {/* 가독성 스크림 — 다크 톤으로 깔아 글래스 카드/텍스트가 스포트라이트 위에서도 읽히게 */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(7,10,16,0.62)' }]} />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', marginBottom: 12 }}>
            <Image source={require('../assets/clubs/logo.png')} style={{ width: 210, height: 86, resizeMode: 'contain' }} />
            <Text style={{ color: C.sub, fontSize: 13, letterSpacing: 2, marginTop: 2 }}>당신의 구단을 선택하세요</Text>
          </View>

          {LEAGUE.teams.map((t, i) => {
            const players = getTeamPlayers(t.id);
            const coach = getTeamCoach(t.id);
            const id = clubIdentity(t.id);
            const h = teamHue(t.id);
            const ac = accent(h);
            const card = (
              <Pressable
                key={t.id}
                onPress={() => router.push(`/team/${t.id}`)}
                style={({ pressed }) => [{
                  flexDirection: 'row', alignItems: 'center', gap: 13,
                  backgroundColor: C.glass, borderRadius: 18, borderWidth: 1, borderColor: C.glassBorder,
                  paddingVertical: 13, paddingLeft: 14, paddingRight: 12, marginBottom: 12, overflow: 'hidden',
                  shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4,
                }, pressed && { opacity: 0.85 }]}
              >
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: tint(h) }} />
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: ac }} />

                {/* 엠블럼 — 카드 전체 높이에 세로 중앙(좌측 데드스페이스 제거) */}
                <Image source={EMBLEMS[i] ?? EMBLEMS[0]} style={{ width: 64, height: 64, resizeMode: 'contain' }} />

                {/* 콘텐츠: 이름·칩 / 태그라인 / 구분선 / 스탯 한 줄 / 순위 그래프 */}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: C.text, fontSize: 19, fontWeight: '800', fontFamily: 'Pretendard', flexShrink: 1 }} numberOfLines={1}>{t.name}</Text>
                    {id ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: `hsla(${h},65%,55%,0.22)`, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2.5 }}>
                        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: ac }} />
                        <Text style={{ color: ac, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>{id.label}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ color: C.sub, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>{id?.tagline ?? `${players.length}명`}</Text>

                  <View style={{ height: 1, backgroundColor: C.divider, marginVertical: 9 }} />

                  {/* 스탯 한 줄 — 콤팩트(라벨 흐리게·값 밝게) */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 3 }}>
                    {id ? <Text style={{ color: C.faint, fontSize: 12 }}>우승 <Text style={{ color: C.gold, fontWeight: '800', fontSize: 13 }}>{id.titles}</Text>회</Text> : null}
                    {id ? <Text style={{ color: C.faint, fontSize: 12 }}>창단 <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>{id.foundedYear}</Text></Text> : null}
                    <Text style={{ color: C.faint, fontSize: 12 }}>감독 <Text style={{ color: C.sub, fontWeight: '700', fontSize: 13 }}>{coach?.name ?? '—'}</Text></Text>
                  </View>

                  {/* 최근 시즌 순위 — 숫자 셀 */}
                  {id ? <View style={{ marginTop: 9 }}><RecentRanks ranks={id.recentRanks} accentColor={ac} /></View> : null}
                </View>

                <Text style={{ color: C.faint, fontSize: 22 }}>›</Text>
              </Pressable>
            );
            return i === 0 ? <SpotlightTarget key={t.id} id="team-card-0">{card}</SpotlightTarget> : card;
          })}
          <SpotlightOverlay screen="select-team" />
        </ScrollView>
      </SafeAreaView>
    </ImageBackground>
  );
}
