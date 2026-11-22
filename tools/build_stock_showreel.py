#!/usr/bin/env python3
"""Build actual welding and construction footage into a branded (non-QR) showreel.
Sources: Pexels video pages /video/14314645/ and /video/38942459/
Footage is stock illustration, not claimed to be S's-YR jobsite recording.
"""
from pathlib import Path
import subprocess, urllib.request, tempfile
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"assets/showreel-demo.mp4"
SOURCES={"welding":("14314645",[50,25,30]),"construction":("38942459",[25,30,50])}
def run(*cmd):
    print(">",*map(str,cmd),flush=True)
    subprocess.run(list(map(str,cmd)),check=True)

def fetch(name,info,dst):
    ident,fpslist=info
    urls=[]
    for fps in fpslist:
        for qual,res in [("hd","1920_1080"),("hd","1280_720"),("sd","960_540")]:
            urls.append(f"https://videos.pexels.com/video-files/{ident}/{ident}-{qual}_{res}_{fps}fps.mp4")
    urls.append(f"https://www.pexels.com/download/video/{ident}/")
    for url in urls:
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"})
            with urllib.request.urlopen(req,timeout=12) as r:
                first=r.read(131072)
                if b"ftyp" not in first[:32]:
                    print("non-video response",r.status,url);continue
                with open(dst,"wb") as f:
                    f.write(first)
                    while True:
                        d=r.read(512*1024)
                        if not d:break
                        f.write(d)
            if dst.stat().st_size>100000:
                print("SOURCE OK",name,url,dst.stat().st_size,flush=True)
                return url
        except Exception as e:
            print("candidate skipped",str(e)[:90],url,flush=True)
    raise RuntimeError("No rights-checked moving stock footage could be downloaded for "+name)

def shot(source,out,ja,en):
    title=out.with_suffix(".title");title.write_text(ja,encoding="utf-8")
    subtitle=out.with_suffix(".sub");subtitle.write_text(en,encoding="utf-8")
    font="/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
    if not Path(font).exists():raise RuntimeError("Missing Noto CJK font")
    filt=("scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,"
          "fps=24,eq=contrast=1.075:saturation=0.87,"
          "drawbox=x=0:y=578:w=iw:h=142:color=black@0.52:t=fill,"
          f"drawtext=fontfile={font}:textfile={title}:fontsize=42:fontcolor=white:x=64:y=604,"
          f"drawtext=fontfile={font}:textfile={subtitle}:fontsize=18:fontcolor=0xD7BFA0:x=65:y=665")
    run("ffmpeg","-y","-hide_banner","-loglevel","error","-ss","1","-i",source,"-t","6.5",
        "-vf",filt,"-an","-c:v","libx264","-preset","veryfast","-crf","24","-pix_fmt","yuv420p",out)

with tempfile.TemporaryDirectory() as td:
    d=Path(td)
    media={key:d/(key+".mp4") for key in SOURCES}
    credits={key:fetch(key,info,media[key]) for key,info in SOURCES.items()}
    a=d/"welding_cut.mp4";b=d/"construction_cut.mp4"
    shot(media["welding"],a,"溶接・鉄骨工事","WELDING / STEELWORK")
    shot(media["construction"],b,"建築・設備・営繕","CONSTRUCTION / MAINTENANCE")
    OUT.parent.mkdir(parents=True,exist_ok=True)
    run("ffmpeg","-y","-hide_banner","-loglevel","error","-i",a,"-i",b,
        "-filter_complex","[0:v][1:v]xfade=transition=fade:duration=0.5:offset=6.0[v]",
        "-map","[v]","-r","24","-an","-c:v","libx264","-preset","veryfast","-crf","23",
        "-pix_fmt","yuv420p","-movflags","+faststart",OUT)
    assert OUT.stat().st_size>100000
    print("SUCCESS",OUT.stat().st_size,credits)
