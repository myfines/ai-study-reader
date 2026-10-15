param([Parameter(Mandatory)][string]$Url,[Parameter(Mandatory)][long]$Size,[Parameter(Mandatory)][string]$Sha256,[Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference='Stop'
$cache=Join-Path (Split-Path $PSScriptRoot -Parent) '.tools\ranges'
New-Item -ItemType Directory -Force $cache | Out-Null
$chunk=[long][math]::Ceiling($Size/12)
$parts=0..11 | ForEach-Object -Parallel {
 $index=$_;$start=$index*$using:chunk;$end=[math]::Min($using:Size-1,$start+$using:chunk-1)
 $file=Join-Path $using:cache "$using:Sha256-$index.bin"
 for($attempt=0;$attempt -lt 4;$attempt++){
  if((Test-Path $file) -and (Get-Item $file).Length -eq $end-$start+1){return $file}
  & curl.exe -sSL --max-time 50 --range "$start-$end" $using:Url -o $file
 }
 if((Get-Item $file).Length -ne $end-$start+1){throw "Incomplete range $index"}
 return $file
} -ThrottleLimit 12
$temp="$Destination.ranges"
$stream=[IO.File]::Create($temp)
try {foreach($index in 0..11){$file=Join-Path $cache "$Sha256-$index.bin";$bytes=[IO.File]::ReadAllBytes($file);$stream.Write($bytes)}}finally{$stream.Dispose()}
$actual=(Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash.ToLower()
if($actual -ne $Sha256){throw "Checksum mismatch $actual"}
Move-Item -LiteralPath $temp -Destination $Destination -Force
Write-Output "Verified $Sha256 $Size bytes -> $Destination"
