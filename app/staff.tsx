// 스태프 계약(STAFF_SYSTEM) — 단장이 감독·전문코치·스카우터를 예산 안에서 영입/방출.
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { showAlert } from '../components/AppDialog';
import { Button, Card, IconLabel, Loading, Muted, Row, Screen, STYLE_LABEL, Title, theme } from '../components/Screen';
import {
  getTeamCoach, teamAssistants, teamScouts, teamScoutReveal,
  availableCoaches, availableAssistants, availableScouts,
  staffSpend, staffBudget, staffBudgetLeft,
} from '../data/league';
import { computeStandings, displayCutoff } from '../data/standings';
import { SPECIALTY_KO, SPECIALTY_DESC, TYPE_KO, TYPE_DESC } from '../engine/staff';
import { firedMidSeason } from '../engine/staffLifecycle';
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
  const currentDay = useGameStore((s) => s.currentDay);
  const results = useGameStore((s) => s.results);
  const hireCoach = useGameStore((s) => s.hireCoach);
  const resignCoach = useGameStore((s) => s.resignCoach);
  const fireCoach = useGameStore((s) => s.fireCoach);
  const hireAssistant = useGameStore((s) => s.hireAssistant);
  const releaseAssistant = useGameStore((s) => s.releaseAssistant);
  const hireScout = useGameStore((s) => s.hireScout);
  const releaseScout = useGameStore((s) => s.releaseScout);

  // 코치/감독 변경은 시즌 결과 캐시를 무효화 → 부진경고용 computeStandings가 전 시즌을 재시뮬(무거움).
  // UI-4: 그 재계산을 로딩 뒤에서 미리 데운다(스피너는 네이티브라 JS가 막혀도 계속 돈다).
  // 스카우터·재계약은 시뮬 무영향(캐시 무효 없음) → busy 안 거치고 즉시.
  const [busy, setBusy] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!busy) return;
    // rAF×2(UI-13): InteractionManager는 커밋 전에 콜백이 돌아 20~30s 동기 블록의 첫 프레임에 <Loading>이
    //   아직 페인트되지 않을 수 있다(화면 동결). rAF 2회면 커밋→네이티브 렌더가 한 프레임 지나 로딩이 확실히
    //   얹힌 뒤 무거운 블록을 시작한다(useBusyRun과 동일 원리).
    let r1 = 0;
    let r2 = 0;
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        pending.current?.(); // 영입/방출 실행(성공 시 baseVersion 무효화)
        const st = useGameStore.getState();
        const day = displayCutoff(st.currentDay, st.results, teamId ?? undefined);
        computeStandings(day); // 로딩 중 캐시 워밍(무거운 재시뮬을 여기서 끝낸다)
        pending.current = null;
        setBusy(false); // 클리어 → 본문은 워밍된 캐시로 즉시 렌더
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [busy]);
  const heavyAction = (fn: () => void) => { pending.current = fn; setBusy(true); };

  if (!teamId) return <Screen title="스태프"><Muted>먼저 구단을 선택하세요.</Muted></Screen>;
  if (busy) return <Loading title="스태프 계약" message={'새 스태프를 반영해\n시즌 전력을 다시 계산하는 중…'} variant="brand" />;

  const head = getTeamCoach(teamId);
  const acting = !!head?.id.startsWith('acting_');
  // 정식 감독이 이미 있으면 새 감독을 바로 영입할 수 없다 — 먼저 경질해야(2026-07-11 테스터: 자동 교체가 실수 유발).
  //   대행/공석(acting || !head)은 정식 감독을 세우는 절차라 영입 허용.
  const hasHeadCoach = !!head && !acting;
  const myRow = computeStandings(displayCutoff(currentDay, results, teamId ?? undefined)).find((r) => r.teamId === teamId); // 결과 인지 표시 컷오프(§3.3)
  const slumping = !!myRow && firedMidSeason(myRow.wins, myRow.losses); // 시즌 중 부진(경질 권유)
  const asst = teamAssistants(teamId);
  const scouts = teamScouts(teamId);
  const spend = staffSpend(teamId);
  const left = staffBudgetLeft(teamId);
  const reveal = teamScoutReveal(teamId);

  const overBudget = (msg: string) => showAlert('스태프 예산 초과', `${msg}\n예산 여유: ${formatMoney(left)}`);

  // 코치/감독 = 무거움(시즌 재계산) → 로딩 뒤에서 실행. 스카우터 = 즉시. 모두 confirm으로 묻는다.
  const tryHireCoach = (id: string, name: string, salary: number) => {
    if (hasHeadCoach) { // 정식 감독 재직 중 — 경질 먼저(위 감독 카드의 "감독 경질")
      showAlert('먼저 감독을 경질하세요', `${head!.name} 감독이 재직 중입니다.\n새 감독을 영입하려면 위에서 현재 감독을 먼저 경질해 주세요.`);
      return;
    }
    showAlert('감독 영입', `${name} 감독을 영입하시겠습니까?\n연봉 ${formatMoney(salary)} · 3년 계약\n\n새 감독을 반영해 시즌 전력을 다시 계산합니다.`, [
      { text: '취소', style: 'cancel' },
      { text: '영입', onPress: () => heavyAction(() => { if (!hireCoach(id)) overBudget(`${name} 감독 영입(연봉 ${formatMoney(salary)}) 불가.`); else showAlert('영입 완료', `${name} 감독이 부임했습니다. 새 감독의 성향으로 팀이 움직입니다.`); }) },
    ]);
  };
  const tryHireAsst = (id: string, name: string, salary: number) =>
    showAlert('코치 영입', `${name} 코치를 영입하시겠습니까?\n연봉 ${formatMoney(salary)}\n\n새 코치를 반영해 시즌 전력을 다시 계산합니다.`, [
      { text: '취소', style: 'cancel' },
      { text: '영입', onPress: () => heavyAction(() => { if (!hireAssistant(id)) overBudget(`${name} 영입(연봉 ${formatMoney(salary)}) 불가.`); else showAlert('영입 완료', `${name} 코치가 합류했습니다.`); }) },
    ]);
  const tryReleaseAsst = (id: string, name: string) =>
    showAlert('코치 방출', `${name} 코치를 방출하시겠습니까?\n\n전력 변화로 시즌을 다시 계산합니다.`, [
      { text: '취소', style: 'cancel' },
      { text: '방출', style: 'destructive', onPress: () => heavyAction(() => releaseAssistant(id)) },
    ]);
  const tryHireScout = (id: string, name: string, salary: number) =>
    showAlert('스카우터 영입', `${name}을(를) 영입하시겠습니까?\n연봉 ${formatMoney(salary)}`, [
      { text: '취소', style: 'cancel' },
      { text: '영입', onPress: () => { if (!hireScout(id)) overBudget(`${name} 영입(연봉 ${formatMoney(salary)}) 불가.`); } },
    ]);
  const tryReleaseScout = (id: string, name: string) =>
    showAlert('스카우터 방출', `${name}을(를) 방출하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      { text: '방출', style: 'destructive', onPress: () => releaseScout(id) },
    ]);

  const pct = Math.min(100, Math.round((spend / staffBudget()) * 100));

  return (
    <Screen title="스태프 계약">
      {/* 예산 바 */}
      <Card accent={theme.warn}>
        <Row>
          <IconLabel icon="wallet-outline" color={theme.warn}>스태프 예산</IconLabel>
          <Muted>{formatMoney(spend)} / {formatMoney(staffBudget())}</Muted>
        </Row>
        <View style={{ height: 8, backgroundColor: theme.cardAlt, borderRadius: 4, marginTop: 8, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: 8, backgroundColor: pct >= 95 ? theme.bad : pct >= 80 ? theme.warn : theme.good }} />
        </View>
        <Muted style={{ marginTop: 6 }}>여유 {formatMoney(left)}</Muted>
      </Card>

      {/* 감독 */}
      <Title>감독</Title>
      {slumping && !acting ? (
        <Muted style={{ color: theme.bad }}>⚠ 성적 부진({myRow!.wins}승 {myRow!.losses}패) — 감독 교체를 고려할 시점입니다.</Muted>
      ) : null}
      {head ? (
        <Card accent={theme.violet}>
          <Row>
            <Title>{head.name}</Title>
            <Muted>{head.age}세 · {head.salary > 0 ? `연봉 ${formatMoney(head.salary)}` : '대행'}</Muted>
          </Row>
          <Muted style={{ marginTop: 4 }}>성향 {STYLE_LABEL[head.style]} · 카리스마 {head.charisma} · {head.archetype}</Muted>
          {acting ? (
            <Muted style={{ color: theme.warn, marginTop: 4 }}>감독 대행 체제 — 정식 감독을 영입하세요(아래 시장).</Muted>
          ) : (() => {
            const yrs = head.contractYears ?? 0;
            const expiring = yrs <= 1;
            return (
              <View style={{ gap: 6, marginTop: 4 }}>
                <Row>
                  <Muted style={{ color: expiring ? theme.warn : theme.muted }}>
                    계약 {yrs <= 0 ? '만료 — 재계약 필요' : `잔여 ${yrs}년`}
                  </Muted>
                  {expiring ? (
                    <Button label="재계약(3년)" onPress={() => { if (resignCoach()) showAlert('재계약 완료', `${head.name} 감독과 3년 재계약했습니다.`); }} />
                  ) : null}
                </Row>
                <Button label="감독 경질" onPress={() => showAlert('감독 경질', `${head.name} 감독을 경질하시겠습니까? 전문 코치가 대행을 맡고, 그 감독은 우리 팀에 다시 오지 않습니다.`, [
                  { text: '취소', style: 'cancel' },
                  { text: '경질', style: 'destructive', onPress: () => heavyAction(() => { const r = fireCoach(); showAlert('경질 완료', r.acting ? `${r.acting} 코치가 감독 대행을 맡습니다.` : '대행할 코치가 없어 공석입니다. 감독을 영입하세요.'); }) },
                ])} />
              </View>
            );
          })()}
        </Card>
      ) : <Muted>감독 없음 — 시장에서 영입하세요</Muted>}
      <View style={{ marginTop: 8, marginBottom: 4 }}>
        <IconLabel icon="clipboard-outline" color={theme.violet}>감독 시장 (프리에이전트)</IconLabel>
      </View>
      {hasHeadCoach ? (
        <Muted style={{ color: theme.warn, marginBottom: 4 }}>현재 감독을 먼저 경질해야 새 감독을 영입할 수 있습니다.</Muted>
      ) : null}
      {availableCoaches(teamId).map((c) => (
        <Card key={c.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>{c.name}</Title>
              <Muted style={{ marginTop: 2 }}>{STYLE_LABEL[c.style]} · 카리스마 {c.charisma} · {c.archetype} · 연봉 {formatMoney(c.salary)}</Muted>
            </View>
            <Button label="영입" onPress={() => tryHireCoach(c.id, c.name, c.salary)} disabled={hasHeadCoach} />
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
              <Title>{SPECIALTY_KO[a.specialty]}{a.type ? ` · ${TYPE_KO[a.type]}` : ''} · {a.name}</Title>
              <Muted style={{ marginTop: 2 }}>{a.type ? TYPE_DESC[a.type] : SPECIALTY_DESC[a.specialty]} · 역량 {a.rating} · 연봉 {formatMoney(a.salary)}</Muted>
            </View>
            <Button label="방출" variant="ghost" onPress={() => tryReleaseAsst(a.id, a.name)} />
          </Row>
        </Card>
      ))}
      <Muted style={{ marginTop: 8, marginBottom: 4 }}>코치 시장 {asst.length >= coachSlots() ? '(슬롯 가득 — 방출 후 영입)' : ''}</Muted>
      {availableAssistants().map((a) => (
        <Card key={a.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>{SPECIALTY_KO[a.specialty]}{a.type ? ` · ${TYPE_KO[a.type]}` : ''} · {a.name}</Title>
              <Muted style={{ marginTop: 2 }}>{a.type ? TYPE_DESC[a.type] : SPECIALTY_DESC[a.specialty]} · 역량 {a.rating} · 연봉 {formatMoney(a.salary)}</Muted>
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
              <Muted style={{ marginTop: 2 }}>스카우팅 {s.scouting} · 연봉 {formatMoney(s.salary)}</Muted>
            </View>
            <Button label="방출" variant="ghost" onPress={() => tryReleaseScout(s.id, s.name)} />
          </Row>
        </Card>
      ))}
      <Muted style={{ marginTop: 8, marginBottom: 4 }}>스카우터 시장</Muted>
      {availableScouts().map((s) => (
        <Card key={s.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>{s.name}</Title>
              <Muted style={{ marginTop: 2 }}>스카우팅 {s.scouting} · 연봉 {formatMoney(s.salary)}</Muted>
            </View>
            <Button label="영입" onPress={() => tryHireScout(s.id, s.name, s.salary)} />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
