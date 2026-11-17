$ErrorActionPreference = "Stop"
Write-Host "Starting MixBench Backend (FastAPI on :8000) and Frontend (Next.js on :3000)..." -ForegroundColor Cyan

$backend = Start-Process -FilePath "$PSScriptRoot\backend\.venv\Scripts\python.exe" `
  -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000" `
  -WorkingDirectory "$PSScriptRoot\backend" `
  -PassThru -NoNewWindow

$frontend = Start-Process -FilePath "npm.cmd" `
  -ArgumentList "run", "dev" `
  -WorkingDirectory "$PSScriptRoot\frontend" `
  -PassThru -NoNewWindow

try {
  Write-Host "MixBench running at http://localhost:3000 (API docs: http://localhost:8000/docs)" -ForegroundColor Green
  Write-Host "Press Ctrl+C to stop both servers."
  while (-not $backend.HasExited -and -not $frontend.HasExited) {
    Start-Sleep -Seconds 1
  }
} finally {
  if ($frontend -and -not $frontend.HasExited) { Stop-Process -Id $frontend.Id -Force -ErrorAction SilentlyContinue }
  if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue }
}
