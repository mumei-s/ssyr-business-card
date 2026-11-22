from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import cairosvg, io, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[1]
assets=ROOT/"assets"
cards=[
 ("ai-illustration-01.svg","AI ILLUSTRATION"),
 ("ai-illustration-02.svg","CREATIVE GRAPHICS"),
 ("ui-creation.svg","TOOLS & APPS"),
]
w,h=960,540
font_path="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
font=ImageFont.truetype(font_path,46)
font_small=ImageFont.truetype(font_path,22)
with tempfile.TemporaryDirectory() as tmp:
    td=Path(tmp)
    entries=[]
    for i,(file,label) in enumerate(cards):
        svg=(assets/file).read_bytes()
        raw=cairosvg.svg2png(bytestring=svg,output_width=960,output_height=960)
        src=Image.open(io.BytesIO(raw)).convert("RGB")
        frame=src.crop((0,210,960,750))
        overlay=Image.new("RGBA",(w,h),(0,0,0,0))
        d=ImageDraw.Draw(overlay)
        d.rectangle((0,0,w,115),fill=(8,19,24,218))
        d.rectangle((0,h-66,w,h),fill=(8,19,24,212))
        d.text((36,22),"S's-YR",font=font,fill="#f8f4ec")
        d.text((36,h-52),label,font=font_small,fill="#e3c29e")
        frame=Image.alpha_composite(frame.convert("RGBA"),overlay).convert("RGB")
        file_path=td/f"slide-{i:02d}.png"
        frame.save(file_path)
        entries.extend([f"file '{file_path}'","duration 5.0"])
    entries.append(f"file '{file_path}'")
    concat=td/"slides.txt"
    concat.write_text("\n".join(entries)+"\n")
    target=assets/"showreel-demo.mp4"
    subprocess.run([
        "ffmpeg","-hide_banner","-loglevel","error","-y",
        "-f","concat","-safe","0","-i",str(concat),
        "-vf","fps=12,format=yuv420p","-c:v","libx264",
        "-crf","24","-preset","medium","-movflags","+faststart",
        "-t","15","-an",str(target)
    ],check=True)
    assert target.exists() and target.stat().st_size>5000, "Video output missing"
    print("Created",target,"bytes",target.stat().st_size)
