// 운영정책 (마이페이지 → 정책). 원문 data/legalText.ts.
import { LegalScreen } from '../components/LegalScreen';
import { POLICY } from '../data/legalText';

export default function Policy() {
  return <LegalScreen doc={POLICY} />;
}
