"""Verify every receiver JNI entry point is exported in each APK ABI."""
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
apk = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'android/app/build/outputs/apk/debug/BearMap.apk'
ndk = pathlib.Path(os.environ.get('ANDROID_NDK_HOME', pathlib.Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/ndk/26.1.10909125'))
nm = ndk / 'toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-nm.exe'
classes = ['SdrNative', 'AirspyNative']
expected = set()
for name in classes:
    source = (root / f'android/app/src/main/java/com/bearpoint/app/{name}.java').read_text(encoding='utf8')
    expected.update(f'Java_com_bearpoint_app_{name}_{method}' for method in re.findall(r'\bnative\s+\S+\s+(\w+)\s*\(', source))
with zipfile.ZipFile(apk) as archive, tempfile.TemporaryDirectory() as tmp:
    for abi in ['arm64-v8a', 'armeabi-v7a', 'x86_64']:
        library = pathlib.Path(tmp) / f'{abi}.so'
        library.write_bytes(archive.read(f'lib/{abi}/libbear_sdr.so'))
        output = subprocess.check_output([str(nm), '-D', str(library)], text=True)
        symbols = {line.split()[-1] for line in output.splitlines() if line.strip()}
        missing = sorted(expected - symbols)
        if missing:
            raise SystemExit(f'{abi}: missing JNI exports: {missing}')
        print(f'{abi}: verified {len(expected)} JNI exports')
