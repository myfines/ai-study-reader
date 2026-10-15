param([switch]$TestsOnly,[switch]$NativeAcceptance)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
Set-Location $project
if(Test-Path "$project\.tools\cargo\bin\cargo.exe"){
 $env:CARGO_HOME="$project\.tools\cargo"
 $env:RUSTUP_HOME="$project\.tools\rustup"
 $env:PATH="$env:CARGO_HOME\bin;$env:PATH"
}
if(-not (Get-Command cargo -ErrorAction SilentlyContinue)){throw 'Install Rust and Visual Studio C++ Build Tools first; see README.'}
if($project.Contains(' ') -and ((& rustc -vV | Out-String) -match 'host: x86_64-pc-windows-gnu')){
 if(-not $env:CARGO_TARGET_DIR){$env:CARGO_TARGET_DIR=Join-Path $env:SystemDrive 'tmp\ai-study-reader-target'}
 Write-Output "GNU build output (without spaces): $env:CARGO_TARGET_DIR"
}
if((& rustc -vV | Out-String) -match 'host: x86_64-pc-windows-gnu'){
 $sysroot=(& rustc --print sysroot)
 $lld=Join-Path $sysroot 'lib\rustlib\x86_64-pc-windows-gnu\bin\rust-lld.exe'
 if(Test-Path -LiteralPath $lld){$env:CARGO_ENCODED_RUSTFLAGS=[string]::Join([char]31,@('-C','linker-flavor=ld.lld','-C',"linker=$lld"))}
}
& npm.cmd ci
if($LASTEXITCODE -ne 0){throw 'npm ci failed'}
& npm.cmd test
if($LASTEXITCODE -ne 0){throw 'Frontend tests failed'}
& npm.cmd run build
if($LASTEXITCODE -ne 0){throw 'Frontend build failed'}
Push-Location src-tauri
try{& cargo test --locked;if($LASTEXITCODE -ne 0){throw 'Rust tests failed'}}finally{Pop-Location}
if($NativeAcceptance){
 & npm.cmd run test:e2e
 if($LASTEXITCODE -ne 0){throw 'Edge acceptance tests failed'}
 & cargo build --manifest-path src-tauri/Cargo.toml --features custom-protocol --locked
 if($LASTEXITCODE -ne 0){throw 'Native acceptance build failed'}
 & npm.cmd run test:native
 if($LASTEXITCODE -ne 0){throw 'Native acceptance tests failed'}
}
if(-not $TestsOnly){& npm.cmd run bundle;if($LASTEXITCODE -ne 0){throw 'Windows bundle failed'}}
