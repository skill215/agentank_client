#!/usr/bin/env python3
"""Restore the frozen BP423 handover payload without overwriting differing files."""
import hashlib
import io
import json
import pathlib
import tarfile

def restore(root):
    here = pathlib.Path(__file__).resolve().parent
    manifest = json.loads((here / 'manifest.json').read_text())
    data = (here / 'evidence.tar.gz').read_bytes()
    assert hashlib.sha256(data).hexdigest() == manifest['archiveSha256'], 'ARCHIVE_HASH'
    expected = {item['path']: item for item in manifest['files']}
    staged = []
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        members = archive.getmembers()
        assert len(members) == len(expected) == len({m.name for m in members}), 'FILE_SET'
        for member in members:
            assert member.isfile() and member.name in expected, 'UNEXPECTED_MEMBER'
            relative = pathlib.PurePosixPath(member.name)
            assert not relative.is_absolute() and '..' not in relative.parts, 'UNSAFE_PATH'
            target = root.joinpath(*relative.parts)
            assert target.resolve().is_relative_to(root), 'PATH_ESCAPE'
            assert not any(p.is_symlink() for p in [target, *target.parents]), 'SYMLINK'
            content = archive.extractfile(member).read()
            item = expected[member.name]
            assert len(content) == item['bytes'], 'SIZE_MISMATCH'
            assert hashlib.sha256(content).hexdigest() == item['sha256'], 'FILE_HASH'
            if target.exists():
                assert target.is_file() and target.read_bytes() == content, 'EXISTING_FILE_DIFFERS: ' + member.name
            else:
                staged.append((target, content))
    for target, content in staged:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(content)
    print(json.dumps({'verifiedFiles': len(expected), 'restoredFiles': len(staged)}))

if __name__ == '__main__':
    restore(pathlib.Path(__file__).resolve().parents[2])
