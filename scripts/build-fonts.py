"""Archivo değişken TTF'ten statik örnekler (v4.0a 1.4).

Kullanım: python -m pip install fonttools; python scripts/build-fonts.py assets/fonts
Kaynak: github.com/google/fonts ofl/archivo (OFL). Çıktı: 4 TTF + OFL.txt.
"""
import hashlib
import os
import sys
import tempfile
import urllib.request

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

here = os.path.dirname(os.path.abspath(__file__))
out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)

BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/"
VF_NAME = "Archivo[wdth,wght].ttf"
vf_path = os.path.join(tempfile.gettempdir(), "Archivo-VF.ttf")
ofl_path = os.path.join(out_dir, "OFL.txt")

if not os.path.exists(vf_path):
    urllib.request.urlretrieve(BASE + urllib.request.quote(VF_NAME), vf_path)
urllib.request.urlretrieve(BASE + "OFL.txt", ofl_path)

vf = TTFont(vf_path)
axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in vf["fvar"].axes}
print("eksenler:", axes)
print("VF sha256:", hashlib.sha256(open(vf_path, "rb").read()).hexdigest())

# (dosya adı, wdth, wght, ailenin adı)
INSTANCES = [
    ("Archivo-Expanded-ExtraBold", 125, 800, "Archivo Expanded ExtraBold"),
    ("Archivo-Regular", 100, 400, "Archivo Regular"),
    ("Archivo-SemiBold", 100, 600, "Archivo SemiBold"),
    ("Archivo-Bold", 100, 700, "Archivo Bold"),
]

for file_name, wdth, wght, family in INSTANCES:
    font = TTFont(vf_path)
    inst = instancer.instantiateVariableFont(
        font, {"wdth": wdth, "wght": wght}, updateFontNames=False
    )
    # Android ailenin adına değil dosya adına (expo-font anahtarı) bakar;
    # yine de ad tablosu tutarlı olsun: her dosya ayrı aile, Regular stil.
    name = inst["name"]
    ps = file_name
    for rec in list(name.names):
        if rec.nameID in (16, 17, 21, 22, 25):
            name.removeNames(nameID=rec.nameID)
    name.setName(family, 1, 3, 1, 0x409)
    name.setName("Regular", 2, 3, 1, 0x409)
    name.setName(f"{family};{ps}", 3, 3, 1, 0x409)
    name.setName(family, 4, 3, 1, 0x409)
    name.setName(ps, 6, 3, 1, 0x409)
    name.setName(family, 1, 1, 0, 0)
    name.setName("Regular", 2, 1, 0, 0)
    name.setName(family, 4, 1, 0, 0)
    name.setName(ps, 6, 1, 0, 0)
    inst["OS/2"].usWeightClass = wght
    inst["OS/2"].usWidthClass = 7 if wdth >= 125 else 5
    # Regular bit; kalın/italik bitleri kapalı (her dosya kendi ailesi)
    inst["OS/2"].fsSelection = (inst["OS/2"].fsSelection & ~0b1100001) | 0b1000000
    inst["head"].macStyle = 0
    path = os.path.join(out_dir, file_name + ".ttf")
    inst.save(path)
    print(f"{file_name}.ttf {os.path.getsize(path)} bayt")

print("OFL.txt", os.path.getsize(ofl_path), "bayt")
