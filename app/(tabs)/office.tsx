// 단장실 — 메뉴 허브. 계약 관리·스태프·시즌 중 FA는 각 상세 화면에서 처리.
import { useRouter } from 'expo-router';
import { Card, Muted, Row, Screen, Title, theme } from '../../components/Screen';
import { SummaryCard } from '../../components/SummaryCard';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { evolveOnDay } from '../../data/league';
import { rosterIdsOnDay } from '../../data/dynamics';
import { capPayroll } from '../../data/roster';
import { LEAGUE_CAP } from '../../engine/cap';
import { formatMoney } from '../../engine/salary';
import { DEV_TOOLS } from '../../data/flags';
import { useGameStore } from '../../store/useGameStore';
import type { Player } from '../../types';

export default function Office() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const currentDay = useGameStore((s) => s.currentDay);
  const overrides = useGameStore((s) => s.contractOverrides);
  const inSeasonTx = useGameStore((s) => s.inSeasonTx);

  // 날짜 인지 명단(UI-43a) + store 게이트와 동일한 캡 산식(UI-43b, capPayroll §7): 그날 유효 명단(시즌 중 영입 포함·방출 제외)에
  // 재계약 override·시즌 영입비(inSeasonCost)·배신 웃돈을 반영. 캡은 국내만(외인=별개 지갑, FOREIGN_SYSTEM 2장) — capPayroll 내부에서 외인 제외.
  const myIds = rosterIdsOnDay(teamId, currentDay);
  const isBetrayed = (id: string) => inSeasonTx.some((t) => t.kind === 'release' && t.teamId === teamId && t.playerId === id);
  const inSeasonSigned = new Set(inSeasonTx.filter((t) => t.kind === 'sign' && t.teamId === teamId).map((t) => t.playerId));
  const capPlayers = myIds.map((id) => evolveOnDay(id, currentDay)).filter((p): p is Player => !!p);
  const total = capPayroll(capPlayers, overrides, inSeasonSigned, isBetrayed);

  return (
    <Screen scroll={false} insetBottom={false}>
      <SummaryCard
        icon="wallet-outline"
        color={theme.warn}
        label="팀 총연봉 / 예산"
        value={`${formatMoney(total)} / ${formatMoney(LEAGUE_CAP)}`}
        valueStyle={{ color: total > LEAGUE_CAP ? theme.bad : theme.text, fontSize: 16, fontWeight: '700' }}
        caption={`잔여 ${formatMoney(Math.max(0, LEAGUE_CAP - total))} · 선수 ${myIds.length}명`}
      />

      <SpotlightTarget id="office-top">
        <Card accent={theme.accent} onPress={() => router.push('/contracts')}>
          <Row>
            {/* 다른 메뉴 카드와 동일하게 기본 Title(흰색) — 좌측 액센트 줄무늬로만 카테고리 구분(2026-07-12 통일) */}
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

      <SpotlightTarget id="office-training">
        <Card accent={theme.good} onPress={() => router.push('/training-policy')}>
          <Row>
            <Title>훈련 방침</Title>
            <Muted>팀 성장 방향 →</Muted>
          </Row>
          <Muted style={{ fontSize: 12, marginTop: 2 }}>감독 기본 또는 단장이 직접 선택(체력·공격·수비 등)</Muted>
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
