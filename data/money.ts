// 요약 표면용 금액 축약 — 억 소수1자리 / 만, 음수·큰 값 정합.
// engine/salary.formatMoney는 양수만 억으로 접어(음수 큰 값이 "-11943만"으로 남는 결함) 홈 순익 요약에서 어긋난다.
// ~~상세·결산 화면은 계속 formatMoney(정밀) 유지~~ → 정정(2026-07-11, 사용자 결정): 결산(카드·상세)의 **순익**도
// short 적용(음수 큰 값 "-11943만" 방지). 수입/지출 개별 항목은 계속 formatMoney(정밀).

/** 절대값 1억(=10000만) 이상 → "X.X억", 미만 → "XXXX만". 음수는 앞에 '-'. (양수 '+'는 호출부가 붙인다) */
export function formatMoneyShort(won: number): string {
  const sign = won < 0 ? '-' : '';
  const abs = Math.abs(won);
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}억`;
  return `${sign}${abs}만`;
}
