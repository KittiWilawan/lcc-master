$ErrorActionPreference = 'Stop'

$environmentPath = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $environmentPath)) {
  throw 'ไม่พบ home-monitor/.env กรุณาคัดลอกจาก .env.example ก่อน'
}

$email = (Read-Host 'อีเมลบัญชีคอมบ้าน').Trim()
if (-not $email.Contains('@') -or $email.StartsWith('@') -or $email.EndsWith('@')) {
  throw 'รูปแบบอีเมลไม่ถูกต้อง'
}

$securePassword = Read-Host 'รหัสผ่าน (ตัวอักษรจะไม่แสดง)' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
if ([string]::IsNullOrWhiteSpace($password)) {
  throw 'รหัสผ่านต้องไม่ว่าง'
}

$originalLines = [IO.File]::ReadAllLines($environmentPath)
$updates = @{
  HOME_MONITOR_EMAIL = $email
  HOME_MONITOR_PASSWORD = $password
}
$seen = [Collections.Generic.HashSet[string]]::new()
$output = [Collections.Generic.List[string]]::new()
foreach ($line in $originalLines) {
  $separator = $line.IndexOf('=')
  $key = if ($separator -gt 0) { $line.Substring(0, $separator) } else { '' }
  if ($updates.ContainsKey($key)) {
    $output.Add("$key=$($updates[$key])")
    $null = $seen.Add($key)
  } else {
    $output.Add($line)
  }
}
foreach ($key in $updates.Keys) {
  if (-not $seen.Contains($key)) {
    $output.Add("$key=$($updates[$key])")
  }
}
[IO.File]::WriteAllLines($environmentPath, $output, [Text.UTF8Encoding]::new($false))
$password = $null

& node --env-file=$environmentPath (Join-Path $PSScriptRoot 'select-family.mjs')
if ($LASTEXITCODE -ne 0) {
  [IO.File]::WriteAllLines($environmentPath, $originalLines, [Text.UTF8Encoding]::new($false))
  throw 'บัญชีหรือครอบครัวยังไม่พร้อม จึงคืนค่าตั้งเดิมให้แล้ว'
}

Write-Host 'บันทึกบัญชีและครอบครัวแล้ว กรุณารัน npm run monitor:doctor เพื่อตรวจสอบ'
