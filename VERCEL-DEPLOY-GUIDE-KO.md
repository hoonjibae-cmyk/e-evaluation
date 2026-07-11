# Vercel 재배포 가이드

1. ZIP 파일을 다운로드합니다.
2. 기존 프로젝트 폴더 `C:\e-evaluation-v0`에 압축을 풀어 기존 파일을 덮어씁니다.
3. PowerShell에서 프로젝트 폴더로 이동합니다.

```powershell
cd C:\e-evaluation-v0
```

4. 아래 명령으로 운영 배포를 실행합니다.

```powershell
npx.cmd vercel --prod --force
```

PowerShell에서는 `npx` 대신 `npx.cmd`를 사용하는 것이 안전합니다.

이번 버전은 신규 SQL이 없으므로 Supabase SQL 실행은 필요하지 않습니다.
