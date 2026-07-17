// 운영·환불 정책(공개 정적 페이지 · 인증 없음 공개 GET). 스토어 심사·앱 링크 URL(/terms).
// 정합 기준: 앱 내 정본 data/legalText.ts(약관 제5·9·12조·운영정책)  + 종료 정책 MONETIZATION_SYSTEM §14.2
//   + 환불 산정 규칙 docs/SHUTDOWN_POLICY.md(무상 우선 소진). 이 페이지는 이용자 대면 요약(경량 약관 성격).
// ⚠ 출시 전 사용자 기입: {사업자 상호}. 문의 이메일은 확정값(bjpio113@gmail.com).

export const metadata = {
  title: '배구명가 — 운영·환불 정책',
  description: '배구명가 운영·환불 정책 (유료 재화·청약철회·환불·서비스 종료 고지)',
};
export const dynamic = 'force-static';

const SUPPORT_EMAIL = 'bjpio113@gmail.com';

const card: React.CSSProperties = {
  background: '#111C2B',
  border: '1px solid #1E2E44',
  borderRadius: 14,
  padding: 20,
  marginTop: 16,
};
const h2: React.CSSProperties = { fontSize: 18, fontWeight: 800, marginBottom: 10 };
const muted: React.CSSProperties = { color: '#9FB0C4', lineHeight: 1.85, margin: '6px 0' };
const li: React.CSSProperties = { color: '#9FB0C4', lineHeight: 1.85 };

export default function Terms() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 32 }}>
      <h1 style={{ fontSize: 26, fontWeight: 900 }}>운영·환불 정책</h1>
      <p style={muted}>
        본 정책은 &quot;배구명가&quot;(이하 &quot;서비스&quot;)의 유료 재화·환불·서비스 종료에 관한 기준을 안내합니다. 상세한
        이용 조건은 앱 내 <strong>이용약관·운영정책</strong>을, 개인정보 처리는 <strong>개인정보처리방침</strong>을 따릅니다.
      </p>
      <p style={{ ...muted, fontSize: 13 }}>시행일: 2026-07-17</p>

      <section style={card}>
        <h2 style={h2}>1. 유료 재화(다이아)</h2>
        <ul style={li}>
          <li>
            &quot;다이아&quot;는 서비스 내 재화로, 인앱결제로 구매한 <strong>유상 다이아</strong>와 광고 시청·업적 보상·쿠폰·
            최초 지급 등으로 획득한 <strong>무상 다이아</strong>로 구분되며, 획득 경로는 서버 원장에 기록·관리됩니다.
          </li>
          <li>
            다이아 사용 시에는 <strong>무상 다이아가 먼저 소진</strong>됩니다(이용자에게 유리 — 유상 잔여를 최대한 보존). 다이아는
            현금으로 교환·환전·양도되지 않습니다.
          </li>
          <li>다이아 잔액·사용·적립의 최종 기준은 서버 기록이며, 앱 화면의 값은 표시용으로 일시적으로 다를 수 있습니다.</li>
        </ul>
      </section>

      <section style={card}>
        <h2 style={h2}>2. 청약철회·환불</h2>
        <ul style={li}>
          <li>
            결제 환불은 <strong>Google Play·App Store의 환불 절차</strong>에 따라 처리됩니다. 결제의 판매 주체는 각 스토어이며,
            운영자는 앱에서 직접 카드 결제를 환불하지 않습니다. 환불 문의는 앱 내 <strong>&quot;문의하기&quot;(환불 카테고리)</strong>로도
            접수할 수 있습니다.
          </li>
          <li>
            구매 후 사용하지 않은 유상 다이아는 「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 청약철회(환불)할 수 있습니다.
          </li>
          <li>
            <strong>이미 사용한 다이아와 무상 다이아는 환불 대상이 아닙니다.</strong> 정상적으로 소비된 다이아, 정상적으로 진행된
            특별훈련·FA·시즌 결과는 복구 대상이 아닙니다.
          </li>
          <li>
            환불이 이루어지면 해당 재화는 회수되며, 이 과정에서 다이아 잔액이 음수(부채)로 표시될 수 있고 이 경우 추가 사용이
            제한됩니다.
          </li>
          <li>미성년자가 법정대리인의 동의 없이 결제한 경우, 본인 또는 법정대리인은 각 스토어 절차 또는 문의하기로 취소를 신청할 수 있습니다.</li>
        </ul>
      </section>

      <section style={card}>
        <h2 style={h2}>3. 서비스 종료 정책</h2>
        <ul style={li}>
          <li>
            서비스 전부를 종료하는 경우, 운영자는 종료 예정일 <strong>최소 30일 전</strong>부터 앱 내 공지 및 이메일 등으로 종료일과
            사유를 고지합니다.
          </li>
          <li>고지 이후 종료일까지 유상 다이아의 신규 구매가 중단됩니다.</li>
          <li>
            서비스 종료 시 이용자가 보유한 <strong>미사용 유상 다이아</strong>는 관련 법령 및 공정거래위원회 모바일게임 표준약관,
            콘텐츠이용자보호지침에 따라 <strong>환불</strong>합니다. 무상 다이아는 환불 대상이 아닙니다.
          </li>
          <li>환불 절차와 신청 기간은 종료 고지와 함께 안내하며, 종료 후에도 일정 기간(최소 30일) 환불 문의 창구를 운영합니다.</li>
        </ul>
      </section>

      <section style={card}>
        <h2 style={h2}>4. 문의 채널</h2>
        <p style={muted}>
          문의는 앱 내 <strong>&quot;문의하기&quot;</strong>로 접수되며 접수 순서대로 처리됩니다. 앱에 접근할 수 없는 경우 아래
          이메일로 문의할 수 있습니다.
        </p>
        <p style={muted}>
          연락처: <strong>{SUPPORT_EMAIL}</strong>
        </p>
      </section>

      <p style={{ ...muted, marginTop: 24, fontSize: 13 }}>
        본 정책은 대한민국 법률을 따릅니다. 정책 변경 시 시행 전 앱 공지사항으로 고지합니다. · 시행일 2026-07-17
      </p>
    </main>
  );
}
