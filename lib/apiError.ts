export function toSafeErrorMessage(error: any) {
  const rawMessage = String(error?.message || error || "알 수 없는 오류가 발생했습니다.");

  if (rawMessage.toLowerCase().includes("fetch failed")) {
    return [
      "Supabase 접속에 실패했습니다.",
      "가장 흔한 원인은 Vercel 환경변수 NEXT_PUBLIC_SUPABASE_URL 값이 잘못되었거나, 환경변수 수정 후 Redeploy를 하지 않은 경우입니다.",
      "NEXT_PUBLIC_SUPABASE_URL은 https://프로젝트ID.supabase.co 형식이어야 합니다.",
      "Supabase Dashboard 주소나 /rest/v1 주소를 넣으면 안 됩니다."
    ].join(" ");
  }

  if (rawMessage.includes("Invalid URL") || rawMessage.includes("Failed to parse URL")) {
    return "Supabase 주소 형식이 잘못되었습니다. NEXT_PUBLIC_SUPABASE_URL은 https://프로젝트ID.supabase.co 형식으로 입력해주세요.";
  }

  return rawMessage;
}
