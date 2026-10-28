"""Build offline WGS84 boundaries without simplifying source polygons.

Requires pyproj. geometry stores zlib-compressed SHP Polygon
record content (little endian): type:i32, bbox:4*f64, part_count:i32,
point_count:i32, parts:part_count*i32, xy:point_count*2*f64.
Coordinates are EPSG:4326, x=longitude and y=latitude (always_xy).
"""
from array import array
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import struct
import sys
import zlib
from pyproj import Transformer


def dbf(path):
    data = path.read_bytes()
    count = struct.unpack_from('<I', data, 4)[0]
    header, size = struct.unpack_from('<HH', data, 8)
    fields = []
    for offset in range(32, header - 1, 32):
        if data[offset] == 13:
            break
        field = data[offset:offset + 32]
        fields.append((field[:11].split(b'\0')[0].decode('ascii'), field[16]))
    rows = []
    for index in range(count):
        start = header + index * size
        if data[start:start + 1] != b' ':
            raise ValueError('Deleted or invalid DBF record')
        offset = start + 1
        row = {}
        for name, length in fields:
            row[name] = data[offset:offset + length].rstrip(b' ').decode('euc-kr')
            offset += length
        rows.append(row)
    return rows


def polygons(path):
    with path.open('rb') as source:
        header = source.read(100)
        assert struct.unpack_from('>i', header)[0] == 9994
        assert struct.unpack_from('<i', header, 32)[0] == 5
        while record_header := source.read(8):
            _, words = struct.unpack('>ii', record_header)
            payload = source.read(words * 2)
            assert len(payload) == words * 2
            assert struct.unpack_from('<i', payload)[0] == 5
            yield payload


def build(emd_dir, sig_dir, sido_dir, output):
    emd = next(emd_dir.glob('*.shp'))
    sig = next(sig_dir.glob('*.shp'))
    sido = next(sido_dir.glob('*.shp'))
    rows = dbf(emd.with_suffix('.dbf'))
    parents = {r['SIGUNGU_CD']: r for r in dbf(sig.with_suffix('.dbf'))}
    provinces = {r['SIDO_CD']: r for r in dbf(sido.with_suffix('.dbf'))}
    unmatched_sido = sorted({code[:2] for code in parents} - provinces.keys())
    if unmatched_sido:
        raise ValueError(f'Unmatched province codes: {unmatched_sido}')
    unmatched = sorted({r['ADM_CD'][:5] for r in rows} - parents.keys())
    if unmatched:
        raise ValueError(f'Unmatched parent codes: {unmatched}')
    for shp in (emd, sig, sido):
        if '"5179"' not in shp.with_suffix('.prj').read_text():
            raise ValueError('Expected EPSG:5179')
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise FileExistsError(output)
    connection = sqlite3.connect(output)
    connection.executescript('''
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE admin_boundaries (
            id INTEGER PRIMARY KEY, emd_code TEXT NOT NULL UNIQUE,
            emd_name TEXT NOT NULL, sig_code TEXT NOT NULL,
            sido_code TEXT NOT NULL, sido_name TEXT NOT NULL,
            sig_name TEXT NOT NULL, display_name TEXT NOT NULL,
            base_date TEXT NOT NULL, min_x REAL, max_x REAL,
            min_y REAL, max_y REAL, geometry BLOB NOT NULL,
            geometry_sha256 TEXT NOT NULL);
        CREATE INDEX admin_boundaries_sig ON admin_boundaries(sig_code);
        CREATE VIRTUAL TABLE boundary_rtree USING rtree(id,min_x,max_x,min_y,max_y);
    ''')
    transformer = Transformer.from_crs(5179, 4326, always_xy=True)
    inverse = Transformer.from_crs(4326, 5179, always_xy=True)
    raw_bytes = compressed_bytes = point_count = count = 0
    max_roundtrip_error = 0.0
    for index, payload in enumerate(polygons(emd)):
        row = rows[index]
        parent = parents[row['ADM_CD'][:5]]
        province = provinces[parent['SIGUNGU_CD'][:2]]
        assert parent['BASE_DATE'] == row['BASE_DATE']
        assert province['BASE_DATE'] == row['BASE_DATE']
        parts, vertices = struct.unpack_from('<ii', payload, 36)
        point_offset = 44 + parts * 4
        coordinates = array('d')
        coordinates.frombytes(payload[point_offset:])
        if sys.byteorder != 'little':
            coordinates.byteswap()
        assert len(coordinates) == vertices * 2
        source_x, source_y = coordinates[::2], coordinates[1::2]
        longitude, latitude = transformer.transform(source_x, source_y, errcheck=True)
        min_x, max_x = min(longitude), max(longitude)
        min_y, max_y = min(latitude), max(latitude)
        assert -180 <= min_x <= max_x <= 180 and -90 <= min_y <= max_y <= 90
        back_x, back_y = inverse.transform(longitude, latitude, errcheck=True)
        error = max(max(abs(a-b) for a,b in zip(source_x, back_x)),
                    max(abs(a-b) for a,b in zip(source_y, back_y)))
        max_roundtrip_error = max(max_roundtrip_error, error)
        assert error < 0.001, 'Coordinate roundtrip error exceeds 1 mm'
        coordinates[::2], coordinates[1::2] = longitude, latitude
        if sys.byteorder != 'little':
            coordinates.byteswap()
        prefix = bytearray(payload[:point_offset])
        struct.pack_into('<4d', prefix, 4, min_x, min_y, max_x, max_y)
        payload = bytes(prefix) + coordinates.tobytes()
        point_count += vertices
        packed = zlib.compress(payload, 9)
        digest = hashlib.sha256(payload).hexdigest()
        connection.execute('INSERT INTO admin_boundaries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (index + 1, row['ADM_CD'], row['ADM_NM'], parent['SIGUNGU_CD'],
             province['SIDO_CD'], province['SIDO_NM'],
             parent['SIGUNGU_NM'], ' '.join((province['SIDO_NM'], parent['SIGUNGU_NM'], row['ADM_NM'])),
             row['BASE_DATE'], min_x, max_x, min_y, max_y, packed, digest))
        connection.execute('INSERT INTO boundary_rtree VALUES (?,?,?,?,?)',
                           (index + 1, min_x, max_x, min_y, max_y))
        raw_bytes += len(payload)
        compressed_bytes += len(packed)
        count += 1
    assert count == len(rows)
    metadata = {'crs': 'EPSG:4326', 'source_crs': 'EPSG:5179',
                'axis_order': 'longitude,latitude',
                'geometry_encoding': 'zlib-shp-polygon-record-le',
                'simplified': 'false', 'source_encoding': 'EUC-KR',
                'source_emd': emd.name, 'source_sig': sig.name,
                'source_sido': sido.name,
                'base_date': rows[0]['BASE_DATE'], 'schema_version': '3'}
    connection.executemany('INSERT INTO metadata VALUES (?,?)', metadata.items())
    connection.commit()
    connection.execute('VACUUM')
    assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    for packed, digest in connection.execute('SELECT geometry,geometry_sha256 FROM admin_boundaries'):
        assert hashlib.sha256(zlib.decompress(packed)).hexdigest() == digest
    assert connection.execute('SELECT count(*) FROM boundary_rtree').fetchone()[0] == count
    connection.close()
    source_size = sum(f.stat().st_size for directory in (emd_dir, sig_dir, sido_dir)
                      for f in directory.iterdir() if f.is_file())
    report = dict(metadata, boundary_count=count, sig_count=len(parents),
                  sido_count=len(provinces), unmatched_sido_count=len(unmatched_sido),
                  unmatched_parent_count=len(unmatched), point_count=point_count,
                  source_total_bytes=source_size, raw_geometry_bytes=raw_bytes,
                  compressed_geometry_bytes=compressed_bytes,
                  sqlite_bytes=output.stat().st_size,
                  max_coordinate_roundtrip_error_m=max_roundtrip_error,
                  integrity_check='ok', all_geometry_roundtrips_verified=True)
    output.with_suffix('.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--emd-dir', type=Path, required=True)
    parser.add_argument('--sig-dir', type=Path, required=True)
    parser.add_argument('--sido-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    build(args.emd_dir, args.sig_dir, args.sido_dir, args.output)
