"""Independent fixture encoder: psd-tools/Pillow, never ag-psd's writer.
All artwork is generated here; no upstream copyrighted fixture corpus used.
"""
from pathlib import Path
import json, hashlib, importlib.metadata
from PIL import Image, ImageDraw
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer
from psd_tools.constants import Compression, Resource
from psd_tools.psd.image_resources import ImageResource, ResoulutionInfo

ROOT = Path(__file__).parent
OUT = ROOT
OUT.mkdir(exist_ok=True)
manifest = []

def save(name, img, compression=Compression.RLE, dpi=None, layers=None):
    psd = PSDImage.frompil(img, compression=compression)
    layer_refs = []
    if layers:
        for layer_img, layer_name, x, y in layers:
            PixelLayer.frompil(layer_img, psd, layer_name, top=y, left=x, compression=compression)
            layer_refs.append(dict(name=layer_name,x=x,y=y,width=layer_img.width,height=layer_img.height))
    if dpi:
        psd.image_resources[Resource.RESOLUTION_INFO] = ImageResource(key=Resource.RESOLUTION_INFO,
            data=ResoulutionInfo(horizontal=int(dpi[0]*65536),horizontal_unit=1,width_unit=1,
                vertical=int(dpi[1]*65536),vertical_unit=1,height_unit=1))
    path=OUT/(name+'.psd')
    # Keep the independently supplied composite; do not rerender through psd-tools.
    with path.open('wb') as f: psd._record.write(f)
    reread=PSDImage.open(path).topil().convert('RGBA')
    error=max(abs(a-b) for a,b in zip(reread.tobytes(),img.convert('RGBA').tobytes()))
    manifest.append(dict(name=name,file=path.name,width=img.width,height=img.height,
        expectedRgbaSha256=hashlib.sha256(img.convert('RGBA').tobytes()).hexdigest(),
        dpi=dpi,layers=layer_refs,independentReadbackMaxError=error,
        fileBytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        mode=img.mode,depth=8,compression=compression.name,expected='decode'))

im=Image.new('RGB',(300,180),'white')
d=ImageDraw.Draw(im)
d.rectangle((15,15,100,90),fill=(18,90,160))
d.ellipse((150,20,250,120),fill=(220,60,30))
for x in range(300): d.line((x,145,x,179),fill=(x*255//299,)*3)
save('rgb-raw-300dpi',im,Compression.RAW,(300,300))
save('rgb-rle-anisotropic',im,Compression.RLE,(300,150))
save('grayscale-rle',im.convert('L'),Compression.RLE,(254,254))

bg=Image.new('RGBA',(300,180),'white')
red=Image.new('RGBA',(65,40),(210,35,35,255))
blue=Image.new('RGBA',(70,55),(15,70,200,128))
bg.alpha_composite(red,(20,15)); bg.alpha_composite(blue,(60,35))
save('two-layers',bg.convert('RGB'),Compression.RLE,(300,300),[(red,'red',20,15),(blue,'blue',60,35)])

(ROOT/'fixtures.json').write_text(json.dumps(dict(generator='psd-tools independent encoder',
    versions={n:importlib.metadata.version(n) for n in ['psd-tools','pillow','numpy']},fixtures=manifest),indent=2))
print(json.dumps(dict(count=len(manifest),independentReadbackErrors=[(x['name'],x.get('independentReadbackMaxError')) for x in manifest]),indent=2))
