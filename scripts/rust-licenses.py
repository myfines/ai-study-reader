"""Record Cargo.lock licenses from checksum-verified downloaded crate archives."""
import os, pathlib, re, tarfile, tomllib
root=pathlib.Path(__file__).resolve().parent.parent
cargo=pathlib.Path(os.environ.get('CARGO_HOME',root/'.tools'/'cargo'))
cache=next((cargo/'registry'/'cache').glob('index.crates.io-*'))
dest=root/'licenses';dest.mkdir(exist_ok=True)
rows=[];uncached=[]
for entry in tomllib.loads((root/'src-tauri'/'Cargo.lock').read_text())['package']:
    if not entry.get('source','').startswith('registry+'):continue
    name,version=entry['name'],entry['version'];archive=cache/f'{name}-{version}.crate'
    if not archive.exists():uncached.append(f'{name} {version}');continue
    with tarfile.open(archive,'r:gz') as tar:
        package=tomllib.loads(tar.extractfile(f'{name}-{version}/Cargo.toml').read().decode())['package']
        license=package.get('license',package.get('license-file','SEE UPSTREAM'))
        rows.append(f'| {name} | {version} | {license} |')
        for member in tar.getmembers():
            if member.isfile() and re.match(r'^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT)([._-]|$)',pathlib.PurePosixPath(member.name).name,re.I):
                local=re.sub(r'[^A-Za-z0-9._-]','_',member.name)
                (dest/f'rust-{local}.txt').write_bytes(tar.extractfile(member).read())
text='# Rust dependency licenses\n\nGenerated from Cargo.lock and verified Cargo crate archives, including available build and target dependencies. Full notices are in licenses/. SQLite itself is public domain.\n\n| Package | Version | License |\n|---|---|---|\n'+'\n'.join(sorted(rows))+'\n'
if uncached:text+='\n## Other platform / uncached lockfile entries\n\nNot included in this machine’s compiled dependency artifacts. See Cargo.lock for the complete resolution.\n\n'+'\n'.join('- '+v for v in uncached)+'\n'
(root/'RUST-LICENSES.md').write_text(text,encoding='utf-8')
print(f'Recorded {len(rows)} Rust dependency licenses; {len(uncached)} other-platform/uncached entries.')
