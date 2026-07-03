// 이용약관 (마이페이지 → 약관). 원문 data/legalText.ts.
import { LegalScreen } from '../components/LegalScreen';
import { TERMS } from '../data/legalText';

export default function Terms() {
  return <LegalScreen doc={TERMS} />;
}
