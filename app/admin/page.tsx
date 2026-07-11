
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { formatScore, maskTeacherName, monthLabel } from "@/lib/score";

const APP_VERSION = "v2.6.18";
const TOAST_AUTO_CLOSE_MS = 9000;
const REPORT_CLASS_MAPPINGS_STORAGE_KEY = "e-evaluation-report-class-mappings-v267";
const VERCEL_SAFE_UPLOAD_BYTES = 4 * 1024 * 1024;

type TabKey =
  | "home"
  | "checklist"
  | "periods"
  | "teachers"
  | "classes"
  | "assignments"
  | "bulk"
  | "legacyUpload"
  | "classMappings"
  | "safety"
  | "dataDelete"
  | "backup"
  | "setup"
  | "admins"
  | "qr"
  | "responses"
  | "results"
  | "withdrawal"
  | "report"
  | "reportLinks"
  | "exports";

const tabs: { key: TabKey; label: string }[] = [
  { key: "home", label: "홈" },
  { key: "checklist", label: "운영 체크리스트" },
  { key: "periods", label: "평가월 관리" },
  { key: "teachers", label: "선생님 관리" },
  { key: "classes", label: "반 관리" },
  { key: "assignments", label: "선생님-반 배정" },
  { key: "bulk", label: "일괄 등록" },
    { key: "safety", label: "운영 안전" },
  { key: "dataDelete", label: "데이터 삭제" },
  { key: "backup", label: "데이터 백업" },
  { key: "legacyUpload", label: "응답 업로드" },
  { key: "setup", label: "초기 세팅" },
  { key: "admins", label: "관리자 계정" },
  { key: "qr", label: "QR 출력" },
  { key: "responses", label: "제출 현황" },
  { key: "results", label: "결과 분석" },
  { key: "withdrawal", label: "퇴원율 입력" },
  { key: "report", label: "PDF/웹 리포트 생성" },
  { key: "reportLinks", label: "리포트 링크 관리" },
  { key: "exports", label: "출력 이력/다운로드" }
];

const menuGroups: { title: string; description: string; items: TabKey[] }[] = [
  {
    title: "운영 현황",
    description: "이번 달 진행 상태를 확인합니다.",
    items: ["home", "checklist"]
  },
  {
    title: "기본 설정",
    description: "평가월, 선생님, 반, 배정을 준비합니다.",
    items: ["periods", "teachers", "classes", "assignments", "bulk"]
  },
  {
    title: "설문 운영",
    description: "QR 배포와 응답 현황을 관리합니다.",
    items: ["qr", "legacyUpload", "responses", "results"]
  },
  {
    title: "결과지",
    description: "퇴원율 입력, PDF·웹 리포트, 발송 이력을 관리합니다.",
    items: ["withdrawal", "report", "reportLinks", "exports"]
  },
  {
    title: "시스템",
    description: "초기 점검과 관리자 계정을 관리합니다.",
    items: ["safety", "dataDelete", "backup", "setup", "admins"]
  }
];

const tabLabelMap = Object.fromEntries(tabs.map((item) => [item.key, item.label])) as Record<TabKey, string>;

const statusLabels: Record<string, string> = {
  draft: "준비중",
  open: "진행중",
  closed: "마감",
  archived: "보관"
};

const exportStatusLabels: Record<string, string> = {
  created: "서버 보관",
  printed: "출력 완료",
  failed: "실패",
  archived: "보관 처리"
};

const responseImportStatusLabels: Record<string, string> = {
  previewed: "미리보기",
  imported: "업로드 완료",
  rolled_back: "롤백 완료",
  failed: "실패"
};

const roleLabels: Record<string, string> = {
  super_admin: "총괄관리자",
  general_admin: "일반관리자"
};

const tabPermissions: Record<string, string[]> = {
  home: ["super_admin", "general_admin"],
  checklist: ["super_admin", "general_admin"],
  periods: ["super_admin", "general_admin"],
  teachers: ["super_admin", "general_admin"],
  classes: ["super_admin", "general_admin"],
  assignments: ["super_admin", "general_admin"],
  bulk: ["super_admin", "general_admin"],
  classMappings: ["super_admin", "general_admin"],
  safety: ["super_admin", "general_admin"],
  dataDelete: ["super_admin"],
  backup: ["super_admin", "general_admin"],
  legacyUpload: ["super_admin", "general_admin"],
  setup: ["super_admin"],
  admins: ["super_admin"],
  qr: ["super_admin", "general_admin"],
  responses: ["super_admin", "general_admin"],
  results: ["super_admin", "general_admin"],
  withdrawal: ["super_admin"],
  report: ["super_admin", "general_admin"],
  reportLinks: ["super_admin", "general_admin"],
  exports: ["super_admin", "general_admin"]
};

function canUseTab(role: string | undefined, key: string) {
  return Boolean(role && (tabPermissions[key] || []).includes(role));
}

function thisMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonth() {
  const now = new Date();
  now.setMonth(now.getMonth() + 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthTitleFromYearMonth(yearMonth: string) {
  const month = Number(String(yearMonth || "").split("-")[1]);
  return Number.isFinite(month) && month > 0 ? `${month}월 강의평가` : "";
}

function makeMonthOptions(back = 3, forward = 18) {
  const base = new Date();
  base.setDate(1);
  const rows: { value: string; label: string }[] = [];
  for (let offset = -back; offset <= forward; offset += 1) {
    const item = new Date(base);
    item.setMonth(base.getMonth() + offset);
    const value = `${item.getFullYear()}-${String(item.getMonth() + 1).padStart(2, "0")}`;
    rows.push({ value, label: `${item.getFullYear()}년 ${item.getMonth() + 1}월` });
  }
  return rows;
}

function defaultPeriodForm() {
  const ym = nextMonth();
  return {
    year_month: ym,
    title: monthTitleFromYearMonth(ym),
    start_date: "",
    end_date: "",
    status: "draft",
    is_active: true
  };
}

const emptyTeacherForm = {
  teacher_code: "",
  name: "",
  display_name: "",
  subject: "영어",
  slack_email: "",
  slack_user_id: "",
  memo: "",
  is_active: true
};

const emptyClassForm = {
  name: "",
  grade: "",
  day_pattern: "",
  campus: "",
  memo: "",
  is_active: true
};

const emptyAdminForm = {
  email: "",
  name: "",
  role: "general_admin",
  password: "",
  memo: "",
  is_active: true
};


function AcademyLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`academy-brand official-logo ${compact ? "compact" : ""}`}>
      <img
        className="academy-logo-img"
        src="/academy-logo.png"
        alt="목동유쌤영어학원"
      />
      {!compact && <div className="academy-subname">e강의평가 리포트 시스템</div>}
    </div>
  );
}

function ReportAcademyBrand() {
  return (
    <div className="report-academy-brand">
      <img
        className="report-logo-img"
        src="/academy-logo.png"
        alt="목동유쌤영어학원"
      />
      <div>
        <span>e강의평가 리포트</span>
      </div>
    </div>
  );
}

function getAnswers(response: any) {
  return response?.evaluation_answers || [];
}

function getAnswerByCode(response: any, code: string) {
  return getAnswers(response).find((answer: any) => answer.evaluation_questions?.code === code);
}

function hasPressureFlag(response: any) {
  return getAnswerByCode(response, "pressure_or_reward")?.boolean_value === true;
}

function responseStatusLabels(response: any) {
  const labels: string[] = [];
  if (response?.is_flagged) labels.push("검토 필요");
  if (response?.is_duplicate_suspected) labels.push("중복 의심");
  if (!labels.length) labels.push("정상");
  return labels;
}

function answerDisplay(answer: any) {
  if (!answer) return "-";
  if (answer.text_value) return answer.text_value;
  if (answer.choice_label) return answer.choice_label;
  if (answer.score_value !== null && answer.score_value !== undefined) return `${answer.score_value}점`;
  if (answer.boolean_value === true) return "네";
  if (answer.boolean_value === false) return "아니오";
  return "-";
}

function formatDateTime(value: any) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR");
}


function buildNumericRankMap(
  rows: any[],
  valueGetter: (row: any) => any,
  direction: "asc" | "desc" = "desc"
) {
  const sortable = (rows || [])
    .map((row: any) => ({
      id: String(row.teacher_id || row.id || ""),
      value: Number(valueGetter(row))
    }))
    .filter((row: any) => row.id && Number.isFinite(row.value))
    .sort((a: any, b: any) => direction === "asc" ? a.value - b.value : b.value - a.value);

  const rankMap = new Map<string, number>();
  let previousValue: number | null = null;
  let currentRank = 0;

  sortable.forEach((row: any, index: number) => {
    if (previousValue === null || Math.abs(row.value - previousValue) > 0.0049) {
      currentRank = index + 1;
      previousValue = row.value;
    }
    rankMap.set(row.id, currentRank);
  });

  return rankMap;
}

function xmlEscape(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function excelColumnName(index: number) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
}

function worksheetXml(rows: any[][]) {
  const safeRows = rows.length ? rows : [["데이터 없음"]];
  const sheetData = safeRows.map((row, rowIndex) => {
    const cells = row.map((cell, colIndex) => {
      const ref = `${excelColumnName(colIndex)}${rowIndex + 1}`;
      const isNumber = typeof cell === "number" && Number.isFinite(cell);
      if (isNumber) return `<c r="${ref}"><v>${cell}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetData>${sheetData}</sheetData>
</worksheet>`;
}

function getReportExportFailureReason(row: any) {
  const pages = row?.pages || {};
  const reason = pages.storageError || pages.error || pages.failureReason || "";
  const stage = pages.failureStage ? `단계: ${pages.failureStage}` : "";
  const suggestion = pages.failureSuggestion ? `조치: ${pages.failureSuggestion}` : "";
  return [stage, reason, suggestion].filter(Boolean).join("\n");
}

function diagnosticBadgeClass(status: string) {
  if (status === "ok") return "badge ok";
  if (status === "warn") return "badge warn";
  if (status === "fail") return "badge danger";
  return "badge";
}

function diagnosticStatusLabel(status: string) {
  if (status === "ok") return "정상";
  if (status === "warn") return "주의";
  if (status === "fail") return "실패";
  return "확인";
}

function getReportExportFormat(row: any) {
  const savedFormat = row?.pages?.savedFormat || "";
  if (savedFormat === "pdf" || String(row?.file_url || "").toLowerCase().endsWith(".pdf")) return "PDF";
  if (["printable-html", "web-html"].includes(savedFormat) || String(row?.file_url || "").toLowerCase().endsWith(".html")) return savedFormat === "web-html" ? "웹 리포트" : "웹 저장본";
  return "-";
}

function getReportExportOpenLabel(row: any) {
  return getReportExportFormat(row) === "PDF" ? "PDF 열기" : "저장본 열기";
}

function getReportExportStatusClass(status: string) {
  if (status === "printed" || status === "created") return "badge ok";
  if (status === "failed") return "badge danger";
  if (status === "archived") return "badge warn";
  return "badge";
}

function escapeHtml(value: any) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function reportSnapshotCss() {
  return `
    :root { --line:#e5e7eb; --text:#111827; --muted:#475569; --soft:#f8fafc; --primary:#111827; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 12mm; color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Segoe UI", sans-serif; line-height: 1.45; background: white; }
    .report-academy-brand { display:flex; align-items:center; gap:3mm; margin-bottom:4mm; color:#111827; }
    .report-logo-img { width:28mm; height:auto; object-fit:contain; display:block; }
    .report-academy-brand b { display:block; font-size:10pt; font-weight:950; letter-spacing:-.05em; }
    .report-academy-brand span { display:block; color:#64748b; font-size:7.5pt; font-weight:800; }
    .report-page { width: 100%; min-height: 186mm; padding: 0; background: white; page-break-inside: avoid; break-inside: avoid; display:flex; flex-direction:column; overflow:visible; }
    .report-page + .report-page { page-break-before: always; break-before: page; }
    .report-page-header { display:flex; justify-content:space-between; align-items:flex-start; gap: 16px; margin-bottom: 8mm; }
    .h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.15; letter-spacing: -0.05em; }
    .h2 { margin: 0 0 12px; font-size: 20px; letter-spacing: -0.04em; }
    .h3 { margin: 0 0 10px; font-size: 16px; letter-spacing: -0.03em; }
    .muted { color: var(--muted); }
    .report-meta, .notice { border: 1px solid var(--line); background: var(--soft); border-radius: 14px; padding: 12px; }
    .table-wrap { overflow: visible; border: 1px solid var(--line); border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; min-width: 0; table-layout: fixed; background: white; }
    th, td { padding: 8px 9px; border-bottom: 1px solid var(--line); text-align: left; font-size: 12px; word-break: keep-all; overflow-wrap: anywhere; vertical-align: top; }
    th { background: #f8fafc; color: #475569; font-weight: 800; }
    tbody tr:nth-child(even) td { background: #fbfdff; }
    .grid { display:grid; gap:14px; }
    .grid-2, .report-comment-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .trend-card { border: 0; border-radius: 0; padding: 0; background: #fff; }
    .trend-legend { display:flex; gap: 12px; flex-wrap: wrap; justify-content: flex-end; margin-bottom: 4mm; color:#475569; font-size: 8.5pt; font-weight:800; }
    .trend-legend-item { display:inline-flex; align-items:center; gap:6px; }
    .trend-legend-item i { display:inline-block; width: 10px; height: 10px; border-radius: 3px; }
    .trend-chart { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4mm; align-items:flex-end; }
    .trend-group { min-width:0; break-inside: avoid; page-break-inside: avoid; }
    .trend-bars { height: 92mm; display:flex; align-items:flex-end; justify-content:center; gap: 2mm; padding: 3mm 2mm 2mm; border: 1px solid #eef2f7; border-radius: 3mm; background: linear-gradient(to top, rgba(148, 163, 184, 0.28) 1px, transparent 1px); background-size: 100% 25%; }
    .trend-bar-column { flex:1; max-width: 13mm; height:100%; display:flex; flex-direction:column; align-items:center; }
    .trend-value { min-height: 5mm; margin-bottom: 1mm; font-size: 8pt; font-weight:900; color:#334155; }
    .trend-bar-shell { width:100%; flex:1; display:flex; align-items:flex-end; justify-content:center; }
    .trend-bar { width:100%; min-height: 1mm; border-radius: 2mm 2mm 0.5mm 0.5mm; }
    .trend-month { margin-top: 1.5mm; font-size: 7pt; color:#64748b; font-weight:800; white-space:nowrap; }
    .trend-class-name { margin-top: 2mm; text-align:center; font-size: 8.5pt; font-weight:900; line-height:1.25; word-break: keep-all; }
    .bar-row { display:grid; grid-template-columns: 210px 1fr 86px; gap: 12px; align-items:center; margin: 10px 0; break-inside: avoid; page-break-inside: avoid; }
    .bar-track { height: 22px; background:#f1f5f9; border-radius: 999px; overflow:hidden; border:1px solid #e5e7eb; }
    .bar-fill { height:100%; background:#111827; border-radius: 999px; }
    .report-response-section { margin-top: 18px; break-inside: avoid; page-break-inside: avoid; }
    .report-footnote { margin-top: 14px; font-size: 12px; }
    ul { margin: 8px 0 0; padding-left: 20px; }

    .report-page { position: relative; overflow: visible; }
    .report-page::before { content:""; position:absolute; inset:0 auto auto 0; width:2mm; height:100%; background:linear-gradient(180deg,#111827,#2563eb); opacity:.92; }
    .report-page-header-designed { padding-bottom:4mm; border-bottom:1px solid #e5e7eb; }
    .report-kicker { display:inline-flex; align-items:center; min-height:6mm; padding:1mm 3mm; border-radius:999px; background:#eef2ff; color:#3730a3; font-size:8pt; font-weight:900; margin-bottom:3mm; }
    .report-kpi-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:3mm; margin:4mm 0 5mm; }
    .report-kpi { border:1px solid #e5e7eb; border-radius:4mm; padding:3mm; background:linear-gradient(180deg,#fff,#f8fafc); }
    .report-kpi span { display:block; color:#64748b; font-size:7.5pt; font-weight:800; }
    .report-kpi b { display:block; margin-top:1mm; font-size:16pt; line-height:1.1; letter-spacing:-.04em; }
    .report-kpi small { display:block; margin-top:1mm; color:#64748b; font-size:7.5pt; font-weight:700; }
    .report-cover-page { min-height:186mm; padding-left:4mm; background:#fff; }
    .report-cover-hero { display:flex; justify-content:space-between; gap:5mm; align-items:flex-start; margin-bottom:5mm; }
    .report-cover-title { margin:0; font-size:23pt; line-height:1.08; letter-spacing:-.06em; }
    .report-cover-subtitle { margin:2.4mm 0 0; font-size:9.5pt; color:#475569; font-weight:800; }
    .report-cover-badge { min-width:34mm; padding:3.5mm; border-radius:4mm; background:#111827; color:#fff; text-align:right; }
    .report-cover-badge span { display:block; color:#93c5fd; font-size:6.5pt; font-weight:900; }
    .report-cover-badge b { display:block; margin-top:.8mm; font-size:11pt; }
    .report-cover-section-grid { display:grid; grid-template-columns:1fr 1fr; gap:3mm; }
    .report-cover-section { border:1px solid #dbe3ef; border-radius:3.5mm; background:#fff; padding:3mm; break-inside:avoid; page-break-inside:avoid; }
    .report-cover-section b { font-size:9pt; }
    .report-cover-section ol, .report-cover-section p { margin:1.4mm 0 0; color:#475569; font-size:8pt; line-height:1.38; }
    .report-cover-section li { margin:.5mm 0; }
    .report-cover-page .cover-kpis { margin:3mm 0 4mm; }
    .report-cover-page .report-kpi { padding:2.1mm 2.3mm; border-radius:3mm; }
    .report-cover-page .report-kpi b { font-size:12pt; }
    .report-cover-page .report-kpi span, .report-cover-page .report-kpi small { font-size:6.6pt; }
    .designed-trend-card { padding:0; background:#fff; }
    .trend-card-head { display:flex; justify-content:space-between; gap:4mm; align-items:flex-start; margin-bottom:3mm; }
    .trend-axis-labels { float:left; width:9mm; height:92mm; color:#94a3b8; font-size:7pt; font-weight:800; display:grid; align-content:space-between; }
    .trend-axis-labels span { display:block; text-align:right; }
    .designed-trend-card .trend-chart { margin-left:12mm; }
    .trend-class-average { margin-top:1.5mm; text-align:center; color:#475569; font-size:7.5pt; font-weight:800; }
    .response-section-title { display:flex; justify-content:space-between; gap:3mm; align-items:center; margin-bottom:2mm; }
    .response-section-title span { border-radius:999px; padding:1mm 3mm; background:#f1f5f9; color:#475569; font-size:7.5pt; font-weight:900; }
    .ranking-card { padding:3mm; border:1px solid #e5e7eb; border-radius:5mm; background:#fff; }
    .bar-label { font-weight:850; }
    .bar-value { text-align:right; font-weight:900; }
    .bar-row.highlight { padding:1.6mm 2mm; margin-left:-2mm; margin-right:-2mm; border-radius:3mm; background:#eff6ff; border:1px solid #bfdbfe; }
    .bar-row.highlight .bar-fill { background:linear-gradient(90deg,#1d4ed8,#60a5fa); }
    .bar-row.withdrawal .bar-fill { background:linear-gradient(90deg,#059669,#34d399); }
    .report-footer { display:flex; justify-content:space-between; gap:4mm; align-items:center; margin-top:auto; padding-top:2mm; border-top:1px solid #e5e7eb; color:#64748b; font-size:7pt; font-weight:800; flex-shrink:0; break-inside:avoid; page-break-inside:avoid; }
    .report-footer-brand { display:inline-flex; align-items:center; gap:2mm; min-width:0; }
    .report-footer-logo { width:18mm; height:auto; object-fit:contain; display:block; opacity:.88; }


    /* v2.1.1 PDF 저장본 전용 압축 규칙 */
    .report-page-score .report-page-header { margin-bottom: 3mm; }
    .report-page-score .report-kicker { min-height:0; padding:1mm 2mm; margin-bottom:1.5mm; font-size:6.5pt; }
    .report-page-score .h1 { font-size:17pt; margin-bottom:1mm; }
    .report-page-score .muted { font-size:7.4pt; }
    .report-page-score .report-meta { padding:2mm; min-width:30mm; font-size:7.4pt; }
    .report-page-score .report-kpi-grid { gap:2mm; margin:2mm 0 2.5mm; }
    .report-page-score .report-kpi { padding:1.8mm 2mm; border-radius:2.5mm; }
    .report-page-score .report-kpi b { margin-top:1mm; font-size:11pt; }
    .report-page-score .report-kpi small, .report-page-score .report-kpi span { font-size:6.2pt; }
    .report-page-score .trend-card-head { display:grid; grid-template-columns:1fr; gap:1mm; margin-bottom:1.5mm; }
    .report-page-score .trend-card-head .h2 { font-size:9.5pt; margin-bottom:.8mm; }
    .report-page-score .trend-legend { justify-content:flex-start; gap:2.5mm; margin-bottom:1.5mm; font-size:6.5pt; }
    .report-page-score .trend-axis-labels { display:none; }
    .report-page-score .designed-trend-card .trend-chart { margin-left:0; }
    .report-page-score .trend-chart { grid-template-columns:repeat(var(--trend-columns), minmax(0,1fr)); gap:2mm; align-items:end; }
    .report-page-score .trend-bars { height:var(--trend-bar-height); padding:1.6mm 1mm 1mm; gap:1mm; border-radius:2mm; }
    .report-page-score .trend-bar-column { max-width:none; }
    .report-page-score .trend-value { min-height:3.6mm; margin-bottom:.7mm; font-size:5.7pt; }
    .report-page-score .trend-month { margin-top:1mm; font-size:5.2pt; }
    .report-page-score .trend-class-name { margin-top:1.2mm; font-size:6.1pt; line-height:1.12; }
    .report-page-score .trend-class-average { margin-top:.7mm; font-size:5.6pt; }
    .report-page-score .report-footnote { margin-top:1.5mm; font-size:6pt; }
    .report-page-score .report-footer { margin-top:auto; padding-top:1mm; font-size:6pt; }

    .report-page-responses .report-page-header { margin-bottom:3mm; }
    .report-page-responses .report-kicker { min-height:0; padding:1mm 2mm; margin-bottom:1.5mm; font-size:6.5pt; }
    .report-page-responses .h1 { font-size:17pt; margin-bottom:1mm; }
    .report-page-responses .report-meta { padding:2mm; min-width:24mm; font-size:7.2pt; }
    .report-page-responses .report-response-section { margin-top:2.2mm; padding-top:0 !important; break-inside:auto; page-break-inside:auto; }
    .report-page-responses .report-response-section + .report-response-section { border-top:0; }
    .report-page-responses .response-section-title { margin-bottom:1mm; }
    .report-page-responses .response-section-title .h2 { font-size:8.4pt; margin-bottom:0; }
    .report-page-responses .response-section-title span { padding:.5mm 1.5mm; font-size:5.8pt; }
    .report-page-responses table.report-response-table { font-size:5.9pt !important; line-height:1.08; }
    .report-page-responses .report-response-table th, .report-page-responses .report-response-table td { padding:.75mm .55mm !important; vertical-align:middle; }
    .report-page-responses .report-response-table th:nth-child(1), .report-page-responses .report-response-table td:nth-child(1) { width:7mm; }
    .report-page-responses .report-response-table th:nth-child(2), .report-page-responses .report-response-table td:nth-child(2) { width:54mm; }
    .report-page-responses .report-response-table th:nth-child(3), .report-page-responses .report-response-table td:nth-child(3) { width:14mm; }
    .report-page-responses .report-comment-grid { gap:2mm; margin-top:3mm !important; }
    .report-page-responses .notice { padding:2mm !important; font-size:6.6pt !important; }
    .report-page-responses .notice ul { margin-top:1mm; padding-left:4mm; }
    .report-page-responses .report-footer { margin-top:auto; padding-top:1mm; font-size:6pt; }


    .report-page-header-designed .h1 { font-size: 32px; }
    .internal-summary-table th:nth-child(1), .internal-summary-table td:nth-child(1) { width: 10mm; text-align:center; }
    .internal-summary-table th:nth-child(3), .internal-summary-table td:nth-child(3),
    .internal-summary-table th:nth-child(4), .internal-summary-table td:nth-child(4) { width: 28mm; white-space: nowrap; }
    .internal-teacher-grid { display:grid; grid-template-columns: 1fr; gap: 3mm; }
    .internal-teacher-card { border:1px solid #e5e7eb; border-radius:4mm; padding:3mm; break-inside: avoid; page-break-inside: avoid; background:white; }
    .internal-teacher-card-head { display:flex; justify-content:space-between; gap:4mm; align-items:flex-start; padding-bottom:2mm; border-bottom:1px solid #e5e7eb; margin-bottom:2mm; }
    .internal-teacher-card-head b { font-size: 15pt; white-space: nowrap; }
    .internal-class-comment-list { display:grid; gap:2mm; }
    .internal-class-comment { padding:2mm; border-radius:3mm; background:#f8fafc; border:1px solid #eef2f7; }
    .internal-class-comment > b { display:block; margin-bottom:1mm; font-size:9pt; }
    .internal-comment-columns { display:grid; grid-template-columns:1fr 1fr; gap:2mm; }
    .internal-comment-columns span { display:inline-flex; margin-bottom:1mm; font-size:7pt; font-weight:900; color:#475569; }
    .internal-comment-columns ul, .internal-issues ul { margin:1mm 0 0; padding-left:4mm; }
    .internal-comment-columns li, .internal-issues li { margin:.5mm 0; }
    .internal-issues { margin-top:2mm; padding:2mm; border-radius:3mm; background:#fff7ed; border:1px solid #fed7aa; }
    .internal-risk-grid { display:grid; grid-template-columns:1fr 1fr; gap:3mm; margin:4mm 0; }
    .internal-risk-card { border:1px solid #e5e7eb; border-radius:4mm; padding:3mm; background:#fff; break-inside:avoid; page-break-inside:avoid; }
    .internal-risk-card.warn { background:#fff7ed; border-color:#fed7aa; }
    .internal-risk-card b { display:block; margin-bottom:1.5mm; font-size:10pt; }
    .internal-risk-card ul { margin:1mm 0 0; padding-left:4mm; }
    .internal-ranking-table th:nth-child(1), .internal-ranking-table td:nth-child(1),
    .internal-stability-table th:nth-child(1), .internal-stability-table td:nth-child(1) { width:20mm; text-align:center; white-space:nowrap; }
    .internal-ranking-table th:nth-child(3), .internal-ranking-table td:nth-child(3),
    .internal-ranking-table th:nth-child(4), .internal-ranking-table td:nth-child(4),
    .internal-ranking-table th:nth-child(5), .internal-ranking-table td:nth-child(5),
    .internal-stability-table th:nth-child(3), .internal-stability-table td:nth-child(3),
    .internal-stability-table th:nth-child(4), .internal-stability-table td:nth-child(4),
    .internal-stability-table th:nth-child(5), .internal-stability-table td:nth-child(5) { width:24mm; white-space:nowrap; }
    .internal-keyword-panel { margin:3mm 0; padding:3mm; border:1px solid #dbe3ef; border-radius:4mm; background:#f8fafc; }
    .internal-keyword-panel > b { display:block; margin-bottom:2mm; font-size:10pt; }
    .internal-keyword-list { display:flex; gap:1.5mm; flex-wrap:wrap; }
    .internal-keyword-list span { display:inline-flex; align-items:center; gap:1mm; padding:1mm 2mm; border-radius:999px; background:#eef2ff; color:#3730a3; font-size:8pt; font-weight:900; }
    .internal-comment-note { margin:3mm 0; padding:2mm 3mm; border-radius:3mm; background:#f8fafc; color:#475569; font-size:8pt; font-weight:800; }
    .internal-comment-summary-grid { display:grid; grid-template-columns:1fr 1fr; gap:3mm; align-items:start; }
    .internal-comment-group { border:1px solid #e5e7eb; border-radius:4mm; padding:3mm; background:#fff; break-inside:avoid; page-break-inside:avoid; }
    .internal-comment-group-head { display:flex; justify-content:space-between; gap:2mm; align-items:center; padding-bottom:2mm; border-bottom:1px solid #e5e7eb; margin-bottom:2mm; }
    .internal-comment-group-head b { font-size:11pt; }
    .internal-comment-group-head span { padding:1mm 2mm; border-radius:999px; background:#f1f5f9; color:#475569; font-size:7pt; font-weight:900; white-space:nowrap; }
    .internal-comment-item-list { display:grid; gap:2mm; }
    .internal-comment-item { padding:2mm; border-radius:3mm; background:#f8fafc; border:1px solid #eef2f7; }
    .internal-comment-meta { display:grid; gap:.8mm; margin-bottom:1mm; }
    .internal-comment-meta b { font-size:8pt; }
    .internal-comment-meta span { color:#64748b; font-size:7pt; font-weight:800; }
    .internal-comment-text { font-size:8.5pt; line-height:1.45; word-break:keep-all; overflow-wrap:anywhere; }

    .internal-action-panel { margin:3mm 0; padding:3mm; border-radius:4mm; background:#f8fafc; border:1px solid #dbe3ef; break-inside:avoid; page-break-inside:avoid; }
    .internal-action-panel > b, .internal-relation-head > b, .internal-priority-comments-head > b, .director-memo-box > b { display:block; font-size:10pt; margin-bottom:1.5mm; }
    .internal-action-panel ol { margin:1mm 0 0; padding-left:5mm; }
    .internal-action-panel li { margin:.8mm 0; line-height:1.35; }
    .director-memo-box { margin-top:3mm; padding:2.5mm 3mm; border-radius:4mm; border:1px dashed #cbd5e1; background:#fff; break-inside:avoid; page-break-inside:avoid; }
    .director-memo-box.compact { margin-top:2mm; padding:2mm 3mm; }
    .director-memo-lines { display:grid; gap:2.2mm; margin-top:1.5mm; }
    .director-memo-lines span { display:block; height:5mm; border-bottom:1px solid #cbd5e1; }
    .internal-relation-panel { margin:3mm 0; padding:3mm; border-radius:4mm; border:1px solid #dbe3ef; background:#fff; break-inside:avoid; page-break-inside:avoid; }
    .internal-relation-head { display:flex; justify-content:space-between; gap:2mm; align-items:center; margin-bottom:2mm; }
    .internal-relation-head span { display:inline-flex; border-radius:999px; padding:1mm 2mm; background:#f1f5f9; color:#475569; font-size:7pt; font-weight:900; }
    .internal-relation-grid, .internal-comment-category-grid, .internal-insight-grid { display:grid; grid-template-columns:1fr 1fr; gap:2mm; align-items:stretch; }
    .internal-relation-card, .internal-comment-category-card { padding:2mm; border-radius:3mm; border:1px solid #e5e7eb; background:#f8fafc; break-inside:avoid; page-break-inside:avoid; }
    .internal-relation-card b, .internal-comment-category-card b { display:block; font-size:8.5pt; }
    .internal-relation-card strong { display:block; margin-top:1mm; font-size:15pt; letter-spacing:-.04em; }
    .internal-relation-card span, .internal-relation-card small, .internal-comment-category-card p, .internal-comment-category-card small { display:block; margin-top:.8mm; color:#475569; font-size:7pt; font-weight:800; line-height:1.3; }
    .internal-relation-card.danger, .internal-comment-item.risk, .internal-priority-comments { background:#fff1f2; border-color:#fecdd3; }
    .internal-relation-card.warn, .internal-keyword-panel.warn, .internal-comment-item.watch, .internal-comment-item.negative { background:#fff7ed; border-color:#fed7aa; }
    .internal-relation-card.ok, .internal-comment-item.positive { background:#f0fdf4; border-color:#bbf7d0; }
    .internal-priority-comments { margin:3mm 0; padding:3mm; border-radius:4mm; border:1px solid #fecdd3; break-inside:avoid; page-break-inside:avoid; }
    .internal-priority-comments-head, .internal-comment-category-card > div { display:flex; justify-content:space-between; align-items:center; gap:2mm; }
    .internal-priority-comments-head span, .internal-comment-category-card > div span { border-radius:999px; padding:1mm 2mm; background:#fff; color:#475569; font-size:7pt; font-weight:900; white-space:nowrap; }
    .internal-comment-category-grid { margin:3mm 0; }
    .internal-comment-tags { display:flex; flex-wrap:wrap; gap:1mm; margin:1mm 0 1.5mm; }
    .internal-comment-tags span { display:inline-flex; align-items:center; border-radius:999px; padding:.7mm 1.4mm; background:#fff; border:1px solid #e5e7eb; color:#475569; font-size:6.6pt; font-weight:900; }
    .internal-comment-tags .tone.risk, .internal-comment-tags .tone.negative, .internal-keyword-list.risk span { background:#ffe4e6; border-color:#fecdd3; color:#be123c; }
    .internal-comment-tags .tone.positive { background:#dcfce7; border-color:#bbf7d0; color:#15803d; }
    .internal-comment-tags .tone.watch { background:#ffedd5; border-color:#fed7aa; color:#c2410c; }
    .internal-comments-page .internal-comment-group { break-inside: avoid; page-break-inside: avoid; }
    .internal-comments-page .internal-comment-item { break-inside: avoid; page-break-inside: avoid; }


    .report-average-only-table th:nth-child(1), .report-average-only-table td:nth-child(1) { width:14mm; text-align:center; }
    .report-average-only-table th:nth-child(3), .report-average-only-table td:nth-child(3), .report-average-only-table th:nth-child(4), .report-average-only-table td:nth-child(4) { width:30mm; text-align:center; white-space:nowrap; }
    .internal-student-response-panel, .internal-teacher-comment-section { margin:3mm 0; border:1px solid #e5e7eb; border-radius:4mm; background:#fff; padding:3mm; break-inside:avoid; page-break-inside:avoid; }
    .internal-student-response-table th, .internal-student-response-table td { font-size:7pt; white-space:nowrap; }
    .internal-student-response-table th:nth-child(1), .internal-student-response-table td:nth-child(1) { width:22mm; }
    .internal-insight-grid.single { grid-template-columns:1fr; }
    .internal-teacher-comment-split { display:grid; grid-template-columns:1fr 1fr; gap:3mm; margin:3mm 0; align-items:start; }
    .internal-teacher-comment-list { display:grid; gap:2mm; }
    .internal-teacher-comment-card { border:1px solid #eef2f7; border-radius:3mm; background:#f8fafc; padding:2.3mm; break-inside:avoid; page-break-inside:avoid; }
    .internal-teacher-comment-card summary { display:flex; align-items:center; justify-content:space-between; gap:2mm; cursor:pointer; list-style:none; }
    .internal-teacher-comment-card summary::-webkit-details-marker { display:none; }
    .internal-teacher-comment-card summary b { font-size:9pt; }
    .internal-teacher-comment-card summary span { display:inline-flex; border-radius:999px; padding:1mm 2mm; background:#eef2ff; color:#3730a3; font-size:7pt; font-weight:900; white-space:nowrap; }
    .internal-teacher-comment-card[open] summary { padding-bottom:1.5mm; border-bottom:1px solid #e5e7eb; margin-bottom:1.5mm; }
    .internal-teacher-comment-card:not([open]) ul { display:none; }
    .internal-teacher-comment-card ul { margin:0; padding-left:4mm; }
    .internal-teacher-comment-card li { margin:1.2mm 0; }
    .internal-teacher-comment-card li span { display:block; color:#64748b; font-size:7pt; font-weight:900; }
    .internal-teacher-comment-card li p { margin:.5mm 0 0; font-size:8pt; line-height:1.45; word-break:keep-all; overflow-wrap:anywhere; }


/* v2.6.14 원장 내부 리포트: 만족도 × 퇴원율 사분면 그래프 */
.internal-retention-scatter-card {
  margin: 14px 0;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid #dbe3ef;
  background: #ffffff;
  break-inside: avoid;
  page-break-inside: avoid;
}

.scatter-axis-guide {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  color: #475569;
  font-size: 13px;
  font-weight: 900;
}

.retention-scatter-shell {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: 10px;
  align-items: stretch;
}

.retention-y-axis-block {
  position: relative;
  min-height: 420px;
}

.retention-y-axis-title {
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%) rotate(-90deg);
  transform-origin: left top;
  color: #334155;
  font-size: 13px;
  font-weight: 950;
  white-space: nowrap;
}

.retention-y-axis-ticks {
  position: absolute;
  inset: 0 0 44px 0;
}

.retention-y-axis-ticks span {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  color: #64748b;
  font-size: 12px;
  font-weight: 900;
}

.retention-y-axis-ticks .top { top: 0%; }
.retention-y-axis-ticks .mid { top: 50%; }
.retention-y-axis-ticks .bottom { top: 100%; }

.retention-plot-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.retention-scatter {
  position: relative;
  height: 420px;
  min-height: 420px;
  border-radius: 20px;
  border: 1px solid #dbe3ef;
  overflow: hidden;
  background:
    linear-gradient(to right, rgba(148, 163, 184, 0.12) 1px, transparent 1px),
    linear-gradient(to top, rgba(148, 163, 184, 0.12) 1px, transparent 1px),
    #ffffff;
  background-size: 25% 100%, 100% 25%, auto;
}

.scatter-zone {
  position: absolute;
  z-index: 1;
  padding: 14px;
  pointer-events: none;
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.scatter-zone b {
  display: block;
  font-size: 14px;
  font-weight: 950;
}

.scatter-zone span {
  display: block;
  margin-top: 4px;
  color: #475569;
  font-size: 12px;
  font-weight: 900;
}

.scatter-zone-safe {
  left: 50%;
  right: 0;
  top: 0;
  bottom: 50%;
  background: rgba(220, 252, 231, 0.68);
}

.scatter-zone-watch {
  left: 0;
  right: 50%;
  top: 0;
  bottom: 50%;
  background: rgba(239, 246, 255, 0.7);
}

.scatter-zone-danger {
  left: 0;
  right: 50%;
  top: 50%;
  bottom: 0;
  background: rgba(255, 241, 242, 0.75);
}

.scatter-zone-warn {
  left: 50%;
  right: 0;
  top: 50%;
  bottom: 0;
  background: rgba(255, 247, 237, 0.74);
}

.scatter-threshold {
  position: absolute;
  z-index: 3;
  pointer-events: none;
}

.scatter-threshold.vertical {
  top: 0;
  bottom: 0;
  border-left: 2px solid #64748b;
}

.scatter-threshold.horizontal {
  left: 0;
  right: 0;
  border-top: 2px solid #64748b;
}

.scatter-point {
  position: absolute;
  z-index: 10;
  transform: translate(-50%, 50%);
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 2px solid #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.18);
  color: #ffffff;
  font-size: 12px;
  font-weight: 950;
}

.scatter-point.safe,
.scatter-point-list-item.safe .scatter-point-list-number {
  background: #22c55e;
}

.scatter-point.watch,
.scatter-point-list-item.watch .scatter-point-list-number {
  background: #3b82f6;
}

.scatter-point.danger,
.scatter-point-list-item.danger .scatter-point-list-number {
  background: #ef4444;
}

.scatter-point.warn,
.scatter-point-list-item.warn .scatter-point-list-number {
  background: #f59e0b;
}

.retention-x-axis-block {
  padding-left: 4px;
}

.retention-x-axis-title {
  margin-bottom: 4px;
  color: #334155;
  font-size: 13px;
  font-weight: 950;
  text-align: center;
}

.retention-x-axis-ticks {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  color: #64748b;
  font-size: 12px;
  font-weight: 900;
}

.retention-x-axis-ticks span:nth-child(1) { text-align: left; }
.retention-x-axis-ticks span:nth-child(2) { text-align: center; }
.retention-x-axis-ticks span:nth-child(3) { text-align: right; }

.scatter-clamp-note {
  margin-top: 8px;
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
}

.scatter-point-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.scatter-point-list-item {
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #f8fafc;
}

.scatter-point-list-item b,
.scatter-point-list-item span,
.scatter-point-list-item small {
  display: block;
  line-height: 1.35;
}

.scatter-point-list-item b {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 950;
}

.scatter-point-list-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
  width: 24px;
  min-width: 24px;
  height: 24px;
  min-height: 24px;
  margin-right: 0;
  padding: 0;
  border-radius: 999px;
  color: #ffffff;
  font-size: 11px;
  line-height: 1;
  font-weight: 950;
  text-align: center;
  vertical-align: middle;
}

.scatter-point-list-item span {
  margin-top: 3px;
  color: #111827;
  font-size: 12px;
  font-weight: 900;
}

.scatter-point-list-item small {
  margin-top: 3px;
  color: #475569;
  font-size: 11px;
  font-weight: 800;
}

@media screen and (max-width: 720px) {
  .retention-scatter-shell {
    grid-template-columns: 52px 1fr;
    gap: 8px;
  }

  .retention-y-axis-block,
  .retention-scatter {
    min-height: 340px;
    height: 340px;
  }

  .retention-y-axis-title {
    font-size: 11px;
  }

  .retention-y-axis-ticks span,
  .retention-x-axis-ticks span,
  .scatter-clamp-note {
    font-size: 10px;
  }

  .scatter-axis-guide {
    display: grid;
    grid-template-columns: 1fr;
    gap: 4px;
    font-size: 12px;
  }

  .scatter-zone {
    padding: 8px;
  }

  .scatter-zone b {
    font-size: 11px;
  }

  .scatter-zone span {
    font-size: 10px;
  }

  .scatter-point-list {
    grid-template-columns: 1fr;
  }
}


    .no-print, button, input, select, textarea { display:none !important; }
    @page { size: A4 landscape; margin: 10mm; }
    @media print {
      body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .report-page { min-height: 186mm; page-break-after: auto; break-after: auto; overflow: visible; display:flex; flex-direction:column; }
      .report-page + .report-page { page-break-before: always; break-before: page; }
    }
  `;
}

function buildReportSnapshotHtml(reportElement: Element, title: string) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${reportSnapshotCss()}</style>
</head>
<body>
  <main class="report-output">
    ${reportElement.innerHTML}
  </main>
</body>
</html>`;
}

function webReportSnapshotCss() {
  return `${reportSnapshotCss()}
  @media screen {
    body { padding: 28px; background: #f8fafc; }
    .report-output { max-width: 1180px; margin: 0 auto; }
    .report-page { min-height: 0 !important; padding: 28px !important; margin: 0 0 24px !important; border: 1px solid #e5e7eb; border-radius: 28px; box-shadow: 0 18px 60px rgba(15, 23, 42, 0.08); page-break-before: auto !important; break-before: auto !important; page-break-inside: auto !important; break-inside: auto !important; }
    .report-page + .report-page { page-break-before: auto !important; break-before: auto !important; }
    .report-page-cover { min-height: 520px !important; }
    .report-page-responses .report-response-section { page-break-inside: auto !important; break-inside: auto !important; }
    .report-table-wrap { overflow-x: auto !important; }
    .report-footer { margin-top: 24px; }

    /* v2.2.3 웹 리포트 전용 가독성 보강
       PDF 저장본은 A4 안에 맞추기 위해 작게 압축하지만,
       웹 리포트는 길이 제한이 없으므로 큰 글씨와 넉넉한 간격을 사용합니다. */
    .web-report-output { max-width: 1240px; }
    .web-report-output .report-page {
      padding: 40px !important;
      margin-bottom: 28px !important;
      overflow: visible !important;
    }
    .web-report-output .report-page-header,
    .web-report-output .report-page-score .report-page-header,
    .web-report-output .report-page-responses .report-page-header {
      margin-bottom: 24px !important;
    }
    .web-report-output .report-kicker,
    .web-report-output .report-page-score .report-kicker,
    .web-report-output .report-page-responses .report-kicker {
      min-height: auto !important;
      padding: 6px 12px !important;
      margin-bottom: 12px !important;
      font-size: 14px !important;
    }
    .web-report-output .h1,
    .web-report-output .report-page-score .h1,
    .web-report-output .report-page-responses .h1 {
      font-size: 42px !important;
      line-height: 1.12 !important;
      margin-bottom: 10px !important;
    }
    .web-report-output .h2,
    .web-report-output .report-page-score .trend-card-head .h2,
    .web-report-output .report-page-responses .response-section-title .h2 {
      font-size: 26px !important;
      line-height: 1.25 !important;
      margin-bottom: 10px !important;
    }
    .web-report-output .h3 { font-size: 20px !important; }
    .web-report-output .muted,
    .web-report-output p,
    .web-report-output .report-meta,
    .web-report-output .report-page-score .muted,
    .web-report-output .report-page-score .report-meta,
    .web-report-output .report-page-responses .report-meta {
      font-size: 17px !important;
      line-height: 1.7 !important;
    }
    .web-report-output .report-meta,
    .web-report-output .notice {
      padding: 18px !important;
      border-radius: 18px !important;
    }
    .web-report-output .report-kpi-grid,
    .web-report-output .report-page-score .report-kpi-grid {
      gap: 14px !important;
      margin: 18px 0 22px !important;
    }
    .web-report-output .report-kpi,
    .web-report-output .report-page-score .report-kpi {
      padding: 18px !important;
      border-radius: 18px !important;
    }
    .web-report-output .report-kpi span,
    .web-report-output .report-kpi small,
    .web-report-output .report-page-score .report-kpi span,
    .web-report-output .report-page-score .report-kpi small {
      font-size: 14px !important;
      line-height: 1.45 !important;
    }
    .web-report-output .report-kpi b,
    .web-report-output .report-page-score .report-kpi b {
      font-size: 32px !important;
    }
    .web-report-output table,
    .web-report-output .report-table {
      font-size: 16px !important;
    }
    .web-report-output th,
    .web-report-output td,
    .web-report-output .report-page-responses .report-response-table th,
    .web-report-output .report-page-responses .report-response-table td {
      padding: 12px 14px !important;
      font-size: 16px !important;
      line-height: 1.55 !important;
    }
    .web-report-output .report-page-responses table.report-response-table {
      font-size: 16px !important;
      line-height: 1.55 !important;
    }
    .web-report-output .response-section-title {
      margin-bottom: 12px !important;
    }
    .web-report-output .response-section-title span,
    .web-report-output .report-page-responses .response-section-title span {
      padding: 6px 12px !important;
      font-size: 14px !important;
    }
    .web-report-output .report-response-section,
    .web-report-output .report-page-responses .report-response-section {
      margin-top: 28px !important;
    }
    .web-report-output .report-comment-grid { gap: 18px !important; }
    .web-report-output .report-page-responses .notice {
      font-size: 16px !important;
      line-height: 1.65 !important;
      padding: 18px !important;
    }
    .web-report-output .notice ul {
      margin-top: 10px !important;
      padding-left: 24px !important;
    }
    .web-report-output .bar-row {
      grid-template-columns: 260px 1fr 100px !important;
      gap: 16px !important;
      margin: 14px 0 !important;
      font-size: 17px !important;
    }
    .web-report-output .bar-track { height: 28px !important; }
    .web-report-output .bar-label,
    .web-report-output .bar-value { font-size: 17px !important; }
    .web-report-output .trend-legend,
    .web-report-output .report-page-score .trend-legend {
      gap: 14px !important;
      font-size: 14px !important;
      margin-bottom: 18px !important;
    }
    .web-report-output .report-page-score .trend-chart {
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)) !important;
      gap: 18px !important;
    }
    .web-report-output .report-page-score .trend-bars {
      height: 260px !important;
      padding: 16px 10px 10px !important;
      gap: 8px !important;
      border-radius: 16px !important;
    }
    .web-report-output .report-page-score .trend-value {
      min-height: 22px !important;
      font-size: 14px !important;
    }
    .web-report-output .report-page-score .trend-month {
      font-size: 13px !important;
      margin-top: 8px !important;
    }
    .web-report-output .report-page-score .trend-class-name {
      font-size: 16px !important;
      line-height: 1.35 !important;
      margin-top: 12px !important;
    }
    .web-report-output .report-page-score .trend-class-average {
      font-size: 14px !important;
      margin-top: 8px !important;
    }
    .web-report-output .report-footnote,
    .web-report-output .report-page-score .report-footnote,
    .web-report-output .report-footer,
    .web-report-output .report-page-score .report-footer,
    .web-report-output .report-page-responses .report-footer {
      font-size: 14px !important;
      line-height: 1.6 !important;
    }

    /* v2.3 웹 리포트 숫자 열 줄바꿈 방지 */
    .web-report-output .report-response-table {
      table-layout: auto !important;
      min-width: 760px !important;
    }
    .web-report-output .report-response-table th:not(:nth-child(2)),
    .web-report-output .report-response-table td:not(:nth-child(2)) {
      white-space: nowrap !important;
      word-break: normal !important;
      overflow-wrap: normal !important;
      text-align: center !important;
      min-width: 72px !important;
    }
    .web-report-output .report-response-table th:nth-child(1),
    .web-report-output .report-response-table td:nth-child(1) {
      min-width: 56px !important;
    }
    .web-report-output .report-response-table th:nth-child(2),
    .web-report-output .report-response-table td:nth-child(2) {
      min-width: 360px !important;
      white-space: normal !important;
      word-break: keep-all !important;
      overflow-wrap: break-word !important;
    }
    .web-report-output .report-response-table th:nth-child(3),
    .web-report-output .report-response-table td:nth-child(3) {
      min-width: 92px !important;
      font-variant-numeric: tabular-nums !important;
    }
    .web-report-output .report-response-table td b {
      white-space: nowrap !important;
      word-break: normal !important;
      overflow-wrap: normal !important;
      font-variant-numeric: tabular-nums !important;
    }

    @media screen and (max-width: 720px) {
      body {
        padding: 12px !important;
        background: #f8fafc !important;
      }
      .web-report-output {
        max-width: 100% !important;
      }
      .web-report-output .report-page {
        padding: 20px !important;
        border-radius: 20px !important;
        margin-bottom: 16px !important;
      }
      .web-report-output .report-page::before {
        width: 3px !important;
      }
      .web-report-output .report-page-header,
      .web-report-output .report-cover-hero,
      .web-report-output .trend-card-head {
        display: block !important;
      }
      .web-report-output .h1,
      .web-report-output .report-page-score .h1,
      .web-report-output .report-page-responses .h1 {
        font-size: 30px !important;
        line-height: 1.18 !important;
      }
      .web-report-output .h2,
      .web-report-output .report-page-score .trend-card-head .h2,
      .web-report-output .report-page-responses .response-section-title .h2 {
        font-size: 22px !important;
      }
      .web-report-output .muted,
      .web-report-output p,
      .web-report-output .report-meta,
      .web-report-output .notice {
        font-size: 16px !important;
        line-height: 1.65 !important;
      }
      .web-report-output .report-meta {
        margin-top: 14px !important;
        display: inline-block !important;
      }
      .web-report-output .report-kpi-grid,
      .web-report-output .report-cover-section-grid,
      .web-report-output .grid-2,
      .web-report-output .report-comment-grid {
        grid-template-columns: 1fr !important;
      }
      .web-report-output .report-kpi b,
      .web-report-output .report-page-score .report-kpi b {
        font-size: 28px !important;
      }
      .web-report-output .report-page-score .trend-chart {
        grid-template-columns: 1fr !important;
      }
      .web-report-output .report-page-score .trend-bars {
        height: 220px !important;
      }
      .web-report-output .table-wrap,
      .web-report-output .report-table-wrap {
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        border-radius: 16px !important;
      }
      .web-report-output th,
      .web-report-output td,
      .web-report-output .report-page-responses .report-response-table th,
      .web-report-output .report-page-responses .report-response-table td {
        font-size: 15px !important;
        padding: 10px 12px !important;
      }
      .web-report-output .report-response-table {
        min-width: 720px !important;
      }
      .web-report-output .bar-row {
        grid-template-columns: 1fr !important;
        gap: 8px !important;
        padding: 12px !important;
      }
      .web-report-output .bar-value {
        text-align: left !important;
      }
    }


    /* v2.6.10 모바일 웹 리포트 가독성 보강 */
    @media screen and (max-width: 720px) {
      body {
        padding: 8px !important;
        background: #f8fafc !important;
        overflow-x: hidden !important;
      }

      .web-report-output {
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
      }

      .web-report-output .report-page {
        padding: 16px !important;
        border-radius: 18px !important;
        margin: 0 0 14px !important;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08) !important;
      }

      .web-report-output .report-page::before {
        width: 3px !important;
      }

      .web-report-output .report-page-header,
      .web-report-output .report-cover-hero,
      .web-report-output .trend-card-head,
      .web-report-output .internal-relation-head,
      .web-report-output .internal-comment-group-head,
      .web-report-output .internal-priority-comments-head,
      .web-report-output .internal-comment-category-card > div {
        display: block !important;
      }

      .web-report-output .report-kicker {
        font-size: 11px !important;
        padding: 5px 9px !important;
        margin-bottom: 10px !important;
      }

      .web-report-output .h1,
      .web-report-output .report-page-score .h1,
      .web-report-output .report-page-responses .h1 {
        font-size: 24px !important;
        line-height: 1.18 !important;
        letter-spacing: -0.055em !important;
      }

      .web-report-output .h2,
      .web-report-output .report-page-score .trend-card-head .h2,
      .web-report-output .report-page-responses .response-section-title .h2 {
        font-size: 19px !important;
        line-height: 1.25 !important;
      }

      .web-report-output .muted,
      .web-report-output p,
      .web-report-output .report-meta,
      .web-report-output .notice {
        font-size: 14px !important;
        line-height: 1.55 !important;
      }

      .web-report-output .report-meta {
        width: 100% !important;
        min-width: 0 !important;
        margin-top: 12px !important;
        text-align: left !important;
        display: block !important;
      }

      .web-report-output .report-kpi-grid,
      .web-report-output .report-cover-section-grid,
      .web-report-output .grid-2,
      .web-report-output .grid-3,
      .web-report-output .grid-4,
      .web-report-output .grid-5,
      .web-report-output .report-comment-grid,
      .web-report-output .internal-risk-grid,
      .web-report-output .internal-comment-summary-grid,
      .web-report-output .internal-relation-grid,
      .web-report-output .internal-comment-category-grid,
      .web-report-output .internal-insight-grid,
      .web-report-output .internal-teacher-comment-split {
        grid-template-columns: 1fr !important;
      }

      .web-report-output .report-kpi {
        padding: 14px !important;
        border-radius: 16px !important;
      }

      .web-report-output .report-kpi b,
      .web-report-output .report-page-score .report-kpi b {
        font-size: 24px !important;
      }

      .web-report-output .trend-legend-stack {
        justify-items: start !important;
      }

      .web-report-output .trend-legend,
      .web-report-output .trend-mapping-legend {
        justify-content: flex-start !important;
        max-width: 100% !important;
        font-size: 12px !important;
      }

      .web-report-output .report-page-score .trend-chart,
      .web-report-output .trend-chart {
        grid-template-columns: 1fr !important;
        gap: 12px !important;
      }

      .web-report-output .report-page-score .trend-bars,
      .web-report-output .trend-bars {
        height: 190px !important;
        padding: 12px 8px 8px !important;
      }

      .web-report-output .trend-class-name {
        font-size: 14px !important;
      }

      .web-report-output .bar-row {
        grid-template-columns: 1fr !important;
        gap: 8px !important;
        padding: 12px !important;
        border: 1px solid #e5e7eb !important;
        border-radius: 14px !important;
        background: #ffffff !important;
      }

      .web-report-output .bar-value {
        text-align: left !important;
      }

      .web-report-output .table-wrap,
      .web-report-output .report-table-wrap {
        overflow-x: visible !important;
        border: 0 !important;
        border-radius: 0 !important;
      }

      .web-report-output .internal-summary-table,
      .web-report-output .internal-ranking-table,
      .web-report-output .internal-stability-table,
      .web-report-output .report-average-only-table,
      .web-report-output .internal-student-response-table {
        display: block !important;
        width: 100% !important;
        min-width: 0 !important;
        table-layout: auto !important;
        border-collapse: separate !important;
        border-spacing: 0 !important;
      }

      .web-report-output .internal-summary-table thead,
      .web-report-output .internal-ranking-table thead,
      .web-report-output .internal-stability-table thead,
      .web-report-output .report-average-only-table thead,
      .web-report-output .internal-student-response-table thead {
        display: none !important;
      }

      .web-report-output .internal-summary-table tbody,
      .web-report-output .internal-ranking-table tbody,
      .web-report-output .internal-stability-table tbody,
      .web-report-output .report-average-only-table tbody,
      .web-report-output .internal-student-response-table tbody {
        display: grid !important;
        gap: 10px !important;
      }

      .web-report-output .internal-summary-table tr,
      .web-report-output .internal-ranking-table tr,
      .web-report-output .internal-stability-table tr,
      .web-report-output .report-average-only-table tr,
      .web-report-output .internal-student-response-table tr {
        display: block !important;
        width: 100% !important;
        padding: 12px !important;
        border: 1px solid #e5e7eb !important;
        border-radius: 16px !important;
        background: #ffffff !important;
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04) !important;
      }

      .web-report-output .internal-summary-table td,
      .web-report-output .internal-ranking-table td,
      .web-report-output .internal-stability-table td,
      .web-report-output .report-average-only-table td,
      .web-report-output .internal-student-response-table td {
        display: grid !important;
        grid-template-columns: 92px minmax(0, 1fr) !important;
        gap: 10px !important;
        width: 100% !important;
        min-width: 0 !important;
        padding: 7px 0 !important;
        border: 0 !important;
        border-bottom: 1px solid #f1f5f9 !important;
        background: transparent !important;
        text-align: left !important;
        white-space: normal !important;
        word-break: keep-all !important;
        overflow-wrap: anywhere !important;
        font-size: 14px !important;
        line-height: 1.45 !important;
      }

      .web-report-output .internal-summary-table td:last-child,
      .web-report-output .internal-ranking-table td:last-child,
      .web-report-output .internal-stability-table td:last-child,
      .web-report-output .report-average-only-table td:last-child,
      .web-report-output .internal-student-response-table td:last-child {
        border-bottom: 0 !important;
      }

      .web-report-output .internal-summary-table td::before,
      .web-report-output .internal-ranking-table td::before,
      .web-report-output .internal-stability-table td::before,
      .web-report-output .report-average-only-table td::before,
      .web-report-output .internal-student-response-table td::before {
        color: #64748b !important;
        font-size: 12px !important;
        font-weight: 900 !important;
        line-height: 1.45 !important;
      }

      .web-report-output .internal-summary-table td:nth-child(1)::before { content: "No."; }
      .web-report-output .internal-summary-table td:nth-child(2)::before { content: "평가 항목"; }
      .web-report-output .internal-summary-table td:nth-child(3)::before { content: "응답 수"; }
      .web-report-output .internal-summary-table td:nth-child(4)::before { content: "평균/결과"; }

      .web-report-output .internal-ranking-table td:nth-child(1)::before { content: "순위"; }
      .web-report-output .internal-ranking-table td:nth-child(2)::before { content: "선생님"; }
      .web-report-output .internal-ranking-table td:nth-child(3)::before { content: "응답/반"; }
      .web-report-output .internal-ranking-table td:nth-child(4)::before { content: "강의평가"; }
      .web-report-output .internal-ranking-table td:nth-child(5)::before { content: "점수 변화"; }
      .web-report-output .internal-ranking-table td:nth-child(6)::before { content: "순위 변화"; }
      .web-report-output .internal-ranking-table td:nth-child(7)::before { content: "상태"; }

      .web-report-output .internal-stability-table td:nth-child(1)::before { content: "퇴원율 순위"; }
      .web-report-output .internal-stability-table td:nth-child(2)::before { content: "선생님"; }
      .web-report-output .internal-stability-table td:nth-child(3)::before { content: "강의평가"; }
      .web-report-output .internal-stability-table td:nth-child(4)::before { content: "퇴원율"; }
      .web-report-output .internal-stability-table td:nth-child(5)::before { content: "응답/반"; }
      .web-report-output .internal-stability-table td:nth-child(6)::before { content: "관계 신호"; }
      .web-report-output .internal-stability-table td:nth-child(7)::before { content: "내부 판단"; }

      .web-report-output .report-average-only-table td:nth-child(1)::before { content: "No."; }
      .web-report-output .report-average-only-table td:nth-child(2)::before { content: "평가 내용"; }
      .web-report-output .report-average-only-table td:nth-child(3)::before { content: "해당월 AVG"; }
      .web-report-output .report-average-only-table td:nth-child(4)::before { content: "응답 수"; }

      .web-report-output .internal-student-response-table td:nth-child(1)::before { content: "학생"; }
      .web-report-output .internal-student-response-table td:nth-child(2)::before { content: "반"; }
      .web-report-output .internal-student-response-table td:nth-child(3)::before { content: "T1"; }
      .web-report-output .internal-student-response-table td:nth-child(4)::before { content: "T2"; }
      .web-report-output .internal-student-response-table td:nth-child(5)::before { content: "T3"; }
      .web-report-output .internal-student-response-table td:nth-child(6)::before { content: "T4"; }
      .web-report-output .internal-student-response-table td:nth-child(7)::before { content: "T5"; }
      .web-report-output .internal-student-response-table td:nth-child(8)::before { content: "선생님 AVG"; }
      .web-report-output .internal-student-response-table td:nth-child(9)::before { content: "공통 AVG"; }
      .web-report-output .internal-student-response-table td:nth-child(10)::before { content: "압박 응답"; }
      .web-report-output .internal-student-response-table td:nth-child(11)::before { content: "제출 시각"; }

      .web-report-output .internal-student-response-card summary,
      .web-report-output .internal-teacher-comment-card summary {
        align-items: flex-start !important;
      }

      .web-report-output .internal-student-response-card summary b,
      .web-report-output .internal-teacher-comment-card summary b {
        font-size: 15px !important;
        white-space: normal !important;
      }

      .web-report-output .internal-student-response-card summary span,
      .web-report-output .internal-teacher-comment-card summary span,
      .web-report-output .internal-comment-group-head span {
        margin-top: 6px !important;
        display: inline-flex !important;
        width: fit-content !important;
      }

      .web-report-output .internal-teacher-comment-card li p,
      .web-report-output .internal-comment-text {
        font-size: 14px !important;
        line-height: 1.55 !important;
      }

      .web-report-output .report-footer {
        display: block !important;
        font-size: 12px !important;
        text-align: left !important;
      }
    }
  }
  `;
}

function buildWebReportSnapshotHtml(reportElement: Element, title: string) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${webReportSnapshotCss()}</style>
</head>
<body>
  <main class="report-output web-report-output">
    ${reportElement.innerHTML}
  </main>
</body>
</html>`;
}

export default function AdminPage() {
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [setupEmail, setSetupEmail] = useState("");
  const [setupName, setSetupName] = useState("총괄관리자");
  const [setupPassword, setSetupPassword] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [showInitialSetup, setShowInitialSetup] = useState(false);
  const [tab, setTab] = useState<TabKey>("home");
  const [data, setData] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [qrBusy, setQrBusy] = useState(false);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("");
  const [selectedReportPeriodId, setSelectedReportPeriodId] = useState<string>("");
  const [selectedQrPeriodId, setSelectedQrPeriodId] = useState<string>("");
  const [selectedAssignmentPeriodId, setSelectedAssignmentPeriodId] = useState<string>("");
  const [selectedHomePeriodId, setSelectedHomePeriodId] = useState<string>("");
  const [selectedSafetyPeriodId, setSelectedSafetyPeriodId] = useState<string>("");
  const [deletePeriodId, setDeletePeriodId] = useState<string>("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteTeacherConfirmText, setDeleteTeacherConfirmText] = useState<Record<string, string>>({});
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [safetyResponseSearch, setSafetyResponseSearch] = useState("");
  const [withdrawalDraft, setWithdrawalDraft] = useState<Record<string, string>>({});
  const [responseSearch, setResponseSearch] = useState("");
  const [responseTeacherFilter, setResponseTeacherFilter] = useState("all");
  const [responseClassFilter, setResponseClassFilter] = useState("all");
  const [responseStatusFilter, setResponseStatusFilter] = useState("all");
  const [selectedResponseId, setSelectedResponseId] = useState("");
  const [reportMode, setReportMode] = useState<"single" | "all">("single");
  const [reportMonthCount, setReportMonthCount] = useState<3 | 4>(3);
  const [reportTemplate, setReportTemplate] = useState<"teacher" | "summary" | "internal">("teacher");
  const [reportPages, setReportPages] = useState<Record<string, boolean>>({
    coverPage: false,
    scoreTable: true,
    responseTable: true,
    evaluationRanking: true,
    withdrawalRanking: true
  });
  const [exportBusy, setExportBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [webReportBusy, setWebReportBusy] = useState(false);
  const [slackBusy, setSlackBusy] = useState<string>("");
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [diagnosticsResult, setDiagnosticsResult] = useState<any>(null);
  const [reportLinkStatusFilter, setReportLinkStatusFilter] = useState("all");
  const [backupPeriodId, setBackupPeriodId] = useState<string>("");
  const [backupBusy, setBackupBusy] = useState(false);
  const periodMonthOptions = useMemo(() => makeMonthOptions(12, 18), []);


  const [newPeriod, setNewPeriod] = useState<any>(defaultPeriodForm());
  const [periodDrafts, setPeriodDrafts] = useState<Record<string, any>>({});
  const [newTeacher, setNewTeacher] = useState<any>(emptyTeacherForm);
  const [teacherDrafts, setTeacherDrafts] = useState<Record<string, any>>({});
  const [newClassItem, setNewClassItem] = useState<any>(emptyClassForm);
  const [classDrafts, setClassDrafts] = useState<Record<string, any>>({});
  const [classExcelUploadBusy, setClassExcelUploadBusy] = useState(false);
  const [classExcelUploadResult, setClassExcelUploadResult] = useState<any>(null);
  const [classMappingForm, setClassMappingForm] = useState<any>({ from_class_id: "", to_class_id: "", memo: "" });
  const [reportClassMappingForms, setReportClassMappingForms] = useState<Record<string, any>>({});
  const [reportClassMappings, setReportClassMappings] = useState<Record<string, any[]>>({});
  const [reportClassMappingsLoaded, setReportClassMappingsLoaded] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState<any>({
    evaluation_period_id: "",
    teacher_id: "",
    class_id: ""
  });
  const [selectedAssignmentClassIds, setSelectedAssignmentClassIds] = useState<string[]>([]);
  const [bulkType, setBulkType] = useState<"teachers" | "classes" | "assignments" | "responses">("teachers");
  const [bulkText, setBulkText] = useState("");
  const [bulkImportPeriodId, setBulkImportPeriodId] = useState("");
  const [bulkResult, setBulkResult] = useState<any>(null);
  const [legacyUploadPeriodId, setLegacyUploadPeriodId] = useState("");
  const [legacyUploadText, setLegacyUploadText] = useState("");
  const [legacyUploadSourceLabel, setLegacyUploadSourceLabel] = useState("레거시 데이터 이관");
  const [legacyUploadMemo, setLegacyUploadMemo] = useState("");
  const [legacyUploadPreview, setLegacyUploadPreview] = useState<any>(null);
  const [legacyUploadResult, setLegacyUploadResult] = useState<any>(null);
  const [newAdmin, setNewAdmin] = useState<any>(emptyAdminForm);
  const [adminDrafts, setAdminDrafts] = useState<Record<string, any>>({});

  const appUrl = useMemo(() => {
    const configured = String(process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
    const isLocalhost = configured.includes("localhost") || configured.includes("127.0.0.1");
    if (configured && !isLocalhost) return configured;
    if (typeof window !== "undefined") return window.location.origin;
    return "";
  }, []);

  const shareLinkUrl = (token: string) => token ? `${appUrl}/r/${token}` : "";

  const hasActiveStatusOperation = qrBusy
    || exportBusy
    || pdfBusy
    || zipBusy
    || webReportBusy
    || diagnosticsBusy
    || Boolean(slackBusy)
    || backupBusy
    || deleteBusy
    || classExcelUploadBusy;

  const isInternalReportTemplate = reportTemplate === "internal";

  function isInternalShareLink(link: any) {
    const pages = link?.teacher_report_exports?.pages || {};
    const title = String(link?.title || "");
    return pages?.reportTemplate === "internal"
      || pages?.audience === "director_internal"
      || pages?.internalOnly === true
      || title.includes("원장 내부 확인용");
  }

  useEffect(() => {
    const token = localStorage.getItem("e-evaluation-admin-session") || "";
    const adminText = localStorage.getItem("e-evaluation-admin-user") || "";
    setSessionToken(token);
    if (adminText) {
      try {
        setCurrentAdmin(JSON.parse(adminText));
      } catch {
        localStorage.removeItem("e-evaluation-admin-user");
      }
    }
  }, []);

  useEffect(() => {
    if (sessionToken) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REPORT_CLASS_MAPPINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") setReportClassMappings(parsed);
      }
    } catch {
      window.localStorage.removeItem(REPORT_CLASS_MAPPINGS_STORAGE_KEY);
    } finally {
      setReportClassMappingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!reportClassMappingsLoaded) return;
    window.localStorage.setItem(REPORT_CLASS_MAPPINGS_STORAGE_KEY, JSON.stringify(reportClassMappings || {}));
  }, [reportClassMappingsLoaded, reportClassMappings]);

  useEffect(() => {
    if (!message) return;
    if (hasActiveStatusOperation) return;
    const timer = window.setTimeout(() => setMessage(""), TOAST_AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [message, hasActiveStatusOperation]);

  useEffect(() => {
    async function makeQrImages() {
      if (!data?.qrLinks?.length) return;
      const entries: Record<string, string> = {};
      for (const link of data.qrLinks) {
        const url = `${appUrl}/s/${link.token}`;
        entries[link.id] = await QRCode.toDataURL(url, { width: 420, margin: 1 });
      }
      setQrImages(entries);
    }
    makeQrImages();
  }, [data?.qrLinks, appUrl]);

  const currentPeriod = useMemo(() => {
    if (!data?.periods?.length) return null;
    return data.periods.find((p: any) => p.status === "open") || data.periods[0];
  }, [data]);

  const selectedReportPeriod = useMemo(() => {
    if (!data?.periods?.length) return null;
    return data.periods.find((p: any) => p.id === selectedReportPeriodId) || currentPeriod;
  }, [data, selectedReportPeriodId, currentPeriod]);

  const selectedQrPeriod = useMemo(() => {
    if (!data?.periods?.length) return null;
    return data.periods.find((p: any) => p.id === selectedQrPeriodId) || currentPeriod;
  }, [data, selectedQrPeriodId, currentPeriod]);

  const selectedAssignmentPeriod = useMemo(() => {
    if (!data?.periods?.length) return null;
    return data.periods.find((p: any) => p.id === selectedAssignmentPeriodId) || currentPeriod;
  }, [data, selectedAssignmentPeriodId, currentPeriod]);

  const selectedSafetyPeriod = useMemo(() => {
    if (!data?.periods?.length) return null;
    return data.periods.find((p: any) => p.id === selectedSafetyPeriodId) || currentPeriod;
  }, [data, selectedSafetyPeriodId, currentPeriod]);

  const selectedDeletePeriod = useMemo(() => {
    if (!data?.periods?.length) return null;
    return data.periods.find((p: any) => p.id === deletePeriodId) || currentPeriod;
  }, [data, deletePeriodId, currentPeriod]);

  useEffect(() => {
    if (!data) return;

    if (data.teachers?.length && !selectedTeacherId) setSelectedTeacherId(data.teachers[0].id);
    if (currentPeriod && !selectedHomePeriodId) setSelectedHomePeriodId(currentPeriod.id);
    if (currentPeriod && !selectedReportPeriodId) setSelectedReportPeriodId(currentPeriod.id);
    if (currentPeriod && !selectedQrPeriodId) setSelectedQrPeriodId(currentPeriod.id);
    if (currentPeriod && !selectedAssignmentPeriodId) setSelectedAssignmentPeriodId(currentPeriod.id);
    if (currentPeriod && !selectedSafetyPeriodId) setSelectedSafetyPeriodId(currentPeriod.id);
    if (currentPeriod && !deletePeriodId) setDeletePeriodId(currentPeriod.id);
    if (currentPeriod && !backupPeriodId) setBackupPeriodId(currentPeriod.id);
    if (currentPeriod && !bulkImportPeriodId) setBulkImportPeriodId(currentPeriod.id);
    if (currentPeriod && !legacyUploadPeriodId) setLegacyUploadPeriodId(currentPeriod.id);

    const pDrafts: Record<string, any> = {};
    for (const period of data.periods || []) {
      pDrafts[period.id] = {
        year_month: period.year_month || "",
        title: period.title || "",
        start_date: period.start_date || "",
        end_date: period.end_date || "",
        status: period.status || "draft",
        is_active: period.is_active !== false
      };
    }
    setPeriodDrafts(pDrafts);

    const tDrafts: Record<string, any> = {};
    for (const teacher of data.teachers || []) {
      tDrafts[teacher.id] = {
        teacher_code: teacher.teacher_code || "",
        name: teacher.name || "",
        display_name: teacher.display_name || "",
        subject: teacher.subject || "",
        slack_email: teacher.slack_email || "",
        slack_user_id: teacher.slack_user_id || "",
        memo: teacher.memo || "",
        is_active: teacher.is_active !== false
      };
    }
    setTeacherDrafts(tDrafts);

    const cDrafts: Record<string, any> = {};
    for (const classItem of data.classes || []) {
      cDrafts[classItem.id] = {
        name: classItem.name || "",
        grade: classItem.grade || "",
        day_pattern: classItem.day_pattern || "",
        campus: classItem.campus || "",
        memo: classItem.memo || "",
        is_active: classItem.is_active !== false
      };
    }
    setClassDrafts(cDrafts);

    const aDrafts: Record<string, any> = {};
    for (const admin of data.adminProfiles || []) {
      aDrafts[admin.id] = {
        name: admin.name || "",
        role: admin.role || "general_admin",
        memo: admin.memo || "",
        is_active: admin.is_active !== false,
        password: ""
      };
    }
    setAdminDrafts(aDrafts);

    if (data.currentAdmin) {
      setCurrentAdmin(data.currentAdmin);
      localStorage.setItem("e-evaluation-admin-user", JSON.stringify(data.currentAdmin));
    }

    const withdrawal: Record<string, string> = {};
    for (const teacher of data.teachers || []) {
      const metric = data.metrics?.find((m: any) => m.teacher_id === teacher.id && (!currentPeriod || m.evaluation_period_id === currentPeriod.id));
      withdrawal[teacher.id] = metric?.withdrawal_rate_percent?.toString() || "";
    }
    setWithdrawalDraft(withdrawal);

    const activeTeacher = (data.teachers || []).find((t: any) => t.is_active !== false);
    const activeClass = (data.classes || []).find((c: any) => c.is_active !== false);

    setAssignmentForm((prev: any) => ({
      evaluation_period_id: prev.evaluation_period_id || currentPeriod?.id || "",
      teacher_id: prev.teacher_id || activeTeacher?.id || "",
      class_id: prev.class_id || activeClass?.id || ""
    }));
  }, [data, currentPeriod, selectedHomePeriodId, selectedTeacherId, selectedReportPeriodId, selectedQrPeriodId, selectedAssignmentPeriodId, bulkImportPeriodId, legacyUploadPeriodId, backupPeriodId]);

  async function api(path: string, options: RequestInit = {}) {
    let res: Response;
    try {
      res = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "x-admin-session": sessionToken,
          ...(options.headers || {})
        }
      });
    } catch {
      throw new Error("앱 서버 요청 자체가 실패했습니다. Vercel 배포가 완료되었는지, 인터넷 연결이 정상인지 확인해주세요.");
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const stage = body.failureStage ? `[${body.failureStage}] ` : "";
      const suggestion = body.suggestion ? ` 조치: ${body.suggestion}` : "";
      throw new Error(`${stage}${body.error || "요청 처리 중 문제가 발생했습니다."}${suggestion}`);
    }
    return body;
  }

  async function loadData() {
    try {
      setMessage("데이터를 불러오는 중입니다.");
      const body = await api("/api/admin/bootstrap");
      setData(body);
      setMessage("데이터를 불러왔습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  function saveSession(token: string, admin: any) {
    localStorage.setItem("e-evaluation-admin-session", token);
    localStorage.setItem("e-evaluation-admin-user", JSON.stringify(admin || {}));
    setSessionToken(token);
    setCurrentAdmin(admin || null);
  }

  async function loginAdmin() {
    try {
      setMessage("로그인 중입니다.");
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "로그인에 실패했습니다.");
      saveSession(body.sessionToken, body.admin);
      setLoginPassword("");
      setMessage("관리자 로그인 완료");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function createFirstSuperAdmin() {
    try {
      setMessage("초기 총괄관리자 계정을 만드는 중입니다.");
      const res = await fetch("/api/admin/auth/bootstrap-super-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupCode,
          email: setupEmail,
          name: setupName,
          password: setupPassword
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "초기 총괄관리자 생성에 실패했습니다.");
      saveSession(body.sessionToken, body.admin);
      setSetupPassword("");
      setMessage("초기 총괄관리자 계정을 만들고 로그인했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function logoutAdmin() {
    localStorage.removeItem("e-evaluation-admin-session");
    localStorage.removeItem("e-evaluation-admin-user");
    setSessionToken("");
    setCurrentAdmin(null);
    setData(null);
    setMessage("로그아웃했습니다.");
  }

  async function setupDemo() {
    try {
      setMessage("샘플 데이터를 만드는 중입니다.");
      await api("/api/admin/setup-demo", { method: "POST" });
      await loadData();
      setMessage("샘플 데이터가 준비되었습니다. QR 출력과 결과지 생성을 확인하세요.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function checkDiagnostics(periodId?: string) {
    if (diagnosticsBusy) return;
    const targetPeriodId = periodId || selectedReportPeriod?.id || currentPeriod?.id || "";
    const query = targetPeriodId ? `?evaluationPeriodId=${encodeURIComponent(targetPeriodId)}` : "";

    try {
      setDiagnosticsBusy(true);
      setMessage("저장/발송 환경을 점검하는 중입니다. Supabase Storage, PDF 저장 권한, Slack 설정을 함께 확인합니다.");
      const res = await fetch(`/api/admin/diagnostics${query}`, {
        method: "GET",
        headers: { "x-admin-session": sessionToken },
        cache: "no-store"
      });
      const body = await res.json().catch(() => ({}));
      setDiagnosticsResult(body);

      const summary = body.summary || {};
      const readyText = body.readyForInternalReport ? "원장 내부 확인용 Slack DM까지 준비됨" : "원장 내부용 Slack DM 설정 확인 필요";
      const baseMessage = body.message || body.error || "환경 점검 완료";
      if (!res.ok && !body.checks?.length) throw new Error(baseMessage);
      setMessage(`${baseMessage} 정상 ${summary.ok || 0}건 · 주의 ${summary.warning || 0}건 · 실패 ${summary.failed || 0}건 · ${readyText}`);
    } catch (error: any) {
      setDiagnosticsResult({
        ok: false,
        message: error.message,
        checks: [{
          key: "client_request",
          label: "환경 점검 요청",
          status: "fail",
          message: error.message,
          detail: "앱 서버 요청 또는 진단 API 처리에 실패했습니다.",
          action: "Vercel 배포 상태와 관리자 로그인 세션을 확인하세요."
        }]
      });
      setMessage(error.message);
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function createPeriod() {
    try {
      setMessage("평가월을 만드는 중입니다.");
      await api("/api/admin/evaluation-periods", {
        method: "POST",
        body: JSON.stringify(newPeriod)
      });
      setNewPeriod(defaultPeriodForm());
      await loadData();
      setMessage("평가월을 만들었습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function updatePeriod(periodId: string) {
    try {
      setMessage("평가월을 저장하는 중입니다.");
      await api("/api/admin/evaluation-periods", {
        method: "PATCH",
        body: JSON.stringify({ id: periodId, ...periodDrafts[periodId] })
      });
      await loadData();
      setMessage("평가월을 저장했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function createTeacher() {
    try {
      setMessage("선생님을 추가하는 중입니다.");
      await api("/api/admin/teachers", {
        method: "POST",
        body: JSON.stringify(newTeacher)
      });
      setNewTeacher(emptyTeacherForm);
      await loadData();
      setMessage("선생님을 추가했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function updateTeacher(teacherId: string, override?: any) {
    try {
      setMessage("선생님 정보를 저장하는 중입니다.");
      await api("/api/admin/teachers", {
        method: "PATCH",
        body: JSON.stringify({ id: teacherId, ...teacherDrafts[teacherId], ...(override || {}) })
      });
      await loadData();
      setMessage("선생님 정보를 저장했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function createClassItem() {
    try {
      setMessage("반을 추가하는 중입니다.");
      await api("/api/admin/classes", {
        method: "POST",
        body: JSON.stringify(newClassItem)
      });
      setNewClassItem(emptyClassForm);
      await loadData();
      setMessage("반을 추가했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function updateClassItem(classId: string, override?: any) {
    try {
      setMessage("반 정보를 저장하는 중입니다.");
      await api("/api/admin/classes", {
        method: "PATCH",
        body: JSON.stringify({ id: classId, ...classDrafts[classId], ...(override || {}) })
      });
      await loadData();
      setMessage("반 정보를 저장했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }


  function downloadClassBulkTemplate() {
    const a = document.createElement("a");
    a.href = `/templates/e-evaluation-class-bulk-upload-template-v2.6.4.xlsx`;
    a.download = `e-evaluation-class-bulk-upload-template-${APP_VERSION}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function uploadClassExcelFile(file?: File | null) {
    try {
      if (!file) return;
      setClassExcelUploadBusy(true);
      setClassExcelUploadResult(null);
      setMessage("반 명단 엑셀 파일을 업로드하는 중입니다.");

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/classes/bulk-upload", {
        method: "POST",
        headers: {
          "x-admin-session": sessionToken
        },
        body: formData
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "반 명단 엑셀 업로드에 실패했습니다.");
      }

      setClassExcelUploadResult(body);
      await loadData();
      setMessage(body.message || "반 명단 엑셀 업로드를 완료했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setClassExcelUploadBusy(false);
    }
  }

  async function createClassMapping() {
    try {
      if (!classMappingForm.from_class_id || !classMappingForm.to_class_id) {
        throw new Error("이전반과 바뀐반을 모두 선택해주세요.");
      }
      if (classMappingForm.from_class_id === classMappingForm.to_class_id) {
        throw new Error("이전반과 바뀐반은 서로 달라야 합니다.");
      }

      setMessage("반 이름 매칭을 저장하는 중입니다.");
      await api("/api/admin/class-mappings", {
        method: "POST",
        body: JSON.stringify(classMappingForm)
      });
      setClassMappingForm({ from_class_id: "", to_class_id: "", memo: "" });
      await loadData();
      setMessage("반 이름 매칭을 저장했습니다. 결과지 1페이지 그래프에 반영됩니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function toggleClassMapping(mapping: any) {
    try {
      await api("/api/admin/class-mappings", {
        method: "PATCH",
        body: JSON.stringify({ id: mapping.id, is_active: !mapping.is_active })
      });
      await loadData();
      setMessage(mapping.is_active ? "반 이름 매칭을 비활성화했습니다." : "반 이름 매칭을 다시 활성화했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  function updateReportClassMappingForm(patch: any) {
    setReportClassMappingForms((prev) => ({
      ...prev,
      [currentReportMappingKey]: {
        ...(prev[currentReportMappingKey] || { from_class_id: "", to_class_id: "", direction_mode: "bidirectional", memo: "" }),
        ...patch
      }
    }));
  }

  function addReportClassMapping() {
    const form = currentReportMappingForm || {};
    if (!selectedTeacher?.id) {
      setMessage("반 이름 매칭을 적용할 선생님을 먼저 선택해주세요.");
      return;
    }
    if (!form.from_class_id || !form.to_class_id) {
      setMessage("합산할 이전반과 기준으로 볼 반을 모두 선택해주세요.");
      return;
    }
    if (form.from_class_id === form.to_class_id) {
      setMessage("이전반과 기준 반은 서로 달라야 합니다.");
      return;
    }

    const fromName = activeClasses.find((item: any) => item.id === form.from_class_id)?.name || "이전반";
    const toName = activeClasses.find((item: any) => item.id === form.to_class_id)?.name || "기준반";
    const directionMode = form.direction_mode === "oneway" ? "oneway" : "bidirectional";
    const isBidirectional = directionMode === "bidirectional";
    const directionLabel = isBidirectional ? "양방향" : "단방향";
    const directionSymbol = isBidirectional ? "↔" : "→";
    const nextMapping = {
      id: `${currentReportMappingKey}:${form.from_class_id}:${form.to_class_id}:${directionMode}:${Date.now()}`,
      scope: "teacher_all_periods",
      teacher_id: selectedTeacher.id,
      from_class_id: form.from_class_id,
      to_class_id: form.to_class_id,
      direction_mode: directionMode,
      memo: form.memo || "",
      bidirectional: isBidirectional,
      is_active: true
    };

    setReportClassMappings((prev) => {
      const rows = (prev[currentReportMappingKey] || []).filter((row: any) => {
        const rowDirectionMode = row.direction_mode || (row.bidirectional === false ? "oneway" : "bidirectional");
        const sameForward = row.from_class_id === form.from_class_id && row.to_class_id === form.to_class_id;
        const sameReverse = row.from_class_id === form.to_class_id && row.to_class_id === form.from_class_id;
        if (isBidirectional) return !(sameForward || sameReverse);
        return !(sameForward && rowDirectionMode === "oneway");
      });
      return { ...prev, [currentReportMappingKey]: [...rows, nextMapping] };
    });
    setReportClassMappingForms((prev) => ({ ...prev, [currentReportMappingKey]: { from_class_id: "", to_class_id: form.to_class_id, direction_mode: directionMode, memo: "" } }));
    setMessage(`${selectedTeacher.name} 선생님 전체 월 리포트에 ${fromName} ${directionSymbol} ${toName} 반 이름 매칭을 ${directionLabel}으로 적용합니다.`);
  }

  function removeReportClassMapping(mappingId: string) {
    setReportClassMappings((prev) => ({
      ...prev,
      [currentReportMappingKey]: (prev[currentReportMappingKey] || []).filter((row: any) => row.id !== mappingId)
    }));
    setMessage("선택 선생님 전체 월 리포트용 반 이름 매칭을 삭제했습니다.");
  }

  function clearReportClassMappings() {
    setReportClassMappings((prev) => ({ ...prev, [currentReportMappingKey]: [] }));
    setMessage("선택 선생님 전체 월 리포트용 반 이름 매칭을 모두 초기화했습니다.");
  }

  function getScopedReportClassMappings(teacherId: string) {
    return reportClassMappings[reportMappingScopeKey(teacherId)] || [];
  }

  async function createAdminAccount() {
    try {
      setMessage("관리자 계정을 저장하는 중입니다.");
      await api("/api/admin/admins", {
        method: "POST",
        body: JSON.stringify(newAdmin)
      });
      setNewAdmin(emptyAdminForm);
      await loadData();
      setMessage("관리자 계정을 저장했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function updateAdminAccount(id: string) {
    try {
      setMessage("관리자 계정을 수정하는 중입니다.");
      await api("/api/admin/admins", {
        method: "PATCH",
        body: JSON.stringify({ id, ...(adminDrafts[id] || {}) })
      });
      await loadData();
      setMessage("관리자 계정을 수정했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function createAssignment() {
    try {
      const periodId = assignmentForm.evaluation_period_id || selectedAssignmentPeriod?.id;
      const teacherId = assignmentForm.teacher_id || activeTeachers[0]?.id;
      const classIds = selectedAssignmentClassIds.filter(Boolean);

      if (!periodId) throw new Error("평가월을 선택해주세요.");
      if (!teacherId) throw new Error("선생님을 선택해주세요.");
      if (!classIds.length) throw new Error("배정할 반을 1개 이상 선택해주세요.");

      const teacherName = activeTeachers.find((teacher: any) => teacher.id === teacherId)?.name || "선생님";
      const ok = window.confirm(`${teacherName} 선생님의 선택 평가월 반 배정을 ${classIds.length}개 반으로 저장할까요? 기존에 저장된 반 중 선택하지 않은 반은 비활성화됩니다.`);
      if (!ok) return;

      setMessage("선생님-반 배정을 저장하는 중입니다.");
      const body = await api("/api/admin/assignments", {
        method: "POST",
        body: JSON.stringify({
          evaluation_period_id: periodId,
          teacher_id: teacherId,
          class_ids: classIds,
          replace: true
        })
      });
      await loadData();
      setMessage(body.message || "선생님-반 배정을 저장했습니다. QR 출력 탭에서 QR 전체 생성을 눌러주세요.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  function toggleAssignmentClass(classId: string) {
    setSelectedAssignmentClassIds((prev) =>
      prev.includes(classId)
        ? prev.filter((id) => id !== classId)
        : [...prev, classId]
    );
  }

  function loadPreviousAssignmentDefaults() {
    const defaults = assignmentDefaults.previousClassIds.length
      ? assignmentDefaults.previousClassIds
      : assignmentDefaults.currentClassIds;
    setSelectedAssignmentClassIds(Array.from(new Set(defaults)));
    setMessage(
      assignmentDefaults.sourcePeriod
        ? `${assignmentDefaults.sourcePeriod.title} 배정을 불러왔습니다. 저장해야 이번 평가월에 반영됩니다.`
        : "불러올 이전 평가월 배정이 없습니다."
    );
  }

  async function runBulkImport() {
    try {
      const targetPeriodId = bulkImportPeriodId || selectedAssignmentPeriod?.id || currentPeriod?.id || "";
      if (bulkType === "assignments" && !targetPeriodId) {
        throw new Error("선생님-반 배정 일괄 등록은 평가월을 먼저 선택해야 합니다.");
      }

      if (!bulkText.trim()) {
        throw new Error("붙여넣은 데이터가 없습니다.");
      }

      setMessage("일괄 등록을 처리하는 중입니다.");
      const body = await api("/api/admin/bulk-import", {
        method: "POST",
        body: JSON.stringify({
          type: bulkType,
          text: bulkText,
          evaluationPeriodId: targetPeriodId
        })
      });

      setBulkResult(body);
      await loadData();
      setMessage(body.message || "일괄 등록을 완료했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  function downloadLegacyTemplate() {
    const a = document.createElement("a");
    a.href = `/templates/e-evaluation-response-upload-template-v2.0.xlsx`;
    a.download = `e-evaluation-response-upload-template-${APP_VERSION}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function previewLegacyResponseUpload() {
    try {
      const targetPeriodId = legacyUploadPeriodId || currentPeriod?.id || "";
      if (!targetPeriodId) {
        throw new Error("설문 응답을 업로드할 평가월을 선택해주세요.");
      }
      if (!legacyUploadText.trim()) {
        throw new Error("붙여넣은 응답 데이터가 없습니다.");
      }

      setMessage("업로드 전 미리보기를 만드는 중입니다.");
      const body = await api("/api/admin/response-imports", {
        method: "POST",
        body: JSON.stringify({
          mode: "preview",
          text: legacyUploadText,
          evaluationPeriodId: targetPeriodId,
          sourceLabel: legacyUploadSourceLabel,
          memo: legacyUploadMemo
        })
      });

      setLegacyUploadPreview(body);
      setLegacyUploadResult(null);
      setMessage(body.message || "업로드 전 미리보기를 완료했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function runLegacyResponseUpload() {
    try {
      const targetPeriodId = legacyUploadPeriodId || currentPeriod?.id || "";
      if (!targetPeriodId) {
        throw new Error("설문 응답을 업로드할 평가월을 선택해주세요.");
      }
      if (!legacyUploadText.trim()) {
        throw new Error("붙여넣은 응답 데이터가 없습니다.");
      }

      const previewErrors = legacyUploadPreview?.summary?.errorRowCount || 0;
      if (previewErrors > 0) {
        const ok = window.confirm(`오류 ${previewErrors}줄은 제외하고 업로드합니다. 계속할까요?`);
        if (!ok) return;
      } else {
        const ok = window.confirm("미리보기 결과를 기준으로 업로드를 확정할까요? 업로드 후에는 이력에서 롤백할 수 있습니다.");
        if (!ok) return;
      }

      setMessage("설문 응답 업로드를 확정하는 중입니다.");
      const body = await api("/api/admin/response-imports", {
        method: "POST",
        body: JSON.stringify({
          mode: "commit",
          text: legacyUploadText,
          evaluationPeriodId: targetPeriodId,
          sourceLabel: legacyUploadSourceLabel,
          memo: legacyUploadMemo
        })
      });

      setLegacyUploadResult(body);
      setLegacyUploadPreview(null);
      await loadData();
      setMessage(body.message || "설문 응답 업로드를 완료했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function rollbackResponseImport(batchId: string) {
    try {
      const reason = window.prompt("롤백 사유를 입력해주세요.", "잘못 업로드된 레거시 응답 삭제");
      if (reason === null) return;
      const ok = window.confirm("이 업로드 이력으로 등록된 응답과 답변을 삭제합니다. 계속할까요?");
      if (!ok) return;

      setMessage("응답 업로드를 롤백하는 중입니다.");
      const body = await api("/api/admin/response-imports/rollback", {
        method: "POST",
        body: JSON.stringify({ batchId, reason })
      });
      await loadData();
      setMessage(body.message || "업로드 롤백을 완료했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function toggleAssignment(assignment: any) {
    try {
      await api("/api/admin/assignments", {
        method: "PATCH",
        body: JSON.stringify({ id: assignment.id, is_active: !assignment.is_active })
      });
      await loadData();
      setMessage(assignment.is_active ? "배정을 비활성화했습니다." : "배정을 다시 활성화했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function generateQrLinks(periodId?: string) {
    const targetPeriodId = periodId || selectedQrPeriod?.id || currentPeriod?.id;
    try {
      if (!targetPeriodId) throw new Error("평가월이 없습니다. 먼저 평가월을 만들어주세요.");
      const targetPeriod = (data?.periods || []).find((period: any) => period.id === targetPeriodId);
      const activeAssignmentCount = (data?.assignments || []).filter((assignment: any) =>
        assignment.evaluation_period_id === targetPeriodId && assignment.is_active !== false
      ).length;

      setQrBusy(true);
      setMessage([
        "QR 링크를 생성하는 중입니다.",
        `평가월: ${targetPeriod?.title || targetPeriod?.year_month || "선택 평가월"}`,
        `대상 배정: ${activeAssignmentCount}건`,
        "완료 또는 실패가 확인될 때까지 이 알림은 자동으로 닫히지 않습니다."
      ].join("\n"));

      const body = await api("/api/admin/qr-links/generate", {
        method: "POST",
        body: JSON.stringify({ evaluationPeriodId: targetPeriodId })
      });
      await loadData();
      setQrBusy(false);
      setMessage(body.message || `QR 링크 생성을 완료했습니다. 대상 배정 ${activeAssignmentCount}건을 확인했습니다.`);
    } catch (error: any) {
      setQrBusy(false);
      setMessage(`QR 링크 생성에 실패했습니다.\n${error.message || "오류 내용을 확인할 수 없습니다."}`);
    }
  }

  async function saveWithdrawalRates() {
    try {
      const period = selectedReportPeriod || currentPeriod;
      if (!period) throw new Error("평가월이 없습니다.");
      const rows = Object.entries(withdrawalDraft).map(([teacherId, value]) => ({
        teacher_id: teacherId,
        withdrawal_rate_percent: value === "" ? null : Number(value)
      }));
      await api("/api/admin/withdrawal-rates", {
        method: "POST",
        body: JSON.stringify({ evaluationPeriodId: period.id, rows })
      });
      await loadData();
      setMessage("퇴원율을 저장했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }


  async function createPdfBlobFromReportNode(
    node: Element,
    filename: string,
    mode: "normal" | "compact" | "ultraCompact" = "normal"
  ) {
    const html2pdfModule = await import("html2pdf.js");
    const html2pdf = (html2pdfModule as any).default || html2pdfModule;
    const isCompact = mode !== "normal";
    const isUltraCompact = mode === "ultraCompact";

    const options = {
      margin: isCompact ? [5, 5, 5, 5] : [6, 6, 6, 6],
      filename,
      image: {
        type: "jpeg",
        quality: isUltraCompact ? 0.66 : isCompact ? 0.82 : 0.92
      },
      html2canvas: {
        scale: isUltraCompact ? 0.78 : isCompact ? 1.05 : 1.35,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        windowWidth: 1123
      },
      jsPDF: {
        unit: "mm",
        format: "a4",
        orientation: "landscape",
        compress: true
      },
      pagebreak: {
        mode: ["css", "legacy"],
        before: ".report-page:not(:first-child)",
        avoid: isCompact
          ? [".report-page-header", ".report-footer"]
          : [".report-page-header", ".report-footer", ".report-cover-section", ".report-kpi", ".bar-row"]
      }
    };

    return await html2pdf().set(options).from(node).outputPdf("blob") as Blob;
  }

  async function uploadPdfExport(blob: Blob, options: {
    evaluationPeriodId: string;
    teacherId: string;
    teacherName: string;
    periodTitle: string;
  }) {
    if (blob.size > VERCEL_SAFE_UPLOAD_BYTES) {
      throw new Error(`PDF 파일 용량이 ${(blob.size / 1024 / 1024).toFixed(1)}MB로 커서 Vercel 업로드 제한을 넘을 수 있습니다. 내부 리포트는 자동 압축 후에도 용량이 크면 포함 페이지를 줄이거나 웹 리포트 생성 기능을 사용해주세요.`);
    }

    const form = new FormData();
    form.append("pdf", blob, `${options.periodTitle}-${options.teacherName}-결과지.pdf`);
    form.append("evaluationPeriodId", options.evaluationPeriodId);
    form.append("teacherId", options.teacherId);
    form.append("teacherName", options.teacherName);
    form.append("periodTitle", options.periodTitle);
    form.append("pages", JSON.stringify(reportPagesMetadata()));
    form.append("monthCount", String(reportMonthCount));

    let res: Response;
    try {
      res = await fetch("/api/admin/report-exports/pdf", {
        method: "POST",
        headers: { "x-admin-session": sessionToken },
        body: form,
        cache: "no-store"
      });
    } catch {
      throw new Error("PDF 업로드 요청 자체가 실패했습니다. 인터넷 연결과 Vercel 배포 상태를 확인해주세요.");
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const stage = body.failureStage ? `[${body.failureStage}] ` : "";
      const suggestion = body.suggestion ? ` 조치: ${body.suggestion}` : "";
      throw new Error(`${stage}${body.error || body.errorMessage || "PDF 저장 중 문제가 발생했습니다. PDF 용량이 큰 경우 자동 압축 후 다시 시도하거나 포함 페이지를 줄여주세요."}${suggestion}`);
    }
    return body;
  }

  async function generatePdfExports(openAfter = false) {
    if (pdfBusy) return;

    try {
      const period = selectedReportPeriod || currentPeriod;
      if (!period) throw new Error("평가월이 없습니다. 결과지 생성에서 평가월을 먼저 선택해주세요.");

      const reportNodes = Array.from(document.querySelectorAll("[data-report-teacher-id]"));
      if (!reportNodes.length) {
        throw new Error("PDF로 만들 결과지 화면이 없습니다. 결과지 생성을 먼저 확인해주세요.");
      }

      if (!confirmReportGeneration("pdf", reportTemplate === "internal" ? 1 : reportNodes.length)) return;

      setPdfBusy(true);
      setMessage(reportTemplate === "internal" ? "원장 내부 확인용 PDF 1건을 생성하는 중입니다. 용량이 크면 자동 압축 모드로 다시 생성합니다." : `PDF ${reportNodes.length}건을 생성하는 중입니다. 선생님 수와 응답 수가 많으면 시간이 걸릴 수 있습니다.`);

      let storedCount = 0;
      let failedCount = 0;
      let firstExportId = "";
      const failureMessages: string[] = [];

      for (const node of reportNodes) {
        const teacherId = node.getAttribute("data-report-teacher-id") || "";
        const teacherName = node.getAttribute("data-report-teacher-name") || "선생님";
        const filename = `${period.title || "강의평가"}-${teacherName}-결과지.pdf`;

        try {
          const isInternalPdf = reportTemplate === "internal";
          let blob = await createPdfBlobFromReportNode(node, filename, isInternalPdf ? "compact" : "normal");
          if (isInternalPdf && blob.size > VERCEL_SAFE_UPLOAD_BYTES) {
            setMessage("원장 내부 확인용 PDF 용량이 커서 고압축 모드로 다시 생성하는 중입니다.");
            blob = await createPdfBlobFromReportNode(node, filename, "ultraCompact");
          }
          const body = await uploadPdfExport(blob, {
            evaluationPeriodId: period.id,
            teacherId,
            teacherName,
            periodTitle: period.title || period.year_month
          });

          if (body?.ok === false) {
            failedCount += 1;
            failureMessages.push(`${teacherName}: ${body?.errorMessage || body?.warning || "PDF 저장 실패"}`);
          } else {
            storedCount += 1;
            if (!firstExportId && body?.export?.id) firstExportId = body.export.id;
          }
        } catch (error: any) {
          failedCount += 1;
          failureMessages.push(`${teacherName}: ${error?.message || "PDF 저장 실패"}`);
          console.error(error);
        }
      }

      await loadData();

      if (failedCount > 0) {
        const firstReason = failureMessages[0] ? ` 첫 실패 사유: ${failureMessages[0]}` : "";
        setMessage(`PDF ${storedCount}건은 저장했고, ${failedCount}건은 실패했습니다.${firstReason}`);
      } else {
        setMessage(`PDF ${storedCount}건을 생성해 서버에 저장했습니다. 출력 이력에서 바로 열거나 ZIP으로 받을 수 있습니다.`);
      }

      if (openAfter && firstExportId) {
        await openReportExport(firstExportId);
      }

      setTab("exports");
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setPdfBusy(false);
    }
  }

  async function saveReportExports(printAfter = false) {
    if (exportBusy) return;

    try {
      const period = selectedReportPeriod || currentPeriod;
      if (!period) throw new Error("평가월이 없습니다. 결과지 생성에서 평가월을 먼저 선택해주세요.");

      const reportNodes = Array.from(document.querySelectorAll("[data-report-teacher-id]"));
      if (!reportNodes.length) {
        throw new Error("저장할 결과지 화면이 없습니다. 결과지 생성을 먼저 확인해주세요.");
      }

      if (!confirmReportGeneration("snapshot", reportTemplate === "internal" ? 1 : reportNodes.length)) return;

      setExportBusy(true);
      setMessage(`결과지 ${reportNodes.length}건을 서버에 보관하는 중입니다.`);

      let storedCount = 0;
      let failedCount = 0;
      const failureMessages: string[] = [];

      for (const node of reportNodes) {
        const teacherId = node.getAttribute("data-report-teacher-id") || "";
        const teacherName = node.getAttribute("data-report-teacher-name") || "선생님";
        const title = `${period.title || "강의평가"} ${teacherName} 결과지`;
        const html = buildWebReportSnapshotHtml(node, title);

        try {
          const body = await api("/api/admin/report-exports", {
            method: "POST",
            body: JSON.stringify({
              evaluationPeriodId: period.id,
              teacherId,
              teacherName,
              periodTitle: period.title || period.year_month,
              pages: reportPagesMetadata(),
              monthCount: reportMonthCount,
              html
            })
          });

          if (body?.ok === false) {
            failedCount += 1;
            const stage = body.failureStage ? `[${body.failureStage}] ` : "";
            const suggestion = body.suggestion ? ` 조치: ${body.suggestion}` : "";
            failureMessages.push(`${teacherName}: ${stage}${body?.errorMessage || body?.warning || "저장 실패"}${suggestion}`);
          } else {
            storedCount += 1;
          }
        } catch (error: any) {
          failedCount += 1;
          failureMessages.push(`${teacherName}: ${error?.message || "저장 실패"}`);
          console.error(error);
        }
      }

      await loadData();

      if (failedCount > 0) {
        const firstReason = failureMessages[0] ? ` 첫 실패 사유: ${failureMessages[0]}` : "";
        setMessage(`결과지 ${storedCount}건은 서버에 보관했고, ${failedCount}건은 저장 실패 이력으로 기록했습니다.${firstReason}`);
      } else {
        setMessage(`결과지 ${storedCount}건을 서버에 보관했습니다. 출력 이력 탭에서 다시 열 수 있습니다.`);
      }

      if (printAfter) {
        setTimeout(() => {
          window.print();
          setTimeout(() => setTab("exports"), 500);
        }, 250);
      } else {
        setTab("exports");
      }
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setExportBusy(false);
    }
  }


  async function createWebReportLinks() {
    if (webReportBusy) return;

    try {
      const period = selectedReportPeriod || currentPeriod;
      if (!period) throw new Error("평가월이 없습니다. 결과지 생성에서 평가월을 먼저 선택해주세요.");

      const reportNodes = Array.from(document.querySelectorAll("[data-report-teacher-id]"));
      if (!reportNodes.length) {
        throw new Error("웹 리포트로 만들 결과지 화면이 없습니다. 결과지 생성을 먼저 확인해주세요.");
      }

      const isInternal = reportTemplate === "internal";
      if (!confirmReportGeneration("web", isInternal ? 1 : reportNodes.length)) return;

      setWebReportBusy(true);
      setMessage(
        isInternal
          ? "원장 내부 확인용 웹 리포트 링크를 생성하고 총괄관리자 Slack DM을 준비하는 중입니다."
          : `웹 리포트 링크 ${reportNodes.length}건을 생성하는 중입니다. 실패하면 첫 번째 실패 사유를 화면에 표시합니다.`
      );

      let createdCount = 0;
      let failedCount = 0;
      let internalShareLinkId = "";
      let internalSlackMessage = "";
      let internalSlackFailed = false;
      const failureMessages: string[] = [];

      for (const node of reportNodes) {
        const teacherId = node.getAttribute("data-report-teacher-id") || "";
        const teacherName = node.getAttribute("data-report-teacher-name") || "선생님";
        const title = isInternal
          ? `${period.title || "강의평가"} 원장 내부 확인용 웹 리포트`
          : `${period.title || "강의평가"} ${teacherName} 웹 리포트`;
        const html = buildWebReportSnapshotHtml(node, title);

        try {
          const body = await api("/api/admin/report-links", {
            method: "POST",
            body: JSON.stringify({
              action: "create_from_html",
              evaluationPeriodId: period.id,
              teacherId,
              teacherName: isInternal ? "원장 내부 확인용" : teacherName,
              periodTitle: period.title || period.year_month,
              pages: reportPagesMetadata(),
              monthCount: reportMonthCount,
              reportTemplate,
              html,
              title
            })
          });

          if (body?.ok === false) {
            failedCount += 1;
            failureMessages.push(`${teacherName}: ${body?.error || "알 수 없는 실패"}`);
          } else {
            createdCount += 1;
            if (isInternal && body?.shareLink?.id) internalShareLinkId = body.shareLink.id;
          }
        } catch (error: any) {
          failedCount += 1;
          const reason = error?.message || "알 수 없는 오류";
          failureMessages.push(`${teacherName}: ${reason}`);
          console.error(error);
        }
      }

      if (isInternal && internalShareLinkId) {
        try {
          const slackBody = await api("/api/admin/slack", {
            method: "POST",
            body: JSON.stringify({
              action: "send_internal_report",
              shareLinkId: internalShareLinkId
            })
          });
          internalSlackMessage = slackBody?.message || "총괄관리자 Slack DM을 발송했습니다.";
        } catch (error: any) {
          internalSlackFailed = true;
          internalSlackMessage = `총괄관리자 Slack DM 발송 실패: ${error?.message || "알 수 없는 오류"}`;
        }
      }

      await loadData();
      setTab("reportLinks");

      if (isInternal) {
        const firstReason = failureMessages[0] ? ` 첫 실패 사유: ${failureMessages[0]}` : "";
        const slackNotice = internalSlackMessage ? ` ${internalSlackMessage}` : "";
        const safeNotice = " 선생님/직원 대상 Slack 발송은 차단했습니다.";
        if (failedCount || internalSlackFailed) {
          setMessage(`원장 내부 확인용 웹 리포트 링크 ${createdCount}건 생성, 실패 ${failedCount}건.${firstReason}${slackNotice}${safeNotice}`);
        } else {
          setMessage(`원장 내부 확인용 웹 리포트 링크 ${createdCount}건을 생성했습니다.${slackNotice}${safeNotice}`);
        }
        return;
      }

      if (failedCount) {
        const firstReason = failureMessages[0] ? ` 첫 실패 사유: ${failureMessages[0]}` : "";
        setMessage(`웹 리포트 링크 ${createdCount}건은 생성했고, ${failedCount}건은 실패했습니다.${firstReason}`);
      } else {
        setMessage(`웹 리포트 링크 ${createdCount}건을 생성했습니다. 선생님별 Slack DM 발송도 여기서 진행할 수 있습니다.`);
      }
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setWebReportBusy(false);
    }
  }

  async function updateShareLink(linkId: string, action: "deactivate" | "reactivate" | "regenerate") {
    try {
      const label = action === "deactivate" ? "비활성화" : action === "reactivate" ? "재활성화" : "재생성";
      if (action === "regenerate" && !window.confirm("링크를 재생성하면 기존 링크는 더 이상 사용하지 않는 것이 좋습니다. 계속할까요?")) return;
      await api("/api/admin/report-links", {
        method: "PATCH",
        body: JSON.stringify({ id: linkId, action })
      });
      await loadData();
      setMessage(`리포트 링크를 ${label}했습니다.`);
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function lookupSlackUser(teacherId: string) {
    try {
      const draft = teacherDrafts[teacherId] || {};
      setSlackBusy(`lookup-${teacherId}`);
      setMessage("Slack 연결을 확인하는 중입니다. 선생님 Slack 이메일을 먼저 저장하고, Slack 사용자 ID를 찾습니다.");

      const body = await api("/api/admin/slack", {
        method: "POST",
        body: JSON.stringify({
          action: "lookup_teacher",
          teacherId,
          slackEmail: draft.slack_email || ""
        })
      });

      await loadData();
      setMessage(body.message || "Slack 사용자 연결을 확인했습니다.");
    } catch (error: any) {
      setMessage(error.message || "Slack 연결 확인 중 오류가 발생했습니다.");
    } finally {
      setSlackBusy("");
    }
  }

  async function sendInternalSlackReport(link: any) {
    try {
      if (!isInternalShareLink(link)) {
        setMessage("총괄관리자 DM은 원장 내부 확인용 리포트에만 사용할 수 있습니다.");
        return;
      }
      const periodTitle = link.evaluation_periods?.title || selectedReportPeriod?.title || "강의평가";
      if (!window.confirm(`${periodTitle} 원장 내부 확인용 리포트 링크를 총괄관리자에게 Slack DM으로 발송할까요?

선생님/직원에게는 발송되지 않습니다.`)) return;
      setSlackBusy(`internal-${link.id}`);
      const body = await api("/api/admin/slack", {
        method: "POST",
        body: JSON.stringify({ action: "send_internal_report", shareLinkId: link.id })
      });
      await loadData();
      setMessage(body.message || "총괄관리자 Slack DM을 발송했습니다.");
    } catch (error: any) {
      setMessage(`총괄관리자 Slack DM 발송 실패: ${error.message}`);
    } finally {
      setSlackBusy("");
    }
  }

  async function sendSlackReport(link: any) {
    try {
      if (isInternalShareLink(link)) {
        setMessage("원장 내부 확인용 리포트는 선생님/직원에게 Slack DM으로 발송할 수 없습니다. 웹 리포트 생성 시 총괄관리자에게만 DM 발송됩니다.");
        return;
      }
      const teacherName = link.teachers?.name || "선생님";
      if (!window.confirm(`${teacherName} 선생님에게 Slack DM으로 웹 리포트 링크를 발송할까요?`)) return;
      setSlackBusy(`send-${link.id}`);
      const body = await api("/api/admin/slack", {
        method: "POST",
        body: JSON.stringify({ action: "send_report", shareLinkId: link.id })
      });
      await loadData();
      setMessage(body.message || "Slack DM을 발송했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setSlackBusy("");
    }
  }

  async function sendSlackReportsBulk() {
    try {
      const periodId = selectedReportPeriod?.id || currentPeriod?.id;
      const targets = displayedReportShareLinks.filter((link: any) => link.is_active !== false && !isInternalShareLink(link));
      const connected = targets.filter((link: any) => link.teachers?.slack_user_id);

      if (!periodId) throw new Error("평가월을 선택해주세요.");
      if (!targets.length) throw new Error("선택 평가월에 선생님에게 발송할 웹 리포트 링크가 없습니다. 원장 내부 확인용 링크는 일괄 발송 대상에서 제외됩니다.");
      if (!connected.length) throw new Error("Slack 연결이 완료된 선생님 링크가 없습니다. 선생님 관리에서 Slack 연결 확인을 먼저 실행해주세요.");

      const ok = window.confirm(`선택 평가월의 Slack 연결 완료 리포트 ${connected.length}건을 일괄 발송할까요?\n미연결 또는 비활성 링크는 제외됩니다.`);
      if (!ok) return;

      setSlackBusy("bulk-send");
      setMessage(`Slack DM ${connected.length}건을 순서대로 발송하는 중입니다.`);

      let sent = 0;
      let failed = 0;
      const failures: string[] = [];

      for (const link of connected) {
        try {
          const body = await api("/api/admin/slack", {
            method: "POST",
            body: JSON.stringify({ action: "send_report", shareLinkId: link.id })
          });
          if (body?.ok === false) {
            failed += 1;
            failures.push(`${link.teachers?.name || "선생님"}: ${body?.error || "발송 실패"}`);
          } else {
            sent += 1;
          }
        } catch (error: any) {
          failed += 1;
          failures.push(`${link.teachers?.name || "선생님"}: ${error?.message || "발송 실패"}`);
        }
      }

      await loadData();
      const firstFailure = failures[0] ? ` 첫 실패 사유: ${failures[0]}` : "";
      setMessage(`Slack DM 일괄 발송 완료: 성공 ${sent}건, 실패 ${failed}건.${firstFailure}`);
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setSlackBusy("");
    }
  }

  async function sendSlackReportsByFilter(mode: "unsent" | "failed") {
    try {
      const rows = reportShareLinksForPeriod
        .filter((link: any) => link.is_active !== false && link.teachers?.slack_user_id && !isInternalShareLink(link))
        .filter((link: any) => {
          const latestLog = latestSlackLogForLink(link);
          if (mode === "unsent") return !latestLog;
          return latestLog && latestLog.status !== "sent";
        });

      if (!rows.length) {
        throw new Error(mode === "unsent" ? "미발송 상태의 Slack 연결 완료 리포트가 없습니다." : "재발송할 실패 이력이 없습니다.");
      }

      const label = mode === "unsent" ? "미발송 리포트" : "실패 리포트";
      if (!window.confirm(`${label} ${rows.length}건을 Slack DM으로 발송할까요?`)) return;

      setSlackBusy(`bulk-${mode}`);
      setMessage(`${label} ${rows.length}건을 순서대로 발송하는 중입니다.`);

      let sent = 0;
      let failed = 0;
      const failures: string[] = [];

      for (const link of rows) {
        try {
          const body = await api("/api/admin/slack", {
            method: "POST",
            body: JSON.stringify({ action: "send_report", shareLinkId: link.id })
          });
          if (body?.ok === false) {
            failed += 1;
            failures.push(`${link.teachers?.name || "선생님"}: ${body?.error || "발송 실패"}`);
          } else {
            sent += 1;
          }
        } catch (error: any) {
          failed += 1;
          failures.push(`${link.teachers?.name || "선생님"}: ${error?.message || "발송 실패"}`);
        }
      }

      await loadData();
      const firstFailure = failures[0] ? ` 첫 실패 사유: ${failures[0]}` : "";
      setMessage(`${label} 발송 완료: 성공 ${sent}건, 실패 ${failed}건.${firstFailure}`);
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setSlackBusy("");
    }
  }

  async function sendSlackTest(teacherId: string) {
    try {
      if (!window.confirm("이 선생님에게 Slack 테스트 DM을 발송할까요?")) return;
      const draft = teacherDrafts[teacherId] || {};
      setSlackBusy(`test-${teacherId}`);
      setMessage("Slack 테스트 DM을 준비하는 중입니다. Slack 이메일 저장, 사용자 확인, DM 발송을 순서대로 진행합니다.");

      const body = await api("/api/admin/slack", {
        method: "POST",
        body: JSON.stringify({
          action: "test_teacher",
          teacherId,
          slackEmail: draft.slack_email || ""
        })
      });

      await loadData();
      setMessage(body.message || "Slack 테스트 DM을 발송했습니다.");
    } catch (error: any) {
      setMessage(error.message || "Slack 테스트 DM 발송 중 오류가 발생했습니다.");
    } finally {
      setSlackBusy("");
    }
  }

  async function openReportExport(exportId: string) {
    try {
      const body = await api(`/api/admin/report-exports/open?exportId=${encodeURIComponent(exportId)}`);
      if (!body.url) throw new Error("저장본을 열 수 있는 주소가 없습니다.");
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function updateReportExportStatus(exportId: string, status: "printed" | "archived") {
    try {
      await api("/api/admin/report-exports", {
        method: "PATCH",
        body: JSON.stringify({ id: exportId, status })
      });
      await loadData();
      setMessage(status === "printed" ? "출력 완료로 표시했습니다." : "보관 처리했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function runSafetyAction(payload: any, successMessage: string) {
    try {
      await api("/api/admin/safety", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await loadData();
      setMessage(successMessage);
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function lockSafetyPeriod(period: any) {
    if (!period?.id) {
      setMessage("잠금 처리할 평가월이 없습니다.");
      return;
    }
    const reason = window.prompt("평가월 잠금 사유를 입력해주세요.", "결과지 생성 후 데이터 변경 방지");
    if (reason === null) return;
    await runSafetyAction(
      { action: "lock_period", periodId: period.id, reason },
      "평가월을 잠금 처리했습니다. 수정하려면 먼저 잠금을 해제하세요."
    );
  }

  async function unlockSafetyPeriod(period: any) {
    if (!period?.id) {
      setMessage("잠금 해제할 평가월이 없습니다.");
      return;
    }
    const reason = window.prompt("평가월 잠금 해제 사유를 입력해주세요.", "추가 수정 필요");
    if (reason === null) return;
    const ok = window.confirm("잠금을 해제하면 해당 평가월의 응답/배정/QR/퇴원율 수정이 다시 가능해집니다. 계속할까요?");
    if (!ok) return;
    await runSafetyAction(
      { action: "unlock_period", periodId: period.id, reason },
      "평가월 잠금을 해제했습니다."
    );
  }

  async function hideResponse(response: any) {
    const reason = window.prompt("응답 숨김 사유를 입력해주세요.", "잘못 입력된 응답 또는 운영상 제외");
    if (reason === null) return;
    const ok = window.confirm("이 응답은 결과 분석과 결과지에서 제외됩니다. 원본은 삭제하지 않고 숨김 처리합니다. 계속할까요?");
    if (!ok) return;
    await runSafetyAction(
      { action: "hide_response", responseId: response.id, reason },
      "응답을 숨김 처리했습니다. 운영 안전 탭에서 복구할 수 있습니다."
    );
    setSelectedResponseId("");
  }

  async function restoreResponse(response: any) {
    const reason = window.prompt("응답 복구 사유를 입력해주세요.", "숨김 처리 취소");
    if (reason === null) return;
    await runSafetyAction(
      { action: "restore_response", responseId: response.id, reason },
      "응답을 복구했습니다."
    );
  }


  function requiredDeletePhrase(period: any) {
    return period?.title ? `${period.title} 영구 삭제` : "";
  }

  async function deletePeriodData() {
    if (currentAdmin?.role !== "super_admin") {
      setMessage("데이터 삭제는 총괄관리자만 사용할 수 있습니다.");
      return;
    }
    if (!selectedDeletePeriod?.id) {
      setMessage("삭제할 평가월을 선택해주세요.");
      return;
    }

    const phrase = requiredDeletePhrase(selectedDeletePeriod);
    if (deleteConfirmText.trim() !== phrase) {
      setMessage(`삭제 확인 문구가 맞지 않습니다. 정확히 "${phrase}"라고 입력해야 합니다.`);
      return;
    }

    const ok = window.confirm(
      `${selectedDeletePeriod.title}의 설문 응답, 답변, QR, 배정, 퇴원율, 결과지, 웹 링크, Slack 발송 이력, 업로드 이력을 영구 삭제합니다.\n이 작업은 되돌릴 수 없습니다. 계속할까요?`
    );
    if (!ok) return;

    try {
      setDeleteBusy(true);
      setMessage("선택 평가월 데이터를 영구 삭제하는 중입니다.");
      const body = await api("/api/admin/destructive-delete", {
        method: "POST",
        body: JSON.stringify({
          action: "delete_period_data",
          evaluationPeriodId: selectedDeletePeriod.id,
          confirmation: phrase
        })
      });
      setDeleteConfirmText("");
      await loadData();
      setMessage(body.message || "선택 평가월 데이터를 삭제했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function deleteTeacherHard(teacher: any) {
    if (currentAdmin?.role !== "super_admin") {
      setMessage("선생님 삭제는 총괄관리자만 사용할 수 있습니다.");
      return;
    }
    const phrase = `${teacher.name} 선생님 영구 삭제`;
    const input = window.prompt(
      `선생님 "${teacher.name}"을 영구 삭제하려면 아래 문구를 정확히 입력하세요.\n\n${phrase}\n\n연결된 응답, QR, 배정, 결과지, 웹 링크, Slack 발송 이력도 함께 삭제됩니다.`,
      ""
    );
    if (input === null) return;
    if (input.trim() !== phrase) {
      setMessage(`삭제 확인 문구가 맞지 않습니다. 정확히 "${phrase}"라고 입력해야 합니다.`);
      return;
    }
    const ok = window.confirm(`${teacher.name} 선생님과 연결된 모든 운영 데이터를 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다. 계속할까요?`);
    if (!ok) return;

    try {
      setDeleteBusy(true);
      setMessage(`${teacher.name} 선생님 데이터를 영구 삭제하는 중입니다.`);
      const body = await api("/api/admin/teachers", {
        method: "DELETE",
        body: JSON.stringify({ teacherId: teacher.id, confirmation: phrase })
      });
      await loadData();
      setMessage(body.message || "선생님을 삭제했습니다.");
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function downloadReportExportsZip(scope: "period" | "teacher" | "all") {
    try {
      setZipBusy(true);
      setMessage("ZIP 파일을 준비하고 있습니다. 저장본 수가 많으면 조금 걸릴 수 있습니다.");

      const params = new URLSearchParams();
      params.set("mode", scope);
      if (scope === "period" && selectedReportPeriod?.id) {
        params.set("evaluationPeriodId", selectedReportPeriod.id);
      }
      if (scope === "teacher" && selectedReportPeriod?.id) {
        params.set("evaluationPeriodId", selectedReportPeriod.id);
      }
      if (scope === "teacher" && selectedTeacher?.id) {
        params.set("teacherId", selectedTeacher.id);
      }

      const res = await fetch(`/api/admin/report-exports/download-zip?${params.toString()}`, {
        headers: { "x-admin-session": sessionToken },
        cache: "no-store"
      });

      if (!res.ok) {
        let errorMessage = "ZIP 다운로드에 실패했습니다.";
        try {
          const body = await res.json();
          errorMessage = body.error || errorMessage;
        } catch {
          errorMessage = await res.text();
        }
        throw new Error(errorMessage);
      }

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const matched = disposition.match(/filename="([^"]+)"/);
      const filename = matched?.[1] || `e-evaluation-reports-${Date.now()}.zip`;

      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);

      setMessage("ZIP 다운로드를 시작했습니다. 압축 파일 안의 index.html을 열면 저장본 목록을 확인할 수 있습니다.");
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setZipBusy(false);
    }
  }

  async function downloadWorkbook(filename: string, sheets: { name: string; rows: any[][] }[]) {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const safeSheets = sheets.map((sheet, index) => ({
      name: String(sheet.name || `Sheet${index + 1}`).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31) || `Sheet${index + 1}`,
      rows: sheet.rows?.length ? sheet.rows : [["데이터 없음"]]
    }));

    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${safeSheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n  ")}
</Types>`);
    zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
    zip.folder("xl")?.file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${safeSheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("\n    ")}
  </sheets>
</workbook>`);
    zip.folder("xl")?.folder("_rels")?.file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${safeSheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("\n  ")}
</Relationships>`);
    const worksheetFolder = zip.folder("xl")?.folder("worksheets");
    safeSheets.forEach((sheet, index) => worksheetFolder?.file(`sheet${index + 1}.xml`, worksheetXml(sheet.rows)));

    const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }

  async function downloadDataBackup(scope: "period" | "all") {
    try {
      setBackupBusy(true);
      const periodId = scope === "period" ? backupPeriod?.id : "";
      const periodTitle = scope === "period" ? (backupPeriod?.title || "선택평가월") : "전체기간";
      const teachersById = new Map((data?.teachers || []).map((teacher: any) => [teacher.id, teacher]));
      const classesById = new Map((data?.classes || []).map((classItem: any) => [classItem.id, classItem]));
      const periodsById = new Map((data?.periods || []).map((period: any) => [period.id, period]));

      const periodFilter = (row: any) => !periodId || row.evaluation_period_id === periodId;
      const responses = (data?.responses || []).filter(periodFilter);
      const questionsById = new Map((data?.questions || []).map((question: any) => [question.id, question]));

      const responseRows = [
        ["제출시각", "평가월", "선생님", "반", "학생입력명", "상태", "숨김", "업로드소스", "응답ID"],
        ...responses.map((response: any) => [
          formatDateTime(response.submitted_at || response.created_at),
          (periodsById.get(response.evaluation_period_id) as any)?.title || response.evaluation_periods?.title || "",
          (teachersById.get(response.teacher_id) as any)?.name || response.teachers?.name || "",
          (classesById.get(response.class_id) as any)?.name || response.classes?.name || "",
          response.student_name || "",
          responseStatusLabels(response).join(", "),
          response.is_hidden ? "숨김" : "표시",
          response.import_source || "qr",
          response.id || ""
        ])
      ];

      const answerRows = [
        ["제출시각", "평가월", "선생님", "반", "응답번호", "문항코드", "문항", "점수", "선택값", "서술형"],
        ...responses.flatMap((response: any) => (response.evaluation_answers || []).map((answer: any, index: number) => {
          const question = answer.evaluation_questions || questionsById.get(answer.question_id) || {};
          return [
            formatDateTime(response.submitted_at || response.created_at),
            (periodsById.get(response.evaluation_period_id) as any)?.title || "",
            (teachersById.get(response.teacher_id) as any)?.name || "",
            (classesById.get(response.class_id) as any)?.name || "",
            index + 1,
            question.code || "",
            String(question.title || "").replace("{teacher_name}", (teachersById.get(response.teacher_id) as any)?.name || ""),
            answer.score_value ?? "",
            answer.choice_label || "",
            answer.text_value || ""
          ];
        }))
      ];

      const teacherSummaryRows = [
        ["평가월", "선생님", "강의평가 평점", "응답수", "퇴원율"],
        ...(data?.monthlyScores || []).filter(periodFilter).map((row: any) => {
          const metric = (data?.metrics || []).find((m: any) => m.teacher_id === row.teacher_id && m.evaluation_period_id === row.evaluation_period_id);
          return [
            (periodsById.get(row.evaluation_period_id) as any)?.title || "",
            row.teacher_name || (teachersById.get(row.teacher_id) as any)?.name || "",
            row.avg_score_100 ?? "",
            row.response_count ?? "",
            metric?.withdrawal_rate_percent ?? ""
          ];
        })
      ];

      const classScoreRows = [
        ["평가월", "선생님", "반", "평균점수", "응답수"],
        ...(data?.classScores || []).filter(periodFilter).map((row: any) => [
          (periodsById.get(row.evaluation_period_id) as any)?.title || "",
          row.teacher_name || (teachersById.get(row.teacher_id) as any)?.name || "",
          row.class_name || (classesById.get(row.class_id) as any)?.name || "",
          row.avg_score_100 ?? "",
          row.response_count ?? ""
        ])
      ];

      const qrRows = [
        ["생성시각", "평가월", "선생님", "반", "상태", "토큰", "조회수"],
        ...(data?.qrLinks || []).filter(periodFilter).map((row: any) => [
          formatDateTime(row.created_at),
          row.evaluation_periods?.title || (periodsById.get(row.evaluation_period_id) as any)?.title || "",
          row.teachers?.name || (teachersById.get(row.teacher_id) as any)?.name || "",
          row.classes?.name || (classesById.get(row.class_id) as any)?.name || "",
          row.is_active === false ? "비활성" : "사용중",
          row.token || "",
          row.view_count ?? ""
        ])
      ];

      const reportLinkRows = [
        ["생성시각", "평가월", "선생님", "상태", "조회수", "마지막조회", "토큰"],
        ...(data?.reportShareLinks || []).filter(periodFilter).map((row: any) => [
          formatDateTime(row.created_at),
          row.evaluation_periods?.title || (periodsById.get(row.evaluation_period_id) as any)?.title || "",
          row.teachers?.name || (teachersById.get(row.teacher_id) as any)?.name || "",
          row.is_active === false ? "비활성" : "사용중",
          row.view_count ?? 0,
          formatDateTime(row.last_viewed_at),
          row.token || ""
        ])
      ];

      const slackRows = [
        ["발송시각", "평가월", "선생님", "상태", "오류", "링크ID"],
        ...(data?.slackMessageLogs || []).filter(periodFilter).map((row: any) => [
          formatDateTime(row.created_at),
          row.evaluation_periods?.title || (periodsById.get(row.evaluation_period_id) as any)?.title || "",
          row.teachers?.name || (teachersById.get(row.teacher_id) as any)?.name || "",
          row.status === "sent" ? "발송 성공" : "발송 실패",
          row.error_message || "",
          row.share_link_id || ""
        ])
      ];

      const exportRows = [
        ["보관시각", "평가월", "선생님", "상태", "파일형식", "포함페이지", "파일URL"],
        ...(data?.reportExports || []).filter(periodFilter).map((row: any) => [
          formatDateTime(row.created_at || row.exported_at),
          row.evaluation_periods?.title || (periodsById.get(row.evaluation_period_id) as any)?.title || "",
          row.teachers?.name || (teachersById.get(row.teacher_id) as any)?.name || "",
          exportStatusLabels[row.status] || row.status || "",
          getReportExportFormat(row),
          Object.entries(row.pages || {}).filter(([_, value]) => value === true).map(([key]) => key).join(", "),
          row.file_url || ""
        ])
      ];

      const importRows = [
        ["업로드시각", "평가월", "상태", "전체행", "성공", "오류", "메모"],
        ...(data?.responseImportBatches || []).filter(periodFilter).map((row: any) => [
          formatDateTime(row.created_at),
          row.evaluation_periods?.title || (periodsById.get(row.evaluation_period_id) as any)?.title || "",
          responseImportStatusLabels[row.status] || row.status || "",
          row.total_rows ?? "",
          row.imported_rows ?? "",
          row.error_rows ?? "",
          row.memo || ""
        ])
      ];

      await downloadWorkbook(`e-evaluation-backup-${periodTitle}-${APP_VERSION}.xlsx`, [
        { name: "응답원본", rows: responseRows },
        { name: "문항별답변", rows: answerRows },
        { name: "선생님요약", rows: teacherSummaryRows },
        { name: "반별점수", rows: classScoreRows },
        { name: "QR링크", rows: qrRows },
        { name: "웹리포트링크", rows: reportLinkRows },
        { name: "Slack발송이력", rows: slackRows },
        { name: "출력이력", rows: exportRows },
        { name: "응답업로드이력", rows: importRows }
      ]);

      setMessage(`${periodTitle} 데이터 백업 엑셀 다운로드를 시작했습니다.`);
    } catch (error: any) {
      setMessage(error.message || "데이터 백업 엑셀 생성에 실패했습니다.");
    } finally {
      setBackupBusy(false);
    }
  }

  const selectedTeacher = useMemo(() => {
    return data?.teachers?.find((t: any) => t.id === selectedTeacherId) || data?.teachers?.[0];
  }, [data, selectedTeacherId]);

  const activeTeachers = useMemo(() => (data?.teachers || []).filter((t: any) => t.is_active !== false), [data]);
  const activeClasses = useMemo(() => (data?.classes || []).filter((c: any) => c.is_active !== false), [data]);

  const reportMappingScopeKey = (teacherId?: string) => `${teacherId || "teacher"}:all-periods`;
  const currentReportMappingKey = reportMappingScopeKey(selectedTeacher?.id || selectedTeacherId || "");
  const currentReportMappingForm = reportClassMappingForms[currentReportMappingKey] || { from_class_id: "", to_class_id: "", direction_mode: "bidirectional", memo: "" };
  const currentReportClassMappings = reportClassMappings[currentReportMappingKey] || [];

  const reportMappingClassOptions = useMemo(() => {
    const teacherId = selectedTeacher?.id || selectedTeacherId || "";
    const classIds = new Set<string>();
    if (!teacherId) return activeClasses;

    for (const assignment of data?.assignments || []) {
      if (assignment.teacher_id === teacherId && assignment.is_active !== false && assignment.class_id) {
        classIds.add(assignment.class_id);
      }
    }
    for (const response of data?.responses || []) {
      if (response.teacher_id === teacherId && response.class_id) classIds.add(response.class_id);
    }
    for (const score of data?.classScores || []) {
      if (score.teacher_id === teacherId && score.class_id) classIds.add(score.class_id);
    }

    const rows = activeClasses.filter((classItem: any) => classIds.has(classItem.id));
    return rows.length ? rows : activeClasses;
  }, [data, activeClasses, selectedTeacher, selectedTeacherId]);

  const visibleResponses = useMemo(() => (data?.responses || []).filter((r: any) => r.is_hidden !== true), [data]);
  const hiddenResponses = useMemo(() => (data?.responses || []).filter((r: any) => r.is_hidden === true), [data]);

  const homePeriod = useMemo(() => {
    if (!data?.periods?.length) return null;
    return data.periods.find((p: any) => p.id === selectedHomePeriodId) || currentPeriod || data.periods[0];
  }, [data, selectedHomePeriodId, currentPeriod]);

  const homeQrLinks = useMemo(() => {
    const periodId = homePeriod?.id;
    return (data?.qrLinks || []).filter((link: any) => !periodId || link.evaluation_period_id === periodId);
  }, [data, homePeriod]);

  const homeResponses = useMemo(() => {
    const periodId = homePeriod?.id;
    return visibleResponses.filter((r: any) => !periodId || r.evaluation_period_id === periodId);
  }, [visibleResponses, homePeriod]);

  const totalResponses = homeResponses.length;
  const flaggedResponses = homeResponses.filter((r: any) => r.is_flagged).length;
  const duplicateResponses = homeResponses.filter((r: any) => r.is_duplicate_suspected).length;

  const activeQrClassKeys = new Set(
    homeQrLinks
      .filter((link: any) => link.is_active !== false && link.class_id)
      .map((link: any) => `${link.teacher_id}:${link.class_id}`)
  );
  const respondedClassKeys = new Set(
    homeResponses
      .filter((response: any) => response.class_id)
      .map((response: any) => `${response.teacher_id}:${response.class_id}`)
  );
  const responseRate = activeQrClassKeys.size
    ? Math.round((Array.from(activeQrClassKeys).filter((key) => respondedClassKeys.has(key)).length / activeQrClassKeys.size) * 1000) / 10
    : 0;

  const homeTeacherSummaries = useMemo(() => {
    const periodId = homePeriod?.id;
    return activeTeachers.map((teacher: any) => {
      const teacherResponses = homeResponses.filter((response: any) => response.teacher_id === teacher.id);
      const classCount = new Set(teacherResponses.map((response: any) => response.class_id).filter(Boolean)).size;
      const scoreRow = (data?.monthlyScores || []).find((row: any) => row.teacher_id === teacher.id && (!periodId || row.evaluation_period_id === periodId));
      const metric = (data?.metrics || []).find((row: any) => row.teacher_id === teacher.id && (!periodId || row.evaluation_period_id === periodId));
      return {
        teacher,
        responseCount: teacherResponses.length,
        classCount,
        avgScore: scoreRow?.avg_score_100,
        withdrawalRate: metric?.withdrawal_rate_percent
      };
    }).sort((a: any, b: any) => String(a.teacher.name || "").localeCompare(String(b.teacher.name || ""), "ko"));
  }, [activeTeachers, homeResponses, data, homePeriod]);

  function goToResponses(status: "flagged" | "duplicate") {
    if (homePeriod?.id) setSelectedReportPeriodId(homePeriod.id);
    setResponseStatusFilter(status);
    setResponseTeacherFilter("all");
    setResponseClassFilter("all");
    setResponseSearch("");
    setSelectedResponseId("");
    setTab("responses");
  }

  const operationChecklist = useMemo(() => {
    const periodId = homePeriod?.id;
    const periodTitle = homePeriod?.title || "선택 평가월";
    const assignments = (data?.assignments || []).filter((a: any) => a.is_active !== false && (!periodId || a.evaluation_period_id === periodId));
    const qrLinks = (data?.qrLinks || []).filter((q: any) => q.is_active !== false && (!periodId || q.evaluation_period_id === periodId));
    const responses = homeResponses;
    const responseClassKeys = new Set(responses.map((r: any) => `${r.teacher_id}:${r.class_id || ""}`));
    const qrClassKeys = new Set(qrLinks.map((q: any) => `${q.teacher_id}:${q.class_id || ""}`));
    const noResponseQr = qrLinks.filter((q: any) => !responseClassKeys.has(`${q.teacher_id}:${q.class_id || ""}`));
    const targetTeacherIds = new Set([
      ...assignments.map((a: any) => a.teacher_id),
      ...responses.map((r: any) => r.teacher_id),
      ...qrLinks.map((q: any) => q.teacher_id)
    ].filter(Boolean));
    const pdfTeacherIds = new Set(
      (data?.reportExports || [])
        .filter((row: any) => (!periodId || row.evaluation_period_id === periodId) && getReportExportFormat(row) === "PDF" && row.status !== "failed")
        .map((row: any) => row.teacher_id)
    );
    const webTeacherIds = new Set(
      (data?.reportShareLinks || [])
        .filter((row: any) => (!periodId || row.evaluation_period_id === periodId) && row.is_active !== false)
        .map((row: any) => row.teacher_id)
    );
    const slackSentTeacherIds = new Set(
      (data?.slackMessageLogs || [])
        .filter((log: any) => (!periodId || log.evaluation_period_id === periodId) && log.status === "sent")
        .map((log: any) => log.teacher_id)
    );
    const missingWithdrawal = Array.from(targetTeacherIds).filter((teacherId: any) => {
      const metric = (data?.metrics || []).find((m: any) => m.teacher_id === teacherId && (!periodId || m.evaluation_period_id === periodId));
      return metric?.withdrawal_rate_percent === null || metric?.withdrawal_rate_percent === undefined || metric?.withdrawal_rate_percent === "";
    });
    const pdfMissing = Array.from(targetTeacherIds).filter((teacherId: any) => !pdfTeacherIds.has(teacherId));
    const webMissing = Array.from(targetTeacherIds).filter((teacherId: any) => !webTeacherIds.has(teacherId));
    const slackMissing = Array.from(targetTeacherIds).filter((teacherId: any) => !slackSentTeacherIds.has(teacherId));

    const rows = [
      {
        key: "period",
        title: "평가월 준비",
        done: Boolean(periodId),
        value: periodTitle,
        detail: "평가월이 선택되어 있습니다.",
        action: () => setTab("periods")
      },
      {
        key: "assignments",
        title: "선생님-반 배정",
        done: assignments.length > 0,
        value: `${assignments.length}건`,
        detail: assignments.length ? "평가월 기준 배정이 있습니다." : "배정이 없습니다.",
        action: () => setTab("assignments")
      },
      {
        key: "qr",
        title: "QR 생성",
        done: qrLinks.length > 0 && qrLinks.length >= assignments.length,
        value: `${qrLinks.length}/${Math.max(assignments.length, 0)}건`,
        detail: "QR을 만든 반이 이번 달 활성화된 반으로 계산됩니다.",
        action: () => setTab("qr")
      },
      {
        key: "responses",
        title: "응답 없는 반",
        done: noResponseQr.length === 0 && qrLinks.length > 0,
        value: `${noResponseQr.length}개`,
        detail: noResponseQr.length ? "응답이 없는 QR 반이 있습니다." : "응답 없는 반이 없습니다.",
        action: () => setTab("responses")
      },
      {
        key: "review",
        title: "검토 필요/중복 응답",
        done: flaggedResponses === 0 && duplicateResponses === 0,
        value: `검토 ${flaggedResponses}건 · 중복 ${duplicateResponses}건`,
        detail: "문제 응답이 있으면 제출 현황에서 먼저 확인하세요.",
        action: () => {
          setResponseStatusFilter(flaggedResponses ? "flagged" : duplicateResponses ? "duplicate" : "all");
          setTab("responses");
        }
      },
      {
        key: "withdrawal",
        title: "퇴원율 입력",
        done: missingWithdrawal.length === 0 && targetTeacherIds.size > 0,
        value: `${missingWithdrawal.length}명 미입력`,
        detail: "퇴원율은 외부 기준으로 산출 후 이 앱에 확정값만 입력합니다.",
        action: () => setTab("withdrawal")
      },
      {
        key: "pdf",
        title: "PDF 결과지 생성",
        done: pdfMissing.length === 0 && targetTeacherIds.size > 0,
        value: `${pdfTeacherIds.size}/${targetTeacherIds.size}명`,
        detail: "선생님별 PDF 저장 이력을 기준으로 확인합니다.",
        action: () => setTab("report")
      },
      {
        key: "web",
        title: "웹 리포트 링크",
        done: webMissing.length === 0 && targetTeacherIds.size > 0,
        value: `${webTeacherIds.size}/${targetTeacherIds.size}명`,
        detail: "웹 리포트 링크 생성 여부를 확인합니다.",
        action: () => setTab("reportLinks")
      },
      {
        key: "slack",
        title: "Slack DM 발송",
        done: slackMissing.length === 0 && targetTeacherIds.size > 0,
        value: `${slackSentTeacherIds.size}/${targetTeacherIds.size}명`,
        detail: "선생님에게 웹 리포트 링크를 DM 발송했는지 확인합니다.",
        action: () => setTab("reportLinks")
      },
      {
        key: "lock",
        title: "평가월 잠금",
        done: Boolean(homePeriod?.is_locked),
        value: homePeriod?.is_locked ? "잠금 완료" : "미잠금",
        detail: "결과지 배포 후 평가월을 잠그면 실수 수정을 막을 수 있습니다.",
        action: () => setTab("safety")
      }
    ];
    return rows;
  }, [data, homePeriod, homeResponses, flaggedResponses, duplicateResponses]);

  const backupPeriod = useMemo(() => {
    if (!data?.periods?.length) return null;
    return data.periods.find((p: any) => p.id === backupPeriodId) || currentPeriod || data.periods[0];
  }, [data, backupPeriodId, currentPeriod]);

  const assignmentDefaults = useMemo(() => {
    const period = selectedAssignmentPeriod;
    const teacherId = assignmentForm.teacher_id || activeTeachers[0]?.id || "";
    if (!period || !teacherId) {
      return { currentClassIds: [] as string[], previousClassIds: [] as string[], sourcePeriod: null as any };
    }

    const activeAssignments = (data?.assignments || []).filter((a: any) => a.is_active !== false && a.teacher_id === teacherId);
    const currentClassIds = activeAssignments
      .filter((a: any) => a.evaluation_period_id === period.id)
      .map((a: any) => a.class_id)
      .filter(Boolean);

    const sortedPreviousPeriods = [...(data?.periods || [])]
      .filter((p: any) => p.id !== period.id && String(p.year_month || "") < String(period.year_month || ""))
      .sort((a: any, b: any) => String(b.year_month || "").localeCompare(String(a.year_month || "")));

    const sourcePeriod = sortedPreviousPeriods.find((p: any) =>
      activeAssignments.some((a: any) => a.evaluation_period_id === p.id)
    );

    const previousClassIds = sourcePeriod
      ? activeAssignments
          .filter((a: any) => a.evaluation_period_id === sourcePeriod.id)
          .map((a: any) => a.class_id)
          .filter(Boolean)
      : [];

    return { currentClassIds, previousClassIds, sourcePeriod };
  }, [data, selectedAssignmentPeriod, assignmentForm.teacher_id, activeTeachers]);

  useEffect(() => {
    const periodId = selectedAssignmentPeriod?.id || "";
    const teacherId = assignmentForm.teacher_id || activeTeachers[0]?.id || "";
    if (!periodId || !teacherId) return;

    const defaults = assignmentDefaults.currentClassIds.length
      ? assignmentDefaults.currentClassIds
      : assignmentDefaults.previousClassIds;

    setAssignmentForm((prev: any) => ({
      ...prev,
      evaluation_period_id: prev.evaluation_period_id || periodId,
      teacher_id: prev.teacher_id || teacherId
    }));
    setSelectedAssignmentClassIds(Array.from(new Set(defaults)));
  }, [
    selectedAssignmentPeriod?.id,
    assignmentForm.teacher_id,
    activeTeachers,
    assignmentDefaults.currentClassIds.join("|"),
    assignmentDefaults.previousClassIds.join("|")
  ]);

  const displayedAssignments = useMemo(() => {
    const periodId = selectedAssignmentPeriod?.id;
    return (data?.assignments || []).filter((a: any) => !periodId || a.evaluation_period_id === periodId);
  }, [data, selectedAssignmentPeriod]);

  const displayedQrLinks = useMemo(() => {
    const periodId = selectedQrPeriod?.id;
    return (data?.qrLinks || []).filter((link: any) => !periodId || link.evaluation_period_id === periodId);
  }, [data, selectedQrPeriod]);

  const periodResponses = useMemo(() => {
    const periodId = selectedReportPeriod?.id || currentPeriod?.id;
    return visibleResponses.filter((r: any) => !periodId || r.evaluation_period_id === periodId);
  }, [visibleResponses, selectedReportPeriod, currentPeriod]);

  const reportShareLinksForPeriod = useMemo(() => {
    const periodId = selectedReportPeriod?.id || currentPeriod?.id;
    return (data?.reportShareLinks || []).filter((link: any) => !periodId || link.evaluation_period_id === periodId);
  }, [data, selectedReportPeriod, currentPeriod]);

  function latestSlackLogForLink(link: any) {
    const logs = (data?.slackMessageLogs || []).filter((log: any) => {
      const logShareLinkId = log.report_share_link_id || log.share_link_id;
      if (logShareLinkId && link.id) return logShareLinkId === link.id;
      return log.teacher_id === link.teacher_id && log.evaluation_period_id === link.evaluation_period_id;
    });
    return logs.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0] || null;
  }

  const displayedReportShareLinks = useMemo(() => {
    const rows = reportShareLinksForPeriod;
    const teacherSlackRows = rows.filter((link: any) => !isInternalShareLink(link));
    if (reportLinkStatusFilter === "internal") return rows.filter((link: any) => isInternalShareLink(link));
    if (reportLinkStatusFilter === "active") return rows.filter((link: any) => link.is_active !== false);
    if (reportLinkStatusFilter === "inactive") return rows.filter((link: any) => link.is_active === false);
    if (reportLinkStatusFilter === "connected") return teacherSlackRows.filter((link: any) => link.teachers?.slack_user_id);
    if (reportLinkStatusFilter === "disconnected") return teacherSlackRows.filter((link: any) => !link.teachers?.slack_user_id);
    if (reportLinkStatusFilter === "viewed") return rows.filter((link: any) => Number(link.view_count || 0) > 0);
    if (reportLinkStatusFilter === "unviewed") return rows.filter((link: any) => Number(link.view_count || 0) === 0);
    if (reportLinkStatusFilter === "sent") return rows.filter((link: any) => latestSlackLogForLink(link)?.status === "sent");
    if (reportLinkStatusFilter === "failed") return rows.filter((link: any) => {
      const log = latestSlackLogForLink(link);
      return log && log.status !== "sent";
    });
    if (reportLinkStatusFilter === "unsent") return teacherSlackRows.filter((link: any) => !latestSlackLogForLink(link));
    return rows;
  }, [reportShareLinksForPeriod, reportLinkStatusFilter, data?.slackMessageLogs]);

  const reportLinkSlackSummary = useMemo(() => {
    const rows = reportShareLinksForPeriod;
    const teacherSlackRows = rows.filter((link: any) => !isInternalShareLink(link));
    const internalRows = rows.filter((link: any) => isInternalShareLink(link));
    const sent = rows.filter((link: any) => latestSlackLogForLink(link)?.status === "sent").length;
    const failed = rows.filter((link: any) => {
      const log = latestSlackLogForLink(link);
      return log && log.status !== "sent";
    }).length;
    const unsent = teacherSlackRows.filter((link: any) => !latestSlackLogForLink(link)).length;
    const internalSent = internalRows.filter((link: any) => latestSlackLogForLink(link)?.status === "sent").length;
    const internalFailed = internalRows.filter((link: any) => {
      const log = latestSlackLogForLink(link);
      return log && log.status !== "sent";
    }).length;
    const unviewed = rows.filter((link: any) => Number(link.view_count || 0) === 0).length;
    const connected = teacherSlackRows.filter((link: any) => link.teachers?.slack_user_id).length;
    const internal = internalRows.length;
    return { total: rows.length, sent, failed, unsent, unviewed, connected, internal, internalSent, internalFailed };
  }, [reportShareLinksForPeriod, data?.slackMessageLogs]);

  const responseStats = useMemo(() => {
    return {
      total: periodResponses.length,
      normal: periodResponses.filter((r: any) => !r.is_flagged && !r.is_duplicate_suspected && !hasPressureFlag(r)).length,
      flagged: periodResponses.filter((r: any) => r.is_flagged).length,
      duplicate: periodResponses.filter((r: any) => r.is_duplicate_suspected).length
    };
  }, [periodResponses]);

  const responseSummaryRows = useMemo(() => {
    const periodId = selectedReportPeriod?.id || currentPeriod?.id;
    const map = new Map<string, any>();

    (data?.qrLinks || [])
      .filter((link: any) => !periodId || link.evaluation_period_id === periodId)
      .forEach((link: any) => {
        const key = link.id || `${link.teacher_id}:${link.class_id || ""}`;
        map.set(key, {
          key,
          teacherName: link.teachers?.name || "-",
          className: link.classes?.name || "반 미지정",
          total: 0,
          flagged: 0,
          duplicate: 0,
          lastSubmittedAt: null
        });
      });

    periodResponses.forEach((response: any) => {
      const key = response.teacher_qr_link_id || `${response.teacher_id}:${response.class_id || ""}`;
      const existing = map.get(key) || {
        key,
        teacherName: response.teachers?.name || "-",
        className: response.classes?.name || "반 미지정",
        total: 0,
        flagged: 0,
        duplicate: 0,
        lastSubmittedAt: null
      };
      existing.total += 1;
      if (response.is_flagged) existing.flagged += 1;
      if (response.is_duplicate_suspected) existing.duplicate += 1;
      if (!existing.lastSubmittedAt || new Date(response.submitted_at) > new Date(existing.lastSubmittedAt)) {
        existing.lastSubmittedAt = response.submitted_at;
      }
      map.set(key, existing);
    });

    return Array.from(map.values()).sort((a: any, b: any) => {
      const teacherCompare = String(a.teacherName || "").localeCompare(String(b.teacherName || ""), "ko");
      if (teacherCompare !== 0) return teacherCompare;
      return String(a.className || "").localeCompare(String(b.className || ""), "ko");
    });
  }, [data, periodResponses, selectedReportPeriod, currentPeriod]);

  const filteredResponses = useMemo(() => {
    const keyword = responseSearch.trim().toLowerCase();
    return periodResponses.filter((response: any) => {
      if (responseTeacherFilter !== "all" && response.teacher_id !== responseTeacherFilter) return false;
      if (responseClassFilter !== "all" && response.class_id !== responseClassFilter) return false;
      if (responseStatusFilter === "normal" && (response.is_flagged || response.is_duplicate_suspected || hasPressureFlag(response))) return false;
      if (responseStatusFilter === "flagged" && !response.is_flagged) return false;
      if (responseStatusFilter === "duplicate" && !response.is_duplicate_suspected) return false;

      if (!keyword) return true;
      const haystack = [
        response.student_name,
        response.teachers?.name,
        response.classes?.name,
        response.flag_reason,
        response.duplicate_reason,
        ...getAnswers(response).map((answer: any) => answerDisplay(answer))
      ].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [periodResponses, responseSearch, responseTeacherFilter, responseClassFilter, responseStatusFilter]);

  const selectedResponse = useMemo(() => {
    return filteredResponses.find((response: any) => response.id === selectedResponseId) || null;
  }, [filteredResponses, selectedResponseId]);

  const safetyPeriodResponses = useMemo(() => {
    const periodId = selectedSafetyPeriod?.id;
    const keyword = safetyResponseSearch.trim().toLowerCase();
    return (data?.responses || [])
      .filter((response: any) => !periodId || response.evaluation_period_id === periodId)
      .filter((response: any) => {
        if (!keyword) return true;
        const haystack = [
          response.student_name,
          response.teachers?.name,
          response.classes?.name,
          response.hidden_reason,
          response.flag_reason,
          response.duplicate_reason
        ].join(" ").toLowerCase();
        return haystack.includes(keyword);
      });
  }, [data, selectedSafetyPeriod, safetyResponseSearch]);

  const safetyHiddenResponses = useMemo(() => {
    return safetyPeriodResponses.filter((response: any) => response.is_hidden === true);
  }, [safetyPeriodResponses]);

  const safetyActionLogs = useMemo(() => {
    const rows = data?.actionLogs || [];
    return rows.slice(0, 80);
  }, [data]);

  const deletePeriodStats = useMemo(() => {
    const periodId = selectedDeletePeriod?.id;
    const matchesPeriod = (row: any) => !periodId || row.evaluation_period_id === periodId;
    return {
      responses: (data?.responses || []).filter(matchesPeriod).length,
      qrLinks: (data?.qrLinks || []).filter(matchesPeriod).length,
      assignments: (data?.assignments || []).filter(matchesPeriod).length,
      metrics: (data?.metrics || []).filter(matchesPeriod).length,
      reportExports: (data?.reportExports || []).filter(matchesPeriod).length,
      reportShareLinks: (data?.reportShareLinks || []).filter(matchesPeriod).length,
      slackLogs: (data?.slackMessageLogs || []).filter(matchesPeriod).length,
      importBatches: (data?.responseImportBatches || []).filter(matchesPeriod).length
    };
  }, [data, selectedDeletePeriod]);

  const selectedTeacherResponses = useMemo(() => {
    if (!selectedTeacher) return [];
    const periodId = selectedReportPeriod?.id || currentPeriod?.id;
    return visibleResponses.filter((r: any) => r.teacher_id === selectedTeacher.id && (!periodId || r.evaluation_period_id === periodId));
  }, [visibleResponses, selectedTeacher, selectedReportPeriod, currentPeriod]);

  const selectedTeacherScores = useMemo(() => {
    if (!selectedTeacher) return [];
    const rows = (data?.classScores || []).filter((s: any) => s.teacher_id === selectedTeacher.id);
    return rows.sort((a: any, b: any) => String(a.year_month || "").localeCompare(String(b.year_month || "")));
  }, [data, selectedTeacher]);

  const selectedTeacherMetric = useMemo(() => {
    if (!selectedTeacher) return null;
    const periodId = selectedReportPeriod?.id || currentPeriod?.id;
    return data?.metrics?.find((m: any) => m.teacher_id === selectedTeacher.id && (!periodId || m.evaluation_period_id === periodId));
  }, [data, selectedTeacher, selectedReportPeriod, currentPeriod]);

  const evaluationRanking = useMemo(() => {
    const periodId = selectedReportPeriod?.id || currentPeriod?.id;
    const rows = [...(data?.monthlyScores || [])].filter((row: any) => !periodId || row.evaluation_period_id === periodId);
    return rows.sort((a: any, b: any) => Number(b.avg_score_100 || 0) - Number(a.avg_score_100 || 0));
  }, [data, selectedReportPeriod, currentPeriod]);

  const currentPeriodClassScores = useMemo(() => {
    const periodId = selectedReportPeriod?.id || currentPeriod?.id;
    return [...(data?.classScores || [])].filter((row: any) => !periodId || row.evaluation_period_id === periodId);
  }, [data, selectedReportPeriod, currentPeriod]);

  const withdrawalRanking = useMemo(() => {
    const periodId = selectedReportPeriod?.id || currentPeriod?.id;
    const rows = (data?.teachers || []).map((teacher: any) => {
      const metric = data?.metrics?.find((m: any) => m.teacher_id === teacher.id && (!periodId || m.evaluation_period_id === periodId));
      return {
        teacher_id: teacher.id,
        teacher_name: teacher.name,
        withdrawal_rate_percent: metric?.withdrawal_rate_percent
      };
    }).filter((row: any) => row.withdrawal_rate_percent !== null && row.withdrawal_rate_percent !== undefined && row.withdrawal_rate_percent !== "");
    return rows.sort((a: any, b: any) => Number(a.withdrawal_rate_percent) - Number(b.withdrawal_rate_percent));
  }, [data, selectedReportPeriod, currentPeriod]);

  const reportTeachers = useMemo(() => {
    if (reportMode === "all") return activeTeachers;
    return selectedTeacher ? [selectedTeacher] : [];
  }, [reportMode, activeTeachers, selectedTeacher]);

  function reportTemplateLabel(template = reportTemplate) {
    if (template === "internal") return "원장 내부 확인용";
    if (template === "summary") return "간단 요약형";
    return "선생님 전달용";
  }

  function reportTargetLabel() {
    if (reportTemplate === "internal") return "전체 선생님 실명 기준 단일 내부 리포트";
    if (reportMode === "all") return `전체 선생님 ${activeTeachers.length}명`;
    return selectedTeacher?.name ? `${selectedTeacher.name} 선생님 1명` : "선택한 선생님 1명";
  }

  function includedReportPageLabels() {
    const labels = reportTemplate === "internal"
      ? [
          reportPages.coverPage ? "표지" : null,
          reportPages.scoreTable !== false ? "1p 전체 평가 요약" : null,
          reportPages.evaluationRanking !== false ? "2p 강의평가 순위" : null,
          reportPages.withdrawalRanking !== false ? "3p 퇴원율/재원 안정성" : null,
          reportPages.responseTable !== false ? "4p 응답 원문/코멘트 분석" : null
        ]
      : [
          reportPages.coverPage ? "표지" : null,
          reportPages.scoreTable !== false ? "1p 점수표" : null,
          reportPages.responseTable !== false ? "2p 항목별 평균표" : null,
          reportPages.evaluationRanking !== false ? "3p 강의평가 등수" : null,
          reportPages.withdrawalRanking !== false ? "4p 퇴원율 등수" : null
        ];
    return labels.filter(Boolean).join(", ") || "선택된 페이지 없음";
  }

  function reportDeliveryPolicy(template = reportTemplate) {
    const isInternal = template === "internal";
    return {
      audience: isInternal ? "director_internal" : "teacher_delivery",
      internalOnly: isInternal,
      templateLabel: reportTemplateLabel(template),
      targetLabel: isInternal ? "총괄관리자 전용" : "선택된 선생님",
      teacherSlackAllowed: !isInternal,
      superAdminSlackRequired: isInternal,
      slackPolicyLabel: isInternal ? "총괄관리자 Slack DM 필수 / 선생님·직원 발송 차단" : "선생님 Slack DM 발송 가능",
      generationGuard: "프론트 확인창 + API 발송 정책 이중 차단",
      deliveryPolicyVersion: APP_VERSION
    };
  }

  function reportPagesMetadata() {
    const policy = reportDeliveryPolicy();
    return {
      ...reportPages,
      reportTemplate,
      audience: policy.audience,
      internalOnly: policy.internalOnly,
      templateLabel: policy.templateLabel,
      targetLabel: reportTargetLabel(),
      slackPolicyLabel: policy.slackPolicyLabel,
      teacherSlackAllowed: policy.teacherSlackAllowed,
      superAdminSlackRequired: policy.superAdminSlackRequired,
      generationGuard: policy.generationGuard,
      deliveryPolicyVersion: policy.deliveryPolicyVersion,
      reportKind: reportTemplate === "internal" ? "director_internal_report" : "teacher_report",
      environmentDiagnosticsVersion: APP_VERSION,
      generatedByAdminId: currentAdmin?.id || currentAdmin?.adminId || null,
      generatedByAdminEmail: currentAdmin?.email || null,
      generatedByAdminName: currentAdmin?.name || null
    };
  }

  function confirmReportGeneration(kind: "pdf" | "web" | "snapshot", targetCount: number) {
    const period = selectedReportPeriod || currentPeriod;
    const policy = reportDeliveryPolicy();
    const kindLabel = kind === "pdf" ? "PDF 자동 생성/저장" : kind === "snapshot" ? "웹 저장본 보관" : "웹 리포트 생성";
    const deliveryLine = reportTemplate === "internal"
      ? "발송 대상: 총괄관리자 Slack DM만 발송 / 선생님·직원 발송 차단"
      : `발송 대상: ${reportMode === "all" ? `선택월 전체 선생님 ${targetCount}명` : reportTargetLabel()} / 선생님 Slack DM은 링크 관리에서 별도 실행`;
    const disabledLine = reportTemplate === "internal"
      ? "출력 대상/선생님 선택값: 적용하지 않음"
      : "출력 대상/선생님 선택값: 적용";

    return window.confirm([
      `[${kindLabel}]을 진행할까요?`,
      "",
      `평가월: ${period?.title || monthLabel(period?.year_month) || "-"}`,
      `리포트 템플릿: ${policy.templateLabel}`,
      `생성 건수: ${reportTemplate === "internal" ? "내부 리포트 1건" : `${targetCount}건`}`,
      `포함 페이지: ${includedReportPageLabels()}`,
      deliveryLine,
      disabledLine,
      "",
      reportTemplate === "internal"
        ? "확인: 원장 내부 확인용 리포트는 선생님/직원에게 발송되지 않습니다."
        : "확인: 생성 후 리포트 링크 관리에서 Slack 발송 대상과 결과를 다시 확인하세요."
    ].join("\n"));
  }


  function renderDiagnosticsPanel() {
    const checks = diagnosticsResult?.checks || [];
    const summary = diagnosticsResult?.summary || {
      ok: checks.filter((item: any) => item.status === "ok").length,
      warning: checks.filter((item: any) => item.status === "warn").length,
      failed: checks.filter((item: any) => item.status === "fail").length
    };

    return (
      <div className="diagnostics-panel no-print" style={{ marginTop: 18 }}>
        <div className="delivery-policy-head">
          <div>
            <h2 className="h2">저장/발송 환경 점검</h2>
            <p className="muted small">Supabase 연결, Storage PDF 저장 권한, 웹 링크 테이블, Slack Bot Token, 총괄관리자 DM 대상을 한 번에 확인합니다.</p>
          </div>
          <button
            className="btn secondary"
            onClick={() => checkDiagnostics(selectedReportPeriod?.id || currentPeriod?.id || "")}
            disabled={diagnosticsBusy}
          >
            {diagnosticsBusy ? "점검 중..." : "환경 점검 실행"}
          </button>
        </div>

        {diagnosticsResult ? (
          <>
            <div className="grid grid-4 diagnostics-summary" style={{ marginTop: 14 }}>
              <Stat label="정상" value={`${summary.ok || 0}건`} />
              <Stat label="주의" value={`${summary.warning || 0}건`} />
              <Stat label="실패" value={`${summary.failed || 0}건`} />
              <Stat label="내부용 DM" value={diagnosticsResult.readyForInternalReport ? "준비됨" : "확인 필요"} />
            </div>
            <div className={diagnosticsResult.ok ? "notice small" : "notice danger small"} style={{ marginTop: 12, whiteSpace: "pre-line" }}>
              <b>{diagnosticsResult.message || (diagnosticsResult.ok ? "환경 점검 통과" : "환경 점검 확인 필요")}</b>
              <br />원장 내부 확인용 리포트는 Storage 저장이 성공하더라도 Slack Bot Token과 총괄관리자 이메일이 맞지 않으면 DM 발송에 실패할 수 있습니다.
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>항목</th>
                    <th>상태</th>
                    <th>확인 내용</th>
                    <th>조치</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.length ? checks.map((item: any) => (
                    <tr key={item.key || item.label}>
                      <td><b>{item.label}</b></td>
                      <td><span className={diagnosticBadgeClass(item.status)}>{diagnosticStatusLabel(item.status)}</span></td>
                      <td>
                        <b>{item.message || "-"}</b>
                        {item.detail ? <div className="muted small" style={{ whiteSpace: "pre-line" }}>{item.detail}</div> : null}
                      </td>
                      <td className="muted small" style={{ whiteSpace: "pre-line" }}>{item.action || "-"}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="muted">아직 점검 결과가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="notice small" style={{ marginTop: 12 }}>
            리포트 생성 전 한 번 실행하면 저장 실패 원인이 Supabase 권한인지, Bucket 설정인지, Slack 설정인지 빠르게 구분할 수 있습니다.
          </div>
        )}
      </div>
    );
  }

  function toggleReportPage(key: string) {
    setReportPages((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function applyReportTemplate(template: "teacher" | "summary" | "internal") {
    setReportTemplate(template);
    if (template === "summary") {
      setReportPages({
        coverPage: true,
        scoreTable: true,
        responseTable: false,
        evaluationRanking: true,
        withdrawalRanking: true
      });
      setReportMonthCount(3);
    } else if (template === "internal") {
      setReportMode("all");
      setReportPages({
        coverPage: true,
        scoreTable: true,
        responseTable: true,
        evaluationRanking: true,
        withdrawalRanking: true
      });
      setReportMonthCount(4);
    } else {
      setReportPages({
        coverPage: true,
        scoreTable: true,
        responseTable: true,
        evaluationRanking: true,
        withdrawalRanking: true
      });
      setReportMonthCount(3);
    }
  }

  function getReportDataForTeacher(teacher: any) {
    const periodId = selectedReportPeriod?.id || currentPeriod?.id;
    return {
      classScores: (data?.classScores || []).filter((s: any) => s.teacher_id === teacher.id),
      responses: visibleResponses.filter((r: any) => r.teacher_id === teacher.id && (!periodId || r.evaluation_period_id === periodId)),
      metric: data?.metrics?.find((m: any) => m.teacher_id === teacher.id && (!periodId || m.evaluation_period_id === periodId))
    };
  }

  if (!sessionToken) {
    return (
      <main className="survey-wrap">
        <div className="card">
          <AcademyLogo />
          <div className="brand" style={{ marginTop: 14 }}>e강의평가 관리자</div>
          <div className="version-pill" style={{ marginTop: 10 }}>버전 {APP_VERSION}</div>
          <h1 className="h1" style={{ marginTop: 16 }}>관리자 로그인</h1>
          <p className="muted">
            v1.6부터 관리자 코드 대신 관리자 계정으로 로그인합니다. 처음 1회는 아래의 “초기 총괄관리자 만들기”를 사용하세요.
          </p>

          {message && <div className="notice" style={{ margin: "14px 0" }}>{message}</div>}

          <div className="form-row">
            <label className="label">이메일</label>
            <input className="input" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="admin@example.com" />
          </div>
          <div className="form-row">
            <label className="label">비밀번호</label>
            <input className="input" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="비밀번호" onKeyDown={(e) => { if (e.key === "Enter") loginAdmin(); }} />
          </div>
          <div className="form-row">
            <button className="btn full" onClick={loginAdmin}>로그인</button>
          </div>

          <div className="divider" />

          <button className="btn secondary full" onClick={() => setShowInitialSetup(!showInitialSetup)}>
            초기 총괄관리자 만들기
          </button>

          {showInitialSetup && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2 className="h2">처음 1회만 사용</h2>
              <p className="muted">
                Vercel 환경변수에 넣은 ADMIN_ACCESS_CODE를 입력해서 첫 총괄관리자 계정을 만듭니다.
                이미 총괄관리자 계정이 있으면 이 기능은 막힙니다.
              </p>
              <div className="grid grid-2">
                <Field label="초기 생성 코드">
                  <input className="input" type="password" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} placeholder="ADMIN_ACCESS_CODE" />
                </Field>
                <Field label="관리자 이름">
                  <input className="input" value={setupName} onChange={(e) => setSetupName(e.target.value)} />
                </Field>
                <Field label="이메일">
                  <input className="input" value={setupEmail} onChange={(e) => setSetupEmail(e.target.value)} placeholder="admin@example.com" />
                </Field>
                <Field label="비밀번호">
                  <input className="input" type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} placeholder="8자 이상" />
                </Field>
              </div>
              <button className="btn" style={{ marginTop: 12 }} onClick={createFirstSuperAdmin}>총괄관리자 만들기</button>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell admin-shell">
      <aside className="side-menu no-print">
        <div className="side-brand-block">
          <AcademyLogo compact />
          <div className="side-brand" style={{ marginTop: 12 }}>e강의평가</div>
          <div className="side-subtitle">관리자 콘솔</div>
          <div className="version-pill">버전 {APP_VERSION}</div>
        </div>

        {currentAdmin && (
          <div className="side-user">
            <b>{currentAdmin.name}</b>
            <span>{roleLabels[currentAdmin.role] || currentAdmin.role}</span>
          </div>
        )}

        <nav className="side-nav" aria-label="관리자 메뉴">
          {menuGroups.map((group) => {
            const groupItems = group.items.filter((key) => canUseTab(currentAdmin?.role, key));
            if (!groupItems.length) return null;
            const isGroupActive = groupItems.includes(tab);

            return (
              <div className={`side-group ${isGroupActive ? "active" : ""}`} key={group.title}>
                <button className="side-main" onClick={() => setTab(groupItems[0])}>
                  <span>{group.title}</span>
                  <small>{group.description}</small>
                </button>
                <div className="side-subnav">
                  {groupItems.map((key) => (
                    <button key={key} onClick={() => setTab(key)} className={`side-sub ${tab === key ? "active" : ""}`}>
                      {tabLabelMap[key]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="side-actions">
          <button className="btn secondary full" onClick={loadData}>새로고침</button>
          <button className="btn danger full" onClick={logoutAdmin}>로그아웃</button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="topbar no-print">
          <div className="topbar-inner">
            <div className="topbar-title-wrap">
              <div>
                <div className="muted">현재 메뉴</div>
                <div className="page-title">{tabLabelMap[tab]}</div>
                <div className="muted">e강의평가 · {APP_VERSION}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn secondary" onClick={() => setTab("home")}>홈</button>
              <button className="btn secondary" onClick={loadData}>새로고침</button>
            </div>
          </div>
        </header>

        <main className="container admin-content">
          {message && (
            <div className={`toast-notice no-print ${hasActiveStatusOperation ? "toast-busy" : ""}`} role="status" aria-live="polite">
              <span className="toast-message">
                {hasActiveStatusOperation && <span className="toast-spinner" aria-hidden="true" />}
                {message}
              </span>
              {!hasActiveStatusOperation && (
                <button
                  type="button"
                  className="toast-close"
                  aria-label="상태 알림 닫기"
                  onClick={() => setMessage("")}
                >
                  ×
                </button>
              )}
            </div>
          )}

        {tab === "home" && (
          <>
            <section className="card">
              <div className="section-header">
                <div>
                  <h1 className="h1">관리자 홈</h1>
                  <p className="muted">선택한 평가월의 응답 상태와 선생님별 현황을 확인합니다.</p>
                </div>
                <div style={{ minWidth: 240 }}>
                  <label className="label">상태 점검 평가월</label>
                  <select className="select" value={homePeriod?.id || ""} onChange={(e) => setSelectedHomePeriodId(e.target.value)}>
                    {(data?.periods || []).map((period: any) => (
                      <option key={period.id} value={period.id}>{period.title} · {statusLabels[period.status] || period.status}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="summary-grid compact-summary" style={{ marginTop: 18 }}>
                <Stat label="전체 응답 수" value={`${totalResponses}건`} />
                <Stat label="전체 응답률" value={`${responseRate}%`} />
                <Stat label="검토 필요 응답" value={`${flaggedResponses}건`} onClick={() => goToResponses("flagged")} />
                <Stat label="중복 의심 응답" value={`${duplicateResponses}건`} onClick={() => goToResponses("duplicate")} />
              </div>

              <div className="quick-actions" style={{ marginTop: 20 }}>
                <button className="btn" onClick={() => setTab("checklist")}>운영 체크리스트</button>
                <button className="btn secondary" onClick={() => setTab("periods")}>평가월 만들기</button>
                <button className="btn secondary" onClick={() => setTab("assignments")}>선생님-반 배정</button>
                <button className="btn secondary" onClick={() => setTab("bulk")}>일괄 등록</button>
                <button className="btn secondary" onClick={() => setTab("qr")}>QR 출력하기</button>
                <button className="btn secondary" onClick={() => setTab("legacyUpload")}>응답 업로드</button>
                <button className="btn secondary" onClick={() => setTab("report")}>결과지 생성</button>
              </div>
            </section>

            <section className="card">
              <h2 className="h2">선생님별 Summary</h2>
              <p className="muted">{homePeriod?.title || "평가월"} 기준입니다.</p>
              <div className="teacher-summary-grid" style={{ marginTop: 16 }}>
                {homeTeacherSummaries.map((row: any) => (
                  <div className="teacher-summary-card" key={row.teacher.id}>
                    <div className="teacher-summary-title">{row.teacher.name} 선생님</div>
                    <div className="teacher-summary-row"><span>설문 제출 인원</span><b>{row.responseCount}명</b></div>
                    <div className="teacher-summary-row"><span>설문 제출 반</span><b>{row.classCount}개</b></div>
                    <div className="teacher-summary-row"><span>강의평가 평점</span><b>{formatScore(row.avgScore)}점</b></div>
                    <div className="teacher-summary-row"><span>퇴원율</span><b>{row.withdrawalRate === null || row.withdrawalRate === undefined ? "-" : `${formatScore(Number(row.withdrawalRate))}%`}</b></div>
                  </div>
                ))}
              </div>
              {!homeTeacherSummaries.length && <Empty message="선생님 데이터가 없습니다." />}
            </section>

            <section className="card">
              <h2 className="h2">운영 순서</h2>
              <ol>
                <li><b>평가월 관리</b>에서 이번 달 평가를 만들고 상태를 진행중으로 둡니다.</li>
                <li><b>선생님 관리</b>와 <b>반 관리</b>에서 실제 명단을 입력합니다. 명단이 많으면 <b>일괄 등록</b>을 사용합니다.</li>
                <li>학기가 바뀌어 반 이름이 달라진 경우에는 <b>PDF/웹 리포트 생성</b> 화면에서 선택 선생님 전체 월 리포트에 적용되는 반 이름 매칭을 양방향/단방향 중 선택해 설정합니다.</li>
                <li><b>선생님-반 배정</b>에서 이번 달 선생님과 반을 연결하고, <b>QR 출력</b>에서 QR을 생성합니다.</li>
                <li>QR 설문이 어려운 레거시/비상 상황은 <b>응답 업로드</b>에서 엑셀 복사 붙여넣기로 등록합니다.</li>
              </ol>
            </section>
          </>
        )}

        {tab === "checklist" && (
          <section className="card">
            <div className="section-header">
              <div>
                <h1 className="h1">월별 운영 체크리스트</h1>
                <p className="muted">평가월별 운영 상태를 순서대로 확인하고, 마감 전 빠진 작업을 점검합니다.</p>
              </div>
              <div style={{ minWidth: 240 }}>
                <label className="label">점검 평가월</label>
                <select className="select" value={homePeriod?.id || ""} onChange={(e) => setSelectedHomePeriodId(e.target.value)}>
                  {(data?.periods || []).map((period: any) => (
                    <option key={period.id} value={period.id}>{period.title} · {statusLabels[period.status] || period.status}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="checklist-grid" style={{ marginTop: 18 }}>
              {operationChecklist.map((item: any, index: number) => (
                <button className={`checklist-item ${item.done ? "done" : "todo"}`} key={item.key} onClick={item.action} type="button">
                  <div className="checklist-step">{index + 1}</div>
                  <div className="checklist-body">
                    <div className="checklist-title">
                      <span>{item.title}</span>
                      {item.done ? <span className="badge ok">완료</span> : <span className="badge warn">확인 필요</span>}
                    </div>
                    <div className="checklist-value">{item.value}</div>
                    <div className="muted small">{item.detail}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="notice" style={{ marginTop: 18 }}>
              <b>추천 마감 순서</b>
              <br />응답 확인 → 검토 필요/중복 의심 처리 → 퇴원율 입력 → PDF/웹 리포트 생성 → Slack 발송 → 평가월 잠금 순서로 진행하세요.
              <br />퇴원율은 이 앱에서 자동 계산하지 않고, 별도 퇴원율 앱 또는 외부 산출값을 확정 입력하는 구조를 유지합니다.
            </div>
          </section>
        )}

        {tab === "periods" && (
          <section className="card">
            <h1 className="h1">평가월 관리</h1>
            <p className="muted">매달 평가 회차를 만들고, 진행중/마감 상태를 관리합니다. v2.6.3부터 각 평가월의 상태는 서로 독립적으로 저장됩니다.</p>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">새 평가월 만들기</h2>
              <p className="muted small">한 평가월을 진행중 또는 마감으로 바꿔도 다른 평가월 상태는 자동 변경되지 않습니다.</p>
              <div className="grid grid-2">
                <Field label="평가월">
                  <select
                    className="select"
                    value={newPeriod.year_month}
                    onChange={(e) => {
                      const yearMonth = e.target.value;
                      setNewPeriod({ ...newPeriod, year_month: yearMonth, title: monthTitleFromYearMonth(yearMonth) });
                    }}
                  >
                    {periodMonthOptions.map((month) => (
                      <option key={month.value} value={month.value}>{month.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="평가 이름">
                  <input className="input" value={newPeriod.title} onChange={(e) => setNewPeriod({ ...newPeriod, title: e.target.value })} placeholder="7월 강의평가" />
                </Field>
              </div>
              <div className="form-row">
                <label className="label">상태</label>
                <select className="select" value={newPeriod.status} onChange={(e) => setNewPeriod({ ...newPeriod, status: e.target.value })}>
                  <option value="draft">준비중</option>
                  <option value="open">진행중</option>
                  <option value="closed">마감</option>
                  <option value="archived">보관</option>
                </select>
              </div>
              <div className="form-row">
                <button className="btn" onClick={createPeriod}>평가월 만들기</button>
              </div>
            </div>

            <div className="table-wrap" style={{ marginTop: 18 }}>
              <table>
                <thead>
                  <tr>
                    <th>평가월</th>
                    <th>평가 이름</th>
                    <th>상태</th>
                    <th>잠금</th>
                    <th>저장</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.periods || []).map((period: any) => {
                    const draft = periodDrafts[period.id] || {};
                    return (
                      <tr key={period.id}>
                        <td><input className="input" disabled={period.is_locked} value={draft.year_month || ""} onChange={(e) => setPeriodDrafts((prev) => ({ ...prev, [period.id]: { ...draft, year_month: e.target.value } }))} /></td>
                        <td><input className="input" disabled={period.is_locked} value={draft.title || ""} onChange={(e) => setPeriodDrafts((prev) => ({ ...prev, [period.id]: { ...draft, title: e.target.value } }))} /></td>
                        <td>
                          <select className="select" disabled={period.is_locked} value={draft.status || "draft"} onChange={(e) => setPeriodDrafts((prev) => ({ ...prev, [period.id]: { ...draft, status: e.target.value } }))}>
                            <option value="draft">준비중</option>
                            <option value="open">진행중</option>
                            <option value="closed">마감</option>
                            <option value="archived">보관</option>
                          </select>
                        </td>
                        <td>
                          {period.is_locked ? <span className="badge danger">잠금</span> : <span className="badge ok">수정 가능</span>}
                          {period.locked_reason && <div className="muted" style={{ marginTop: 6 }}>{period.locked_reason}</div>}
                        </td>
                        <td>
                          {period.is_locked ? (
                            <button className="btn secondary" onClick={() => { setSelectedSafetyPeriodId(period.id); setTab("safety"); }}>운영 안전에서 해제</button>
                          ) : (
                            <button className="btn secondary" onClick={() => updatePeriod(period.id)}>저장</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "teachers" && (
          <section className="card">
            <h1 className="h1">선생님 관리</h1>
            <p className="muted">선생님을 추가하거나 이름, 과목, 사용 여부를 수정합니다.</p>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">선생님 추가</h2>
              <div className="grid grid-4">
                <Field label="선생님 이름">
                  <input className="input" value={newTeacher.name} onChange={(e) => setNewTeacher({ ...newTeacher, name: e.target.value })} placeholder="이서영" />
                </Field>
                <Field label="과목">
                  <input className="input" value={newTeacher.subject} onChange={(e) => setNewTeacher({ ...newTeacher, subject: e.target.value })} placeholder="영어" />
                </Field>
                <Field label="선생님 식별코드(선택)">
                  <input className="input" value={newTeacher.teacher_code} onChange={(e) => setNewTeacher({ ...newTeacher, teacher_code: e.target.value })} placeholder="비워도 됩니다. 예: T001" />
                  <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>동명이인 구분이나 추후 엑셀 연동용입니다. 지금은 입력하지 않아도 됩니다.</p>
                </Field>
                <Field label="Slack 이메일(선택)">
                  <input className="input" value={newTeacher.slack_email} onChange={(e) => setNewTeacher({ ...newTeacher, slack_email: e.target.value })} placeholder="teacher@example.com" />
                  <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>Slack DM 발송을 쓰려면 선생님의 Slack 계정 이메일을 입력하세요.</p>
                </Field>
                <Field label="메모">
                  <input className="input" value={newTeacher.memo} onChange={(e) => setNewTeacher({ ...newTeacher, memo: e.target.value })} placeholder="선택 입력" />
                </Field>
              </div>
              <div className="form-row">
                <button className="btn" onClick={createTeacher}>선생님 추가</button>
              </div>
            </div>

            <div className="table-wrap" style={{ marginTop: 18 }}>
              <table>
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>과목</th>
                    <th>식별코드(선택)</th>
                    <th>Slack 이메일</th>
                    <th>Slack 연결</th>
                    <th>메모</th>
                    <th>상태</th>
                    <th>기능</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.teachers || []).map((teacher: any) => {
                    const draft = teacherDrafts[teacher.id] || {};
                    return (
                      <tr key={teacher.id}>
                        <td><input className="input" value={draft.name || ""} onChange={(e) => setTeacherDrafts((prev) => ({ ...prev, [teacher.id]: { ...draft, name: e.target.value } }))} /></td>
                        <td><input className="input" value={draft.subject || ""} onChange={(e) => setTeacherDrafts((prev) => ({ ...prev, [teacher.id]: { ...draft, subject: e.target.value } }))} /></td>
                        <td><input className="input" value={draft.teacher_code || ""} onChange={(e) => setTeacherDrafts((prev) => ({ ...prev, [teacher.id]: { ...draft, teacher_code: e.target.value } }))} placeholder="선택" /></td>
                        <td><input className="input" value={draft.slack_email || ""} onChange={(e) => setTeacherDrafts((prev) => ({ ...prev, [teacher.id]: { ...draft, slack_email: e.target.value } }))} placeholder="teacher@example.com" /></td>
                        <td>
                          {draft.slack_user_id ? <span className="badge ok">연결됨</span> : <span className="badge">미연결</span>}
                          {draft.slack_user_id ? <div className="muted small">{draft.slack_user_id}</div> : null}
                        </td>
                        <td><input className="input" value={draft.memo || ""} onChange={(e) => setTeacherDrafts((prev) => ({ ...prev, [teacher.id]: { ...draft, memo: e.target.value } }))} /></td>
                        <td>{draft.is_active ? <span className="badge ok">사용중</span> : <span className="badge">비활성</span>}</td>
                        <td>
                          <div className="row-actions">
                            <button className="btn soft sm" onClick={() => updateTeacher(teacher.id)}>저장</button>
                            <button className="btn secondary sm" onClick={() => lookupSlackUser(teacher.id)} disabled={slackBusy === `lookup-${teacher.id}`}>
                              {slackBusy === `lookup-${teacher.id}` ? "연결 확인 중..." : "연결 확인"}
                            </button>
                            <button className="btn secondary sm" onClick={() => sendSlackTest(teacher.id)} disabled={slackBusy === `test-${teacher.id}`}>
                              {slackBusy === `test-${teacher.id}` ? "DM 발송 중..." : "테스트 DM"}
                            </button>
                            <button className="btn danger sm" onClick={() => updateTeacher(teacher.id, { is_active: !draft.is_active })}>
                              {draft.is_active ? "비활성화" : "다시 사용"}
                            </button>
                            {currentAdmin?.role === "super_admin" && (
                              <button className="btn danger sm" onClick={() => deleteTeacherHard(teacher)}>
                                삭제
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "classes" && (
          <section className="card">
            <h1 className="h1">반 관리</h1>
            <p className="muted">결과지 1페이지와 2페이지는 반 단위로 나오므로, 실제 반 이름을 정확히 입력합니다.</p>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">반 추가</h2>
              <div className="grid grid-4">
                <Field label="반 이름">
                  <input className="input" value={newClassItem.name} onChange={(e) => setNewClassItem({ ...newClassItem, name: e.target.value })} placeholder="M4 화목 > M5 화목" />
                </Field>
                <Field label="학년/구분">
                  <input className="input" value={newClassItem.grade} onChange={(e) => setNewClassItem({ ...newClassItem, grade: e.target.value })} placeholder="중2" />
                </Field>
                <Field label="요일">
                  <input className="input" value={newClassItem.day_pattern} onChange={(e) => setNewClassItem({ ...newClassItem, day_pattern: e.target.value })} placeholder="화목" />
                </Field>
                <Field label="캠퍼스">
                  <input className="input" value={newClassItem.campus} onChange={(e) => setNewClassItem({ ...newClassItem, campus: e.target.value })} placeholder="선택 입력" />
                </Field>
              </div>
              <div className="form-row">
                <button className="btn" onClick={createClassItem}>반 추가</button>
              </div>
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">엑셀 벌크 업로드</h2>
              <p className="muted">
                반 이름, 학년/구분, 요일, 캠퍼스, 메모, 상태 순서의 엑셀 파일을 업로드합니다. 같은 반 이름이 이미 있으면 새로 만들지 않고 기존 반 정보를 갱신합니다.
              </p>
              <div className="notice" style={{ marginTop: 12 }}>
                <b>업로드 형식</b><br />
                1열 반 이름은 필수입니다. 2열 학년/구분, 3열 요일, 4열 캠퍼스, 5열 메모, 6열 상태는 선택입니다.<br />
                상태 칸에 <b>비활성</b> 또는 <b>inactive</b>를 쓰면 비활성 반으로 저장되고, 비워두면 사용중으로 저장됩니다.
              </div>
              <div className="form-row" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <input
                  id="class-excel-upload-input"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    uploadClassExcelFile(file);
                    e.currentTarget.value = "";
                  }}
                />
                <button className="btn secondary" type="button" onClick={downloadClassBulkTemplate}>업로드 양식 다운로드</button>
                <button
                  className="btn"
                  type="button"
                  disabled={classExcelUploadBusy}
                  onClick={() => document.getElementById("class-excel-upload-input")?.click()}
                >
                  {classExcelUploadBusy ? "업로드 중..." : "엑셀 파일 업로드"}
                </button>
              </div>
              {classExcelUploadResult && (
                <div className="notice" style={{ marginTop: 12 }}>
                  <b>{classExcelUploadResult.message}</b>
                  {!!classExcelUploadResult.skipped?.length && (
                    <ul>
                      {classExcelUploadResult.skipped.map((item: string) => <li key={item}>{item}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="table-wrap" style={{ marginTop: 18 }}>
              <table>
                <thead>
                  <tr>
                    <th>반 이름</th>
                    <th>학년/구분</th>
                    <th>요일</th>
                    <th>캠퍼스</th>
                    <th>상태</th>
                    <th>기능</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.classes || []).map((classItem: any) => {
                    const draft = classDrafts[classItem.id] || {};
                    return (
                      <tr key={classItem.id}>
                        <td><input className="input" value={draft.name || ""} onChange={(e) => setClassDrafts((prev) => ({ ...prev, [classItem.id]: { ...draft, name: e.target.value } }))} /></td>
                        <td><input className="input" value={draft.grade || ""} onChange={(e) => setClassDrafts((prev) => ({ ...prev, [classItem.id]: { ...draft, grade: e.target.value } }))} /></td>
                        <td><input className="input" value={draft.day_pattern || ""} onChange={(e) => setClassDrafts((prev) => ({ ...prev, [classItem.id]: { ...draft, day_pattern: e.target.value } }))} /></td>
                        <td><input className="input" value={draft.campus || ""} onChange={(e) => setClassDrafts((prev) => ({ ...prev, [classItem.id]: { ...draft, campus: e.target.value } }))} /></td>
                        <td>{draft.is_active ? <span className="badge ok">사용중</span> : <span className="badge">비활성</span>}</td>
                        <td>
                          <div className="row-actions">
                            <button className="btn soft" onClick={() => updateClassItem(classItem.id)}>저장</button>
                            <button className="btn danger" onClick={() => updateClassItem(classItem.id, { is_active: !draft.is_active })}>
                              {draft.is_active ? "비활성화" : "다시 사용"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "classMappings" && (
          <section className="card">
            <h1 className="h1">반 이름 매칭</h1>
            <p className="muted">
              학기가 지나 반 이름이 바뀐 경우, 이전반과 바뀐반을 연결합니다.
              결과지 1페이지 최근 3개월 그래프에서 같은 반의 흐름으로 묶어 보여줍니다.
            </p>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">새 매칭 추가</h2>
              <div className="mapping-flow">
                <Field label="이전반">
                  <select className="select" value={classMappingForm.from_class_id} onChange={(e) => setClassMappingForm({ ...classMappingForm, from_class_id: e.target.value })}>
                    <option value="">이전반 선택</option>
                    {(data?.classes || []).map((classItem: any) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
                  </select>
                </Field>
                <div className="mapping-arrow">→</div>
                <Field label="바뀐반 / 현재반">
                  <select className="select" value={classMappingForm.to_class_id} onChange={(e) => setClassMappingForm({ ...classMappingForm, to_class_id: e.target.value })}>
                    <option value="">바뀐반 선택</option>
                    {(data?.classes || []).map((classItem: any) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="form-row">
                <label className="label">메모</label>
                <input className="input" value={classMappingForm.memo} onChange={(e) => setClassMappingForm({ ...classMappingForm, memo: e.target.value })} placeholder="예: 2026년 2학기 반 이름 변경" />
              </div>
              <button className="btn" onClick={createClassMapping}>매칭 저장</button>
            </div>

            <div className="notice" style={{ marginTop: 18 }}>
              예: <b>M4 화목</b>이 다음 달 <b>M5 화목</b>으로 바뀌었다면 “M4 화목 → M5 화목”으로 연결합니다.
              이후 결과지 그래프는 M4 화목의 과거 점수와 M5 화목의 현재 점수를 한 흐름으로 계산합니다.
            </div>

            <div className="table-wrap" style={{ marginTop: 18 }}>
              <table>
                <thead>
                  <tr>
                    <th>이전반</th>
                    <th>바뀐반/현재반</th>
                    <th>메모</th>
                    <th>상태</th>
                    <th>기능</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.classMappings || []).map((mapping: any) => (
                    <tr key={mapping.id}>
                      <td>{mapping.from_class?.name || "-"}</td>
                      <td>{mapping.to_class?.name || "-"}</td>
                      <td>{mapping.memo || "-"}</td>
                      <td>{mapping.is_active ? <span className="badge ok">사용중</span> : <span className="badge">비활성</span>}</td>
                      <td>
                        <button className="btn secondary" onClick={() => toggleClassMapping(mapping)}>
                          {mapping.is_active ? "비활성화" : "다시 사용"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!(data?.classMappings || []).length && <Empty message="아직 등록된 반 이름 매칭이 없습니다." />}
          </section>
        )}

        {tab === "assignments" && (
          <section className="card">
            <h1 className="h1">선생님-반 배정</h1>
            <p className="muted">
              평가월과 선생님을 선택하면, 해당 평가월에 저장된 배정이 있으면 그 값을 먼저 보여주고,
              저장된 값이 없으면 가장 최근 이전 평가월의 배정을 기본값으로 불러옵니다.
            </p>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">선생님별 반 복수 배정</h2>
              <div className="grid grid-3">
                <Field label="평가월">
                  <select
                    className="select"
                    value={assignmentForm.evaluation_period_id || selectedAssignmentPeriod?.id || ""}
                    onChange={(e) => {
                      setSelectedAssignmentPeriodId(e.target.value);
                      setAssignmentForm({ ...assignmentForm, evaluation_period_id: e.target.value });
                    }}
                  >
                    {(data?.periods || []).map((period: any) => <option key={period.id} value={period.id}>{period.title}</option>)}
                  </select>
                </Field>
                <Field label="선생님">
                  <select
                    className="select"
                    value={assignmentForm.teacher_id || activeTeachers[0]?.id || ""}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, teacher_id: e.target.value })}
                  >
                    {activeTeachers.map((teacher: any) => <option key={teacher.id} value={teacher.id}>{teacher.name} 선생님</option>)}
                  </select>
                </Field>
                <div>
                  <label className="label">현재 선택</label>
                  <div className="notice small">
                    <b>{selectedAssignmentClassIds.length}개 반 선택됨</b>
                    <br />
                    {assignmentDefaults.currentClassIds.length
                      ? "이 평가월에 이미 저장된 배정을 불러왔습니다."
                      : assignmentDefaults.sourcePeriod
                        ? `${assignmentDefaults.sourcePeriod.title} 배정을 기본값으로 불러왔습니다.`
                        : "이전 평가월 배정이 없어 직접 선택해야 합니다."}
                  </div>
                </div>
              </div>

              <div className="notice" style={{ marginTop: 14 }}>
                <b>운영 편의 기능</b>
                <br />전월 배정을 기본값으로 가져오므로 매월 같은 배정을 다시 입력할 필요가 없습니다.
                이번 달에 일부 반을 변경해 저장하면, 다음 평가월에서는 그 변경된 배정이 기본값으로 이어집니다.
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                <button className="btn secondary" type="button" onClick={loadPreviousAssignmentDefaults}>최근 이전 배정 다시 불러오기</button>
                <button className="btn secondary" type="button" onClick={() => setSelectedAssignmentClassIds(activeClasses.map((classItem: any) => classItem.id))}>전체 반 선택</button>
                <button className="btn secondary" type="button" onClick={() => setSelectedAssignmentClassIds([])}>전체 해제</button>
                <button className="btn" type="button" onClick={createAssignment}>선택한 반 배정 저장</button>
                <button className="btn soft" type="button" onClick={() => generateQrLinks(assignmentForm.evaluation_period_id || selectedAssignmentPeriod?.id)} disabled={qrBusy}>{qrBusy ? "QR 생성 중..." : "이 평가월 QR 생성"}</button>
              </div>

              <div className="grid grid-3" style={{ marginTop: 16 }}>
                {activeClasses.map((classItem: any) => {
                  const checked = selectedAssignmentClassIds.includes(classItem.id);
                  return (
                    <label
                      key={classItem.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "12px 14px",
                        border: checked ? "2px solid #111827" : "1px solid #e5e7eb",
                        borderRadius: 16,
                        background: checked ? "#f8fafc" : "#fff",
                        cursor: "pointer"
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAssignmentClass(classItem.id)}
                        style={{ marginTop: 4 }}
                      />
                      <span>
                        <b>{classItem.name}</b>
                        <br />
                        <span className="muted small">
                          {[classItem.grade, classItem.day_pattern, classItem.campus].filter(Boolean).join(" · ") || "추가 정보 없음"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="table-wrap" style={{ marginTop: 18 }}>
              <table>
                <thead>
                  <tr>
                    <th>평가월</th>
                    <th>선생님</th>
                    <th>반</th>
                    <th>상태</th>
                    <th>기능</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedAssignments.map((assignment: any) => (
                    <tr key={assignment.id}>
                      <td>{assignment.evaluation_periods?.title}</td>
                      <td>{assignment.teachers?.name} 선생님</td>
                      <td>{assignment.classes?.name}</td>
                      <td>{assignment.is_active ? <span className="badge ok">사용중</span> : <span className="badge">비활성</span>}</td>
                      <td><button className="btn secondary" onClick={() => toggleAssignment(assignment)}>{assignment.is_active ? "비활성화" : "다시 사용"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!displayedAssignments.length && <Empty message="아직 배정이 없습니다. 위에서 선생님과 반을 복수 선택해 저장해주세요." />}
          </section>
        )}


        {tab === "bulk" && (
          <section className="card">
            <h1 className="h1">일괄 등록</h1>
            <p className="muted">
              선생님, 반, 선생님-반 배정을 한 명씩 입력하지 않고 엑셀이나 구글시트에서 복사해 붙여넣는 화면입니다.
              파일 업로드가 아니라 표 내용을 그대로 복사해서 붙여넣는 방식이라 초보자도 안전하게 사용할 수 있습니다.
            </p>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">1. 등록할 종류 선택</h2>
              <div className="grid grid-3">
                <Field label="가져오기 종류">
                  <select
                    className="select"
                    value={bulkType}
                    onChange={(e) => {
                      setBulkType(e.target.value as any);
                      setBulkResult(null);
                      setBulkText("");
                    }}
                  >
                    <option value="teachers">선생님 명단</option>
                    <option value="classes">반 명단</option>
                    <option value="assignments">선생님-반 배정</option>
                  </select>
                </Field>

                {bulkType === "assignments" && (
                  <Field label="배정할 평가월">
                    <select className="select" value={bulkImportPeriodId || selectedAssignmentPeriod?.id || currentPeriod?.id || ""} onChange={(e) => setBulkImportPeriodId(e.target.value)}>
                      {(data?.periods || []).map((period: any) => <option key={period.id} value={period.id}>{period.title}</option>)}
                    </select>
                  </Field>
                )}
              </div>
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">2. 엑셀/구글시트에서 복사해 붙여넣기</h2>

              {bulkType === "teachers" && (
                <div className="notice" style={{ marginBottom: 12 }}>
                  <b>선생님 명단 형식</b><br />
                  첫 번째 칸: 선생님 이름 / 두 번째 칸: 과목 / 세 번째 칸: 식별코드(선택) / 네 번째 칸: 메모(선택)<br />
                  예시:<br />
                  이서영&nbsp;&nbsp;영어&nbsp;&nbsp;T001&nbsp;&nbsp;중등부<br />
                  배승희&nbsp;&nbsp;영어&nbsp;&nbsp;T002&nbsp;&nbsp;고등부
                </div>
              )}

              {bulkType === "classes" && (
                <div className="notice" style={{ marginBottom: 12 }}>
                  <b>반 명단 형식</b><br />
                  첫 번째 칸: 반 이름 / 두 번째 칸: 학년·구분 / 세 번째 칸: 요일 / 네 번째 칸: 캠퍼스 / 다섯 번째 칸: 메모<br />
                  예시:<br />
                  M4 화목 &gt; M5 화목&nbsp;&nbsp;중2&nbsp;&nbsp;화목&nbsp;&nbsp;목동&nbsp;&nbsp;정규반<br />
                  윤슬중2 화목&nbsp;&nbsp;중2&nbsp;&nbsp;화목&nbsp;&nbsp;목동&nbsp;&nbsp;내신반
                </div>
              )}

              {bulkType === "assignments" && (
                <div className="notice" style={{ marginBottom: 12 }}>
                  <b>선생님-반 배정 형식</b><br />
                  첫 번째 칸: 선생님 이름 또는 식별코드 / 두 번째 칸: 반 이름<br />
                  이 화면은 이미 등록된 선생님과 반을 연결합니다. 선생님과 반을 먼저 등록한 뒤 사용하세요.<br />
                  예시:<br />
                  이서영&nbsp;&nbsp;M4 화목 &gt; M5 화목<br />
                  배승희&nbsp;&nbsp;윤슬중2 화목
                </div>
              )}

              <textarea
                className="textarea"
                style={{ minHeight: 220 }}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={
                  bulkType === "teachers"
                    ? "선생님 이름\t과목\t식별코드(선택)\t메모\n이서영\t영어\tT001\t중등부\n배승희\t영어\tT002\t고등부"
                    : bulkType === "classes"
                      ? "반 이름\t학년/구분\t요일\t캠퍼스\t메모\nM4 화목 > M5 화목\t중2\t화목\t목동\t정규반\n윤슬중2 화목\t중2\t화목\t목동\t내신반"
                      : "선생님 이름 또는 식별코드\t반 이름\n이서영\tM4 화목 > M5 화목\n배승희\t윤슬중2 화목"
                }
              />

              <div className="form-row" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn" onClick={runBulkImport}>붙여넣은 내용 등록하기</button>
                {bulkType === "assignments" && (
                  <button className="btn secondary" onClick={() => generateQrLinks(bulkImportPeriodId || selectedAssignmentPeriod?.id || currentPeriod?.id)} disabled={qrBusy}>
                    {qrBusy ? "QR 생성 중..." : "배정 후 QR 생성"}
                  </button>
                )}
              </div>
            </div>

            {bulkResult && (
              <div className="card" style={{ marginTop: 18 }}>
                <h2 className="h2">처리 결과</h2>
                <p>{bulkResult.message}</p>
                {!!bulkResult.skipped?.length && (
                  <div className="notice" style={{ marginTop: 12 }}>
                    <b>확인 필요</b>
                    <ul>
                      {bulkResult.skipped.map((item: string) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="notice" style={{ marginTop: 18 }}>
              <b>추천 순서</b><br />
              1. 선생님 명단 등록 → 2. 반 명단 등록 → 3. 선생님-반 배정 등록 → 4. QR 생성<br />
              같은 반 이름은 기존 반을 갱신합니다. 같은 선생님 이름이 여러 명이면 식별코드를 사용해주세요.
            </div>
          </section>
        )}

        {tab === "admins" && currentAdmin?.role === "super_admin" && (
          <section className="card">
            <h1 className="h1">관리자 계정</h1>
            <p className="muted">
              총괄관리자만 접근할 수 있습니다. 일반관리자는 QR 출력, 제출 현황, 결과 분석, 결과지 출력 중심으로 제한됩니다.
            </p>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">관리자 추가</h2>
              <div className="grid grid-3">
                <Field label="이메일">
                  <input className="input" value={newAdmin.email} onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })} placeholder="admin@example.com" />
                </Field>
                <Field label="이름">
                  <input className="input" value={newAdmin.name} onChange={(e) => setNewAdmin({ ...newAdmin, name: e.target.value })} placeholder="홍길동" />
                </Field>
                <Field label="권한">
                  <select className="select" value={newAdmin.role} onChange={(e) => setNewAdmin({ ...newAdmin, role: e.target.value })}>
                    <option value="general_admin">일반관리자</option>
                    <option value="super_admin">총괄관리자</option>
                  </select>
                </Field>
                <Field label="초기 비밀번호">
                  <input className="input" type="password" value={newAdmin.password} onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })} placeholder="8자 이상" />
                </Field>
                <Field label="메모">
                  <input className="input" value={newAdmin.memo} onChange={(e) => setNewAdmin({ ...newAdmin, memo: e.target.value })} placeholder="담당 업무 등" />
                </Field>
                <Field label="상태">
                  <select className="select" value={newAdmin.is_active ? "active" : "inactive"} onChange={(e) => setNewAdmin({ ...newAdmin, is_active: e.target.value === "active" })}>
                    <option value="active">사용중</option>
                    <option value="inactive">비활성</option>
                  </select>
                </Field>
              </div>
              <button className="btn" style={{ marginTop: 12 }} onClick={createAdminAccount}>관리자 계정 저장</button>
            </div>

            <div className="table-wrap" style={{ marginTop: 18 }}>
              <table>
                <thead>
                  <tr>
                    <th>이메일</th>
                    <th>이름</th>
                    <th>권한</th>
                    <th>상태</th>
                    <th>마지막 로그인</th>
                    <th>비밀번호 재설정</th>
                    <th>기능</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.adminProfiles || []).map((admin: any) => {
                    const draft = adminDrafts[admin.id] || {};
                    return (
                      <tr key={admin.id}>
                        <td>{admin.email}</td>
                        <td>
                          <input className="input" value={draft.name || ""} onChange={(e) => setAdminDrafts({ ...adminDrafts, [admin.id]: { ...draft, name: e.target.value } })} />
                        </td>
                        <td>
                          <select className="select" value={draft.role || admin.role} onChange={(e) => setAdminDrafts({ ...adminDrafts, [admin.id]: { ...draft, role: e.target.value } })}>
                            <option value="general_admin">일반관리자</option>
                            <option value="super_admin">총괄관리자</option>
                          </select>
                        </td>
                        <td>
                          <select className="select" value={(draft.is_active ?? admin.is_active) ? "active" : "inactive"} onChange={(e) => setAdminDrafts({ ...adminDrafts, [admin.id]: { ...draft, is_active: e.target.value === "active" } })}>
                            <option value="active">사용중</option>
                            <option value="inactive">비활성</option>
                          </select>
                        </td>
                        <td>{formatDateTime(admin.last_login_at)}</td>
                        <td>
                          <input className="input" type="password" value={draft.password || ""} onChange={(e) => setAdminDrafts({ ...adminDrafts, [admin.id]: { ...draft, password: e.target.value } })} placeholder="변경할 때만 입력" />
                        </td>
                        <td>
                          <button className="btn secondary" onClick={() => updateAdminAccount(admin.id)}>저장</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">최근 로그인 기록</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>시간</th>
                      <th>이메일</th>
                      <th>결과</th>
                      <th>사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.adminLoginLogs || []).map((log: any) => (
                      <tr key={log.id}>
                        <td>{formatDateTime(log.created_at)}</td>
                        <td>{log.email}</td>
                        <td><span className={log.success ? "badge ok" : "badge danger"}>{log.success ? "성공" : "실패"}</span></td>
                        <td>{log.failure_reason || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}


        {tab === "safety" && (
          <section className="card">
            <h1 className="h1">운영 안전</h1>
            <p className="muted">
              운영 중 실수로 데이터가 바뀌는 일을 줄이기 위한 화면입니다. 응답은 삭제하지 않고 숨김 처리하며,
              마감된 평가월은 잠금 처리해서 추가 수정이 일어나지 않도록 관리합니다.
            </p>

            <div className="grid grid-4" style={{ marginTop: 18 }}>
              <Stat label="선택 평가월 응답" value={`${safetyPeriodResponses.length}건`} />
              <Stat label="숨김 응답" value={`${safetyHiddenResponses.length}건`} />
              <Stat label="잠금 평가월" value={`${(data?.periods || []).filter((p: any) => p.is_locked).length}개`} />
              <Stat label="최근 작업 로그" value={`${safetyActionLogs.length}건`} />
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">평가월 잠금</h2>
              <p className="muted">
                결과지 생성이 끝난 평가월은 잠금 처리하세요. 잠금된 평가월은 배정, QR 생성, 응답 업로드, 학생 제출, 퇴원율 입력을 막습니다.
              </p>
              <div className="grid grid-3" style={{ marginTop: 14 }}>
                <Field label="점검할 평가월">
                  <select className="select" value={selectedSafetyPeriod?.id || ""} onChange={(e) => setSelectedSafetyPeriodId(e.target.value)}>
                    {(data?.periods || []).map((period: any) => (
                      <option key={period.id} value={period.id}>
                        {period.title} · {statusLabels[period.status] || period.status}{period.is_locked ? " · 잠금" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <div>
                  <label className="label">현재 상태</label>
                  {selectedSafetyPeriod?.is_locked ? (
                    <div className="notice small">
                      <b>잠금됨</b>
                      <br />{formatDateTime(selectedSafetyPeriod.locked_at)}
                      <br />{selectedSafetyPeriod.locked_reason || "사유 없음"}
                    </div>
                  ) : (
                    <div className="notice small">현재 수정 가능 상태입니다.</div>
                  )}
                </div>
                <div>
                  <label className="label">기능</label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {selectedSafetyPeriod?.is_locked ? (
                      <button className="btn secondary" onClick={() => unlockSafetyPeriod(selectedSafetyPeriod)}>잠금 해제</button>
                    ) : (
                      <button className="btn danger" onClick={() => lockSafetyPeriod(selectedSafetyPeriod)}>평가월 잠금</button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">응답 숨김/복구</h2>
              <p className="muted">
                잘못 입력된 응답이나 운영상 제외해야 하는 응답은 삭제하지 말고 숨김 처리하세요. 숨김 응답은 결과 분석과 결과지에서 제외됩니다.
              </p>
              <div className="form-row">
                <Field label="검색">
                  <input
                    className="input"
                    value={safetyResponseSearch}
                    onChange={(e) => setSafetyResponseSearch(e.target.value)}
                    placeholder="학생 이름, 선생님, 반, 숨김 사유로 검색"
                  />
                </Field>
              </div>
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>상태</th>
                      <th>제출자</th>
                      <th>선생님</th>
                      <th>반</th>
                      <th>제출 시간</th>
                      <th>숨김 사유</th>
                      <th>기능</th>
                    </tr>
                  </thead>
                  <tbody>
                    {safetyPeriodResponses.slice(0, 200).map((response: any) => (
                      <tr key={response.id}>
                        <td>{response.is_hidden ? <span className="badge danger">숨김</span> : <span className="badge ok">반영중</span>}</td>
                        <td><b>{response.student_name}</b></td>
                        <td>{response.teachers?.name || "-"} 선생님</td>
                        <td>{response.classes?.name || "반 미지정"}</td>
                        <td>{formatDateTime(response.submitted_at)}</td>
                        <td>{response.hidden_reason || "-"}</td>
                        <td>
                          {response.is_hidden ? (
                            <button className="btn secondary" onClick={() => restoreResponse(response)}>복구</button>
                          ) : (
                            <button className="btn danger" onClick={() => hideResponse(response)}>숨김</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!safetyPeriodResponses.length && <Empty message="선택 평가월의 응답이 없습니다." />}
              {safetyPeriodResponses.length > 200 && <p className="muted">처음 200건까지만 표시합니다. 검색어를 사용해 범위를 좁혀주세요.</p>}
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">최근 작업 로그</h2>
              <p className="muted">평가월 잠금, 응답 숨김/복구, 업로드 롤백 등 주요 작업 이력을 확인합니다.</p>
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>시각</th>
                      <th>작업자</th>
                      <th>작업</th>
                      <th>대상</th>
                      <th>상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {safetyActionLogs.map((log: any) => (
                      <tr key={log.id}>
                        <td>{formatDateTime(log.created_at)}</td>
                        <td>{log.admin_profiles?.name || log.actor_admin_id || "-"}</td>
                        <td><b>{log.action}</b></td>
                        <td>{log.entity_type || "-"} {log.entity_id ? String(log.entity_id).slice(0, 8) : ""}</td>
                        <td><code>{JSON.stringify(log.details || {})}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!safetyActionLogs.length && <Empty message="아직 표시할 작업 로그가 없습니다." />}
            </div>
          </section>
        )}

        {tab === "dataDelete" && (
          <section className="card">
            <h1 className="h1">데이터 삭제</h1>
            <p className="muted">
              총괄관리자 전용 화면입니다. 삭제는 즉시 DB와 저장본에서 제거되며 되돌릴 수 없습니다.
              Vercel 프로젝트 삭제처럼 지정 문구를 정확히 입력해야 실행됩니다.
            </p>

            <div className="notice danger-notice" style={{ marginTop: 18 }}>
              <b>주의</b>
              <br />운영 중 잘못 입력된 응답은 우선 <b>운영 안전 &gt; 응답 숨김</b>을 권장합니다.
              이 화면은 레거시 테스트 데이터, 잘못 만든 평가월 데이터, 폐기 대상 결과지/이력을 영구 삭제할 때만 사용하세요.
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">선택 평가월 데이터 영구 삭제</h2>
              <p className="muted">
                선택한 평가월의 설문 응답/답변, QR, 선생님-반 배정, 퇴원율, 결과지 저장본, 웹 리포트 링크, Slack 발송 이력, 응답 업로드 이력을 삭제합니다.
                평가월 자체는 남겨두므로 같은 평가월을 다시 운영할 수 있습니다.
              </p>

              <div className="grid grid-3" style={{ marginTop: 14 }}>
                <Field label="삭제 대상 평가월">
                  <select className="select" value={selectedDeletePeriod?.id || ""} onChange={(e) => { setDeletePeriodId(e.target.value); setDeleteConfirmText(""); }}>
                    {(data?.periods || []).map((period: any) => (
                      <option key={period.id} value={period.id}>{period.title} · {statusLabels[period.status] || period.status}</option>
                    ))}
                  </select>
                </Field>
                <div>
                  <label className="label">삭제 확인 문구</label>
                  <div className="notice small">
                    <b>{requiredDeletePhrase(selectedDeletePeriod) || "-"}</b>
                  </div>
                </div>
                <Field label="확인 문구 직접 입력">
                  <input
                    className="input"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder={requiredDeletePhrase(selectedDeletePeriod) || "평가월을 선택해주세요"}
                  />
                </Field>
              </div>

              <div className="grid grid-4" style={{ marginTop: 18 }}>
                <Stat label="설문 응답" value={`${deletePeriodStats.responses}건`} />
                <Stat label="QR/배정" value={`${deletePeriodStats.qrLinks + deletePeriodStats.assignments}건`} />
                <Stat label="결과지/웹링크" value={`${deletePeriodStats.reportExports + deletePeriodStats.reportShareLinks}건`} />
                <Stat label="업로드/Slack 이력" value={`${deletePeriodStats.importBatches + deletePeriodStats.slackLogs}건`} />
              </div>

              <div className="form-row">
                <button
                  className="btn danger"
                  onClick={deletePeriodData}
                  disabled={deleteBusy || deleteConfirmText.trim() !== requiredDeletePhrase(selectedDeletePeriod)}
                >
                  {deleteBusy ? "삭제 중..." : "선택 평가월 데이터 영구 삭제"}
                </button>
              </div>
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">선생님 삭제 안내</h2>
              <p className="muted">
                선생님을 완전히 삭제하려면 <b>기본 설정 &gt; 선생님 관리</b>에서 해당 선생님 행의 [삭제] 버튼을 사용하세요.
                삭제 시 그 선생님과 연결된 설문 응답, 배정, QR, 결과지, 웹 리포트 링크, Slack 이력도 함께 삭제됩니다.
              </p>
            </div>
          </section>
        )}

                {tab === "backup" && (
          <section className="card">
            <div className="section-header">
              <div>
                <h1 className="h1">데이터 백업 / 엑셀 내보내기</h1>
                <p className="muted">설문 응답, 문항별 답변, 결과 요약, QR, 리포트 링크, Slack 발송 이력을 엑셀 파일로 내려받습니다.</p>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => downloadDataBackup("period")} disabled={backupBusy}>
                  {backupBusy ? "엑셀 생성 중..." : "선택 평가월 엑셀 다운로드"}
                </button>
                <button className="btn secondary" onClick={() => downloadDataBackup("all")} disabled={backupBusy}>
                  전체 기간 엑셀 다운로드
                </button>
              </div>
            </div>

            <div className="grid grid-3" style={{ marginTop: 18 }}>
              <Field label="백업 평가월">
                <select className="select" value={backupPeriod?.id || ""} onChange={(e) => setBackupPeriodId(e.target.value)}>
                  {(data?.periods || []).map((period: any) => (
                    <option key={period.id} value={period.id}>{period.title}</option>
                  ))}
                </select>
              </Field>
              <div className="notice small">
                <b>포함 데이터</b>
                <br />응답 원본, 문항별 답변, 선생님 요약, 반별 점수, QR 링크, 웹 리포트 링크, Slack 이력, 출력 이력, 응답 업로드 이력
              </div>
              <div className="notice small">
                <b>권장 사용 시점</b>
                <br />평가월 잠금 전, 결과지 배포 후, 데이터 삭제 전에는 반드시 백업 파일을 내려받으세요.
              </div>
            </div>

            <div className="grid grid-4" style={{ marginTop: 18 }}>
              <Stat label="선택월 응답" value={`${(data?.responses || []).filter((row: any) => !backupPeriod?.id || row.evaluation_period_id === backupPeriod.id).length}건`} />
              <Stat label="선택월 QR" value={`${(data?.qrLinks || []).filter((row: any) => !backupPeriod?.id || row.evaluation_period_id === backupPeriod.id).length}건`} />
              <Stat label="선택월 웹 링크" value={`${(data?.reportShareLinks || []).filter((row: any) => !backupPeriod?.id || row.evaluation_period_id === backupPeriod.id).length}건`} />
              <Stat label="선택월 Slack 이력" value={`${(data?.slackMessageLogs || []).filter((row: any) => !backupPeriod?.id || row.evaluation_period_id === backupPeriod.id).length}건`} />
            </div>

            <div className="notice" style={{ marginTop: 18 }}>
              엑셀 파일은 운영 확인과 백업 목적으로 제공됩니다. 백업 파일에는 학생이 입력한 이름과 원본 답변이 포함될 수 있으므로 외부 공유는 금지해주세요.
            </div>
          </section>
        )}

{tab === "setup" && (
          <section className="card">
            <h1 className="h1">초기 세팅</h1>
            <p className="muted">
              테스트용 기능입니다. 실제 운영 전에는 평가월/선생님/반/배정 메뉴에서 실제 데이터를 직접 입력하는 방식을 권장합니다.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
              <button className="btn secondary" onClick={() => checkDiagnostics()} disabled={diagnosticsBusy}>{diagnosticsBusy ? "점검 중..." : "저장/발송 환경 점검"}</button>
              <button className="btn" onClick={setupDemo}>샘플 데이터 만들기</button>
              <button className="btn secondary" onClick={() => generateQrLinks()} disabled={qrBusy}>{qrBusy ? "QR 생성 중..." : "QR 전체 생성"}</button>
            </div>
            <div className="notice" style={{ marginTop: 14 }}>
              <b>실제 운영 권장 순서</b><br />
              샘플 데이터는 테스트용입니다. 운영 전에는 실제 선생님과 반을 직접 등록하고, 이번 달 평가월에 배정한 뒤 QR을 생성해주세요.
            </div>

            {renderDiagnosticsPanel()}

            <div className="grid grid-3" style={{ marginTop: 18 }}>
              <ListCard title="평가월" rows={(data?.periods || []).map((p: any) => `${p.title} · ${statusLabels[p.status] || p.status}`)} />
              <ListCard title="선생님" rows={(data?.teachers || []).map((t: any) => `${t.name}${t.is_active === false ? " · 비활성" : ""}`)} />
              <ListCard title="반" rows={(data?.classes || []).map((c: any) => `${c.name}${c.is_active === false ? " · 비활성" : ""}`)} />
            </div>
          </section>
        )}

        {tab === "qr" && (
          <section className="card">
            <div className="no-print" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h1 className="h1">QR 출력</h1>
                <p className="muted">선생님·반별 QR을 출력해 교실에서 나눠주면 됩니다.</p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select className="select" value={selectedQrPeriod?.id || ""} onChange={(e) => setSelectedQrPeriodId(e.target.value)}>
                  {(data?.periods || []).map((period: any) => <option key={period.id} value={period.id}>{period.title}</option>)}
                </select>
                <button className="btn secondary" onClick={() => generateQrLinks(selectedQrPeriod?.id)} disabled={qrBusy}>{qrBusy ? "QR 생성 중..." : "QR 전체 생성"}</button>
                <button className="btn" onClick={() => window.print()}>현재 화면 출력</button>
              </div>
            </div>

            <div className="grid grid-2" style={{ marginTop: 18 }}>
              {displayedQrLinks.map((link: any) => {
                const url = `${appUrl}/s/${link.token}`;
                return (
                  <div className="qr-card" key={link.id}>
                    <h2 className="h2">e강의평가</h2>
                    <p className="muted">{link.evaluation_periods?.title}</p>
                    <h3 className="h3">{link.teachers?.name} 선생님</h3>
                    <p><b>{link.classes?.name || "반 미지정"}</b></p>
                    {qrImages[link.id] ? <img className="qr-image" src={qrImages[link.id]} alt="QR 코드" /> : <div className="qr-image" />}
                    <div className="notice" style={{ marginTop: 14 }}>
                      <b>안내</b>
                      <br />1. QR코드를 스캔해주세요.
                      <br />2. 본인 이름을 정확히 입력해주세요.
                      <br />3. 제출 완료 화면을 관리자에게 보여주세요.
                    </div>
                    <p className="muted" style={{ wordBreak: "break-all" }}>{url}</p>
                    <a className="btn secondary no-print" href={url} target="_blank">설문 링크 열기</a>
                  </div>
                );
              })}
            </div>

            {!displayedQrLinks.length && <Empty message="이 평가월의 QR이 아직 없습니다. 선생님-반 배정 후 QR 전체 생성을 눌러주세요." />}
          </section>
        )}

        {tab === "legacyUpload" && (
          <section className="card">
            <h1 className="h1">응답 업로드</h1>
            <p className="muted">
              QR 설문을 쓰지 못한 레거시 데이터 이관용 또는 비상용 기능입니다.
              v1.9부터는 바로 저장하지 않고, 먼저 미리보기에서 오류/중복을 확인한 뒤 업로드를 확정합니다.
            </p>

            <div className="notice" style={{ marginTop: 18 }}>
              <b>운영 안전장치</b><br />
              업로드 전 미리보기, 오류 줄 제외, 중복 의심 표시, 업로드 이력 저장, 업로드 롤백을 지원합니다.
              QR 제출 응답과 업로드 응답은 내부적으로 구분되어 저장됩니다.
            </div>

            <div className="grid grid-3" style={{ marginTop: 18 }}>
              <Stat label="업로드 이력" value={`${data?.responseImportBatches?.length || 0}건`} />
              <Stat label="업로드 완료" value={`${(data?.responseImportBatches || []).filter((b: any) => b.status === "imported").length}건`} />
              <Stat label="롤백 완료" value={`${(data?.responseImportBatches || []).filter((b: any) => b.status === "rolled_back").length}건`} />
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">1. 업로드 기본 정보</h2>
              <div className="grid grid-3">
                <Field label="업로드할 평가월">
                  <select className="select" value={legacyUploadPeriodId || currentPeriod?.id || ""} onChange={(e) => setLegacyUploadPeriodId(e.target.value)}>
                    {(data?.periods || []).map((period: any) => <option key={period.id} value={period.id}>{period.title}</option>)}
                  </select>
                </Field>
                <Field label="업로드 구분">
                  <input className="input" value={legacyUploadSourceLabel} onChange={(e) => setLegacyUploadSourceLabel(e.target.value)} placeholder="예: 2025년 기존 엑셀 이관" />
                </Field>
                <Field label="메모">
                  <input className="input" value={legacyUploadMemo} onChange={(e) => setLegacyUploadMemo(e.target.value)} placeholder="예: 종이 설문 수기 입력분" />
                </Field>
              </div>
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">2. 엑셀 표준 양식 작성 후 붙여넣기</h2>
              <p className="muted">
                이제 표준 양식은 실제 엑셀 파일(.xlsx)로 다운로드됩니다. 엑셀에서 작성한 뒤 표 전체를 복사해서 아래 입력칸에 붙여넣으세요.
                점수는 5/4/3/2/1, 매우 만족/만족/보통/불만족/매우 불만족, 또는 100/75/50/25/0으로 입력할 수 있습니다.
              </p>
              <button className="btn secondary" onClick={downloadLegacyTemplate}>엑셀 표준 양식(.xlsx) 다운로드</button>
              <pre className="upload-example" style={{ marginTop: 12 }}>{`학생이름\t선생님\t반\t시설\t수업시간\t클리닉\t압박있음\t설명이해\t적극도움\t과제량\t피드백\t관심도\t좋은점\t아쉬운점\t학원건의\t제출시간(선택)
김민준\t이서영\tM5 화목\t5\t4\t5\t아니오\t5\t5\t4\t5\t5\t설명이 좋아요\t숙제 피드백이 더 빨랐으면 좋겠어요\t없음\t2026-07-01 14:30`}</pre>
              <textarea
                className="textarea"
                style={{ minHeight: 260, marginTop: 12 }}
                value={legacyUploadText}
                onChange={(e) => {
                  setLegacyUploadText(e.target.value);
                  setLegacyUploadPreview(null);
                  setLegacyUploadResult(null);
                }}
                placeholder={"학생이름\t선생님\t반\t시설\t수업시간\t클리닉\t압박있음\t설명이해\t적극도움\t과제량\t피드백\t관심도\t좋은점\t아쉬운점\t학원건의\t제출시간(선택)\n김민준\t이서영\tM5 화목\t5\t4\t5\t아니오\t5\t5\t4\t5\t5\t설명이 좋아요\t숙제 피드백이 더 빨랐으면 좋겠어요\t없음\t2026-07-01 14:30"}
              />
              <div className="form-row" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn secondary" onClick={previewLegacyResponseUpload}>업로드 전 미리보기</button>
                <button className="btn" onClick={runLegacyResponseUpload} disabled={!legacyUploadPreview}>
                  미리보기 결과로 업로드 확정
                </button>
              </div>
            </div>

            {legacyUploadPreview && (
              <div className="card" style={{ marginTop: 18 }}>
                <h2 className="h2">3. 업로드 전 미리보기</h2>
                <div className="grid grid-5">
                  <Stat label="전체 줄" value={`${legacyUploadPreview.summary?.rawRowCount || 0}줄`} />
                  <Stat label="업로드 가능" value={`${legacyUploadPreview.summary?.validRowCount || 0}줄`} />
                  <Stat label="오류" value={`${legacyUploadPreview.summary?.errorRowCount || 0}줄`} />
                  <Stat label="확인 필요" value={`${legacyUploadPreview.summary?.warningRowCount || 0}줄`} />
                  <Stat label="중복 의심" value={`${legacyUploadPreview.summary?.duplicateRowCount || 0}줄`} />
                </div>

                <div className="table-wrap" style={{ marginTop: 16 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>줄</th>
                        <th>상태</th>
                        <th>학생</th>
                        <th>선생님</th>
                        <th>반</th>
                        <th>확인 내용</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(legacyUploadPreview.rows || []).slice(0, 80).map((row: any) => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          <td>
                            {row.status === "error" && <span className="badge danger">오류</span>}
                            {row.status === "warning" && <span className="badge warn">확인 필요</span>}
                            {row.status === "valid" && <span className="badge ok">정상</span>}
                          </td>
                          <td>{row.studentName || "-"}</td>
                          <td>{row.teacherName || row.teacherKey || "-"}</td>
                          <td>{row.classResolvedName || row.className || "-"}</td>
                          <td>
                            {[...(row.errors || []), ...(row.warnings || [])].length ? (
                              <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {[...(row.errors || []), ...(row.warnings || [])].map((item: string, idx: number) => <li key={idx}>{item}</li>)}
                              </ul>
                            ) : "문제 없음"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(legacyUploadPreview.rows || []).length > 80 && <p className="muted">미리보기 표는 처음 80줄까지만 표시합니다. 전체 오류/주의 수는 위 카드 기준으로 확인하세요.</p>}
              </div>
            )}

            {legacyUploadResult && (
              <div className="card" style={{ marginTop: 18 }}>
                <h2 className="h2">업로드 처리 결과</h2>
                <p>{legacyUploadResult.message}</p>
                {legacyUploadResult.batchId && <p className="muted">업로드 이력 ID: {legacyUploadResult.batchId}</p>}
              </div>
            )}

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">업로드 이력 / 롤백</h2>
              <p className="muted">잘못 업로드한 경우 해당 이력의 [롤백]을 누르면 그 업로드로 들어간 응답과 답변만 삭제합니다.</p>
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>업로드 시각</th>
                      <th>평가월</th>
                      <th>구분</th>
                      <th>상태</th>
                      <th>등록</th>
                      <th>오류/확인</th>
                      <th>기능</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.responseImportBatches || []).map((batch: any) => {
                      const errors = (data?.responseImportErrors || []).filter((e: any) => e.batch_id === batch.id);
                      return (
                        <tr key={batch.id}>
                          <td>{formatDateTime(batch.created_at)}</td>
                          <td>{batch.evaluation_periods?.title || "-"}</td>
                          <td>{batch.source_label || "-"}</td>
                          <td>
                            <span className={batch.status === "imported" ? "badge ok" : batch.status === "rolled_back" ? "badge warn" : "badge danger"}>
                              {responseImportStatusLabels[batch.status] || batch.status}
                            </span>
                          </td>
                          <td><b>{batch.imported_response_count || 0}건</b></td>
                          <td>
                            오류 {batch.error_row_count || 0} · 확인 {batch.warning_row_count || 0}
                            {!!errors.length && (
                              <details style={{ marginTop: 6 }}>
                                <summary>상세 보기</summary>
                                <ul>
                                  {errors.slice(0, 12).map((err: any) => <li key={err.id}>{err.row_number}줄 · {err.severity === "error" ? "오류" : "확인"} · {err.message}</li>)}
                                </ul>
                              </details>
                            )}
                          </td>
                          <td>
                            {batch.status === "imported" ? (
                              <button className="btn danger" onClick={() => rollbackResponseImport(batch.id)}>롤백</button>
                            ) : (
                              <span className="muted">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!(data?.responseImportBatches || []).length && <Empty message="아직 응답 업로드 이력이 없습니다." />}
            </div>
          </section>
        )}

        {tab === "responses" && (
          <section className="card">
            <h1 className="h1">제출 현황</h1>
            <p className="muted">
              관리자 내부 화면입니다. 학생 이름은 여기서만 확인하고, 선생님 결과지에는 노출하지 않습니다.
              반별 제출 수, 중복 의심, 검토 필요 응답을 한 화면에서 확인할 수 있습니다.
            </p>

            <div className="grid grid-4" style={{ marginTop: 18 }}>
              <Stat label="선택 평가월 응답" value={`${responseStats.total}건`} />
              <Stat label="정상 응답" value={`${responseStats.normal}건`} />
              <Stat label="검토 필요" value={`${responseStats.flagged}건`} />
              <Stat label="중복 의심" value={`${responseStats.duplicate}건`} />
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">필터</h2>
              <div className="grid grid-4">
                <Field label="평가월">
                  <select className="select" value={selectedReportPeriod?.id || ""} onChange={(e) => setSelectedReportPeriodId(e.target.value)}>
                    {(data?.periods || []).map((period: any) => <option key={period.id} value={period.id}>{period.title}</option>)}
                  </select>
                </Field>
                <Field label="선생님">
                  <select className="select" value={responseTeacherFilter} onChange={(e) => setResponseTeacherFilter(e.target.value)}>
                    <option value="all">전체 선생님</option>
                    {activeTeachers.map((teacher: any) => <option key={teacher.id} value={teacher.id}>{teacher.name} 선생님</option>)}
                  </select>
                </Field>
                <Field label="반">
                  <select className="select" value={responseClassFilter} onChange={(e) => setResponseClassFilter(e.target.value)}>
                    <option value="all">전체 반</option>
                    {activeClasses.map((classItem: any) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
                  </select>
                </Field>
                <Field label="상태">
                  <select className="select" value={responseStatusFilter} onChange={(e) => setResponseStatusFilter(e.target.value)}>
                    <option value="all">전체 상태</option>
                    <option value="normal">정상만</option>
                    <option value="flagged">검토 필요만</option>
                    <option value="duplicate">중복 의심만</option>
                  </select>
                </Field>
              </div>
              <div className="form-row">
                <Field label="검색">
                  <input
                    className="input"
                    value={responseSearch}
                    onChange={(e) => setResponseSearch(e.target.value)}
                    placeholder="학생 이름, 선생님, 반, 코멘트, 검토 사유로 검색"
                  />
                </Field>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                <button className="btn secondary" onClick={() => { setResponseSearch(""); setResponseTeacherFilter("all"); setResponseClassFilter("all"); setResponseStatusFilter("all"); setSelectedResponseId(""); }}>
                  필터 초기화
                </button>
                <button className="btn secondary" onClick={loadData}>새로고침</button>
              </div>
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">반별 제출 요약</h2>
              <p className="muted">QR 기준으로 제출 수를 집계합니다. 설문 시간이 끝난 뒤 관리자가 반별 제출 상황을 빠르게 확인하는 용도입니다.</p>
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>선생님</th>
                      <th>반</th>
                      <th>제출 수</th>
                      <th>검토 필요</th>
                      <th>중복 의심</th>
                      <th>마지막 제출</th>
                    </tr>
                  </thead>
                  <tbody>
                    {responseSummaryRows.map((row: any) => (
                      <tr key={row.key}>
                        <td>{row.teacherName} 선생님</td>
                        <td>{row.className}</td>
                        <td><b>{row.total}건</b></td>
                        <td>{row.flagged ? <span className="badge danger">{row.flagged}건</span> : <span className="badge ok">0건</span>}</td>
                        <td>{row.duplicate ? <span className="badge warn">{row.duplicate}건</span> : <span className="badge ok">0건</span>}</td>
                        <td>{formatDateTime(row.lastSubmittedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!responseSummaryRows.length && <Empty message="이 평가월의 QR 또는 응답 데이터가 없습니다." />}
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">응답 목록</h2>
              <p className="muted">상세 버튼을 누르면 학생이 남긴 답변과 검토 사유를 확인할 수 있습니다.</p>
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>제출자</th>
                      <th>선생님</th>
                      <th>반</th>
                      <th>제출 시간</th>
                      <th>상태</th>
                      <th>기능</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResponses.map((r: any) => (
                      <tr key={r.id}>
                        <td><b>{r.student_name}</b></td>
                        <td>{r.teachers?.name} 선생님</td>
                        <td>{r.classes?.name || "반 미지정"}</td>
                        <td>{formatDateTime(r.submitted_at)}</td>
                        <td><ResponseStatusBadges response={r} /></td>
                        <td><button className="btn secondary" onClick={() => setSelectedResponseId(r.id)}>상세</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!filteredResponses.length && <Empty message="조건에 맞는 제출 응답이 없습니다." />}
            </div>

            {selectedResponse && (
              <div className="card" style={{ marginTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <h2 className="h2">응답 상세</h2>
                    <p className="muted">
                      {selectedResponse.student_name} 학생 · {selectedResponse.teachers?.name} 선생님 · {selectedResponse.classes?.name || "반 미지정"} · {formatDateTime(selectedResponse.submitted_at)}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn danger" onClick={() => hideResponse(selectedResponse)}>응답 숨김</button>
                    <button className="btn secondary" onClick={() => setSelectedResponseId("")}>상세 닫기</button>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <ResponseStatusBadges response={selectedResponse} />
                </div>

                {(selectedResponse.flag_reason || selectedResponse.duplicate_reason) && (
                  <div className="notice" style={{ marginTop: 14 }}>
                    {selectedResponse.flag_reason && <><b>검토 사유</b><br />{selectedResponse.flag_reason}<br /><br /></>}
                    {selectedResponse.duplicate_reason && <><b>중복 의심 사유</b><br />{selectedResponse.duplicate_reason}</>}
                  </div>
                )}

                <div className="table-wrap" style={{ marginTop: 16 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>문항</th>
                        <th>답변</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getAnswers(selectedResponse)
                        .sort((a: any, b: any) => Number(a.evaluation_questions?.display_order || 0) - Number(b.evaluation_questions?.display_order || 0))
                        .map((answer: any) => (
                          <tr key={answer.id}>
                            <td>{String(answer.evaluation_questions?.title || "").replace("{teacher_name}", selectedResponse.teachers?.name || "")}</td>
                            <td>{answerDisplay(answer)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "results" && (
          <section className="card">
            <h1 className="h1">결과 분석</h1>
            <p className="muted">선생님 평가 5문항 기준 평균 점수입니다. 학원 시설/수업시간/클리닉은 선생님 등수 계산에서 제외합니다.</p>
            <div className="grid grid-2" style={{ marginTop: 18 }}>
              <div className="card">
                <h2 className="h2">선생님별 강의평가 점수</h2>
                {evaluationRanking.map((row: any) => (
                  <Bar key={row.teacher_id} label={`${row.teacher_name} 선생님`} value={Number(row.avg_score_100 || 0)} max={100} suffix="점" />
                ))}
                {!evaluationRanking.length && <Empty message="집계할 응답이 없습니다." />}
              </div>
              <div className="card">
                <h2 className="h2">반별 점수</h2>
                {currentPeriodClassScores.map((row: any) => (
                  <Bar key={`${row.teacher_id}-${row.class_id}`} label={`${row.teacher_name} · ${row.class_name}`} value={Number(row.avg_score_100 || 0)} max={100} suffix="점" />
                ))}
                {!currentPeriodClassScores.length && <Empty message="반별 점수 데이터가 없습니다." />}
              </div>
            </div>
          </section>
        )}

        {tab === "withdrawal" && (
          <section className="card">
            <div className="no-print" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h1 className="h1">퇴원율 입력</h1>
                <p className="muted">v1.0에서는 관리자가 직접 입력합니다. 나중에 v2에서 자동 계산으로 바꿀 수 있습니다.</p>
              </div>
              <select className="select" value={selectedReportPeriod?.id || ""} onChange={(e) => setSelectedReportPeriodId(e.target.value)}>
                {(data?.periods || []).map((period: any) => <option key={period.id} value={period.id}>{period.title}</option>)}
              </select>
            </div>
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>선생님</th>
                    <th>퇴원율 %</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTeachers.map((teacher: any) => (
                    <tr key={teacher.id}>
                      <td>{teacher.name} 선생님</td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={withdrawalDraft[teacher.id] || ""}
                          onChange={(e) => setWithdrawalDraft((prev) => ({ ...prev, [teacher.id]: e.target.value }))}
                          placeholder="예: 4.40"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={saveWithdrawalRates}>퇴원율 저장</button>
            </div>
          </section>
        )}

        {tab === "report" && (
          <section className="card">
            <div className="no-print" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h1 className="h1">선생님별 결과지 생성</h1>
                <p className="muted">현재 버전은 출력용 PDF와 웹문서 리포트 링크를 함께 지원합니다. 웹 리포트는 PDF보다 넓고 큰 글씨로 읽기 쉽게 표시됩니다.</p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn secondary" onClick={loadData}>데이터 새로고침</button>
                <button className="btn" onClick={() => generatePdfExports(false)} disabled={pdfBusy}>
                  {pdfBusy ? "PDF 생성 중..." : "PDF 자동 생성/저장"}
                </button>
                <button className="btn soft" onClick={() => generatePdfExports(true)} disabled={pdfBusy}>
                  PDF 생성 후 열기
                </button>
                <button className="btn soft" onClick={createWebReportLinks} disabled={webReportBusy}>
                  {webReportBusy ? "웹 리포트 생성 중..." : (isInternalReportTemplate ? "내부 웹 리포트 생성 + 총괄관리자 DM" : "웹 리포트 생성하기")}
                </button>
              </div>
              <p className="muted" style={{ marginTop: 10 }}>
                직접 전달은 [PDF 자동 생성/저장], Slack 전달은 [웹 리포트 생성하기]를 사용하세요. 생성 전 확인창에서 평가월·템플릿·발송 정책을 한 번 더 검증합니다.
              </p>
            </div>

            {renderDiagnosticsPanel()}

            <div className="card no-print" style={{ marginTop: 18 }}>
              <h2 className="h2">출력 설정</h2>
              <div className="grid grid-4">
                <Field label="평가월">
                  <select className="select" value={selectedReportPeriod?.id || ""} onChange={(e) => setSelectedReportPeriodId(e.target.value)}>
                    {(data?.periods || []).map((period: any) => <option key={period.id} value={period.id}>{period.title}</option>)}
                  </select>
                </Field>
                <Field label="리포트 템플릿">
                  <select className="select" value={reportTemplate} onChange={(e) => applyReportTemplate(e.target.value as "teacher" | "summary" | "internal")}>
                    <option value="teacher">선생님 전달용</option>
                    <option value="summary">간단 요약형</option>
                    <option value="internal">원장 내부 확인용</option>
                  </select>
                </Field>
                <Field label="출력 대상">
                  <select
                    className="select"
                    value={reportMode}
                    onChange={(e) => setReportMode(e.target.value as "single" | "all")}
                    disabled={isInternalReportTemplate}
                  >
                    <option value="single">선택한 선생님 1명</option>
                    <option value="all">전체 선생님 일괄 출력</option>
                  </select>
                  {isInternalReportTemplate ? <p className="muted small" style={{ marginTop: 6 }}>원장 내부 확인용은 전체 선생님 실명 데이터를 기준으로 생성되어 출력 대상 선택이 적용되지 않습니다.</p> : null}
                </Field>
                <Field label="선생님">
                  <select
                    className="select"
                    value={selectedTeacherId}
                    onChange={(e) => setSelectedTeacherId(e.target.value)}
                    disabled={reportMode === "all" || isInternalReportTemplate}
                  >
                    {(data?.teachers || []).map((teacher: any) => <option key={teacher.id} value={teacher.id}>{teacher.name} 선생님</option>)}
                  </select>
                  {isInternalReportTemplate ? <p className="muted small" style={{ marginTop: 6 }}>선생님 선택은 비활성화됩니다. 생성 후 총괄관리자 Slack DM으로만 전달됩니다.</p> : null}
                </Field>
                <Field label={isInternalReportTemplate ? "내부 리포트 기준" : "1페이지 점수표 기간"}>
                  {isInternalReportTemplate ? (
                    <div className="notice small">선택한 평가월 단월 기준으로 전체 요약, 강의평가 순위, 퇴원율, 서술형 코멘트를 생성합니다.</div>
                  ) : (
                    <select className="select" value={reportMonthCount} onChange={(e) => setReportMonthCount(Number(e.target.value) as 3 | 4)}>
                      <option value={3}>최근 3개월</option>
                      <option value={4}>최근 4개월</option>
                    </select>
                  )}
                </Field>
              </div>

              {!isInternalReportTemplate && reportMode === "single" ? (
                <div className="scoped-mapping-panel" style={{ marginTop: 16 }}>
                  <div className="delivery-policy-head">
                    <div>
                      <b>선생님 전체 월 리포트용 반 이름 매칭</b>
                      <p className="muted small">선택 선생님에게 월 상관없이 적용됩니다. 다른 선생님에게는 반영되지 않으며, 적용 방식은 양방향/단방향 중 선택할 수 있습니다.</p>
                    </div>
                    <span className="badge">{currentReportClassMappings.length}건 적용</span>
                  </div>
                  <div className="grid grid-5" style={{ marginTop: 10 }}>
                    <Field label="합산할 이전반">
                      <select className="select" value={currentReportMappingForm.from_class_id || ""} onChange={(e) => updateReportClassMappingForm({ from_class_id: e.target.value })}>
                        <option value="">이전반 선택</option>
                        {reportMappingClassOptions.map((classItem: any) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
                      </select>
                    </Field>
                    <Field label="기준으로 볼 반">
                      <select className="select" value={currentReportMappingForm.to_class_id || ""} onChange={(e) => updateReportClassMappingForm({ to_class_id: e.target.value })}>
                        <option value="">기준 반 선택</option>
                        {reportMappingClassOptions.map((classItem: any) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
                      </select>
                    </Field>
                    <Field label="적용 방식">
                      <select className="select" value={currentReportMappingForm.direction_mode || "bidirectional"} onChange={(e) => updateReportClassMappingForm({ direction_mode: e.target.value })}>
                        <option value="bidirectional">양방향 적용(예: 정규반 ↔ 내신반)</option>
                        <option value="oneway">단방향 적용(예: 학기 변경에 따른 레벨 상승. M3 → M4)</option>
                      </select>
                    </Field>
                    <Field label="메모">
                      <input className="input" value={currentReportMappingForm.memo || ""} onChange={(e) => updateReportClassMappingForm({ memo: e.target.value })} placeholder="예: M4 ↔ M5 또는 M3 → M4" />
                    </Field>
                    <Field label="적용">
                      <button type="button" className="btn full" onClick={addReportClassMapping}>매칭 추가</button>
                    </Field>
                  </div>

                  {currentReportClassMappings.length ? (
                    <div className="table-wrap" style={{ marginTop: 10 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>적용 범위</th>
                            <th>이전반</th>
                            <th>기준 반</th>
                            <th>적용 방식</th>
                            <th>메모</th>
                            <th>관리</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentReportClassMappings.map((mapping: any) => {
                            const fromName = activeClasses.find((item: any) => item.id === mapping.from_class_id)?.name || "-";
                            const toName = activeClasses.find((item: any) => item.id === mapping.to_class_id)?.name || "-";
                            const directionMode = mapping.direction_mode || (mapping.bidirectional === false ? "oneway" : "bidirectional");
                            const isBidirectional = directionMode === "bidirectional";
                            return (
                              <tr key={mapping.id}>
                                <td>{selectedTeacher?.name || "선택 선생님"} 선생님 · 전체 평가월</td>
                                <td>{fromName}</td>
                                <td><b>{toName}</b></td>
                                <td>{isBidirectional ? "양방향 적용" : "단방향 적용"}</td>
                                <td>{mapping.memo || "-"}</td>
                                <td><button type="button" className="btn danger" onClick={() => removeReportClassMapping(mapping.id)}>삭제</button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted small" style={{ marginTop: 8 }}>선택 선생님 전체 월 리포트에 적용할 반 이름 매칭이 없습니다. 필요한 경우에만 추가하세요.</p>
                  )}
                  {currentReportClassMappings.length ? <button type="button" className="btn secondary" style={{ marginTop: 10 }} onClick={clearReportClassMappings}>선택 선생님 매칭 모두 삭제</button> : null}
                </div>
              ) : null}

              <div className="form-row">
                <label className="label">포함할 페이지</label>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" className={reportPages.coverPage ? "btn soft" : "btn secondary"} onClick={() => toggleReportPage("coverPage")}>
                    표지 페이지
                  </button>
                  {isInternalReportTemplate ? (
                    <>
                      <button type="button" className={reportPages.scoreTable ? "btn soft" : "btn secondary"} onClick={() => toggleReportPage("scoreTable")}>
                        1페이지 전체 평가 요약
                      </button>
                      <button type="button" className={reportPages.evaluationRanking ? "btn soft" : "btn secondary"} onClick={() => toggleReportPage("evaluationRanking")}>
                        2페이지 강의평가 순위
                      </button>
                      <button type="button" className={reportPages.withdrawalRanking ? "btn soft" : "btn secondary"} onClick={() => toggleReportPage("withdrawalRanking")}>
                        3페이지 퇴원율/재원 안정성
                      </button>
                      <button type="button" className={reportPages.responseTable ? "btn soft" : "btn secondary"} onClick={() => toggleReportPage("responseTable")}>
                        4페이지 응답 원문/코멘트 분석
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={reportPages.scoreTable ? "btn soft" : "btn secondary"} onClick={() => toggleReportPage("scoreTable")}>
                        1페이지 점수표
                      </button>
                      <button type="button" className={reportPages.responseTable ? "btn soft" : "btn secondary"} onClick={() => toggleReportPage("responseTable")}>
                        2페이지 항목별 평균표
                      </button>
                      <button type="button" className={reportPages.evaluationRanking ? "btn soft" : "btn secondary"} onClick={() => toggleReportPage("evaluationRanking")}>
                        3페이지 강의평가 등수
                      </button>
                      <button type="button" className={reportPages.withdrawalRanking ? "btn soft" : "btn secondary"} onClick={() => toggleReportPage("withdrawalRanking")}>
                        4페이지 퇴원율 등수
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="delivery-policy-panel" style={{ marginTop: 16 }}>
                <div className="delivery-policy-head">
                  <div>
                    <b>템플릿별 발송 정책</b>
                    <p className="muted small">v2.6.3부터 평가월 상태는 월별로 독립 저장됩니다. 한 월을 진행중/마감으로 바꿔도 다른 월의 상태는 자동 변경되지 않습니다.</p>
                  </div>
                  <span className={isInternalReportTemplate ? "badge warn" : "badge ok"}>
                    현재 선택: {reportTemplateLabel()}
                  </span>
                </div>
                <div className="delivery-policy-grid">
                  <div className="delivery-policy-card">
                    <b>선생님 전달용</b>
                    <span>선생님 Slack DM 가능</span>
                    <p>출력 대상과 선생님 선택을 적용합니다.</p>
                  </div>
                  <div className="delivery-policy-card">
                    <b>간단 요약형</b>
                    <span>선생님 Slack DM 가능</span>
                    <p>표지·트렌드·순위 중심의 짧은 리포트입니다.</p>
                  </div>
                  <div className="delivery-policy-card warn">
                    <b>원장 내부 확인용</b>
                    <span>총괄관리자 DM만 허용</span>
                    <p>출력 대상/선생님 선택을 무시하고 선생님·직원 발송을 차단합니다.</p>
                  </div>
                </div>
              </div>

              <div className="template-guide-grid" style={{ marginTop: 16 }}>
                <div className="notice small"><b>선생님 전달용</b><br />학생 이름 미표시, 타 선생님 이름 마스킹, 선생님에게 직접 전달하는 기본 리포트입니다.</div>
                <div className="notice small"><b>간단 요약형</b><br />표지, 1페이지 트렌드, 3·4페이지 순위 중심으로 짧게 출력합니다.</div>
                <div className="notice small"><b>원장 내부 확인용</b><br />전체 평가 요약, 선생님별 순위 변화, 퇴원율-강의평가 관계, 코멘트는 답변 내용이 아니라 문항 기준으로 묶어 내부 검토용으로 확인합니다.</div>
              </div>

              <div className="notice" style={{ marginTop: 16 }}>
                <b>결과지 저장 방식</b>
                <br />[PDF 자동 생성/저장]은 현재 결과지 화면을 PDF 파일로 만들어 Supabase Storage에 저장합니다.
                <br />[웹 리포트 생성하기]는 선생님에게 공유할 수 있는 /r/토큰 링크를 만듭니다. 링크는 만료되지 않으며 리포트 링크 관리에서 비활성화/재생성할 수 있습니다.
                <br />단, <b>원장 내부 확인용</b>은 선생님/직원 발송을 차단하고, 생성 완료 시 총괄관리자에게만 Slack DM을 보냅니다.
                <br />전체 선생님 일괄 생성은 선생님 수와 응답 수가 많으면 시간이 오래 걸릴 수 있습니다. 원장 내부 확인용은 단일 내부 리포트 1건으로 생성됩니다.
              </div>
            </div>

            <div className="report-output">
              {reportTemplate === "internal" ? (
                ((selectedTeacher || activeTeachers[0]) ? (
                  <div
                    className="report-teacher-set"
                    data-report-teacher-id={activeTeachers[0]?.id || selectedTeacher?.id || ""}
                    data-report-teacher-name="원장 내부 확인용"
                    data-report-template="internal"
                  >
                    <InternalReport
                      period={selectedReportPeriod || currentPeriod}
                      teachers={activeTeachers}
                      responses={visibleResponses.filter((r: any) => !((selectedReportPeriod || currentPeriod)?.id) || r.evaluation_period_id === (selectedReportPeriod || currentPeriod)?.id)}
                      evaluationRanking={evaluationRanking}
                      withdrawalRanking={withdrawalRanking}
                      questions={data?.questions || []}
                      metrics={data?.metrics || []}
                      periods={data?.periods || []}
                      monthlyScores={data?.monthlyScores || []}
                      reportPages={reportPages}
                      reportTemplate={reportTemplate}
                    />
                  </div>
                ) : (
                  <Empty message="원장 내부 확인용 리포트를 만들 선생님 데이터가 없습니다." />
                ))
              ) : (
                reportTeachers.length ? reportTeachers.map((teacher: any) => {
                  const reportData = getReportDataForTeacher(teacher);
                  return (
                    <div className="report-teacher-set" key={teacher.id} data-report-teacher-id={teacher.id} data-report-teacher-name={teacher.name} data-report-template={reportTemplate}>
                      <TeacherReport
                        period={selectedReportPeriod || currentPeriod}
                        periods={data?.periods || []}
                        teacher={teacher}
                        classScores={reportData.classScores}
                        responses={reportData.responses}
                        evaluationRanking={evaluationRanking}
                        withdrawalRanking={withdrawalRanking}
                        metric={reportData.metric}
                        questions={data?.questions || []}
                        classes={data?.classes || []}
                        classMappings={getScopedReportClassMappings(teacher.id)}
                        reportPages={reportPages}
                        monthCount={reportMonthCount}
                        reportTemplate={reportTemplate}
                      />
                    </div>
                  );
                }) : (
                  <Empty message="출력할 선생님 데이터가 없습니다." />
                )
              )}
            </div>
          </section>
        )}


        {tab === "reportLinks" && (
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h1 className="h1">리포트 링크 관리</h1>
                <p className="muted">선생님별 웹문서 리포트 링크를 열람하고 Slack DM으로 발송합니다. 링크는 기본적으로 만료되지 않습니다.</p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select className="select" value={selectedReportPeriod?.id || ""} onChange={(e) => setSelectedReportPeriodId(e.target.value)} style={{ maxWidth: 180 }}>
                  {(data?.periods || []).map((period: any) => <option key={period.id} value={period.id}>{period.title}</option>)}
                </select>
                <button className="btn secondary" onClick={loadData}>새로고침</button>
                <button className="btn" onClick={() => setTab("report")}>웹 리포트 생성하러 가기</button>
                <select className="select" value={reportLinkStatusFilter} onChange={(e) => setReportLinkStatusFilter(e.target.value)} style={{ maxWidth: 170 }}>
                  <option value="all">전체 링크</option>
                  <option value="internal">원장 내부용</option>
                  <option value="active">사용중</option>
                  <option value="connected">Slack 연결</option>
                  <option value="disconnected">Slack 미연결</option>
                  <option value="unsent">Slack 미발송</option>
                  <option value="sent">Slack 발송 완료</option>
                  <option value="failed">Slack 실패</option>
                  <option value="unviewed">미열람</option>
                  <option value="viewed">열람됨</option>
                </select>
                <button className="btn soft" onClick={sendSlackReportsBulk} disabled={slackBusy === "bulk-send"}>
                  {slackBusy === "bulk-send" ? "일괄 발송 중..." : "표시된 링크 Slack 일괄 발송"}
                </button>
                <button className="btn secondary" onClick={() => sendSlackReportsByFilter("unsent")} disabled={slackBusy === "bulk-unsent"}>
                  미발송만 발송
                </button>
                <button className="btn secondary" onClick={() => sendSlackReportsByFilter("failed")} disabled={slackBusy === "bulk-failed"}>
                  실패만 재발송
                </button>
              </div>
            </div>

            <div className="grid grid-4" style={{ marginTop: 18 }}>
              <Stat label="선택월 웹 링크" value={`${reportLinkSlackSummary.total}건`} />
              <Stat label="원장 내부용" value={`${reportLinkSlackSummary.internal || 0}건`} onClick={() => setReportLinkStatusFilter("internal")} />
              <Stat label="Slack 연결 완료" value={`${reportLinkSlackSummary.connected}건`} />
              <Stat label="Slack/DM 발송 완료" value={`${reportLinkSlackSummary.sent}건`} />
              <Stat label="Slack 미발송" value={`${reportLinkSlackSummary.unsent}건`} onClick={() => setReportLinkStatusFilter("unsent")} />
              <Stat label="Slack 실패" value={`${reportLinkSlackSummary.failed}건`} onClick={() => setReportLinkStatusFilter("failed")} />
              <Stat label="미열람 링크" value={`${reportLinkSlackSummary.unviewed}건`} onClick={() => setReportLinkStatusFilter("unviewed")} />
            </div>

            <div className="notice" style={{ marginTop: 16 }}>
              <b>Slack DM 발송 전 확인</b>
              <br />선생님 관리에서 Slack 이메일을 입력하고 [Slack 연결 확인]을 먼저 실행하세요.
              <br />Vercel 환경변수 <b>SLACK_BOT_TOKEN</b>이 있어야 DM 발송이 됩니다. 이 값에는 NEXT_PUBLIC_을 붙이면 안 됩니다.
              <br />Slack App 권한은 chat:write, im:write, users:read.email을 권장합니다.
              <br /><b>원장 내부 확인용</b> 링크는 선생님 DM 버튼이 표시되지 않고, 총괄관리자 DM 재발송 버튼만 사용할 수 있습니다.
            </div>

            <div className="table-wrap" style={{ marginTop: 18 }}>
              <table>
                <thead>
                  <tr>
                    <th>생성 시각</th>
                    <th>평가월</th>
                    <th>선생님</th>
                    <th>리포트 유형</th>
                    <th>링크 상태</th>
                    <th>조회</th>
                    <th>Slack 상태</th>
                    <th>기능</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedReportShareLinks.length ? displayedReportShareLinks.map((link: any) => {
                    const teacher = link.teachers || {};
                    const url = shareLinkUrl(link.token);
                    const latestSlackLog = latestSlackLogForLink(link);
                    const internalLink = isInternalShareLink(link);
                    return (
                      <tr key={link.id}>
                        <td>{formatDateTime(link.created_at)}</td>
                        <td>{link.evaluation_periods?.title || "-"}</td>
                        <td>{internalLink ? <span className="badge warn">원장 내부 확인용</span> : (teacher.name ? `${teacher.name} 선생님` : "-")}</td>
                        <td>
                          <span className={internalLink ? "badge warn" : "badge"}>{link.teacher_report_exports?.pages?.templateLabel || (internalLink ? "원장 내부 확인용" : "선생님 전달용")}</span>
                          <div className="muted small">{internalLink ? "총괄관리자 전용 · 직원 발송 차단" : "선생님 발송 가능"}</div>
                        </td>
                        <td>
                          {link.is_active !== false ? <span className="badge ok">사용중</span> : <span className="badge danger">비활성</span>}
                          <div className="muted small">만료: 없음</div>
                        </td>
                        <td>
                          <b>{link.view_count || 0}회</b>
                          <div className="muted small">마지막: {link.last_viewed_at ? formatDateTime(link.last_viewed_at) : "-"}</div>
                        </td>
                        <td>
                          {internalLink ? <span className="badge warn">총괄관리자 전용</span> : (teacher.slack_user_id ? <span className="badge ok">연결됨</span> : <span className="badge">미연결</span>)}
                          {latestSlackLog ? (
                            <div style={{ marginTop: 6 }}>
                              {latestSlackLog.status === "sent" ? <span className="badge ok">발송 완료</span> : <span className="badge danger">발송 실패</span>}
                              <div className="muted small">{formatDateTime(latestSlackLog.created_at)}</div>
                              {latestSlackLog.error_message ? <div className="muted small">{latestSlackLog.error_message}</div> : null}
                            </div>
                          ) : (
                            <div className="muted small">{internalLink ? "총괄관리자 DM 이력 없음" : "Slack 발송 이력 없음"}</div>
                          )}
                          <div className="muted small">{internalLink ? "선생님/직원 발송 차단" : (teacher.slack_email || "Slack 이메일 없음")}</div>
                        </td>
                        <td>
                          <div className="row-actions wrap">
                            <button className="btn secondary" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>웹 링크 열기</button>
                            {internalLink ? (
                              <button className="btn soft" onClick={() => sendInternalSlackReport(link)} disabled={slackBusy === `internal-${link.id}` || link.is_active === false}>
                                {slackBusy === `internal-${link.id}` ? "총괄관리자 DM 발송 중..." : "총괄관리자 DM 발송"}
                              </button>
                            ) : (
                              <button className="btn" onClick={() => sendSlackReport(link)} disabled={slackBusy === `send-${link.id}` || link.is_active === false}>
                                {slackBusy === `send-${link.id}` ? "발송 중..." : "Slack DM 발송"}
                              </button>
                            )}
                            {link.is_active !== false ? (
                              <button className="btn danger" onClick={() => updateShareLink(link.id, "deactivate")}>비활성화</button>
                            ) : (
                              <button className="btn secondary" onClick={() => updateShareLink(link.id, "reactivate")}>재활성화</button>
                            )}
                            <button className="btn secondary" onClick={() => updateShareLink(link.id, "regenerate")}>링크 재생성</button>
                          </div>
                          <div className="muted small" style={{ marginTop: 6, wordBreak: "break-all" }}>{url}</div>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={8} className="muted">선택 평가월의 웹 리포트 링크가 없습니다. 결과지 생성 탭에서 [웹 리포트 링크 생성]을 먼저 실행하세요.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">최근 Slack 발송 이력</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>시각</th>
                      <th>선생님</th>
                      <th>평가월</th>
                      <th>상태</th>
                      <th>오류</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.slackMessageLogs || []).length ? (data?.slackMessageLogs || []).slice(0, 30).map((log: any) => (
                      <tr key={log.id}>
                        <td>{formatDateTime(log.created_at)}</td>
                        <td>{log.teachers?.name ? `${log.teachers.name} 선생님` : (log.teacher_id ? "-" : "총괄관리자")}</td>
                        <td>{log.evaluation_periods?.title || "-"}</td>
                        <td>{log.status === "sent" ? <span className="badge ok">발송 성공</span> : <span className="badge danger">발송 실패</span>}</td>
                        <td>{log.error_message || "-"}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5} className="muted">Slack 발송 이력이 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {tab === "exports" && (
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h1 className="h1">결과지 출력 이력</h1>
                <p className="muted">
                  서버에 보관한 PDF와 웹 리포트 저장본을 다시 열 수 있습니다. 원장 내부 확인용은 별도 표시되며 직원 발송 정책과 함께 보관됩니다.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn secondary" onClick={loadData}>이력 새로고침</button>
                <button className="btn" onClick={() => setTab("report")}>결과지 생성하러 가기</button>
                <button className="btn soft" onClick={() => downloadReportExportsZip("period")} disabled={zipBusy}>
                  {zipBusy ? "ZIP 준비 중..." : "선택 평가월 ZIP 다운로드"}
                </button>
                <button className="btn secondary" onClick={() => downloadReportExportsZip("teacher")} disabled={zipBusy}>
                  선택 선생님 ZIP
                </button>
                <button className="btn secondary" onClick={() => downloadReportExportsZip("all")} disabled={zipBusy}>
                  전체 저장본 ZIP
                </button>
              </div>
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 className="h2">ZIP 다운로드 기준</h2>
              <p className="muted">ZIP에는 서버에 보관된 PDF와 웹 리포트 저장본이 들어갑니다. PDF는 바로 열 수 있고, 웹 리포트는 브라우저에서 열람할 수 있습니다.</p>
              <div className="grid grid-3">
                <Field label="평가월">
                  <select className="select" value={selectedReportPeriod?.id || ""} onChange={(e) => setSelectedReportPeriodId(e.target.value)}>
                    {(data?.periods || []).map((period: any) => <option key={period.id} value={period.id}>{period.title}</option>)}
                  </select>
                </Field>
                <Field label="선생님">
                  <select className="select" value={selectedTeacherId} onChange={(e) => setSelectedTeacherId(e.target.value)}>
                    {(data?.teachers || []).map((teacher: any) => <option key={teacher.id} value={teacher.id}>{teacher.name} 선생님</option>)}
                  </select>
                </Field>
                <div>
                  <label className="label">권장 순서</label>
                  <div className="notice small">결과지 생성에서 [PDF 자동 생성/저장] → 출력 이력에서 ZIP 다운로드</div>
                </div>
              </div>
            </div>

            <div className="grid grid-4" style={{ marginTop: 18 }}>
              <Stat label="전체 이력" value={`${data?.reportExports?.length || 0}건`} />
              <Stat label="서버 보관" value={`${(data?.reportExports || []).filter((row: any) => row.status === "created" || !row.status).length}건`} />
              <Stat label="출력 완료" value={`${(data?.reportExports || []).filter((row: any) => row.status === "printed").length}건`} />
              <Stat label="저장 실패" value={`${(data?.reportExports || []).filter((row: any) => row.status === "failed").length}건`} />
              <Stat label="PDF 저장본" value={`${(data?.reportExports || []).filter((row: any) => getReportExportFormat(row) === "PDF").length}건`} />
              <Stat label="웹 저장본" value={`${(data?.reportExports || []).filter((row: any) => ["웹 리포트", "웹 저장본"].includes(getReportExportFormat(row))).length}건`} />
              <Stat label="보관 처리" value={`${(data?.reportExports || []).filter((row: any) => row.status === "archived").length}건`} />
            </div>

            <div className="notice" style={{ marginTop: 16 }}>
              <b>저장 방식 안내</b>
              <br />v2.5는 결과지 화면을 실제 PDF 파일로 자동 생성하고, 웹 리포트는 큰 글씨의 장문 문서로 공유할 수 있습니다.
              <br />PDF 생성이 실패하거나 레이아웃을 더 세밀하게 확인해야 할 때는 웹 저장본을 보조로 사용하세요.
              <br />[선택 평가월 ZIP 다운로드]를 누르면 해당 평가월의 PDF/웹 저장본을 한 압축 파일로 받을 수 있습니다.
              <br />상태가 <b>실패</b>로 표시되면 Storage 파일 저장에 실패한 상태입니다. 실패 사유를 확인하고 초기 세팅의 [저장/발송 환경 점검]을 다시 눌러주세요.
            </div>

            <div className="table-wrap" style={{ marginTop: 18 }}>
              <table>
                <thead>
                  <tr>
                    <th>보관 시각</th>
                    <th>평가월</th>
                    <th>선생님</th>
                    <th>리포트 유형</th>
                    <th>상태</th>
                    <th>파일 형식</th>
                    <th>포함 페이지</th>
                    <th>기능</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.reportExports || []).length ? (data?.reportExports || []).map((row: any) => {
                    const pages = row.pages || {};
                    const isInternalExport = pages.reportTemplate === "internal" || pages.audience === "director_internal" || pages.internalOnly === true;
                    const pageNames = (isInternalExport ? [
                      pages.coverPage ? "표지" : null,
                      pages.scoreTable !== false ? "1p 전체요약" : null,
                      pages.evaluationRanking !== false ? "2p 강의순위" : null,
                      pages.withdrawalRanking !== false ? "3p 퇴원율" : null,
                      pages.responseTable !== false ? "4p 코멘트" : null
                    ] : [
                      pages.coverPage ? "표지" : null,
                      pages.scoreTable !== false ? "1p" : null,
                      pages.responseTable !== false ? "2p" : null,
                      pages.evaluationRanking !== false ? "3p" : null,
                      pages.withdrawalRanking !== false ? "4p" : null
                    ]).filter(Boolean).join(", ");

                    return (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.created_at || row.exported_at)}</td>
                        <td>{row.evaluation_periods?.title || "-"}</td>
                        <td>{isInternalExport ? <span className="badge warn">원장 내부 확인용</span> : (row.teachers?.name ? `${row.teachers.name} 선생님` : "-")}</td>
                        <td>
                          <span className={isInternalExport ? "badge warn" : "badge"}>{pages.templateLabel || (isInternalExport ? "원장 내부 확인용" : "선생님 전달용")}</span>
                          <div className="muted small">{pages.slackPolicyLabel || (isInternalExport ? "직원 발송 차단" : "선생님 전달 가능")}</div>
                        </td>
                        <td>
                          <span className={getReportExportStatusClass(row.status)}>
                            {exportStatusLabels[row.status] || row.status}
                          </span>
                          {row.status === "failed" && getReportExportFailureReason(row) ? (
                            <div className="notice danger small" style={{ marginTop: 8, maxWidth: 520, whiteSpace: "pre-line" }}>
                              <b>실패 사유</b><br />
                              {getReportExportFailureReason(row)}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <span className={getReportExportFormat(row) === "PDF" ? "badge ok" : "badge"}>
                            {getReportExportFormat(row)}
                          </span>
                        </td>
                        <td>
                          {pageNames || "-"}
                          {pages.monthCount ? <div className="muted">최근 {pages.monthCount}개월</div> : null}
                        </td>
                        <td>
                          <div className="row-actions wrap">
                            {row.file_url ? (
                              <button className="btn secondary" onClick={() => openReportExport(row.id)}>{getReportExportOpenLabel(row)}</button>
                            ) : (
                              <span className="muted">저장본 없음</span>
                            )}
                            {row.status !== "printed" && row.status !== "failed" && (
                              <button className="btn soft" onClick={() => updateReportExportStatus(row.id, "printed")}>출력 완료 표시</button>
                            )}
                            {row.status !== "archived" && (
                              <button className="btn danger" onClick={() => updateReportExportStatus(row.id, "archived")}>보관 처리</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={8}>아직 출력 이력이 없습니다. 결과지 생성 탭에서 [PDF 자동 생성/저장] 또는 [웹 저장본 보관]을 눌러주세요.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}


        </main>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <button className={`stat ${onClick ? "clickable" : ""}`} onClick={onClick} type="button" disabled={!onClick}>
      <div className="muted">{label}</div>
      <div className="num">{value}</div>
    </button>
  );
}

function ListCard({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="card">
      <h2 className="h2">{title}</h2>
      {rows.length ? rows.map((row) => <div key={row} style={{ padding: "8px 0", borderBottom: "1px solid #e5e7eb" }}>{row}</div>) : <p className="muted">없음</p>}
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return <div className="notice" style={{ marginTop: 16 }}>{message}</div>;
}

function Bar({
  label,
  value,
  max,
  suffix,
  highlight = false,
  tone = "score"
}: {
  label: string;
  value: number;
  max: number;
  suffix: string;
  highlight?: boolean;
  tone?: "score" | "withdrawal";
}) {
  const width = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div className={`bar-row ${highlight ? "highlight" : ""} ${tone === "withdrawal" ? "withdrawal" : ""}`}>
      <div className="bar-label">{label}</div>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${width}%` }} /></div>
      <div className="bar-value">{formatScore(value)}{suffix}</div>
    </div>
  );
}

function ReportKpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="report-kpi">
      <span>{label}</span>
      <b>{value}</b>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function ReportFooter({ period, teacher }: { period: any; teacher: any }) {
  return (
    <div className="report-footer">
      <span className="report-footer-brand">
        <img className="report-footer-logo" src="/academy-logo.png" alt="목동유쌤영어학원" />
        <span>목동유쌤영어학원 · e강의평가 결과 리포트</span>
      </span>
      <span>e강의평가 · {teacher?.name} 선생님 · {APP_VERSION}</span>
    </div>
  );
}

function chunkArray(items: any[], size: number) {
  const chunks: any[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function TeacherReport({
  period,
  periods,
  teacher,
  classScores,
  responses,
  evaluationRanking,
  withdrawalRanking,
  metric,
  questions,
  classes,
  classMappings,
  reportPages,
  monthCount,
  reportTemplate = "teacher"
}: any) {
  const teacherQuestions = questions.filter((q: any) => q.category === "teacher" && q.question_type === "scale_5");
  const goodCode = "teacher_good_comment";
  const badCode = "teacher_bad_comment";
  const includePage = (key: string) => key === "coverPage" ? reportPages?.coverPage === true : reportPages?.[key] !== false;
  const isInternalReport = reportTemplate === "internal";
  const isSummaryReport = reportTemplate === "summary";
  const reportAudienceLabel = isInternalReport ? "원장 내부 확인용" : isSummaryReport ? "간단 요약형" : "선생님 배포용";
  const trendColors = ["#2563eb", "#f97316", "#10b981", "#8b5cf6"];
  const trendColor = (index: number) => trendColors[index % trendColors.length];

  const sortedPeriods = [...(periods || [])].sort((a: any, b: any) => String(a.year_month || "").localeCompare(String(b.year_month || "")));
  const selectedPeriodIndex = sortedPeriods.findIndex((p: any) => p.id === period?.id);
  const endIndex = selectedPeriodIndex >= 0 ? selectedPeriodIndex : sortedPeriods.length - 1;
  const count = Number(monthCount || 3);
  const recentPeriods = endIndex >= 0 ? sortedPeriods.slice(Math.max(0, endIndex - count + 1), endIndex + 1) : [];
  const recentPeriodIds = new Set(recentPeriods.map((p: any) => p.id));

  const comments = responses.flatMap((response: any) => {
    return (response.evaluation_answers || [])
      .map((answer: any) => ({
        responseId: response.id,
        className: response.classes?.name || "반 미지정",
        code: answer.evaluation_questions?.code,
        text: answer.text_value
      }))
      .filter((x: any) => x.text);
  });

  const goodComments = comments.filter((c: any) => c.code === goodCode).map((c: any) => c.text);
  const badComments = comments.filter((c: any) => c.code === badCode).map((c: any) => c.text);

  const activeMappings = (classMappings || []).filter((mapping: any) => mapping.is_active !== false && mapping.from_class_id && mapping.to_class_id);
  const bidirectionalMappings = activeMappings.filter((mapping: any) => (mapping.direction_mode || (mapping.bidirectional === false ? "oneway" : "bidirectional")) !== "oneway");
  const oneWayMappings = activeMappings.filter((mapping: any) => (mapping.direction_mode || (mapping.bidirectional === false ? "oneway" : "bidirectional")) === "oneway");
  const classById = new Map<string, any>((classes || []).map((classItem: any) => [classItem.id, classItem]));
  const mappingParent = new Map<string, string>();
  const ensureMappingNode = (classId: string) => {
    if (classId && !mappingParent.has(classId)) mappingParent.set(classId, classId);
  };
  const findMappingRoot = (classId: string): string => {
    ensureMappingNode(classId);
    const parent = mappingParent.get(classId) || classId;
    if (parent === classId) return classId;
    const root = findMappingRoot(parent);
    mappingParent.set(classId, root);
    return root;
  };
  const unionMappingPair = (fromClassId: string, toClassId: string) => {
    if (!fromClassId || !toClassId) return;
    const fromRoot = findMappingRoot(fromClassId);
    const toRoot = findMappingRoot(toClassId);
    if (fromRoot !== toRoot) mappingParent.set(fromRoot, toRoot);
  };
  for (const mapping of bidirectionalMappings) {
    unionMappingPair(String(mapping.from_class_id || ""), String(mapping.to_class_id || ""));
  }
  const preferredClassByRoot = new Map<string, string>();
  for (const mapping of bidirectionalMappings) {
    const toClassId = String(mapping.to_class_id || "");
    if (!toClassId) continue;
    preferredClassByRoot.set(findMappingRoot(toClassId), toClassId);
  }
  const bidirectionalCanonicalClassId = (classId: any) => {
    const id = String(classId || "");
    if (!id) return "";
    const root = mappingParent.has(id) ? findMappingRoot(id) : id;
    return preferredClassByRoot.get(root) || root || id;
  };
  const oneWayClassMap = new Map<string, string>();
  for (const mapping of oneWayMappings) {
    const fromClassId = bidirectionalCanonicalClassId(mapping.from_class_id);
    const toClassId = bidirectionalCanonicalClassId(mapping.to_class_id);
    if (fromClassId && toClassId && fromClassId !== toClassId) oneWayClassMap.set(fromClassId, toClassId);
  }
  const canonicalClassId = (classId: any) => {
    let current = bidirectionalCanonicalClassId(classId);
    if (!current) return "";
    const visited = new Set<string>();
    for (let index = 0; index < 10; index += 1) {
      if (visited.has(current)) break;
      visited.add(current);
      const next = oneWayClassMap.get(current);
      if (!next || next === current) break;
      current = bidirectionalCanonicalClassId(next);
    }
    return current;
  };
  const canonicalClassName = (classId: any, fallback: string) => {
    const id = canonicalClassId(classId);
    return classById.get(id)?.name || fallback || "반 미지정";
  };

  const classMappingLegendItems = activeMappings.map((mapping: any) => {
    const fromName = classById.get(String(mapping.from_class_id || ""))?.name || "이전반";
    const toName = classById.get(String(mapping.to_class_id || ""))?.name || "기준반";
    const directionMode = mapping.direction_mode || (mapping.bidirectional === false ? "oneway" : "bidirectional");
    const isBidirectional = directionMode !== "oneway";
    return {
      id: mapping.id || `${mapping.from_class_id}-${mapping.to_class_id}-${directionMode}`,
      label: `${fromName} ${isBidirectional ? "↔" : "→"} ${toName}`,
      modeLabel: isBidirectional ? "양방향" : "단방향"
    };
  });

  const scoreRows = (classScores || [])
    .filter((row: any) => recentPeriodIds.has(row.evaluation_period_id))
    .map((row: any) => ({
      ...row,
      canonical_class_id: canonicalClassId(row.class_id),
      canonical_class_name: canonicalClassName(row.class_id, row.class_name || "반 미지정")
    }));

  const classNamesForScores = Array.from(new Set(scoreRows.map((row: any) => row.canonical_class_name || "반 미지정"))).sort((a: any, b: any) => String(a).localeCompare(String(b), "ko"));

  const responsesWithClassGroup = (responses || []).map((response: any) => ({
    ...response,
    canonical_class_id: canonicalClassId(response.class_id),
    canonical_class_name: canonicalClassName(response.class_id, response.classes?.name || "반 미지정")
  }));

  const classNamesForResponses = Array.from(new Set(responsesWithClassGroup.map((r: any) => r.canonical_class_name || "반 미지정"))).sort((a: any, b: any) => String(a).localeCompare(String(b), "ko"));

  const trendClassCount = Math.max(1, classNamesForScores.length);
  const trendColumns =
    trendClassCount <= 4 ? 4 :
    trendClassCount <= 6 ? 6 :
    trendClassCount <= 8 ? 8 :
    trendClassCount <= 10 ? 5 : 6;
  const trendBarHeight =
    trendClassCount <= 4 ? "70mm" :
    trendClassCount <= 6 ? "60mm" :
    trendClassCount <= 8 ? "52mm" :
    trendClassCount <= 10 ? "38mm" : "30mm";
  const responseChunkSize = 10;

  const scoreFor = (className: string, periodId: string) => {
    const matchingRows = scoreRows.filter((item: any) => (item.canonical_class_name || "반 미지정") === className && item.evaluation_period_id === periodId);
    if (!matchingRows.length) return null;
    const values = matchingRows.map((row: any) => Number(row.avg_score_100)).filter((value: number) => Number.isFinite(value));
    return average(values);
  };

  const answerScore = (response: any, questionCode: string) => {
    const answer = (response.evaluation_answers || []).find((a: any) => a.evaluation_questions?.code === questionCode);
    const value = Number(answer?.score_value);
    return Number.isFinite(value) ? value : null;
  };

  const withdrawalMax = Math.max(
    20,
    ...withdrawalRanking.map((row: any) => Number(row.withdrawal_rate_percent || 0)).filter((value: number) => Number.isFinite(value))
  );

  const currentScoreRows = scoreRows.filter((row: any) => row.evaluation_period_id === period?.id);
  const currentTeacherScore = average(currentScoreRows.map((row: any) => Number(row.avg_score_100)).filter((value: number) => Number.isFinite(value)));
  const submittedClassCount = new Set(responsesWithClassGroup.map((response: any) => response.canonical_class_id || response.canonical_class_name)).size;
  const responseCount = responsesWithClassGroup.length;
  const teacherRankMap = buildNumericRankMap(evaluationRanking || [], (row: any) => row.avg_score_100, "desc");
  const withdrawalRankMapForReport = buildNumericRankMap(withdrawalRanking || [], (row: any) => row.withdrawal_rate_percent, "asc");
  const teacherRank = teacherRankMap.get(teacher.id) || null;
  const withdrawalRank = withdrawalRankMapForReport.get(teacher.id) || null;
  const pageCount = [
    includePage("coverPage"),
    includePage("scoreTable"),
    includePage("responseTable"),
    includePage("evaluationRanking"),
    includePage("withdrawalRanking")
  ].filter(Boolean).length;

  return (
    <div className="teacher-report" style={{ marginTop: 18 }}>
      {includePage("coverPage") && (
        <div className="report-page report-cover-page">
          <ReportAcademyBrand />
          <div className="report-cover-hero" style={{ marginTop: 18 }}>
            <div>
              <div className="report-kicker">e강의평가</div>
              <h1 className="report-cover-title">{teacher.name} 선생님<br />강의평가 결과 리포트</h1>
              <p className="report-cover-subtitle">{period?.title || monthLabel(period?.year_month)} · {reportAudienceLabel}</p>
            </div>
            <div className="report-cover-badge">
              <span>PRIVATE</span>
              <b>익명 결과지</b>
            </div>
          </div>

          <div className="report-kpi-grid cover-kpis">
            <ReportKpi label="응답 수" value={`${responseCount}건`} note="학생 이름 미표시" />
            <ReportKpi label="응답 반" value={`${submittedClassCount}개`} note="1건 이상 응답 반" />
            <ReportKpi label="강의평가 평점" value={currentTeacherScore === null ? "-" : `${formatScore(currentTeacherScore)}점`} note="선생님 문항 5개 기준" />
            <ReportKpi label="전체 순위" value={teacherRank ? `${teacherRank}위` : "-"} note="타 선생님 이름 마스킹" />
          </div>

          <div className="report-cover-section-grid">
            <div className="report-cover-section">
              <b>포함 페이지</b>
              <ol>
                {includePage("scoreTable") && <li>반별 최근 {count}개월 평가점수 트렌드</li>}
                {includePage("responseTable") && <li>반별 항목별 평균표</li>}
                {includePage("evaluationRanking") && <li>해당월 전체 선생님 강의평가 등수</li>}
                {includePage("withdrawalRanking") && <li>해당월 전체 선생님 퇴원율 등수</li>}
              </ol>
            </div>
            <div className="report-cover-section">
              <b>개인정보 처리 기준</b>
              <p>{isInternalReport ? "본 결과지는 원장 내부 확인용입니다. 학생 이름은 포함하지 않지만, 전체 선생님 순위에서는 실명을 표시할 수 있습니다." : "본 결과지는 선생님 배포용입니다. 학생 이름, 제출 시각, 관리자 검토 메모, 내부 ID는 포함하지 않습니다. 타 선생님 이름은 선생님 위치 확인용으로 마스킹됩니다."}</p>
            </div>
          </div>

          <ReportFooter period={period} teacher={teacher} />
        </div>
      )}

      {includePage("scoreTable") && (
        <div className="report-page report-page-score">
          <div className="report-page-header report-page-header-designed">
            <div>
              <div className="report-kicker">Page · Trend</div>
              <h1 className="h1">{teacher.name} 선생님</h1>
              <p className="muted">{period?.title} · 평가월 포함 최근 {count}개월 반별 강의평가 점수 트렌드</p>
            </div>
            <div className="report-meta">
              <b>출력 기준</b>
              <br />{recentPeriods.map((p: any) => monthLabel(p.year_month)).join(" · ") || "-"}
            </div>
          </div>

          <div className="report-kpi-grid">
            <ReportKpi label="해당월 평점" value={currentTeacherScore === null ? "-" : `${formatScore(currentTeacherScore)}점`} note="선생님 평가 5문항 평균" />
            <ReportKpi label="응답 수" value={`${responseCount}건`} note="숨김 응답 제외" />
            <ReportKpi label="응답 반" value={`${submittedClassCount}개`} note="1건 이상 응답 반" />
            <ReportKpi label="전체 순위" value={teacherRank ? `${teacherRank}위` : "-"} note="3페이지 기준" />
          </div>

          {classNamesForScores.length ? (
            <div
              className="trend-card designed-trend-card"
              style={{
                "--trend-columns": String(trendColumns),
                "--trend-bar-height": trendBarHeight,
                "--trend-class-count": String(trendClassCount)
              } as any}
            >
              <div className="trend-card-head">
                <div>
                  <h2 className="h2">반별 점수 흐름</h2>
                  <p className="muted">선생님 전체 월 리포트용 반 이름 매칭을 설정한 경우 선택한 방식에 따라 해당 선생님의 모든 월 리포트에서 반 이름을 합산합니다.</p>
                </div>
                <div className="trend-legend-stack">
                  <div className="trend-legend">
                    {recentPeriods.map((p: any, index: number) => (
                      <span key={p.id} className="trend-legend-item">
                        <i style={{ backgroundColor: trendColor(index) }} />
                        {monthLabel(p.year_month)}
                      </span>
                    ))}
                  </div>
                  {classMappingLegendItems.length ? (
                    <div className="trend-mapping-legend">
                      <b>반 매칭</b>
                      {classMappingLegendItems.map((item: any) => (
                        <span key={item.id}>{item.label} <small>{item.modeLabel}</small></span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="trend-axis-labels" aria-hidden="true">
                <span>100</span><span>90</span><span>80</span><span>70</span><span>60</span><span>50</span>
              </div>

              <div className="trend-chart" aria-label="최근 평가 점수 트렌드 그래프">
                {classNamesForScores.map((className: any) => {
                  const classValues = recentPeriods.map((p: any) => scoreFor(className, p.id)).filter((value: any) => value !== null) as number[];
                  const classAvg = average(classValues);
                  return (
                    <div className="trend-group" key={className}>
                      <div className="trend-bars">
                        {recentPeriods.map((p: any, index: number) => {
                          const value = scoreFor(className, p.id);
                          const visualValue = value === null ? null : Math.max(50, Math.min(100, Number(value)));
                          const barHeight = visualValue === null ? 0 : Math.max(4, ((visualValue - 50) / 50) * 100);
                          return (
                            <div className="trend-bar-column" key={p.id}>
                              <div className="trend-value">{visualValue === null ? "-" : formatScore(visualValue)}</div>
                              <div className="trend-bar-shell">
                                <div
                                  className="trend-bar"
                                  style={{
                                    height: `${barHeight}%`,
                                    backgroundColor: trendColor(index)
                                  }}
                                />
                              </div>
                              <div className="trend-month">{monthLabel(p.year_month)}</div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="trend-class-name">{className}</div>
                      <div className="trend-class-average">평균 {classAvg === null ? "-" : formatScore(classAvg)}점</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <Empty message="반별 점수 데이터가 없습니다." />
          )}

          <p className="muted report-footnote">
            기준 문항: 설명 이해도, 적극적 도움, 과제량 적절성, 과제 피드백, 학생 관심도 · 학생 이름은 결과지에 표시하지 않습니다.
          </p>
          <ReportFooter period={period} teacher={teacher} />
        </div>
      )}

      {includePage("responseTable") && (
        <div className="report-page report-page-responses">
          <div className="report-page-header report-page-header-designed">
            <div>
              <div className="report-kicker">Page · Average Table</div>
              <h1 className="h1">반별 항목별 평균표</h1>
              <p className="muted">{teacher.name} 선생님 · {period?.title} · 개별 학생 응답은 표시하지 않고 항목별 해당월 평균만 표시합니다.</p>
            </div>
            <div className="report-meta">
              <b>응답 수</b>
              <br />{responses.length}건
            </div>
          </div>

          {classNamesForResponses.map((className: any) => {
            const classResponses = responsesWithClassGroup.filter((r: any) => (r.canonical_class_name || "반 미지정") === className);
            return (
              <div key={className} className="report-response-section">
                <div className="response-section-title">
                  <h2 className="h2">Class: {className}</h2>
                  <span>{classResponses.length}건 응답</span>
                </div>
                <div className="table-wrap report-table-wrap">
                  <table className="report-table report-response-table report-average-only-table">
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>평가 내용</th>
                        <th>{monthLabel(period?.year_month)} AVG</th>
                        <th>응답 수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teacherQuestions.map((q: any, qIndex: number) => {
                        const allScores = classResponses.map((response: any) => answerScore(response, q.code)).filter((value: any) => value !== null) as number[];
                        const avg = average(allScores);
                        return (
                          <tr key={q.id}>
                            <td>{qIndex + 1}</td>
                            <td>{q.title.replace("{teacher_name}", teacher.name)}</td>
                            <td><b>{avg === null ? "-" : formatScore(avg)}</b></td>
                            <td>{allScores.length}건</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {!classNamesForResponses.length && <Empty message="응답 데이터가 없습니다." />}

          <p className="muted report-footnote">
            선생님 전달용 리포트에는 개별 학생 응답과 서술형 원문을 표시하지 않습니다. 학생별 실명 응답 현황과 원문 코멘트는 원장 내부 확인용 리포트에서 확인합니다.
          </p>
          <ReportFooter period={period} teacher={teacher} />
        </div>
      )}

      {includePage("evaluationRanking") && (
        <div className="report-page report-page-ranking">
          <div className="report-page-header report-page-header-designed">
            <div>
              <div className="report-kicker">Page · Ranking</div>
              <h1 className="h1">{monthLabel(period?.year_month)} 강의평가 등수</h1>
              <p className="muted">전체 선생님 중 해당 선생님의 위치를 확인합니다. 타 선생님 이름은 가려집니다.</p>
            </div>
            <div className="report-meta">
              <b>선생님 위치</b>
              <br />{teacherRank ? `${teacherRank}위` : "-"}
            </div>
          </div>
          <div className="ranking-card">
            {evaluationRanking.map((row: any, index: number) => (
              <Bar
                key={row.teacher_id}
                label={`${teacherRankMap.get(row.teacher_id) || index + 1}위 · ${maskTeacherName(row.teacher_name, isInternalReport || row.teacher_id === teacher.id)}`}
                value={Number(row.avg_score_100 || 0)}
                max={100}
                suffix="점"
                highlight={row.teacher_id === teacher.id}
              />
            ))}
          </div>
          {!evaluationRanking.length && <Empty message="강의평가 등수 데이터가 없습니다." />}
          <ReportFooter period={period} teacher={teacher} />
        </div>
      )}

      {includePage("withdrawalRanking") && (
        <div className="report-page report-page-withdrawal">
          <div className="report-page-header report-page-header-designed">
            <div>
              <div className="report-kicker">Page · Retention</div>
              <h1 className="h1">{monthLabel(period?.year_month)} 퇴원율 등수</h1>
              <p className="muted">퇴원율은 낮은 순으로 정렬합니다. 현재 버전에서는 관리자가 직접 입력한 확정값을 사용합니다.</p>
            </div>
            <div className="report-meta">
              <b>선생님 위치</b>
              <br />{withdrawalRank ? `${withdrawalRank}위` : "-"}
            </div>
          </div>
          <div className="ranking-card withdrawal-card">
            {withdrawalRanking.map((row: any, index: number) => (
              <Bar
                key={row.teacher_id}
                label={`${withdrawalRankMapForReport.get(row.teacher_id) || index + 1}위 · ${maskTeacherName(row.teacher_name, isInternalReport || row.teacher_id === teacher.id)}`}
                value={Number(row.withdrawal_rate_percent || 0)}
                max={withdrawalMax}
                suffix="%"
                highlight={row.teacher_id === teacher.id}
                tone="withdrawal"
              />
            ))}
          </div>
          {!withdrawalRanking.length && <Empty message="퇴원율 등수 데이터가 없습니다. 먼저 퇴원율 입력 탭에서 값을 저장해주세요." />}
          <ReportFooter period={period} teacher={teacher} />
        </div>
      )}
    </div>
  );
}


function InternalReport({
  period,
  teachers,
  responses,
  evaluationRanking,
  withdrawalRanking,
  questions,
  metrics,
  periods,
  monthlyScores,
  reportPages
}: any) {
  const includePage = (key: string) => key === "coverPage" ? reportPages?.coverPage === true : reportPages?.[key] !== false;
  const teacherScaleQuestions = (questions || []).filter((q: any) => q.category === "teacher" && q.question_type === "scale_5");
  const nonTeacherScaleQuestions = (questions || []).filter((q: any) => q.category !== "teacher" && q.question_type === "scale_5");
  const pressureQuestion = (questions || []).find((q: any) => q.code === "pressure_or_reward");

  const responseList = responses || [];
  const teacherList = (teachers || []).filter((teacher: any) => teacher.is_active !== false);
  const currentScores = evaluationRanking || [];
  const periodId = period?.id || "";
  const pressureResponses = responseList.filter((response: any) => hasPressureFlag(response));
  const flaggedResponses = responseList.filter((response: any) => response.is_flagged || response.is_duplicate_suspected || hasPressureFlag(response));

  const sortedPeriods = [...(periods || [])].sort((a: any, b: any) => String(a.year_month || "").localeCompare(String(b.year_month || "")));
  const currentPeriodIndex = sortedPeriods.findIndex((item: any) => item.id === periodId);
  const previousPeriod = currentPeriodIndex > 0 ? sortedPeriods[currentPeriodIndex - 1] : null;

  const teacherMap = new Map<string, any>((teacherList || []).map((teacher: any) => [teacher.id, teacher]));
  const scoreRankMap = buildNumericRankMap(currentScores || [], (row: any) => row.avg_score_100, "desc");
  const withdrawalRankMap = buildNumericRankMap(withdrawalRanking || [], (row: any) => row.withdrawal_rate_percent, "asc");

  const scoreForTeacher = (teacherId: string) => {
    const row = currentScores.find((item: any) => item.teacher_id === teacherId);
    const value = Number(row?.avg_score_100);
    return Number.isFinite(value) ? value : null;
  };

  const previousScoreForTeacher = (teacherId: string) => {
    if (!previousPeriod?.id) return null;
    const row = (monthlyScores || []).find((item: any) => item.teacher_id === teacherId && item.evaluation_period_id === previousPeriod.id);
    const value = Number(row?.avg_score_100);
    return Number.isFinite(value) ? value : null;
  };

  const previousScoreRows = previousPeriod?.id
    ? (monthlyScores || [])
        .filter((item: any) => item.evaluation_period_id === previousPeriod.id)
        .map((item: any) => ({ teacher_id: item.teacher_id, score: Number(item.avg_score_100) }))
        .filter((item: any) => Number.isFinite(item.score))
        .sort((a: any, b: any) => Number(b.score) - Number(a.score))
    : [];
  const previousScoreRankMap = buildNumericRankMap(previousScoreRows, (row: any) => row.score, "desc");

  const teacherResponses = (teacherId: string) => responseList.filter((response: any) => response.teacher_id === teacherId);

  const answerScoreByCode = (response: any, questionCode: string) => {
    const answer = getAnswerByCode(response, questionCode);
    const value = Number(answer?.score_value);
    return Number.isFinite(value) ? value : null;
  };

  const questionTitle = (question: any, teacherName = "선생님") => String(question?.title || question?.code || "서술형 응답").replaceAll("{teacher_name}", teacherName);

  const nonTeacherSummaryRows = nonTeacherScaleQuestions.map((q: any) => {
    const values = responseList.map((response: any) => answerScoreByCode(response, q.code)).filter((value: any) => value !== null) as number[];
    return {
      code: q.code,
      title: questionTitle(q),
      avg: average(values),
      count: values.length
    };
  });

  const studentResponseRows = responseList.map((response: any) => {
    const teacherScores = teacherScaleQuestions.map((q: any) => ({
      code: q.code,
      title: questionTitle(q, response.teachers?.name || teacherMap.get(response.teacher_id)?.name || "선생님"),
      score: answerScoreByCode(response, q.code)
    }));
    const teacherValues = teacherScores.map((item: any) => item.score).filter((value: any) => value !== null) as number[];
    const commonValues = nonTeacherScaleQuestions.map((q: any) => answerScoreByCode(response, q.code)).filter((value: any) => value !== null) as number[];
    return {
      id: response.id,
      teacherId: response.teacher_id || "unassigned",
      studentName: response.student_name || "학생명 미입력",
      teacherName: response.teachers?.name || teacherMap.get(response.teacher_id)?.name || "선생님 미지정",
      className: response.classes?.name || "반 미지정",
      teacherScores,
      teacherAvg: average(teacherValues),
      commonAvg: average(commonValues),
      pressure: hasPressureFlag(response) ? "예" : "아니오",
      submittedAt: response.submitted_at || response.created_at
    };
  }).sort((a: any, b: any) => {
    const teacherCompare = String(a.teacherName || "").localeCompare(String(b.teacherName || ""), "ko");
    if (teacherCompare !== 0) return teacherCompare;
    const classCompare = String(a.className || "").localeCompare(String(b.className || ""), "ko");
    if (classCompare !== 0) return classCompare;
    return String(a.studentName || "").localeCompare(String(b.studentName || ""), "ko");
  });

  const studentResponseSections = Array.from(studentResponseRows.reduce((map: Map<string, any>, row: any) => {
    const key = row.teacherId || row.teacherName || "unassigned";
    const existing = map.get(key) || { teacherId: key, teacherName: row.teacherName || "선생님 미지정", rows: [] };
    existing.rows.push(row);
    map.set(key, existing);
    return map;
  }, new Map<string, any>()).values()).sort((a: any, b: any) => String(a.teacherName || "").localeCompare(String(b.teacherName || ""), "ko"));

  const pressureYesCount = pressureResponses.length;
  const pressureNoCount = responseList.filter((response: any) => getAnswerByCode(response, "pressure_or_reward")?.boolean_value === false).length;
  const overallCommonScore = average(nonTeacherSummaryRows.map((row: any) => row.avg).filter((value: any) => value !== null));
  const overallTeacherScore = average((currentScores || []).map((row: any) => Number(row.avg_score_100)).filter((value: number) => Number.isFinite(value)));
  const lowestCommonRows = [...nonTeacherSummaryRows].filter((row: any) => row.avg !== null).sort((a: any, b: any) => Number(a.avg) - Number(b.avg)).slice(0, 3);

  const withdrawalMax = Math.max(
    20,
    ...(withdrawalRanking || []).map((row: any) => Number(row.withdrawal_rate_percent || 0)).filter((value: number) => Number.isFinite(value))
  );

  const formatDelta = (current: number | null, previous: number | null) => {
    if (current === null || previous === null) return "-";
    const delta = current - previous;
    const sign = delta > 0 ? "+" : "";
    return `${sign}${formatScore(delta)}점`;
  };

  const formatRankDelta = (currentRank: number | null, previousRank: number | null) => {
    if (!currentRank || !previousRank) return "-";
    const delta = previousRank - currentRank;
    if (delta === 0) return "변동 없음";
    return delta > 0 ? `▲ ${delta}계단` : `▼ ${Math.abs(delta)}계단`;
  };

  const withdrawalRateForTeacher = (teacherId: string) => {
    const metric = (metrics || []).find((row: any) => row.teacher_id === teacherId && (!periodId || row.evaluation_period_id === periodId));
    const rankingRow = (withdrawalRanking || []).find((row: any) => row.teacher_id === teacherId);
    const value = Number(metric?.withdrawal_rate_percent ?? rankingRow?.withdrawal_rate_percent);
    return Number.isFinite(value) ? value : null;
  };

  const scoreStatus = (score: number | null) => {
    if (score === null) return "응답 없음";
    if (score < 70) return "집중 점검";
    if (score < 80) return "개선 필요";
    if (score < 90) return "확인 필요";
    return "양호";
  };

  const relationMemo = (score: number | null, withdrawalRate: number | null) => {
    if (score === null && withdrawalRate === null) return "데이터 부족";
    if (score !== null && score < 80 && withdrawalRate !== null && withdrawalRate > 5) return "만족도·퇴원율 동시 점검";
    if (score !== null && score >= 80 && withdrawalRate !== null && withdrawalRate > 5) return "수업 외 이탈 요인 확인";
    if (score !== null && score < 80 && withdrawalRate !== null && withdrawalRate <= 5) return "만족도 개선 우선";
    if (withdrawalRate !== null && withdrawalRate > 5) return "퇴원율 집중 점검";
    if (score !== null && score < 80) return "강의평가 개선 필요";
    if (withdrawalRate === null) return "퇴원율 미입력";
    return "재원 안정권";
  };

  const stabilityMemo = (score: number | null, withdrawalRate: number | null) => {
    if (score === null && withdrawalRate === null) return "데이터 부족";
    if (score !== null && score < 80 && withdrawalRate !== null && withdrawalRate > 5) return "강의평가와 퇴원율 모두 집중 점검";
    if (score !== null && score >= 80 && withdrawalRate !== null && withdrawalRate > 5) return "수업 만족도 대비 이탈 원인 확인";
    if (withdrawalRate !== null && withdrawalRate > 5) return "퇴원율 집중 점검";
    if (score !== null && score < 80) return "강의평가 개선 필요";
    if (withdrawalRate === null) return "퇴원율 미입력";
    return "재원 안정권";
  };

  const teacherSummaryRows = teacherList.map((teacher: any) => {
    const rows = teacherResponses(teacher.id);
    const score = scoreForTeacher(teacher.id);
    const previousScore = previousScoreForTeacher(teacher.id);
    const withdrawalRate = withdrawalRateForTeacher(teacher.id);
    const classCount = new Set(rows.map((response: any) => response.class_id || response.classes?.name || "반 미지정")).size;
    const scoreRow = currentScores.find((item: any) => item.teacher_id === teacher.id);
    const scoreRank = scoreRankMap.get(teacher.id) || null;
    const previousScoreRank = previousScoreRankMap.get(teacher.id) || null;
    return {
      teacher,
      responseCount: rows.length,
      classCount,
      score,
      previousScore,
      scoreDelta: score !== null && previousScore !== null ? score - previousScore : null,
      withdrawalRate,
      scoreRank,
      previousScoreRank,
      rankDelta: scoreRank && previousScoreRank ? previousScoreRank - scoreRank : null,
      withdrawalRank: withdrawalRankMap.get(teacher.id) || null,
      scoreStatus: scoreStatus(score),
      relationMemo: relationMemo(score, withdrawalRate),
      stabilityMemo: stabilityMemo(score, withdrawalRate),
      rankingResponseCount: scoreRow?.response_count
    };
  });

  const evaluationRows = [...teacherSummaryRows].sort((a: any, b: any) => {
    if (a.score === null && b.score === null) return String(a.teacher.name || "").localeCompare(String(b.teacher.name || ""), "ko");
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return Number(b.score) - Number(a.score);
  });

  const stabilityRows = [...teacherSummaryRows].sort((a: any, b: any) => {
    if (a.withdrawalRate === null && b.withdrawalRate === null) return String(a.teacher.name || "").localeCompare(String(b.teacher.name || ""), "ko");
    if (a.withdrawalRate === null) return 1;
    if (b.withdrawalRate === null) return -1;
    return Number(a.withdrawalRate) - Number(b.withdrawalRate);
  });

  const highScoreCutoff = 80;
  const lowScoreCutoff = 80;
  const highWithdrawalCutoff = 5;
  const withdrawalComparisonRows = stabilityRows.filter((row: any) => row.withdrawalRate !== null);
  const withdrawalComparisonMax = Math.max(
    10,
    ...withdrawalComparisonRows.map((row: any) => Number(row.withdrawalRate || 0)).filter((value: number) => Number.isFinite(value))
  );
  const withdrawalAverageRate = average(withdrawalComparisonRows.map((row: any) => Number(row.withdrawalRate || 0)).filter((value: number) => Number.isFinite(value)));
  const stableTeacherCount = withdrawalComparisonRows.filter((row: any) => Number(row.withdrawalRate) <= 5).length;

  const normalizeCommentText = (text: string) => String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  const includesAny = (haystack: string, keywords: string[]) => keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));

  const commentCategoryLabel = (question: any) => {
    const code = String(question?.code || "").toLowerCase();
    const title = String(question?.title || "").toLowerCase();
    const category = String(question?.category || "").toLowerCase();
    const appliesTo = String(question?.applies_to || "").toLowerCase();
    const questionMeta = `${code} ${title} ${category} ${appliesTo}`;

    if (code === "teacher_good_comment" || includesAny(questionMeta, ["좋은 점", "좋았던", "만족한", "도움된", "장점"])) return "선생님 좋은 점";
    if (code === "teacher_bad_comment" || includesAny(questionMeta, ["아쉬운 점", "아쉬웠던", "불편했던", "개선", "보완", "단점"])) return "선생님 아쉬운 점";
    if (includesAny(questionMeta, ["clinic", "클리닉", "보충", "질문", "질의", "오답", "재시험", "보강", "피드백"])) return "클리닉";
    if (includesAny(questionMeta, ["facility", "시설", "환경", "자리", "책상", "의자", "화장실", "에어컨", "냉방", "난방", "교실"])) return "시설/환경";
    if (includesAny(questionMeta, ["class_time", "수업 시간", "수업시간", "시간", "요일", "일정", "스케줄"])) return "수업 시간";
    if (includesAny(questionMeta, ["suggestion", "건의", "요청", "희망", "추가", "부탁", "바라는"])) return "학원 건의";
    if (appliesTo === "academy" || category === "academy" || includesAny(questionMeta, ["학원", "운영", "관리", "시스템"])) return "학원 운영";
    if (appliesTo === "teacher" || code.startsWith("teacher_") || includesAny(questionMeta, ["선생님", "강사"])) return "선생님 기타";
    return "기타 서술형";
  };

  const isTeacherComment = (question: any) => {
    const code = String(question?.code || "");
    return question?.applies_to === "teacher" || code.startsWith("teacher_") || code === "teacher_good_comment" || code === "teacher_bad_comment";
  };

  const isPriorityCommentCategory = (_label: string) => false;

  const textComments: any[] = [];
  for (const response of responseList) {
    const teacherName = response.teachers?.name || teacherMap.get(response.teacher_id)?.name || "선생님 미지정";
    const className = response.classes?.name || "반 미지정";
    for (const answer of response.evaluation_answers || []) {
      const text = String(answer.text_value || "").trim();
      if (!text) continue;
      const question = answer.evaluation_questions || {};
      const categoryLabel = commentCategoryLabel(question);
      textComments.push({
        id: `${response.id}-${answer.id || question.code || textComments.length}`,
        teacherId: response.teacher_id,
        teacherName,
        className,
        studentName: response.student_name || "학생명 미입력",
        submittedAt: response.submitted_at || response.created_at,
        questionTitle: questionTitle(question, teacherName),
        categoryLabel,
        isTeacherRelated: isTeacherComment(question),
        isPriority: isPriorityCommentCategory(categoryLabel),
        text
      });
    }
  }

  const stopwords = new Set(["합니다", "해주세요", "있어요", "없어요", "너무", "정말", "조금", "그리고", "그냥", "같아요", "있으면", "있어서", "없는", "있는", "하면", "해서", "것", "수", "더", "좀", "잘", "선생님", "학원", "수업", "입니다", "같습니다", "부분", "생각", "때문", "많이", "항상"]);
  const buildKeywordRows = (comments: any[], limit = 12) => {
    const keywordCount = new Map<string, number>();
    for (const comment of comments) {
      const tokens = String(comment.text || "").toLowerCase().replace(/[^가-힣a-z0-9\s]/g, " ").split(/\s+/).map((token) => token.trim()).filter(Boolean);
      for (const token of tokens) {
        if (token.length < 2 || stopwords.has(token)) continue;
        keywordCount.set(token, (keywordCount.get(token) || 0) + 1);
      }
    }
    return Array.from(keywordCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
  };

  const groupedComments = new Map<string, any[]>();
  for (const comment of textComments) {
    const rows = groupedComments.get(comment.categoryLabel) || [];
    rows.push(comment);
    groupedComments.set(comment.categoryLabel, rows);
  }
  const commentGroupOrder = ["선생님 좋은 점", "선생님 아쉬운 점", "선생님 기타", "클리닉", "시설/환경", "수업 시간", "학원 건의", "학원 운영", "기타 서술형"];
  const commentGroupLabels = [
    ...commentGroupOrder.filter((label) => groupedComments.has(label)),
    ...Array.from(groupedComments.keys()).filter((label) => !commentGroupOrder.includes(label)).sort((a, b) => a.localeCompare(b, "ko"))
  ];
  const commentGroups = commentGroupLabels.map((label) => {
    const rows = groupedComments.get(label) || [];
    return {
      label,
      rows,
      keywords: buildKeywordRows(rows, 4)
    };
  });
  const teacherCommentCount = textComments.filter((comment) => comment.isTeacherRelated).length;
  const academyCommentCount = textComments.length - teacherCommentCount;
  const keywordRows = buildKeywordRows(textComments, 14);
  const nonTeacherCommentGroups = commentGroups.filter((group: any) => group.label !== "선생님 좋은 점" && group.label !== "선생님 아쉬운 점");

  const teacherCommentSections = [
    {
      label: "선생님 좋은 점",
      rows: teacherList.map((teacher: any) => ({
        teacher,
        comments: textComments.filter((comment: any) => comment.teacherId === teacher.id && comment.categoryLabel === "선생님 좋은 점")
      })).filter((row: any) => row.comments.length)
    },
    {
      label: "선생님 아쉬운 점",
      rows: teacherList.map((teacher: any) => ({
        teacher,
        comments: textComments.filter((comment: any) => comment.teacherId === teacher.id && comment.categoryLabel === "선생님 아쉬운 점")
      })).filter((row: any) => row.comments.length)
    }
  ];

  const relationRows = teacherSummaryRows.filter((row: any) => row.score !== null && row.withdrawalRate !== null);
  const relationBuckets = [
    {
      label: "만족도 높음 · 퇴원율 높음",
      tone: "warn",
      memo: "수업 외 이탈 요인 확인",
      rows: relationRows.filter((row: any) => Number(row.score) >= highScoreCutoff && Number(row.withdrawalRate) > highWithdrawalCutoff)
    },
    {
      label: "만족도 낮음 · 퇴원율 높음",
      tone: "danger",
      memo: "강의평가와 재원 안정성 동시 점검",
      rows: relationRows.filter((row: any) => Number(row.score) < lowScoreCutoff && Number(row.withdrawalRate) > highWithdrawalCutoff)
    },
    {
      label: "만족도 낮음 · 퇴원율 낮음",
      tone: "watch",
      memo: "퇴원 전환 가능성 사전 관리",
      rows: relationRows.filter((row: any) => Number(row.score) < lowScoreCutoff && Number(row.withdrawalRate) <= highWithdrawalCutoff)
    },
    {
      label: "만족도 높음 · 퇴원율 낮음",
      tone: "ok",
      memo: "현재 안정권",
      rows: relationRows.filter((row: any) => Number(row.score) >= highScoreCutoff && Number(row.withdrawalRate) <= highWithdrawalCutoff)
    }
  ];

  const pearsonCorrelation = (rows: any[]) => {
    if (rows.length < 3) return null;
    const xs = rows.map((row) => Number(row.score));
    const ys = rows.map((row) => Number(row.withdrawalRate));
    const avgX = average(xs);
    const avgY = average(ys);
    if (avgX === null || avgY === null) return null;
    let numerator = 0;
    let xSum = 0;
    let ySum = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const xDiff = xs[i] - avgX;
      const yDiff = ys[i] - avgY;
      numerator += xDiff * yDiff;
      xSum += xDiff * xDiff;
      ySum += yDiff * yDiff;
    }
    const denominator = Math.sqrt(xSum * ySum);
    return denominator ? numerator / denominator : null;
  };
  const scoreWithdrawalCorrelation = pearsonCorrelation(relationRows);
  const correlationLabel = scoreWithdrawalCorrelation === null
    ? "데이터 부족"
    : scoreWithdrawalCorrelation <= -0.4
      ? "점수 하락과 퇴원율 상승 관계가 비교적 큼"
      : scoreWithdrawalCorrelation >= 0.4
        ? "점수가 높아도 퇴원율이 함께 높게 나타남"
        : "뚜렷한 상관은 약함";

  const satisfactionAxisMin = 60;
  const satisfactionAxisMax = 100;
  const withdrawalAxisMin = 0;
  const withdrawalAxisMax = 10;
  const clampAxisValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const retentionScatterRows = relationRows
    .map((row: any) => {
      const score = clampAxisValue(Number(row.score || 0), satisfactionAxisMin, satisfactionAxisMax);
      const withdrawalRate = clampAxisValue(Number(row.withdrawalRate || 0), withdrawalAxisMin, withdrawalAxisMax);
      const x = clampAxisValue(((score - satisfactionAxisMin) / (satisfactionAxisMax - satisfactionAxisMin)) * 100, 6, 94);
      const y = clampAxisValue(((withdrawalAxisMax - withdrawalRate) / (withdrawalAxisMax - withdrawalAxisMin)) * 100, 6, 94);
      const isHighSatisfaction = Number(row.score) >= highScoreCutoff;
      const isLowWithdrawal = Number(row.withdrawalRate) <= highWithdrawalCutoff;
      return {
        ...row,
        plotScore: score,
        plotWithdrawalRate: withdrawalRate,
        x,
        y,
        quadrant: isHighSatisfaction && isLowWithdrawal
          ? "1사분면"
          : !isHighSatisfaction && isLowWithdrawal
            ? "2사분면"
            : !isHighSatisfaction && !isLowWithdrawal
              ? "3사분면"
              : "4사분면",
        quadrantLabel: isHighSatisfaction && isLowWithdrawal
          ? "우수·안정"
          : !isHighSatisfaction && isLowWithdrawal
            ? "만족도 개선"
            : !isHighSatisfaction && !isLowWithdrawal
              ? "집중 점검"
              : "이탈 요인 확인",
        tone: isHighSatisfaction && isLowWithdrawal
          ? "safe"
          : !isHighSatisfaction && !isLowWithdrawal
            ? "danger"
            : !isHighSatisfaction
              ? "watch"
              : "warn"
      };
    })
    .sort((a: any, b: any) => {
      const toneOrder = { safe: 1, warn: 2, watch: 3, danger: 4 } as Record<string, number>;
      const toneDiff = (toneOrder[a.tone] || 99) - (toneOrder[b.tone] || 99);
      if (toneDiff !== 0) return toneDiff;
      return String(a.teacher?.name || "").localeCompare(String(b.teacher?.name || ""), "ko");
    })
    .map((row: any, index: number) => ({
      ...row,
      markerLabel: String(index + 1)
    }));

  const priorityActionItems = [
    ...lowestCommonRows.map((row: any) => `${row.title} 평균 ${formatScore(row.avg)}점: 공통 운영 항목 중 우선 점검`),
    ...(pressureYesCount ? [`강의평가 압박/상품 관련 응답 ${pressureYesCount}건: 응답 공정성 확인`] : []),
    ...(flaggedResponses.length ? [`중복/검토 필요 응답 ${flaggedResponses.length}건: 원문 확인 후 제외 여부 판단`] : []),
    ...relationBuckets.find((bucket) => bucket.tone === "danger")!.rows.slice(0, 3).map((row: any) => `${row.teacher.name} 선생님: 강의평가 ${formatScore(row.score)}점·퇴원율 ${formatScore(row.withdrawalRate)}% 동시 점검`),
    ...relationBuckets.find((bucket) => bucket.tone === "warn")!.rows.slice(0, 3).map((row: any) => `${row.teacher.name} 선생님: 만족도 대비 퇴원율이 높아 수업 외 이탈 원인 확인`),
    ...(teacherCommentCount ? [`선생님 관련 서술형 코멘트 ${teacherCommentCount}건: 좋은 점/아쉬운 점을 선생님별로 확인`] : []),
    ...(academyCommentCount ? [`학원 운영 관련 서술형 코멘트 ${academyCommentCount}건: 클리닉·시설·시간·건의 문항 확인`] : [])
  ].slice(0, 8);

  return (
    <div className="teacher-report internal-report" style={{ marginTop: 18 }}>
      {includePage("coverPage") && (
        <div className="report-page report-cover-page">
          <ReportAcademyBrand />
          <div className="report-cover-hero" style={{ marginTop: 18 }}>
            <div>
              <div className="report-kicker">원장 내부 확인용 · {APP_VERSION}</div>
              <h1 className="report-cover-title">강의평가<br />내부 분석 리포트</h1>
              <p className="report-cover-subtitle">{period?.title || monthLabel(period?.year_month)} · 전체 선생님 실명 기준</p>
            </div>
            <div className="report-cover-badge">
              <span>INTERNAL</span>
              <b>관리자 전용</b>
            </div>
          </div>

          <div className="report-kpi-grid cover-kpis">
            <ReportKpi label="전체 응답 수" value={`${responseList.length}건`} note="숨김 응답 제외" />
            <ReportKpi label="평가 대상 선생님" value={`${teacherList.length}명`} note="사용중 선생님 기준" />
            <ReportKpi label="서술형 코멘트" value={`${textComments.length}건`} note="문항 기준 분류" />
            <ReportKpi label="검토 필요" value={`${flaggedResponses.length}건`} note="압박/중복/관리자 검토 포함" />
          </div>

          <div className="report-cover-section-grid">
            <div className="report-cover-section">
              <b>내부 분석 리포트 구성</b>
              <ol>
                <li>전체 평가 요약: 공통 항목 평균, 응답 흐름, 원장 메모</li>
                <li>선생님별 강의평가 순위: 실명 순위, 점수 변화, 전월 대비 순위 변화</li>
                <li>퇴원율/재원 안정성: 퇴원율과 강의평가 관계 분석</li>
                <li>응답 원문/주요 코멘트: 문항 기준 분류, 반복 키워드, 선생님별 코멘트</li>
              </ol>
            </div>
            <div className="report-cover-section">
              <b>열람 기준</b>
              <p>원장 내부 확인용 리포트는 전체 선생님 이름과 학생 응답 현황을 실명으로 표시합니다. 서술형 응답은 답변 내용이 아니라 문항 기준으로만 분류합니다.</p>
            </div>
          </div>

          <div className="director-memo-box compact">
            <b>원장 체크 메모</b>
            <div className="director-memo-lines"><span /><span /><span /></div>
          </div>

          <ReportFooter period={period} teacher={{ name: "원장 내부 확인용" }} />
        </div>
      )}

      {includePage("scoreTable") && (
        <div className="report-page internal-summary-page">
          <div className="report-page-header report-page-header-designed">
            <div>
              <div className="report-kicker">Page 1 · Total Summary</div>
              <h1 className="h1">전체 평가 요약</h1>
              <p className="muted">{period?.title} · 선생님 평가 문항을 제외한 학원 운영 관련 문항과 내부 검토 신호입니다.</p>
            </div>
            <div className="report-meta">
              <b>전체 응답</b>
              <br />{responseList.length}건
            </div>
          </div>

          <div className="report-kpi-grid">
            <ReportKpi label="공통 평가 평균" value={overallCommonScore === null ? "-" : `${formatScore(overallCommonScore)}점`} note="시설·시간·클리닉 등" />
            <ReportKpi label="강의평가 평균" value={overallTeacherScore === null ? "-" : `${formatScore(overallTeacherScore)}점`} note="선생님 평가 문항 기준" />
            <ReportKpi label="압박 있음" value={`${pressureYesCount}건`} note="상품/강제 압박 응답" />
            <ReportKpi label="서술형 코멘트" value={`${textComments.length}건`} note="문항 기준 분류" />
          </div>

          <div className="internal-risk-grid">
            <div className="internal-risk-card">
              <b>주의 필요 공통 항목</b>
              {lowestCommonRows.length ? (
                <ul>
                  {lowestCommonRows.map((row: any) => (
                    <li key={row.code}>{row.title} · <b>{formatScore(row.avg)}점</b> · {row.count}건</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">집계된 공통 평가 항목이 없습니다.</p>
              )}
            </div>
            <div className="internal-risk-card warn">
              <b>운영 확인 지표</b>
              <ul>
                <li>압박 있음: <b>{pressureYesCount}건</b></li>
                <li>압박 없음: <b>{pressureNoCount}건</b></li>
                <li>중복/검토 필요: <b>{flaggedResponses.length}건</b></li>
                <li>서술형 코멘트: <b>{textComments.length}건</b></li>
              </ul>
            </div>
          </div>

          <div className="internal-action-panel">
            <b>이번 달 내부 확인 포인트</b>
            {priorityActionItems.length ? (
              <ol>
                {priorityActionItems.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
              </ol>
            ) : (
              <p className="muted">현재 데이터 기준으로 특이 리스크 신호가 크지 않습니다.</p>
            )}
          </div>

          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="internal-summary-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>평가 항목</th>
                  <th>응답 수</th>
                  <th>평균 점수</th>
                </tr>
              </thead>
              <tbody>
                {nonTeacherSummaryRows.map((row: any, index: number) => (
                  <tr key={row.code}>
                    <td>{index + 1}</td>
                    <td>{row.title}</td>
                    <td>{row.count}건</td>
                    <td><b>{row.avg === null ? "-" : `${formatScore(row.avg)}점`}</b></td>
                  </tr>
                ))}
                {pressureQuestion && (
                  <tr>
                    <td>{nonTeacherSummaryRows.length + 1}</td>
                    <td>{pressureQuestion.title || "강의평가 공정성 확인"}</td>
                    <td>{pressureYesCount + pressureNoCount}건</td>
                    <td><b>네 {pressureYesCount}건 / 아니오 {pressureNoCount}건</b></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="director-memo-box">
            <b>원장 후속 조치 메모</b>
            <div className="director-memo-lines"><span /><span /><span /><span /></div>
          </div>

          <ReportFooter period={period} teacher={{ name: "원장 내부 확인용" }} />
        </div>
      )}

      {includePage("evaluationRanking") && (
        <div className="report-page internal-ranking-page">
          <div className="report-page-header report-page-header-designed">
            <div>
              <div className="report-kicker">Page 2 · Teacher Ranking</div>
              <h1 className="h1">{monthLabel(period?.year_month)} 선생님별 강의평가 순위</h1>
              <p className="muted">해당월 기준 모든 반을 합산한 선생님 평가 문항 평균입니다. 전월 대비 점수와 순위 변화도 함께 표시합니다.</p>
            </div>
            <div className="report-meta">
              <b>정렬 기준</b>
              <br />높은 점수순
            </div>
          </div>

          <div className="table-wrap">
            <table className="internal-ranking-table">
              <thead>
                <tr>
                  <th>순위</th>
                  <th>선생님</th>
                  <th>응답/반</th>
                  <th>강의평가</th>
                  <th>점수 변화</th>
                  <th>순위 변화</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {evaluationRows.map((row: any, index: number) => (
                  <tr key={row.teacher.id}>
                    <td>{row.score === null ? "-" : `${row.scoreRank || index + 1}위`}</td>
                    <td><b>{row.teacher.name} 선생님</b></td>
                    <td>{row.responseCount}건 / {row.classCount}개</td>
                    <td><b>{row.score === null ? "-" : `${formatScore(row.score)}점`}</b></td>
                    <td>{formatDelta(row.score, row.previousScore)}</td>
                    <td>{formatRankDelta(row.scoreRank, row.previousScoreRank)}</td>
                    <td>{row.scoreStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!evaluationRows.length && <Empty message="강의평가 순위 데이터가 없습니다." />}
          <ReportFooter period={period} teacher={{ name: "원장 내부 확인용" }} />
        </div>
      )}

      {includePage("withdrawalRanking") && (
        <div className="report-page internal-withdrawal-page">
          <div className="report-page-header report-page-header-designed">
            <div>
              <div className="report-kicker">Page 3 · Retention Stability</div>
              <h1 className="h1">퇴원율 / 재원 안정성 비교</h1>
              <p className="muted">선생님별 퇴원율을 비교하는 그래프입니다. 퇴원율은 낮을수록 좋으며, 기준선 5% 이하를 안정권으로 봅니다.</p>
            </div>
            <div className="report-meta">
              <b>비교 기준</b>
              <br />퇴원율 낮을수록 우수 · 안정권 {highWithdrawalCutoff}% 이하
            </div>
          </div>

          <div className="report-kpi-grid" style={{ marginBottom: 14 }}>
            <ReportKpi label="평균 퇴원율" value={withdrawalAverageRate === null ? "-" : `${formatScore(withdrawalAverageRate)}%`} note="전체 선생님 평균" />
            <ReportKpi label="안정권 선생님" value={`${stableTeacherCount}명`} note={`퇴원율 ${highWithdrawalCutoff}% 이하`} />
            <ReportKpi label="비교 대상" value={`${withdrawalComparisonRows.length}명`} note="퇴원율 입력 완료 기준" />
          </div>

          <div className="ranking-card withdrawal-card">
            <div className="internal-relation-head" style={{ marginBottom: 10 }}>
              <b>퇴원율 비교 그래프</b>
              <span>막대가 짧을수록 퇴원율이 낮습니다</span>
            </div>
            {withdrawalComparisonRows.map((row: any, index: number) => (
              <Bar
                key={row.teacher.id}
                label={`${row.withdrawalRank || index + 1}위 · ${row.teacher.name} 선생님${row.score !== null ? ` · 강의평가 ${formatScore(row.score)}점` : ""}`}
                value={Number(row.withdrawalRate || 0)}
                max={withdrawalComparisonMax}
                suffix="%"
                tone="withdrawal"
                highlight={row.withdrawalRate !== null && Number(row.withdrawalRate) <= highWithdrawalCutoff}
              />
            ))}
            {!withdrawalComparisonRows.length && <Empty message="퇴원율 비교 그래프를 그릴 데이터가 없습니다. 먼저 퇴원율 입력 탭에서 값을 저장해주세요." />}
          </div>

          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="internal-stability-table">
              <thead>
                <tr>
                  <th>퇴원율 순위</th>
                  <th>선생님</th>
                  <th>강의평가</th>
                  <th>퇴원율</th>
                  <th>응답/반</th>
                  <th>관계 신호</th>
                  <th>내부 판단</th>
                </tr>
              </thead>
              <tbody>
                {stabilityRows.map((row: any, index: number) => (
                  <tr key={row.teacher.id}>
                    <td>{row.withdrawalRate === null ? "-" : `${row.withdrawalRank || index + 1}위`}</td>
                    <td><b>{row.teacher.name} 선생님</b></td>
                    <td>{row.score === null ? "-" : `${formatScore(row.score)}점`}</td>
                    <td><b>{row.withdrawalRate === null ? "미입력" : `${formatScore(row.withdrawalRate)}%`}</b></td>
                    <td>{row.responseCount}건 / {row.classCount}개</td>
                    <td>{row.relationMemo}</td>
                    <td>{row.stabilityMemo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!(withdrawalRanking || []).length && <Empty message="퇴원율 등수 데이터가 없습니다. 먼저 퇴원율 입력 탭에서 값을 저장해주세요." />}
          <ReportFooter period={period} teacher={{ name: "원장 내부 확인용" }} />
        </div>
      )}

      {includePage("responseTable") && (
        <div className="report-page internal-comments-page">
          <div className="report-page-header report-page-header-designed">
            <div>
              <div className="report-kicker">Page 4 · Comment Intelligence</div>
              <h1 className="h1">응답 원문 / 주요 코멘트 분석</h1>
              <p className="muted">학생 서술형 응답을 답변 내용이 아니라 문항 기준으로 분류합니다. 선생님 좋은 점·아쉬운 점은 선생님별 펼치기 카드로 정리합니다.</p>
            </div>
            <div className="report-meta">
              <b>서술형 응답</b>
              <br />{textComments.length}건
            </div>
          </div>

          <div className="report-kpi-grid">
            <ReportKpi label="전체 코멘트" value={`${textComments.length}건`} note="학생 작성 원문" />
            <ReportKpi label="선생님 관련" value={`${teacherCommentCount}건`} note={`${textComments.length ? Math.round((teacherCommentCount / textComments.length) * 100) : 0}%`} />
            <ReportKpi label="학원 운영 관련" value={`${academyCommentCount}건`} note="클리닉·시설·시간·건의" />
            <ReportKpi label="문항 그룹" value={`${commentGroups.length}개`} note="문항 기준 분류" />
          </div>

          <div className="internal-student-response-panel">
            <div className="internal-comment-group-head">
              <b>학생별 응답 현황</b>
              <span>실명 표시 · {studentResponseRows.length}건 · 선생님별 펼치기</span>
            </div>
            {studentResponseSections.length ? (
              <div className="internal-student-response-list">
                {studentResponseSections.map((section: any) => (
                  <details className="internal-student-response-card" key={section.teacherId || section.teacherName}>
                    <summary>
                      <b>{section.teacherName} 선생님</b>
                      <span>{section.rows.length}건 · 펼치기/닫기</span>
                    </summary>
                    <div className="table-wrap">
                      <table className="internal-student-response-table">
                        <thead>
                          <tr>
                            <th>학생</th>
                            <th>반</th>
                            {teacherScaleQuestions.map((q: any, index: number) => <th key={q.id || q.code || index} title={questionTitle(q)}>T{index + 1}</th>)}
                            <th>선생님 AVG</th>
                            <th>공통 AVG</th>
                            <th>압박 응답</th>
                            <th>제출 시각</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((row: any) => (
                            <tr key={row.id}>
                              <td><b>{row.studentName}</b></td>
                              <td>{row.className}</td>
                              {row.teacherScores.map((item: any, index: number) => <td key={`${row.id}-score-${index}`}>{item.score === null ? "-" : item.score}</td>)}
                              <td>{row.teacherAvg === null ? "-" : `${formatScore(row.teacherAvg)}점`}</td>
                              <td>{row.commonAvg === null ? "-" : `${formatScore(row.commonAvg)}점`}</td>
                              <td>{row.pressure === "예" ? <span className="badge danger">예</span> : <span className="badge ok">아니오</span>}</td>
                              <td>{formatDateTime(row.submittedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <Empty message="학생별 응답 현황이 없습니다." />
            )}
          </div>

          <div className="internal-comment-category-grid">
            {commentGroups.map((group: any) => (
              <div className="internal-comment-category-card" key={group.label}>
                <div>
                  <b>{group.label}</b>
                  <span>{group.rows.length}건</span>
                </div>
                <p>문항 기준 분류</p>
                {group.keywords.length ? <small>{group.keywords.map(([keyword, count]: any) => `${keyword} ${count}`).join(" · ")}</small> : <small>반복 키워드 없음</small>}
              </div>
            ))}
          </div>

          <div className="internal-insight-grid single">
            <div className="internal-keyword-panel">
              <b>반복 키워드</b>
              {keywordRows.length ? (
                <div className="internal-keyword-list">
                  {keywordRows.map(([keyword, count]) => <span key={keyword}>{keyword} <b>{count}</b></span>)}
                </div>
              ) : (
                <p className="muted">표시할 반복 키워드가 없습니다.</p>
              )}
            </div>
          </div>

          <div className="internal-teacher-comment-split">
            {teacherCommentSections.map((section: any) => (
              <div className="internal-teacher-comment-section" key={section.label}>
                <div className="internal-comment-group-head">
                  <b>{section.label} · 선생님별 정리</b>
                  <span>{section.rows.reduce((sum: number, row: any) => sum + row.comments.length, 0)}건</span>
                </div>
                {section.rows.length ? (
                  <div className="internal-teacher-comment-list">
                    {section.rows.map((row: any) => (
                      <details className="internal-teacher-comment-card" key={`${section.label}-${row.teacher.id}`}>
                        <summary>
                          <b>{row.teacher.name} 선생님</b>
                          <span>{row.comments.length}건 · 펼치기/닫기</span>
                        </summary>
                        <ul>
                          {row.comments.map((comment: any, index: number) => (
                            <li key={`${comment.id}-${index}`}>
                              <span>{comment.studentName} · {comment.className}</span>
                              <p>{comment.text}</p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ))}
                  </div>
                ) : (
                  <p className="muted">해당 문항 코멘트가 없습니다.</p>
                )}
              </div>
            ))}
          </div>

          <div className="internal-comment-note">
            원장 내부 확인용 리포트에서는 학생 이름을 실명으로 표시합니다. 아래 문장은 학생이 작성한 원문이며, 맞춤법이나 표현을 수정하지 않았습니다. 코멘트는 답변 내용의 감정/의도를 추정하지 않고 문항 기준으로만 묶습니다.
          </div>

          <div className="internal-comment-summary-grid">
            {nonTeacherCommentGroups.length ? nonTeacherCommentGroups.map((group: any) => (
              <div className="internal-comment-group" key={group.label}>
                <div className="internal-comment-group-head">
                  <b>{group.label}</b>
                  <span>{group.rows.length}건</span>
                </div>
                <div className="internal-comment-item-list">
                  {group.rows.map((comment: any, index: number) => (
                    <div className="internal-comment-item" key={`${comment.id}-${index}`}>
                      <div className="internal-comment-meta">
                        <b>{comment.teacherName} 선생님 · {comment.className} · {comment.studentName}</b>
                        <span>{comment.questionTitle}</span>
                      </div>

                      <div className="internal-comment-text">{comment.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )) : (
              <Empty message="선생님 좋은 점/아쉬운 점 외의 서술형 코멘트가 없습니다." />
            )}
          </div>
          <ReportFooter period={period} teacher={{ name: "원장 내부 확인용" }} />
        </div>
      )}
    </div>
  );
}

function ResponseStatusBadges({ response }: { response: any }) {
  const labels = responseStatusLabels(response);
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {labels.map((label) => {
        const className =
          label === "정상"
            ? "badge ok"
            : label === "중복 의심"
              ? "badge warn"
              : "badge danger";
        return <span className={className} key={label}>{label}</span>;
      })}
    </span>
  );
}

function CommentBox({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="notice">
      <b>{title}</b>
      {rows.length ? (
        <ul>{rows.map((row, idx) => <li key={`${row}-${idx}`}>{row}</li>)}</ul>
      ) : (
        <p className="muted">아직 코멘트가 없습니다.</p>
      )}
    </div>
  );
}
