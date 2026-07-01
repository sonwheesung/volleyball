// 단장실 — 메뉴 허브. 계약 관리·스태프·시즌 중 FA는 각 상세 화면에서 처리.
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Card, IconLabel, Muted, Row, Screen, Title, theme } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { getEvolvedTeamPlayers } from '../../data/league';
import { activeRoster, payroll } from '../../data/roster';
import { LEAGUE_CAP } from '../../engine/cap';
import { formatMoney } from '../../engine/salary';
import { DEV_TOOLS } from '../../data/flags';
import { useGameStore } from '../../store/useGameStore';

export default function Office() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const currentDay = useGameStore((s) => s.currentDay);
  const overrides = useGameStore((s) => s.contractOverrides);
  const released = useGameStore((s) => s.released);

  const roster = activeRoster(getEvolvedTeamPlayers(teamId, currentDay), overrides, released);
  // 캡은 국내 선수만(외인=별개 지갑, FOREIGN_SYSTEM 2장). 외인 포함 비교는 허위 초과(빨강) — EC-CAP-01.
  const total = payroll(roster.filter((p) => !p.isForeign));

  return (
    <Screen scroll={false}>
      <Card accent={theme.warn} flat>
        <Row>
          <IconLabel icon="wallet-outline" color={theme.warn}>팀 총연봉 / 예산</IconLabel>
          <Text style={{ color: total > LEAGUE_CAP ? theme.bad : theme.text, fontSize: 16, fontWeight: '800' }}>
            {formatMoney(total)} / {formatMoney(LEAGUE_CAP)}
          </Text>
        </Row>
        <Muted style={{ fontSize: 12 }}>
          잔여 {formatMoney(Math.max(0, LEAGUE_CAP - total))} · 선수 {roster.length}명
        </Muted>
      </Card>

      <SpotlightTarget id="office-top">
        <Card accent={theme.accent} onPress={() => router.push('/contracts')}>
          <Row>
            <Title>계약 관리</Title>
            <Muted>재계약 · 방출 · FA 예정 →</Muted>
          </Row>
          <Muted style={{ fontSize: 12, marginTop: 2 }}>선수 재계약·방출, 시즌 종료 FA 잔류/포기, 방출 선수 복귀</Muted>
        </Card>
      </SpotlightTarget>

      <SpotlightTarget id="office-staff">
        <Card accent={theme.violet} onPress={() => router.push('/staff')}>
          <Row>
            <Title>스태프 계약</Title>
            <Muted>감독 · 코치 · 스카우터 →</Muted>
          </Row>
          <Muted style={{ fontSize: 12, marginTop: 2 }}>감독 영입 · 전문 코치(훈련 부스트) · 스카우터(드래프트 공개도)</Muted>
        </Card>
      </SpotlightTarget>

      <SpotlightTarget id="office-tx">
        <Card accent={theme.sky} onPress={() => router.push('/transactions')}>
          <Row>
            <Title>시즌 중 FA 영입</Title>
            <Muted>포지션 구멍 메우기 →</Muted>
          </Row>
          <Muted style={{ fontSize: 12, marginTop: 2 }}>방출 선수·미계약 FA를 시즌 중 즉시 영입(캡·정원 적용)</Muted>
        </Card>
      </SpotlightTarget>

      {DEV_TOOLS ? (
        <Card onPress={() => router.push('/audit')}>
          <Row>
            <Title>영입 무결성 감사</Title>
            <Muted>QA · 중복/오배정 검사 →</Muted>
          </Row>
        </Card>
      ) : null}
      <SpotlightOverlay screen="tab-office" />
    </Screen>
  );
}
