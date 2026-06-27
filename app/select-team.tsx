// 구단 선택 — 시네마틱 글래스 테마(2026-06-27). 다크 경기장 톤 + 프로스티드 글래스 카드 + 팀컬러(hue) 액센트
// + 엠블럼(assets/clubs) + 최근 순위 SVG 그래프. 새 의존성 0(react-native-svg만). 기존 흐름 유지(카드 탭 → team/[id]).
import { useRouter, Stack } from 'expo-router';
import { Image, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Stop, Rect, Line, Polyline, Circle } from 'react-native-svg';
import { SpotlightOverlay, SpotlightTarget } from '../components/Spotlight';
import { LEAGUE, getTeamCoach, getTeamPlayers } from '../data/league';
import { clubIdentity } from '../data/clubIdentity';

// teamId(t0..) 순서 = TEAM_NAMES = 엠블럼 순서. 정적 require(번들).
const EMBLEMS = [
  require('../assets/clubs/incheon.png'),
  require('../assets/clubs/suwon.png'),
  require('../assets/clubs/daejeon.png'),
  require('../assets/clubs/gwangju.png'),
  require('../assets/clubs/gimcheon.png'),
  require('../assets/clubs/hwaseong.png'),
  require('../assets/clubs/seoul.png'),
];

// 시네마틱 다크 팔레트(이 화면 전용 — 전역 테마 개편 1차)
const C = {
  bg0: '#0B1018', bg1: '#131C2B',      // 배경 그라데이션(위 밝게~아래 어둡게)
  glass: 'rgba(255,255,255,0.045)',     // 글래스 카드 면
  glassBorder: 'rgba(255,255,255,0.10)',
  text: '#F2F5FA', sub: '#9AA7BC', faint: '#6B7892',
  gold: '#E8C46A',
};
// 팀 컬러 — clubIdentity.hue 기반(밝은 액센트 / 옅은 틴트)
const teamHue = (id: string): number => clubIdentity(id)?.hue ?? 210;
const accent = (h: number) => `hsl(${h}, 72%, 60%)`;
const tint = (h: number) => `hsla(${h}, 65%, 50%, 0.10)`;

const SEASONS = ['20-21', '21-22', '22-23', '23-24', '24-25'];

/** 최근 5시즌 순위 미니 그래프 — 1위=위, 꼴찌=아래. recentRanks는 index0=최신 → 좌(과거)→우(최신)로 뒤집어 표시 */
function RankGraph({ ranks, teamCount, color }: { ranks: number[]; teamCount: number; color: string }) {
  if (!ranks.length) {
    return <Text style={{ color: C.faint, fontSize: 11 }}>창단 첫 시즌 — 기록 없음</Text>;
  }
  const series = [...ranks].reverse();           // 과거→최신
  const labels = SEASONS.slice(-series.length);
  const W = 200, H = 46, padX = 16, padTop = 12, padBot = 16;
  const n = series.length;
  const x = (i: number) => n <= 1 ? W / 2 : padX + (i * (W - padX * 2)) / (n - 1);
  const y = (r: number) => padTop + ((r - 1) * (H - padTop - padBot)) / Math.max(1, teamCount - 1); // 1위=위
  const pts = series.map((r, i) => `${x(i)},${y(r)}`).join(' ');
  return (
    <View>
      <Svg width={W} height={H}>
        <Polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
        {series.map((r, i) => (
          <Circle key={i} cx={x(i)} cy={y(r)} r={3.2} fill={color} />
        ))}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: W }}>
        {labels.map((s, i) => <Text key={i} style={{ color: C.faint, fontSize: 8.5 }}>{s}</Text>)}
      </View>
    </View>
  );
}

export default function SelectTeam() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  return (
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* 배경: 다크 그라데이션 + 은은한 코트 라인(SVG) */}
      <Svg style={{ position: 'absolute', top: 0, left: 0 }} width={width} height={1200}>
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.bg1} />
            <Stop offset="0.5" stopColor={C.bg0} />
            <Stop offset="1" stopColor="#070A10" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={1200} fill="url(#bg)" />
        {/* 코트 네트 라인(은은) */}
        <Line x1="0" y1="120" x2={width} y2="120" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        {Array.from({ length: 9 }).map((_, i) => (
          <Line key={i} x1={(width / 8) * i} y1="60" x2={(width / 8) * i} y2="120" stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
        ))}
      </Svg>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          {/* 로고 + 카피 */}
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <Image source={require('../assets/clubs/logo.png')} style={{ width: 220, height: 92, resizeMode: 'contain' }} />
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
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  backgroundColor: C.glass, borderRadius: 18, borderWidth: 1, borderColor: C.glassBorder,
                  paddingVertical: 14, paddingRight: 14, paddingLeft: 18, marginBottom: 14, overflow: 'hidden',
                  shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4,
                }, pressed && { opacity: 0.82 }]}
              >
                {/* 팀컬러 옅은 틴트 + 좌측 액센트 바 */}
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: tint(h) }} />
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: ac }} />

                {/* 엠블럼 */}
                <Image source={EMBLEMS[i] ?? EMBLEMS[0]} style={{ width: 66, height: 66, resizeMode: 'contain' }} />

                {/* 가운데: 이름·칩·태그라인 */}
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={{ color: C.text, fontSize: 19, fontWeight: '800', fontFamily: 'Pretendard' }} numberOfLines={1}>{t.name}</Text>
                  {id ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, backgroundColor: `hsla(${h},65%,55%,0.18)`, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 }}>
                      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: ac }} />
                      <Text style={{ color: ac, fontSize: 11, fontWeight: '800' }}>{id.label}</Text>
                    </View>
                  ) : null}
                  <Text style={{ color: C.sub, fontSize: 12.5 }} numberOfLines={1}>{id?.tagline ?? `${players.length}명`}</Text>
                </View>

                {/* 오른쪽: 우승/창단 + 순위 그래프 */}
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  {id ? (
                    <View style={{ flexDirection: 'row', gap: 14 }}>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ color: C.faint, fontSize: 10 }}>우승</Text>
                        <Text style={{ color: C.gold, fontSize: 15, fontWeight: '800' }}>{id.titles}<Text style={{ fontSize: 11, color: C.sub }}>회</Text></Text>
                      </View>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ color: C.faint, fontSize: 10 }}>창단</Text>
                        <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>{id.foundedYear}</Text>
                      </View>
                    </View>
                  ) : null}
                  {id ? <RankGraph ranks={id.recentRanks} teamCount={LEAGUE.teams.length} color={ac} /> : null}
                  <Text style={{ color: C.faint, fontSize: 10 }}>감독 {coach?.name ?? '—'}</Text>
                </View>
              </Pressable>
            );
            return i === 0 ? <SpotlightTarget key={t.id} id="team-card-0">{card}</SpotlightTarget> : card;
          })}
          <SpotlightOverlay screen="select-team" />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
