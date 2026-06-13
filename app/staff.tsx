// 스태프 계약(STAFF_SYSTEM) — 단장이 감독·전문코치·스카우터를 예산 안에서 영입/방출.
import { Alert, View } from 'react-native';
import { Button, Card, Muted, Row, Screen, STYLE_LABEL, Title, theme } from '../components/Screen';
import {
  getTeamCoach, teamAssistants, teamScouts, teamScoutReveal,
  availableCoaches, availableAssistants, availableScouts,
  staffSpend, staffBudget, staffBudgetLeft,
} from '../data/league';
import { SPECIALTY_KO, SPECIALTY_DESC } from '../engine/staff';
import { coachSlots } from '../data/league';
import { formatMoney } from '../engine/salary';
import { useGameStore } from '../store/useGameStore';


export default function Staff() {
  const teamId = useGameStore((s) => s.selectedTeamId);
  // 영입 상태 구독 → 영입/방출 시 재렌더(가용 목록 재계산)
  useGameStore((s) => s.staffHead);
  useGameStore((s) => s.staffAssistants);
  useGameStore((s) => s.staffScouts);
  useGameStore((s) => s.coachPool); // 계약 변화 시 재렌더
  const hireCoach = useGameStore((s) => s.hireCoach);
  const resignCoach = useGameStore((s) => s.resignCoach);
  const hireAssistant = useGameStore((s) => s.hireAssistant);
  const releaseAssistant = useGameStore((s) => s.releaseAssistant);
  const hireScout = useGameStore((s) => s.hireScout);
  const releaseScout = useGameStore((s) => s.releaseScout);

  if (!teamId) return <Screen title="스태프"><Muted>먼저 구단을 선택하세요.</Muted></Screen>;

  const head = getTeamCoach(teamId);
  const asst = teamAssistants(teamId);
  const scouts = teamScouts(teamId);
  const spend = staffSpend(teamId);
  const left = staffBudgetLeft(teamId);
  const reveal = teamScoutReveal(teamId);

  const overBudget = (msg: string) => Alert.alert('스태프 예산 초과', `${msg}\n예산 여유: ${formatMoney(left)}만`);

  const tryHireCoach = (id: string, name: string, salary: number) => {
    if (!hireCoach(id)) overBudget(`${name} 감독 영입(연봉 ${formatMoney(salary)}만) 불가.`);
  };
  const tryHireAsst = (id: string, name: string, salary: number) => {
    if (!hireAssistant(id)) overBudget(`${name} 영입(연봉 ${formatMoney(salary)}만) 불가.`);
  };
  const tryHireScout = (id: string, name: string, salary: number) => {
    if (!hireScout(id)) overBudget(`${name} 영입(연봉 ${formatMoney(salary)}만) 불가.`);
  };

  const pct = Math.min(100, Math.round((spend / staffBudget()) * 100));

  return (
    <Screen title="스태프 계약">
      {/* 예산 바 */}
      <Card>
        <Row>
          <Title>스태프 예산</Title>
          <Muted>{formatMoney(spend)} / {formatMoney(staffBudget())}만</Muted>
        </Row>
        <View style={{ height: 8, backgroundColor: theme.cardAlt, borderRadius: 4, marginTop: 8, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: 8, backgroundColor: pct >= 95 ? theme.bad : pct >= 80 ? theme.warn : theme.good }} />
        </View>
        <Muted style={{ marginTop: 6 }}>여유 {formatMoney(left)}만</Muted>
      </Card>

      {/* 감독 */}
      <Title>감독</Title>
      {head ? (
        <Card>
          <Row><Title>{head.name}</Title><Muted>{head.age}세 · 연봉 {formatMoney(head.salary)}만</Muted></Row>
          <Muted style={{ marginTop: 4 }}>성향 {STYLE_LABEL[head.style]} · 카리스마 {head.charisma} · {head.archetype}</Muted>
          {(() => {
            const yrs = head.contractYears ?? 0;
            const expiring = yrs <= 1;
            return (
              <Row>
                <Muted style={{ color: expiring ? theme.warn : theme.muted, marginTop: 4 }}>
                  계약 {yrs <= 0 ? '만료 — 재계약 필요' : `잔여 ${yrs}년`}
                </Muted>
                {expiring ? (
                  <Button label="재계약(3년)" onPress={() => { if (resignCoach()) Alert.alert('재계약 완료', `${head.name} 감독과 3년 재계약했습니다.`); }} />
                ) : null}
              </Row>
            );
          })()}
        </Card>
      ) : <Muted>감독 없음 — 시장에서 영입하세요</Muted>}
      <Muted style={{ marginTop: 8, marginBottom: 4 }}>감독 시장 (프리에이전트)</Muted>
      {availableCoaches().map((c) => (
        <Card key={c.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>{c.name}</Title>
              <Muted style={{ marginTop: 2 }}>{STYLE_LABEL[c.style]} · 카리스마 {c.charisma} · {c.archetype} · 연봉 {formatMoney(c.salary)}만</Muted>
            </View>
            <Button label="영입" onPress={() => tryHireCoach(c.id, c.name, c.salary)} />
          </Row>
        </Card>
      ))}

      {/* 전문 코치 */}
      <Title>전문 코치 ({asst.length}/{coachSlots()})</Title>
      <Muted style={{ marginBottom: 4 }}>분야별 효과(같은 분야 최고 1명). 슬롯 {coachSlots()}개 — 어떤 코치를 둘지 선택.</Muted>
      {asst.map((a) => (
        <Card key={a.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>{SPECIALTY_KO[a.specialty]} · {a.name}</Title>
              <Muted style={{ marginTop: 2 }}>{SPECIALTY_DESC[a.specialty]} · 역량 {a.rating} · 연봉 {formatMoney(a.salary)}만</Muted>
            </View>
            <Button label="방출" variant="ghost" onPress={() => releaseAssistant(a.id)} />
          </Row>
        </Card>
      ))}
      <Muted style={{ marginTop: 8, marginBottom: 4 }}>코치 시장 {asst.length >= coachSlots() ? '(슬롯 가득 — 방출 후 영입)' : ''}</Muted>
      {availableAssistants().map((a) => (
        <Card key={a.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>{SPECIALTY_KO[a.specialty]} · {a.name}</Title>
              <Muted style={{ marginTop: 2 }}>{SPECIALTY_DESC[a.specialty]} · 역량 {a.rating} · 연봉 {formatMoney(a.salary)}만</Muted>
            </View>
            <Button label="영입" onPress={() => tryHireAsst(a.id, a.name, a.salary)} disabled={asst.length >= coachSlots()} />
          </Row>
        </Card>
      ))}

      {/* 스카우터 */}
      <Title>스카우터 ({scouts.length})</Title>
      <Muted style={{ marginBottom: 4 }}>드래프트 유망주 공개도: {Math.round(reveal * 100)}%</Muted>
      {scouts.map((s) => (
        <Card key={s.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>{s.name}</Title>
              <Muted style={{ marginTop: 2 }}>스카우팅 {s.scouting} · 연봉 {formatMoney(s.salary)}만</Muted>
            </View>
            <Button label="방출" variant="ghost" onPress={() => releaseScout(s.id)} />
          </Row>
        </Card>
      ))}
      <Muted style={{ marginTop: 8, marginBottom: 4 }}>스카우터 시장</Muted>
      {availableScouts().map((s) => (
        <Card key={s.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>{s.name}</Title>
              <Muted style={{ marginTop: 2 }}>스카우팅 {s.scouting} · 연봉 {formatMoney(s.salary)}만</Muted>
            </View>
            <Button label="영입" onPress={() => tryHireScout(s.id, s.name, s.salary)} />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
