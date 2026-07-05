// 개인정보처리방침 (마이페이지 → 개인정보처리방침). 원문 data/legalText.ts.
import { LegalScreen } from '../components/LegalScreen';
import { PRIVACY } from '../data/legalText';

export default function Privacy() {
  return <LegalScreen doc={PRIVACY} />;
}
