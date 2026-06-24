import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Loading, Muted, OvrBadge, PosTag, Row, Screen, STYLE_LABEL, Title, theme } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { RosterList } from '../../components/RosterList';
import { IdentityChip, RecentRanks } from '../../components/ClubIdentity';
import { getEvolvedTeamPlayers, getTeam, getTeamCoach, teamAssistants, teamScouts, teamScoutReveal } from '../../data/league';
import { computeStandings } from '../../data/standings';
import { leagueProduction } from '../../data/production';
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

  // 구단 확정 = 무거운 동기 작업(리그 리셋·시즌 구성·전 시즌 캐시 워밍 ~1.8s).
  // 로딩이 **실제로 페인트된 뒤** 무거운 일을 하도록 rAF 2프레임을 양보한다(UI-1). 1프레임=로딩 커밋,
  // 2프레임=페인트 완료 후 실행. (구 InteractionManager.runAfterInteractions는 페인트 보장이 약해
  //  로딩이 안 뜨고 그냥 멈춘 것처럼 보였다 — 사용자 보고 2026-06-24.)
  useEffect(() => {
    if (!starting || !team) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        selectTeam(team.id);
        computeStandings(Number.MAX_SAFE_INTEGER); // allResults() 캐시 워밍(스케줄·대시보드 순위)
        leagueProduction(Number.MAX_SAFE_INTEGER); // 생산 캐시 워밍(대시보드·뉴스·기록)
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

  const onSelect = () => setStarting(true);

  if (starting) {
    return <Loading title={team.name} message={`${team.name} 운영을 준비하는 중…\n시즌 일정과 선수단을 구성하고 있습니다.`} />;
  }

  return (
    <Screen title={team.name}>
      <SpotlightTarget id="team-ovr">
        <Card>
          <Row>
            <Muted>팀 종합 전력</Muted>
            <OvrBadge value={ovr} />
          </Row>
        </Card>
      </SpotlightTarget>

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
        <SpotlightTarget id="team-coach">
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
        </SpotlightTarget>
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

      <SpotlightTarget id="team-roster">
        <Title>선수단 ({players.length}명)</Title>
        <RosterList players={players} />
      </SpotlightTarget>

      <View style={{ height: 4 }} />
      {isCurrent ? (
        <Button label="현재 운영 중인 구단" onPress={() => router.replace('/(tabs)/schedule')} variant="ghost" />
      ) : (
        <SpotlightTarget id="team-operate">
          <Button label={`${team.name} 운영하기`} onPress={onSelect} />
        </SpotlightTarget>
      )}
      <SpotlightOverlay screen="team-detail" />
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
