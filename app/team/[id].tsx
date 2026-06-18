import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, InteractionManager, Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, PosTag, Row, Screen, STYLE_LABEL, Title, theme } from '../../components/Screen';
import { RosterList } from '../../components/RosterList';
import { IdentityChip, RecentRanks } from '../../components/ClubIdentity';
import { getEvolvedTeamPlayers, getTeam, getTeamCoach, teamAssistants, teamScouts, teamScoutReveal } from '../../data/league';
import { clubIdentity, clubAgeYears } from '../../data/clubIdentity';
import { teamOverallRaw } from '../../engine/overall';
import { SPECIALTY_KO } from '../../engine/staff';
import { useGameStore } from '../../store/useGameStore';

export default function TeamDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const selectTeam = useGameStore((s) => s.selectTeam);
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const [starting, setStarting] = useState(false);

  const team = id ? getTeam(id) : undefined;

  // 구단 확정 = 무거운 동기 작업(리그 리셋·시즌 구성). 먼저 로딩 화면을 그린 뒤(다음 인터랙션 틱)
  // 실제 작업을 돌려 "탭했는데 화면이 멈춘" 체감을 없앤다(사용자 보고). InteractionManager로 한 프레임 양보.
  useEffect(() => {
    if (!starting || !team) return;
    const task = InteractionManager.runAfterInteractions(() => {
      selectTeam(team.id);
      router.replace('/(tabs)/schedule');
    });
    return () => task.cancel();
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

  const onSelect = () => setStarting(true);

  if (starting) {
    return (
      <Screen title={team.name} scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>{team.name} 운영을 준비하는 중…</Text>
          <Muted style={{ textAlign: 'center' }}>시즌 일정과 선수단을 구성하고 있습니다.{'\n'}잠시만 기다려 주세요.</Muted>
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={team.name}>
      <Card>
        <Row>
          <Muted>팀 종합 전력</Muted>
          <OvrBadge value={ovr} />
        </Row>
      </Card>

      {identity ? (
        <Card>
          <Row>
            <IdentityChip identity={identity} />
            <Muted style={{ fontSize: 12 }}>{identity.tagline}</Muted>
          </Row>
          <Text style={{ color: theme.text, fontSize: 13, lineHeight: 19, marginTop: 8 }}>{identity.blurb}</Text>
          <View style={{ flexDirection: 'row', marginTop: 12, gap: 8 }}>
            <Stat label="창단" value={`${identity.foundedYear}`} sub={`${clubAgeYears(identity)}년차`} />
            <Stat label="통산 우승" value={`${identity.titles}회`} />
            <Stat label="전통" value={`${identity.tradition}`} sub="/100" />
          </View>
          <View style={{ marginTop: 12 }}>
            <Muted style={{ fontSize: 11, marginBottom: 4 }}>최근 시즌 성적</Muted>
            <RecentRanks ranks={identity.recentRanks} teamCount={7} />
          </View>
        </Card>
      ) : null}

      {coach ? (
        <Card onPress={() => router.push(`/coach/${coach.id}`)}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>감독 · {coach.name}</Title>
              <Muted style={{ marginTop: 2 }}>
                {coach.age}세 · {STYLE_LABEL[coach.style]} · 카리스마 {coach.charisma}
              </Muted>
            </View>
            <Text style={{ color: theme.accent }}>상세 ›</Text>
          </Row>
        </Card>
      ) : null}

      {/* 코칭 스태프 — AI 팀은 기본 스태프(코치2+스카우터1), 내 팀은 영입분 */}
      {(asst.length > 0 || scouts.length > 0) ? (
        <Card>
          <Title>코칭 스태프</Title>
          {asst.map((a) => (
            <View key={a.id} style={{ marginTop: 6 }}>
              <Row>
                <Muted>전문 코치 · {SPECIALTY_KO[a.specialty]}</Muted>
                <Muted>역량 {a.rating}</Muted>
              </Row>
            </View>
          ))}
          {scouts.map((s) => (
            <View key={s.id} style={{ marginTop: 6 }}>
              <Row>
                <Muted>스카우터 · 공개도 {Math.round(reveal * 100)}%</Muted>
                <Muted>스카우팅 {s.scouting}</Muted>
              </Row>
            </View>
          ))}
          {isCurrent ? (
            <Button label="스태프 계약 관리" variant="ghost" onPress={() => router.push('/staff')} />
          ) : null}
        </Card>
      ) : null}

      <Title>선수단 ({players.length}명)</Title>
      <RosterList players={players} />

      <View style={{ height: 4 }} />
      {isCurrent ? (
        <Button label="현재 운영 중인 구단" onPress={() => router.replace('/(tabs)/schedule')} variant="ghost" />
      ) : (
        <Button label={`${team.name} 운영하기`} onPress={onSelect} />
      )}
    </Screen>
  );
}

/** 구단 프로필 미니 통계 칸 */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.cardAlt, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 }}>
      <Text style={{ color: theme.muted, fontSize: 11 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2, marginTop: 2 }}>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{value}</Text>
        {sub ? <Text style={{ color: theme.muted, fontSize: 11 }}>{sub}</Text> : null}
      </View>
    </View>
  );
}
