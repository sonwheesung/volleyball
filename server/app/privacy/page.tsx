// 개인정보처리방침(공개 정적 페이지 · 인증 없음 공개 GET). 스토어 심사·앱 링크의 필수 URL(/privacy).
// 정합 기준: 실서비스 수집 실태(server/db/schema.ts users — providerId(sub)만, 이메일·이름 미저장 / auth/login 최소수집)
//   + 앱 내 정본 data/legalText.ts PRIVACY + 보존기간 BACKEND_SYSTEM §13.9. 두 곳과 어긋나면 안 됨(드리프트 금지).
// 사업자 기입 완료(2026-07-18, 사업자등록증 대조): 상호 휘성게임즈. 연락처 이메일은 확정값(bjpio113@gmail.com).

export const metadata = {
  title: '배구명가 — 개인정보처리방침',
  description: '배구명가 개인정보처리방침 (수집 항목·목적·보유기간·위탁·국외이전·이용자 권리)',
};
export const dynamic = 'force-static';

const SUPPORT_EMAIL = 'bjpio113@gmail.com'; // 개인정보 보호책임자 연락처(확정값)

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

export default function Privacy() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 32 }}>
      <h1 style={{ fontSize: 26, fontWeight: 900 }}>개인정보처리방침</h1>
      <p style={muted}>
        휘성게임즈(이하 &quot;운영자&quot;)는 「개인정보 보호법」 등 관련 법령을 준수하며, &quot;배구명가&quot;(이하
        &quot;서비스&quot;) 이용자의 개인정보를 아래와 같이 처리합니다. 본 방침은 최소한의 개인정보만 수집하는 것을
        원칙으로 합니다.
      </p>
      <p style={{ ...muted, fontSize: 13 }}>시행일: 2026-07-17</p>

      <section style={card}>
        <h2 style={h2}>1. 수집하는 개인정보 항목</h2>
        <ul style={li}>
          <li>
            <strong>계정(소셜 로그인)</strong>: 소셜 계정 고유 식별자(구글·애플이 제공하는 계정 식별 값 &quot;sub&quot;).
            운영자는 이메일 주소·이름·프로필 사진은 저장하지 않습니다.
          </li>
          <li>
            <strong>기기·앱 정보(진단)</strong>: 플랫폼(iOS/Android)·OS 버전·앱 버전·마지막 접속 일시. 문의 시 첨부됩니다.
          </li>
          <li>
            <strong>결제 기록</strong>: 인앱결제 검증 내역(스토어 거래 식별자·구매 상품·재화 지급/차감 내역). 신용카드번호 등
            결제수단 정보는 각 스토어·결제대행사가 처리하며 운영자는 저장하지 않습니다.
          </li>
          <li>
            <strong>문의 내용 + 진단 스냅샷</strong>: 이용자가 입력한 문의 내용과, 제출 시점의 최근 플레이 진단 데이터(최근 시즌
            저장 데이터 재생본 — 가상 선수·구단 기록으로 개인 식별정보를 포함하지 않음, 선택 첨부).
          </li>
          <li>
            <strong>광고 식별자</strong>: 앱 내 광고 제공을 위해 Google AdMob이 광고 식별자(ADID) 등 기기 정보를 수집·이용할 수
            있습니다. 이용자는 기기 설정에서 광고 식별자를 재설정하거나 맞춤 광고를 제한할 수 있습니다.
          </li>
        </ul>
      </section>

      <section style={card}>
        <h2 style={h2}>2. 개인정보의 수집·이용 목적</h2>
        <ul style={li}>
          <li>계정 식별·재화(다이아) 관리, 기기 변경 시 구매·재화 내역의 연속성 유지</li>
          <li>인앱결제 검증·환불 처리, 부정 이용 방지</li>
          <li>고객 문의 대응·서비스 오류 진단 및 품질 개선</li>
          <li>관련 법령상 의무 이행(거래·분쟁 기록 보존 등)</li>
          <li>앱 내 광고 제공</li>
        </ul>
      </section>

      <section style={card}>
        <h2 style={h2}>3. 개인정보의 보유 및 이용기간</h2>
        <p style={muted}>
          수집·이용 목적이 달성되면 지체 없이 파기합니다. 다만 관련 법령에 따라 아래 기간 동안 보존합니다.
        </p>
        <ul style={li}>
          <li>대금결제·재화 공급 및 계약·청약철회 기록: <strong>5년</strong>(전자상거래 등에서의 소비자보호에 관한 법률)</li>
          <li>소비자 불만·분쟁 처리 기록: <strong>3년</strong>(동법)</li>
          <li>표시·광고 기록: <strong>6개월</strong>(동법)</li>
          <li>문의 진단 스냅샷: <strong>90일</strong>(진단 목적 달성 후 파기)</li>
          <li>게임 재화 원장 중 비결제분(광고·업적·특별훈련 등): 2년</li>
        </ul>
        <p style={muted}>
          이용자는 앱 내에서 <strong>계정 삭제(탈퇴)</strong> 기능을 직접 이용할 수 있으며, 계정을 삭제하면 로그인·플레이가 즉시
          차단되고 개인 식별정보는 지체 없이 파기됩니다. 다만 위 법정 보존 대상은 개인을 식별할 수 없도록 처리(가명화)하여
          보존기간 만료 후 파기합니다.
        </p>
      </section>

      <section style={card}>
        <h2 style={h2}>4. 개인정보 처리의 위탁 및 국외 이전</h2>
        <p style={muted}>운영자는 서비스 운영을 위해 아래와 같이 개인정보 처리를 위탁합니다.</p>
        <ul style={li}>
          <li>
            <strong>Supabase</strong>(데이터베이스 호스팅, 리전: 대한민국 서울) — 계정 식별자·재화 원장·문의 등 데이터 저장
          </li>
          <li>
            <strong>Vercel Inc.</strong>(미국, 서버·애플리케이션 호스팅) — 서버 요청 처리(계정 식별자·요청 기록)
          </li>
          <li>
            <strong>RevenueCat, Inc.</strong>(미국, 인앱결제 검증) — 결제 영수증 검증(거래 식별자·구매 내역)
          </li>
          <li>
            <strong>Google LLC / Apple Inc.</strong>(미국) — 소셜 로그인·스토어 결제·AdMob 광고(계정 식별 값·거래 식별자·광고
            식별자)
          </li>
        </ul>
        <p style={muted}>
          위 국외 사업자의 서비스 처리 과정에서 개인정보의 일부가 국외에서 처리될 수 있으며, 이전 목적·항목은 위와 같습니다.
          이용자는 국외 이전을 거부할 수 있으나, 거부 시 일부 또는 전부의 서비스 이용이 제한될 수 있습니다.
        </p>
      </section>

      <section style={card}>
        <h2 style={h2}>5. 만 14세 미만 아동의 개인정보</h2>
        <p style={muted}>
          본 서비스는 만 14세 미만 아동의 개인정보를 수집하지 않는 것을 원칙으로 하며, 가입(소셜 로그인) 시 연령 확인 절차를
          통해 만 14세 미만의 가입을 제한합니다. 만 14세 미만 아동이 법정대리인의 동의 없이 가입한 사실이 확인되면 운영자는
          지체 없이 해당 계정과 수집된 정보를 파기합니다.
        </p>
      </section>

      <section style={card}>
        <h2 style={h2}>6. 이용자의 권리와 행사 방법</h2>
        <p style={muted}>
          이용자는 언제든지 자신의 개인정보에 대한 <strong>열람·정정·삭제·처리정지</strong>를 요구할 수 있으며, 동의를 철회(계정
          삭제)할 수 있습니다. 권리 행사는 앱 내 <strong>&quot;문의하기&quot;</strong> 또는 <strong>설정 → 계정 삭제</strong>로 할 수
          있으며, 운영자는 지체 없이 조치합니다.
        </p>
      </section>

      <section style={card}>
        <h2 style={h2}>7. 개인정보 보호책임자</h2>
        <ul style={li}>
          <li>개인정보 보호책임자: 배구명가 운영자</li>
          <li>
            연락처: <strong>{SUPPORT_EMAIL}</strong> (또는 앱 내 &quot;문의하기&quot;)
          </li>
        </ul>
        <p style={{ ...muted, fontSize: 13 }}>
          기타 개인정보 침해 상담·신고: 개인정보분쟁조정위원회(1833-6972), 개인정보침해신고센터(118).
        </p>
      </section>

      <p style={{ ...muted, marginTop: 24, fontSize: 13 }}>
        본 방침의 내용 추가·삭제·수정이 있을 경우 시행 전 앱 공지사항을 통해 고지합니다. · 시행일 2026-07-17
      </p>
    </main>
  );
}
