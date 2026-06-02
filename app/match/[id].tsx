import { useLocalSearchParams } from 'expo-router';
import { Card, Muted, Screen } from '../../components/Screen';

export default function MatchBoard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Screen title="경기 보드">
      <Card>
        <Muted>경기 #{id ?? '—'} — 코트 + 마커 + 점수판 + 경기 로그. 엔진 상태를 렌더합니다. (Phase 1)</Muted>
      </Card>
    </Screen>
  );
}
