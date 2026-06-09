// 스태프 계약(STAFF_SYSTEM) — 단장이 감독·전문코치·스카우터를 예산 안에서 영입/방출.
import { Alert, View } from 'react-native';
import { Button, Card, Muted, Row, Screen, Title, theme } from '../components/Screen';
import {
  getTeamCoach, teamAssistants, teamScouts, teamScoutReveal,
  availableCoaches, availableAssistants, availableScouts,
  staffSpend, staffBudget, staffBudgetLeft,
} from '../data/league';
import { SPECIALTY_KO } from '../engine/staff';
import { formatMoney } from '../engine/salary';
import { useGameStore } from '../store/useGameStore';

const STYLE_KO = { attack: '공격형', defense: '수비형', balanced: '밸런스' } as const;

export default function Staff() {
  const teamId = useGameStore((s) => s.selectedTeamId);
  // 영입 상태 구독 → 영입/방출 시 재렌더(가용 목록 재계산)
  useGameStore((s) => s.staffHead);
  useGameStore((s) => s.staffAssistants);
  useGameStore((s) => s.staffScouts);
  const hireCoach = useGameStore((s) => s.hireCoach);
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
          <Muted style={{ marginTop: 4 }}>성향 {STYLE_KO[head.style]} · 카리스마 {head.charisma} · {head.archetype}</Muted>
        </Card>
      ) : <Muted>감독 없음</Muted>}
      <Muted style={{ marginTop: 8, marginBottom: 4 }}>감독 시장 (프리에이전트)</Muted>
      {availableCoaches().map((c) => (
        <Card key={c.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>{c.name}</Title>
              <Muted style={{ marginTop: 2 }}>{STYLE_KO[c.style]} · 카리스마 {c.charisma} · {c.archetype} · 연봉 {formatMoney(c.salary)}만</Muted>
            </View>
            <Button label="영입" onPress={() => tryHireCoach(c.id, c.name, c.salary)} />
          </Row>
        </Card>
      ))}

      {/* 전문 코치 */}
      <Title>전문 코치 ({asst.length})</Title>
      <Muted style={{ marginBottom: 4 }}>분야별 훈련 성장을 가속 (같은 분야 최고 1명만 적용)</Muted>
      {asst.map((a) => (
        <Card key={a.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>{a.name}</Title>
              <Muted style={{ marginTop: 2 }}>{SPECIALTY_KO[a.specialty]} · 역량 {a.rating} · 부스트 +{Math.round(0.4 * a.rating / 100 * 100)}% · 연봉 {formatMoney(a.salary)}만</Muted>
            </View>
            <Button label="방출" variant="ghost" onPress={() => releaseAssistant(a.id)} />
          </Row>
        </Card>
      ))}
      <Muted style={{ marginTop: 8, marginBottom: 4 }}>코치 시장</Muted>
      {availableAssistants().map((a) => (
        <Card key={a.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>{a.name}</Title>
              <Muted style={{ marginTop: 2 }}>{SPECIALTY_KO[a.specialty]} · 역량 {a.rating} · 부스트 +{Math.round(0.4 * a.rating / 100 * 100)}% · 연봉 {formatMoney(a.salary)}만</Muted>
            </View>
            <Button label="영입" onPress={() => tryHireAsst(a.id, a.name, a.salary)} />
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
