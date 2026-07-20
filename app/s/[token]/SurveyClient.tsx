"use client";

import { useEffect, useMemo, useState } from "react";
import { SCALE_OPTIONS } from "@/lib/score";

function AcademyLogo() {
  return (
    <div className="academy-brand official-logo">
      <img className="academy-logo-img" src="/academy-logo.png" alt="목동유쌤영어학원" />
      <div className="academy-subname">e강의평가 리포트 시스템</div>
    </div>
  );
}

export default function SurveyClient({ token }: { token: string }) {
  const [survey, setSurvey] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [studentName, setStudentName] = useState("");
  const [agree, setAgree] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [complete, setComplete] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // 같은 기기 재접근 차단을 제거했습니다. (핸드폰을 빌려 여러 학생이 제출하는 경우를 위해)
    async function loadSurvey() {
      try {
        const res = await fetch(`/api/survey/${token}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "설문을 불러오지 못했습니다.");
        setSurvey(body);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadSurvey();
  }, [token]);

  function startNextStudent() {
    // 빌린 기기에서 다음 학생이 이어서 제출할 수 있도록 입력값을 초기화합니다.
    setComplete(null);
    setStudentName("");
    setAnswers({});
    setAgree(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  const teacherName = survey?.teacher?.name || "";
  const className = survey?.classItem?.name || "";
  const periodTitle = survey?.period?.title || "";

  const visibleQuestions = useMemo(() => {
    const qs = survey?.questions || [];
    return qs.filter((q: any) => {
      const meta = q.metadata || {};
      if (meta.show_if_question_code) {
        const target = answers[meta.show_if_question_code];
        if (target === undefined || target === null || target === "") return false;
        return Number(target?.score ?? target) <= Number(meta.show_if_score_lte ?? 25);
      }
      return true;
    });
  }, [survey, answers]);

  function setAnswer(question: any, value: any) {
    setAnswers((prev) => ({ ...prev, [question.code]: value }));
  }

  function questionTitle(question: any) {
    return question.title.replaceAll("{teacher_name}", teacherName);
  }

  function validate() {
    if (!studentName.trim()) return "본인 이름을 입력해주세요.";
    if (!agree) return "작성 책임 안내에 동의해주세요.";

    for (const question of visibleQuestions) {
      if (!question.is_required) continue;
      const value = answers[question.code];
      if (value === undefined || value === null || value === "") {
        return `"${questionTitle(question)}" 문항에 답변해주세요.`;
      }
    }
    return "";
  }

  async function submit() {
    const validationError = validate();
    if (validationError) {
      alert(validationError);
      return;
    }

    if (!confirm("입력한 이름과 설문 내용을 제출하시겠습니까?\n제출 후에는 학생 화면에서 수정할 수 없습니다.")) {
      return;
    }

    try {
      const deviceKey = localStorage.getItem("e-evaluation-device-key") || crypto.randomUUID();
      localStorage.setItem("e-evaluation-device-key", deviceKey);

      const res = await fetch(`/api/survey/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentName: studentName.trim(), answers, deviceKey })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "제출에 실패했습니다.");
      setComplete(body.complete);
    } catch (err: any) {
      alert(err.message);
    }
  }

  if (loading) {
    return <main className="survey-wrap"><div className="card">설문을 불러오는 중입니다.</div></main>;
  }

  if (error) {
    return (
      <main className="survey-wrap">
        <div className="card">
          <h1 className="h1">설문을 열 수 없습니다</h1>
          <p className="muted">{error}</p>
        </div>
      </main>
    );
  }

  if (complete) {
    return (
      <main className="survey-wrap">
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
            <AcademyLogo />
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <div className="complete-mark">✓</div>
          </div>
          <h1 className="h1">제출 완료</h1>
          <p style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.04em" }}>
            {complete.studentName} 학생이 작성한<br />
            {complete.teacherName} 선생님 강의평가가<br />
            정상적으로 제출되었습니다.
          </p>
          <div className="notice" style={{ textAlign: "left", marginTop: 18 }}>
            <b>반</b><br />{complete.className || "-"}<br /><br />
            <b>제출 시간</b><br />{new Date(complete.submittedAt).toLocaleString("ko-KR")}
          </div>
          <p className="muted">이 화면을 관리자에게 보여주세요.</p>
          <button className="btn secondary full" style={{ marginTop: 18 }} onClick={startNextStudent}>
            다른 학생 제출하기
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            핸드폰을 빌려서 이어서 제출하는 경우, 이 버튼을 눌러 다음 학생 설문을 시작하세요.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="survey-wrap">
      <div className="card">
        <AcademyLogo />
        <div className="brand" style={{ marginTop: 14 }}>e강의평가</div>
        <h1 className="h1" style={{ marginTop: 18 }}>{periodTitle}</h1>
        <div className="notice">
          <b>평가 대상</b><br />{teacherName} 선생님<br /><br />
          <b>반</b><br />{className || "반 미지정"}
        </div>
        <p className="muted">
          본 설문은 수업 개선을 위한 강의평가입니다. 담당 선생님에게는 학생 이름이 공개되지 않습니다.
          단, 비속어·타인 비하·허위 작성 방지를 위해 관리자는 제출자 이름을 확인할 수 있습니다.
        </p>
      </div>

      <div className="card">
        <div className="form-row" style={{ marginTop: 0 }}>
          <label className="label">학생 이름</label>
          <input className="input" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="본인 이름을 정확히 입력해주세요" />
        </div>
        <div className="form-row">
          <label className="choice" style={{ justifyContent: "flex-start" }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>본인의 이름으로 책임 있게 작성하고, 제출 완료 화면을 관리자에게 보여주겠습니다.</span>
          </label>
        </div>
      </div>

      <div className="card">
        <h2 className="h2">설문 문항</h2>
        {visibleQuestions.map((question: any, index: number) => (
          <div className="question" key={question.id}>
            <h3 className="h3">{index + 1}. {questionTitle(question)}</h3>
            {question.help_text && <p className="muted">{question.help_text.replaceAll("{teacher_name}", teacherName)}</p>}

            {question.question_type === "scale_5" && (
              <div className="choice-grid">
                {SCALE_OPTIONS.map((option) => (
                  <label className="choice" key={option.label}>
                    <span>{option.label}</span>
                    <input
                      type="radio"
                      name={question.code}
                      checked={answers[question.code]?.score === option.score}
                      onChange={() => setAnswer(question, { label: option.label, score: option.score })}
                    />
                  </label>
                ))}
              </div>
            )}

            {question.question_type === "yes_no" && (
              <div className="choice-grid">
                <label className="choice">
                  <span>아니오</span>
                  <input
                    type="radio"
                    name={question.code}
                    checked={answers[question.code]?.booleanValue === false}
                    onChange={() => setAnswer(question, { label: "아니오", booleanValue: false })}
                  />
                </label>
                <label className="choice">
                  <span>네</span>
                  <input
                    type="radio"
                    name={question.code}
                    checked={answers[question.code]?.booleanValue === true}
                    onChange={() => setAnswer(question, { label: "네", booleanValue: true })}
                  />
                </label>
              </div>
            )}

            {question.question_type === "text" && (
              <textarea
                className="textarea"
                value={answers[question.code]?.text || ""}
                onChange={(e) => setAnswer(question, { text: e.target.value })}
                placeholder="자유롭게 작성해주세요"
              />
            )}
          </div>
        ))}

        <div className="form-row">
          <button className="btn full" onClick={submit}>제출하기</button>
        </div>
      </div>
    </main>
  );
}
