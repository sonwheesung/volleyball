import { Text } from 'react-native';
import { Card, Muted, Screen } from '../../components/Screen';

export default function Dashboard() {
  return (
    <Screen title="구단 현황">
      <Card>
        <Text style={{ color: '#f8fafc', fontSize: 16, fontWeight: '600' }}>백년배구</Text>
        <Muted>모바일 배구 단장/감독 시뮬레이션. 가상 V리그(여자부)를 수십 시즌 운영합니다.</Muted>
      </Card>
      <Card>
        <Muted>아직 시즌 데이터가 없습니다. Phase 2에서 가상 리그 시드를 생성합니다.</Muted>
      </Card>
    </Screen>
  );
}
