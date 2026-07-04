// 일정(캘린더) 전용 화면 — 일정 화면 "일정 보러 가기"에서 진입.
import { useMemo } from 'react';
import { Calendar } from '../components/Calendar';
import { Screen } from '../components/Screen';
import { SEASON } from '../data/league';
import { seasonYear } from '../data/seasonLabel';
import { teamScheduleEntries } from '../engine/season';
import { planNextAction } from '../engine/advance';
import { useGameStore } from '../store/useGameStore';

export default function CalendarScreen() {
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const results = useGameStore((s) => s.results);
  const season = useGameStore((s) => s.season);

  const entries = useMemo(() => teamScheduleEntries(SEASON, teamId), [teamId]);
  const action = planNextAction(SEASON, teamId, results);
  const focusDayIndex = action.kind === 'match' ? action.fixture.dayIndex : 0;

  return (
    <Screen title={`${seasonYear(season)} 일정`} scroll={false}>
      <Calendar entries={entries} results={results} focusDayIndex={focusDayIndex} />
    </Screen>
  );
}
