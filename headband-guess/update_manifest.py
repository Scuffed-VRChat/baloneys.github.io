"""Validate and refresh the local static master; never uploads or removes files."""
import hashlib
import json
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
path = ROOT / 'master.json'
master = json.loads(path.read_text(encoding='utf-8'))
capacity = master['slotCapacity']
if not 1 <= capacity <= 8192:
    raise ValueError('Capacity must fit the world’s 8192 baked URL slots')
categories, traits, characters = master['categories'], master['traits'], master['characters']
if not 1 <= len(categories) <= 124 or len(traits) > 30:
    raise ValueError('Unsupported category/trait count')
if [c['id'] for c in categories] != list(range(1, len(categories) + 1)):
    raise ValueError('Category IDs must remain consecutive from 1')
if [t['id'] for t in traits] != list(range(1, len(traits) + 1)):
    raise ValueError('Trait IDs must remain consecutive from 1')
ids = [c['id'] for c in characters]
indices = [c['imageIndex'] for c in characters]
if len(ids) > 8192 or len(ids) != len(set(ids)) or ids != sorted(ids) or any(i <= 0 for i in ids):
    raise ValueError('Character IDs must be unique, positive and ascending')
if len(indices) != len(set(indices)) or any(not 0 <= i < capacity for i in indices):
    raise ValueError('Image indices must be unique and within capacity')
for character in characters:
    if not character.get('name') or not 1 <= character['categoryId'] <= len(categories):
        raise ValueError('Invalid character name/category')
    if any(not 1 <= i <= len(traits) for i in character['traitIds']):
        raise ValueError('Invalid character trait')

def png_size(file):
    data = file.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(f'Not a PNG: {file}')
    position, dimensions, complete = 8, None, False
    while position + 12 <= len(data):
        length = struct.unpack_from('>I', data, position)[0]
        kind = data[position + 4:position + 8]
        payload = data[position + 8:position + 8 + length]
        if position + length + 12 > len(data): raise ValueError(f'Truncated PNG: {file}')
        crc = struct.unpack_from('>I', data, position + 8 + length)[0]
        if zlib.crc32(kind + payload) & 0xffffffff != crc: raise ValueError(f'PNG CRC mismatch: {file}')
        if kind == b'IHDR': dimensions = struct.unpack_from('>II', payload)
        if kind == b'IEND': complete = True; break
        position += length + 12
    if not complete or not dimensions or not all(0 < d <= 2048 for d in dimensions):
        raise ValueError(f'Invalid or oversized PNG: {file}')
    return dimensions

inventory, available = [], []
for character in characters:
    index = character['imageIndex']
    relative = f'images/{index:04d}.png'
    file = ROOT / relative
    row = {'index': index, 'characterId': character['id'], 'file': relative,
           'iconImageIndex': index, 'state': 'reserved'}
    if file.exists():
        width, height = png_size(file)
        row.update(width=width, height=height, bytes=file.stat().st_size)
        if width > 1 and height > 1:
            row['state'] = 'ready'; available.append(index)
        else: row['state'] = 'placeholder'
    inventory.append(row)
master.update(characterCount=len(characters), categoryCount=len(categories), images=inventory,
    availableImageIndices=sorted(available), availableImageCount=len(available),
    highestReservedImageIndex=capacity - 1, highestAssignedImageIndex=max(indices, default=-1),
    highestAvailableImageIndex=max(available, default=-1))
cache = master['cache']
if not (2 <= cache['maxResidentImages'] <= 64 and 1 <= cache['maxResidentMemoryMB'] <= 256 and 0 <= cache['preloadImageCount'] <= 24):
    raise ValueError('Invalid cache policy')
version_data = {k: v for k, v in master.items() if k != 'version'}
master['version'] = 'headband-' + hashlib.sha256(json.dumps(version_data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
path.write_text(json.dumps(master, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print(f"{len(characters)} characters; {len(available)} ready images; highest assigned {master['highestAssignedImageIndex']}; highest ready {master['highestAvailableImageIndex']}; {capacity} reserved URL slots")
