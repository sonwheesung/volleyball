import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Svg, { Circle } from 'react-native-svg';
import { Button, Card, IconLabel, Loading, Muted, OvrBadge, Screen, STYLE_LABEL, theme } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { RosterList, type RosterSort } from '../../components/RosterList';
import { getEvolvedTeamPlayers, getTeam, getTeamCoach, teamAssistants, teamScouts, teamScoutReveal, LEAGUE } from '../../data/league';
import { computeStandings } from '../../data/standings';
import { leagueProduction } from '../../data/production';
import { clubIdentity, clubAgeYears } from '../../data/clubIdentity';
import { teamOverallRaw } from '../../engine/overall';
import { SPECIALTY_KO } from '../../engine/staff';
import { useGameStore } from '../../store/useGameStore';

// 구단 엠블럼 — select-team과 동일(LEAGUE.teams 순서로 매핑)
const EMBLEMS = [
  require('../../assets/clubs/incheon.png'),
  require('../../assets/clubs/suwon.png'),
  require('../../assets/clubs/daejeon.png'),
  require('../../assets/clubs/gwangju.png'),
  require('../../assets/clubs/gimcheon.png'),
  require('../../assets/clubs/hwaseong.png'),
  require('../../assets/clubs/seoul.png'),
];

const C = { gold: '#E8C46A', faint: '#6B7892' };
const teamHue = (id: string): number => clubIdentity(id)?.hue ?? 210;
const accent = (h: number) => `hsl(${h}, 74%, 62%)`;
const SEASONS = ['20-21', '21-22', '22-23', '23-24', '24-25'];
const SORT_LABEL: Record<RosterSort, string> = { salary: '연봉순', ovr: '전력순', position: '포지션순' };

/** 최근 N시즌 순위 — 시즌 라벨 + 등수. 1위=골드 강조 박스. recentRanks index0=최신 → 좌(과거)→우(최신) */
function SeasonRanks({ ranks, accentColor }: { ranks: number[]; accentColor: string }) {
  if (!ranks.length) return <Muted style={{ fontSize: 12 }}>창단 첫 시즌 — 기록 없음</Muted>;
  const series = [...ranks].reverse();
  const labels = SEASONS.slice(-series.length);
  const color = (r: number) => (r === 1 ? C.gold : r <= 3 ? accentColor : theme.muted);
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {series.map((r, i) => (
        <View
          key={i}
          style={[
            { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: theme.cardAlt },
            r === 1 && { backgroundColor: 'rgba(232,196,106,0.14)', borderWidth: 1, borderColor: 'rgba(232,196,106,0.5)' },
          ]}
        >
          <Text style={{ color: C.faint, fontSize: 10 }}>{labels[i]}</Text>
          <Text style={{ color: color(r), fontSize: 17, fontWeight: '900', marginTop: 2 }}>
            {r}<Text style={{ fontSize: 10, fontWeight: '700', color: C.faint }}>위</Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

/** 작은 진행 링(공개도 등) */
function MiniRing({ pct, color, size = 42 }: { pct: number; color: string; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const frac = Math.max(0.04, Math.min(1, pct));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.cardAlt} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${frac * circ} ${circ}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={{ color: theme.text, fontSize: 11, fontWeight: '800' }}>{Math.round(pct * 100)}%</Text>
    </View>
  );
}

/** 정체성 미니 통계 칸 */
function StatCell({ label, value, valueColor, sub, icon }: { label: string; value: string; valueColor?: string; sub?: string; icon?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
      <Text style={{ color: C.faint, fontSize: 11 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        {icon ? <Text style={{ fontSize: 15 }}>{icon}</Text> : null}
        <Text style={{ color: valueColor ?? theme.text, fontSize: 18, fontWeight: '900' }}>{value}</Text>
        {sub ? <Text style={{ color: C.faint, fontSize: 11 }}>{sub}</Text> : null}
      </View>
    </View>
  );
}

export default function TeamDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const selectTeam = useGameStore((s) => s.selectTeam);
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const [starting, setStarting] = useState(false);
  const [sort, setSort] = useState<RosterSort>('salary');

  const team = id ? getTeam(id) : undefined;

  // 구단 확정 = 무거운 동기 작업(리그 리셋·시즌 구성·전 시즌 캐시 워밍). 로딩이 페인트된 뒤 실행(UI-1 rAF×2).
  useEffect(() => {
    if (!starting || !team) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        selectTeam(team.id);
        computeStandings(Number.MAX_SAFE_INTEGER);
        leagueProduction(Number.MAX_SAFE_INTEGER);
        router.replace('/(tabs)/schedule');
      });
    });
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
  }, [starting, team, selectTeam, router]);

  if (!team) {
    return (
      <Screen title="구단 없음">
        <Muted>존재하지 않는 구단입니다.</Muted>
      </Screen>
    );
  }

  const players = getEvolvedTeamPlayers(team.id, currentDay);
  const identity = clubIdentity(team.id);
  const coach = getTeamCoach(team.id);
  const ovr = teamOverallRaw(players);
  const isCurrent = selectedTeamId === team.id;
  const asst = teamAssistants(team.id);
  const scouts = teamScouts(team.id);
  const reveal = teamScoutReveal(team.id);
  const emblemIdx = LEAGUE.teams.findIndex((t) => t.id === team.id);
  const h = teamHue(team.id);
  const ac = accent(h);
  // 정체성 칩 색 — 명문(dynasty)은 골드(hex), 그 외는 팀컬러. 팀컬러는 hsl 문자열이라 '+22' 알파가 무효(불투명)→
  // 글씨 안 보임 버그였다(2026-06-28). 알파는 hsla()로 직접 만든다.
  const isDyn = identity?.key === 'dynasty';
  const chipColor = isDyn ? C.gold : ac;
  const chipBg = isDyn ? C.gold + '22' : `hsla(${h}, 74%, 62%, 0.14)`;
  const chipBorder = isDyn ? C.gold + '66' : `hsla(${h}, 74%, 62%, 0.45)`;

  if (starting) {
    return <Loading title={team.name} message={`${team.name} 운영을 준비하는 중…\n시즌 일정과 선수단을 구성하고 있습니다.`} variant="brand" />;
  }

  return (
    <Screen>
      {/* ── 히어로 ── */}
      <SpotlightTarget id="team-ovr">
        <View style={styles.hero}>
          <View style={[styles.accentBar, { backgroundColor: ac }]} />
          <Image source={EMBLEMS[emblemIdx] ?? EMBLEMS[0]} style={styles.emblem} />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={styles.teamName} numberOfLines={1}>{team.name}</Text>
            {identity ? (
              <View style={[styles.idChip, { backgroundColor: chipBg, borderColor: chipBorder }]}>
                <Ionicons name="star" size={11} color={chipColor} />
                <Text style={{ color: chipColor, fontSize: 12, fontWeight: '800' }}>{identity.label}</Text>
              </View>
            ) : null}
            {identity ? <Text style={styles.tagline} numberOfLines={1}>{identity.tagline}</Text> : null}
          </View>
          <View style={{ alignItems: 'center', gap: 3 }}>
            <OvrBadge value={ovr} size={64} />
            <Text style={{ color: theme.muted, fontSize: 11 }}>팀 종합 전력</Text>
          </View>
        </View>
      </SpotlightTarget>

      {/* ── 구단 정체성 ── */}
      {identity ? (
        <Card accent={theme.elite}>
          <IconLabel icon="shield-outline" color={theme.elite}>구단 정체성</IconLabel>
          <Text style={styles.blurb}>{identity.blurb}</Text>
          <View style={styles.statRow}>
            <StatCell label="창단" value={`${identity.foundedYear}`} sub={`${clubAgeYears(identity)}년차`} />
            <View style={styles.vDivider} />
            <StatCell label="통산 우승" value={`${identity.titles}회`} valueColor={C.gold} icon="🏆" />
            <View style={styles.vDivider} />
            <StatCell label="전통" value={`${identity.tradition}`} valueColor={theme.accent} sub="/100" />
          </View>
          <Text style={styles.subLabel}>최근 {identity.recentRanks.length || 5}시즌 순위</Text>
          <SeasonRanks ranks={identity.recentRanks} accentColor={ac} />
        </Card>
      ) : null}

      {/* ── 감독 ── */}
      {coach ? (
        <SpotlightTarget id="team-coach">
          <Card onPress={() => router.push(`/coach/${coach.id}`)} accent={theme.violet}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={24} color={theme.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.coachName}>감독 · {coach.name}</Text>
                <Muted style={{ marginTop: 2, fontSize: 13 }}>
                  {coach.age}세 · {STYLE_LABEL[coach.style]} · 카리스마 {coach.charisma}
                </Muted>
              </View>
              <Text style={{ color: theme.accent, fontWeight: '700' }}>상세 ›</Text>
            </View>
          </Card>
        </SpotlightTarget>
      ) : null}

      {/* ── 코칭 스태프 ── */}
      {(asst.length > 0 || scouts.length > 0) ? (
        <Card accent={theme.violet}>
          <IconLabel icon="clipboard-outline" color={theme.violet}>코칭 스태프</IconLabel>
          <View style={styles.staffWrap}>
            {asst.map((a) => (
              <View key={a.id} style={styles.staffItem}>
                <View style={[styles.staffIcon, { backgroundColor: theme.accent + '22' }]}>
                  <MaterialCommunityIcons name="whistle" size={20} color={theme.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.staffTitle}>전문 코치 · {SPECIALTY_KO[a.specialty]}</Text>
                  <Muted style={{ fontSize: 12, marginTop: 1 }}>역량 {a.rating}</Muted>
                </View>
              </View>
            ))}
            {scouts.map((s) => (
              <View key={s.id} style={styles.staffItem}>
                <View style={[styles.staffIcon, { backgroundColor: theme.good + '22' }]}>
                  <MaterialCommunityIcons name="binoculars" size={20} color={theme.good} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.staffTitle}>스카우터 · 공개도</Text>
                  <Muted style={{ fontSize: 12, marginTop: 1 }}>스카우팅 {s.scouting}</Muted>
                </View>
                <MiniRing pct={reveal} color={theme.good} />
              </View>
            ))}
          </View>
          {isCurrent ? (
            <Button label="스태프 계약 관리" variant="ghost" onPress={() => router.push('/staff')} />
          ) : null}
        </Card>
      ) : null}

      {/* ── 선수단 ── */}
      <SpotlightTarget id="team-roster">
        <View style={styles.rosterHead}>
          <IconLabel icon="people-outline" color={theme.accent}>선수단 ({players.length}명)</IconLabel>
          <Pressable
            onPress={() => setSort((s) => (s === 'salary' ? 'ovr' : s === 'ovr' ? 'position' : 'salary'))}
            style={({ pressed }) => [styles.sortChip, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.sortTxt}>{SORT_LABEL[sort]}</Text>
            <Ionicons name="chevron-down" size={13} color={theme.muted} />
          </Pressable>
        </View>
        <View style={{ height: 8 }} />
        <RosterList players={players} sort={sort} />
      </SpotlightTarget>

      <View style={{ height: 6 }} />
      {isCurrent ? (
        <Button label="현재 운영 중인 구단" onPress={() => router.replace('/(tabs)/schedule')} variant="ghost" />
      ) : (
        <SpotlightTarget id="team-operate">
          <Button label={`${team.name} 운영하기`} onPress={() => setStarting(true)} />
        </SpotlightTarget>
      )}
      <SpotlightOverlay screen="team-detail" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 12, paddingVertical: 6, marginBottom: 2 },
  accentBar: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 4, borderRadius: 2 },
  emblem: { width: 76, height: 76, resizeMode: 'contain' },
  teamName: { color: theme.text, fontSize: 24, fontWeight: '900' },
  idChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  tagline: { color: theme.muted, fontSize: 13 },
  blurb: { color: theme.text, fontSize: 13, lineHeight: 20, marginTop: 2 },
  statRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 4 },
  vDivider: { width: 1, alignSelf: 'stretch', backgroundColor: theme.border, marginVertical: 2 },
  subLabel: { color: theme.muted, fontSize: 12, marginTop: 14, marginBottom: 8 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.cardAlt, alignItems: 'center', justifyContent: 'center' },
  coachName: { color: theme.text, fontSize: 16, fontWeight: '800' },
  staffWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4, marginBottom: 4 },
  staffItem: { flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 1, flexBasis: '45%', minWidth: 150 },
  staffIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  staffTitle: { color: theme.text, fontSize: 13, fontWeight: '700' },
  rosterHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sortChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.cardAlt, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  sortTxt: { color: theme.text, fontSize: 13, fontWeight: '700' },
});
