import os
import zipfile
from pathlib import Path

src = Path(r'C:/Users/matth/Downloads/ANIMATION_Sword_Combat_SourceFiles_v5.zip')
dst = Path(r'C:/Users/matth/AppData/Roaming/creator-hub/Scenes/Sidekick Demo/.tmp-boss-anims')
dst.mkdir(parents=True, exist_ok=True)
count = 0
with zipfile.ZipFile(src) as archive:
    for name in archive.namelist():
        normalized = name.replace('\\', '/').lower()
        if '/sidekick/' in normalized and name.lower().endswith('.fbx'):
            archive.extract(name, dst)
            count += 1
print('extracted', count)
print('fbx', len(list(dst.rglob('*.fbx'))))
