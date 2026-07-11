import Link from "next/link";

function AcademyLogo() {
  return (
    <div className="academy-brand official-logo" style={{ justifyContent: "center", alignItems: "center" }}>
      <img className="academy-logo-img" src="/academy-logo.png" alt="목동유쌤영어학원" />
      <div className="academy-subname">e강의평가 리포트 시스템</div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="survey-wrap">
      <div className="card" style={{ textAlign: "center" }}>
        <AcademyLogo />
        <div className="brand" style={{ marginTop: 14 }}>e강의평가</div>
        <h1 className="h1" style={{ marginTop: 18 }}>QR 기반 강의평가 웹앱</h1>
        <p className="muted">
          관리자 대시보드에서 선생님·반별 QR을 만들고, 학생은 QR로 접속해 비로그인 설문을 제출합니다.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
          <Link className="btn" href="/admin">관리자 화면 열기</Link>
        </div>
      </div>
    </main>
  );
}
