// 계정·데이터 삭제 안내(공개 정적 페이지) — 구글 플레이 데이터 삭제 정책 필수 URL(AUTH_SYSTEM §7).
// 앱 밖에서도 삭제를 요청할 수 있어야 한다: 앱 내 경로 안내 + 앱 접근 불가 시 문의 이메일 절차.
// 개인정보처리방침(data/legalText.ts PRIVACY 3·4·8조)과 정합 — 즉시 접근 차단 → 비필수 우선 파기 → 법정 보존분 만료 후 파기.
// 문의 이메일 기입 완료(2026-07-18): 개인정보 보호책임자 연락처, PRIVACY 11조와 동일 값.

export const metadata = {
  title: '배구명가 — 계정 및 데이터 삭제',
  description: '배구명가 계정 삭제(탈퇴) 및 개인정보 삭제 요청 안내',
};

const SUPPORT_EMAIL = 'bjpio113@gmail.com'; // 기입 완료(2026-07-18, PRIVACY 11조 보호책임자 연락처와 동일)

const card: React.CSSProperties = {
  background: '#111C2B',
  border: '1px solid #1E2E44',
  borderRadius: 14,
  padding: 20,
  marginTop: 16,
};
const h2: React.CSSProperties = { fontSize: 18, fontWeight: 800, marginBottom: 8 };
const muted: React.CSSProperties = { color: '#9FB0C4', lineHeight: 1.8 };

export default function DeleteAccount() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
      <h1 style={{ fontSize: 26, fontWeight: 900 }}>계정 및 데이터 삭제 안내</h1>
      <p style={muted}>
        배구명가(이하 &quot;서비스&quot;)는 이용자가 언제든지 계정을 삭제(탈퇴)하고 개인정보 삭제를 요청할 수 있도록 안내합니다.
        본 안내는 개인정보처리방침을 보완합니다.
      </p>

      <section style={card}>
        <h2 style={h2}>1. 앱에서 직접 삭제하기 (권장)</h2>
        <ol style={muted}>
          <li>배구명가 앱을 실행하고 로그인합니다.</li>
          <li>
            <strong>설정 → 데이터 → 계정 삭제</strong>를 선택합니다.
          </li>
          <li>보유 다이아·소멸 안내를 확인한 뒤 2단계 확인을 거쳐 삭제를 완료합니다.</li>
        </ol>
        <p style={muted}>삭제가 완료되면 즉시 로그인이 차단되며, 로그인 화면으로 돌아갑니다.</p>
      </section>

      <section style={card}>
        <h2 style={h2}>2. 앱에 접근할 수 없는 경우 (이메일 요청)</h2>
        <p style={muted}>
          기기 분실·앱 삭제 등으로 앱에서 직접 삭제할 수 없다면, 아래 이메일로 삭제를 요청할 수 있습니다.
        </p>
        <ul style={muted}>
          <li>
            받는 곳: <strong>{SUPPORT_EMAIL}</strong>
          </li>
          <li>제목: [계정 삭제 요청]</li>
          <li>본문: 가입에 사용한 소셜 로그인 종류(Google/Apple)와 삭제를 요청한다는 의사</li>
        </ul>
        <p style={muted}>
          본인 확인 후 지체 없이 처리하며, 처리 결과를 회신합니다.
        </p>
      </section>

      <section style={card}>
        <h2 style={h2}>3. 삭제되는 정보와 보존되는 정보</h2>
        <p style={muted}>
          계정을 삭제하면 소셜 계정 식별자와 표시 이름 등 개인을 식별할 수 있는 정보는 지체 없이 파기(복구 불가)됩니다.
        </p>
        <p style={muted}>
          다만 「전자상거래 등에서의 소비자보호에 관한 법률」 등 관련 법령에 따라 <strong>대금결제·재화 공급에 관한 기록은 5년</strong>,
          <strong> 소비자 불만·분쟁 처리에 관한 기록은 3년</strong> 동안 보존되며, 이 기록은 개인을 식별할 수 없도록 처리(가명화)되어
          보존기간이 만료되면 파기됩니다.
        </p>
        <p style={muted}>
          계정을 삭제하면 보유하고 있던 유상 다이아와 게임 진행 데이터의 연동이 소멸하며, 같은 소셜 계정으로 다시 로그인하더라도
          새 계정으로 시작됩니다. 결제 환불이 필요한 경우 <strong>탈퇴 전에</strong> 앱 내 &quot;문의하기&quot; 또는 위 이메일로 먼저
          문의해 주세요.
        </p>
      </section>

      <p style={{ ...muted, marginTop: 24, fontSize: 13 }}>
        문의: {SUPPORT_EMAIL} · 개인정보의 상세한 처리 기준은 개인정보처리방침을 따릅니다.
      </p>
    </main>
  );
}
