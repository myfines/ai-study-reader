"""Create a source-only ZIP and release checksums; exclude local toolchains/caches."""
import hashlib, os, pathlib, zipfile
root=pathlib.Path(__file__).resolve().parent.parent
release=root/'release';release.mkdir(exist_ok=True)
archive=release/'AI-Study-Reader-0.1.0-source.zip'
excluded={'node_modules','.tools','.headroom-cache','target','dist','release','.git','test-results','playwright-report','gen'}
logs={'final-unit-race.txt','acceptance-final.txt','rust-manifest-tests.txt','native-smoke-key-check.txt','final-build-race.txt','dependency-audit.json','installer-final.txt','installer-extract.txt','release-smoke.txt','payload-final.txt'}
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for current,dirs,files in os.walk(root):
        dirs[:]=sorted(d for d in dirs if d not in excluded)
        for name in sorted(files):
            file=pathlib.Path(current)/name;relative=file.relative_to(root)
            if relative.parts[0]=='logs' and name not in logs:continue
            if relative.parts[0]=='artifacts' and name not in {'reader-preview.png','release-window.png'}:continue
            if name.endswith(('.tsbuildinfo','.pyc')):continue
            z.write(file,'ai-study-reader/'+relative.as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for required in ['README.md','TEST-RESULTS.md','src/App.tsx','src-tauri/Cargo.lock','src-tauri/windows.manifest']:
        assert 'ai-study-reader/'+required in z.namelist()
    count=len(z.namelist())
lines=[]
for file in sorted(release.iterdir()):
    if file.suffix.lower() in {'.exe','.zip'}:lines.append(hashlib.sha256(file.read_bytes()).hexdigest()+'  '+file.name)
(release/'SHA256SUMS.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(f'Source ZIP verified: {count} files, {archive.stat().st_size} bytes')
for line in lines:print(line)
