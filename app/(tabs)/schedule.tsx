import { Card, Muted, Screen } from '../../components/Screen';

export default function Schedule() {
  return (
    <Screen title="일정 / 경기">
      <Card>
        <Muted>시즌 일정과 경기 결과가 표시됩니다. 중요 경기는 "직접 지휘"로 진입합니다. (Phase 3~4)</Muted>
      </Card>
    </Screen>
  );
}
