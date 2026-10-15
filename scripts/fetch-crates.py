"""Optional verified, bounded cache warmer for slow Cargo proxy connections.
Does not modify Cargo.lock or dependency source; only fills Cargo's crate cache.
"""
import concurrent.futures, hashlib, os, pathlib, re, subprocess, time, tomllib
root = pathlib.Path(__file__).resolve().parent.parent
cargo = pathlib.Path(os.environ.get('CARGO_HOME', root / '.tools' / 'cargo'))
cache = next((cargo / 'registry' / 'cache').glob('index.crates.io-*'))
lock = tomllib.loads((root / 'src-tauri' / 'Cargo.lock').read_text())
skip = re.compile(r'^(objc|block2|cocoa|gtk|gdk|gio|glib|webkit|javascriptcore|soup|core-foundation|core-graphics|foreign-types|windows_(aarch64|i686)|windows_x86_64_(msvc|gnullvm))')
def fetch(p):
    name, version = p['name'], p['version']
    dest = cache / f'{name}-{version}.crate'
    if dest.exists() or skip.match(name): return 'cached/skipped'
    if not re.fullmatch(r'[a-zA-Z0-9_.+-]+', name + version): raise ValueError('Invalid package path')
    for attempt in range(3):
        try:
            url=f'https://static.crates.io/crates/{name}/{name}-{version}.crate'
            head=subprocess.run(['curl.exe','-sSI','--max-time','15',url],capture_output=True,check=True).stdout.decode()
            sizes=re.findall(r'content-length:\s*(\d+)',head,re.I)
            size=int(sizes[-1]) if sizes else 0
            def get_range(pair):
                start,end=pair
                result=subprocess.run(['curl.exe','-sSL','--max-time','120','--range',f'{start}-{end}',url],capture_output=True,check=True)
                if len(result.stdout)!=end-start+1:raise ValueError(f'Invalid range for {name}')
                return result.stdout
            if size>1000000:
                chunk=(size+7)//8
                with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                    data=b''.join(pool.map(get_range,[(s,min(size-1,s+chunk-1)) for s in range(0,size,chunk)]))
            else:
                data=subprocess.run(['curl.exe','-sSL','--max-time','90',url],capture_output=True,check=True).stdout
            if hashlib.sha256(data).hexdigest() != p['checksum']: raise ValueError('Checksum mismatch')
            temp = dest.with_suffix('.warm')
            temp.write_bytes(data)
            temp.replace(dest)
            return f'{name} {version}'
        except Exception as error:
            if attempt == 2: return f'ERROR {name}: {error}'
            time.sleep(1)
packages = [p for p in lock['package'] if p.get('source','').startswith('registry+')]
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
    count = 0
    for result in executor.map(fetch, packages):
        count += 1
        if result.startswith('ERROR') or count % 25 == 0: print(f'{count}/{len(packages)} {result}', flush=True)
print(f'Cache warm complete: {len(packages)} lockfile entries inspected.', flush=True)
