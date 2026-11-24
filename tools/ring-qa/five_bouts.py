"""Run a title road using normal game inputs on the supplied release URL."""
import shutil
import sys
import time
from urllib.parse import urljoin, urlsplit

from playwright.sync_api import sync_playwright

url = sys.argv[1]
allowed = urljoin(url, "./")
executable = (sys.argv[2] if len(sys.argv) > 2 else shutil.which("google-chrome") or shutil.which("chromium"))
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=executable, headless=True)
    page = browser.new_page(viewport={"width": 844, "height": 390}, screen={"width": 844, "height": 390},
                            is_mobile=True, has_touch=True, device_scale_factor=1, locale="ja-JP")
    errors, offsite, specials, winners = [], [], [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("requestfailed", lambda req: errors.append([req.url, req.failure]))
    page.on("request", lambda req: offsite.append(req.url) if req.url.startswith("http") and not req.url.startswith(allowed) else None)
    page.on("response", lambda res: errors.append([res.url, res.status]) if res.status >= 400 else None)
    assert page.goto(url).ok
    page.locator("#setup-open").tap()
    page.locator("#nickname").fill("動作確認")
    page.locator("#fighter-select").select_option("azure")
    page.locator("#begin").tap()
    seen_cut = False
    punched = set()
    points = {}
    for kind in ["card", "straight", "upper", "hook", "jab"]:
        box = page.locator(f"[data-punch={kind}]").bounding_box()
        points[kind] = (box["x"] + box["width"]/2, box["y"] + box["height"]/2)
    attempts = 0
    end = time.monotonic() + 420
    index = 0
    while len(winners) < 5 and time.monotonic() < end:
        current = page.evaluate("""() => {
          const $ = id => document.getElementById(id);
          return {out: $("outcome").open, wins: document.querySelectorAll("#bracket .done").length,
            opponent: $("cpu-name").textContent, result: $("result-score").textContent, title: $("result-title").textContent,
            active: !document.querySelector("[data-punch=straight]").disabled, card: !$("card").disabled,
            cut: !$("super-cut").hidden, style: $("super-cut").dataset.variant,
            image: $("super-portrait").getAttribute("src"), width: $("super-portrait").naturalWidth,
            duration: $("super-cut").style.getPropertyValue("--cut-duration")};
        }""")
        if current["cut"]:
            if not seen_cut:
                page.locator("#super-portrait").evaluate("(image) => image.decode()")
                assert current["duration"] == "1760ms"
                specials.append((current["style"], urlsplit(current["image"]).path.split("/")[-1]))
                print("special", specials[-1], flush=True)
            seen_cut = True
        else:
            seen_cut = False
        if current["out"]:
            print(current["title"], current["result"], flush=True)
            if current["wins"] == len(winners) + 1:
                winners.append(current["opponent"])
            else:
                attempts += 1
                assert attempts < 4
            if len(winners) == 5:
                break
            page.locator("#result-primary").tap()
        elif current["active"] and not current["cut"]:
            page.keyboard.down("ArrowRight")
            kind = "card" if current["card"] else (
                "hook" if index % 19 == 3 else "upper" if index % 23 == 7 else "jab" if index % 13 == 9 else "straight")
            page.touchscreen.tap(*points[kind])
            punched.add(kind)
            index += 1
        page.wait_for_timeout(68)
    assert len(set(winners)) == 5, winners
    assert page.locator("#ending").is_visible()
    assert "500,000 G" in page.locator("#result-copy").inner_text()
    assert "ストレート" in page.locator(".ending-road strong").inner_text()
    assert page.locator(".ending-road strong").evaluate("s => s.getAnimations().some(a=>a.animationName==='title-hit')")
    assert len(set(style for style, image in specials[:5])) == 5, specials
    assert len(set(image for style, image in specials)) == 2, specials
    assert len(punched) == 5
    page.locator("#result-primary").tap()
    page.wait_for_function("!document.querySelector('[data-punch=straight]').disabled")
    assert not page.locator("#bracket .done").count()
    page.locator("#back").tap()
    page.get_by_role("dialog", name="試合を一時停止").get_by_role("button", name="タイトルへ戻る").tap()
    assert page.locator("#setup-open").is_visible()
    assert not errors, errors
    assert not offsite, offsite
    print("PASS: five wins, all five styles and both portraits, ending and replay", winners, specials)
    browser.close()
