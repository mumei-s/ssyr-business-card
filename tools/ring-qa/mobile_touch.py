"""Usage: python mobile_touch.py <game-entry-url> [chromium-executable]."""
import json
import sys
from pathlib import PurePosixPath
from urllib.parse import urljoin, urlsplit

from playwright.sync_api import expect, sync_playwright


# Observe the actual visible ring canvas. No game state, timing or source is changed.
DRAW_OBSERVER = """
window.ringImages = new Set();
const drawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
  if (this.canvas.id === 'ring') {
    if (image instanceof HTMLImageElement) {
      window.ringImages.add(new URL(image.currentSrc || image.src, location.href).pathname.split('/').pop());
    } else if (image instanceof HTMLCanvasElement && image.width === 320 && image.height === 320) {
      window.ringImages.add('custom-320');
    }
  }
  return drawImage.call(this, image, ...args);
};
"""


def touch_point(locator, touch_id):
    bounds = locator.bounding_box()
    assert bounds and bounds["width"] > 0 and bounds["height"] > 0
    return {
        "x": bounds["x"] + bounds["width"] / 2,
        "y": bounds["y"] + bounds["height"] / 2,
        "id": touch_id,
        "radiusX": 2,
        "radiusY": 2,
    }


def dispatch(session, kind, points):
    session.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})


def assert_touch_controls(page, session):
    page.wait_for_function("!document.querySelector('[data-punch=jab]').disabled")
    assert page.evaluate("document.documentElement.dataset.playLayout") == "rail"
    assert page.evaluate("document.documentElement.classList.contains('game-touch-lock')")
    assert page.evaluate("visualViewport.scale") == 1
    for selector in ["#ring", "#pad", "#card", ".attacks", "#back"]:
        assert page.locator(selector).evaluate("""element => {
          const r = element.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1
            && r.right <= visualViewport.width+1 && r.bottom <= visualViewport.height+1;
        }"""), f"outside landscape viewport: {selector}"

    guard = page.locator("[data-hold=guard]")
    dispatch(session, "touchStart", [touch_point(guard, 1)])
    page.wait_for_function("document.querySelector('[data-hold=guard]').classList.contains('pressed')")
    page.wait_for_function("Number(document.querySelector('#energy').getAttribute('aria-valuenow')) < 100")
    dispatch(session, "touchEnd", [])
    page.wait_for_function("!document.querySelector('[data-hold=guard]').classList.contains('pressed')")

    direction = page.locator("[data-hold=right]")
    right = touch_point(direction, 1)
    jab = touch_point(page.locator("[data-punch=jab]"), 2)
    for _ in range(12):
        dispatch(session, "touchStart", [right])
        page.wait_for_function("document.querySelector('[data-hold=right]').classList.contains('pressed')")
        page.wait_for_timeout(250)
        dispatch(session, "touchStart", [right, jab])
        page.wait_for_timeout(200)
        dispatch(session, "touchEnd", [])
        if int(page.locator("#cpu-vital").get_attribute("aria-valuenow")) < 100:
            break
    assert int(page.locator("#cpu-vital").get_attribute("aria-valuenow")) < 100, "two-finger jab never landed"
    page.wait_for_function("!document.querySelector('[data-hold=right]').classList.contains('pressed')")
    tap = touch_point(page.locator("#ring"), 1)
    page.touchscreen.tap(tap["x"], tap["y"])
    page.wait_for_timeout(70)
    page.touchscreen.tap(tap["x"], tap["y"])
    page.wait_for_timeout(350)
    assert page.evaluate("visualViewport.scale") == 1


def enter_setup(page):
    page.locator("#setup-open").tap()
    expect(page.locator("#setup")).to_be_visible()


def return_to_title(page):
    page.locator("#back").tap()
    pause = page.get_by_role("dialog", name="試合を一時停止")
    pause.get_by_role("button", name="タイトルへ戻る").tap()
    expect(page.locator("#intro")).to_be_visible()


def run(url, executable=None):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=executable)
        context = browser.new_context(
            viewport={"width": 852, "height": 393}, screen={"width": 852, "height": 393},
            device_scale_factor=1, is_mobile=True, has_touch=True, locale="ja-JP",
        )
        context.add_init_script(DRAW_OBSERVER)
        page = context.new_page()
        failures = []
        page.on("pageerror", lambda err: failures.append(str(err)))
        page.on("requestfailed", lambda req: failures.append((req.url, req.failure)))
        page.on("response", lambda res: failures.append((res.url, res.status)) if res.status >= 400 else None)
        session = context.new_cdp_session(page)
        response = page.goto(url, wait_until="load")
        assert response and response.ok
        page.locator("#rules-open").tap()
        expect(page.locator("#rules")).to_be_visible()
        page.locator("#rules button").tap()
        images = []
        for idx, fighter in enumerate(("rose", "azure", "jade", "violet")):
            enter_setup(page)
            page.locator("#fighter-select").select_option(fighter)
            page.locator("#opponent").select_option("ren" if fighter == "azure" else "kai")
            page.evaluate("window.ringImages.clear()")
            page.locator("#begin").tap()
            page.wait_for_function("name => window.ringImages.has(name)", arg=fighter+".webp")
            page.wait_for_function("window.ringImages.has('arena.webp')")
            images.append(fighter)
            if idx == 0:
                assert_touch_controls(page, session)
            return_to_title(page)

        enter_setup(page)
        page.locator("#nickname").fill("タッチ検証")
        page.locator("#weight").fill("60")
        page.locator("#opponent-type").select_option("female")
        assert page.locator("#opponent option").count() == 5
        page.locator(".character-panel > summary").tap()
        asset_url = urljoin(page.url, "art/azure.webp")
        image = context.request.get(asset_url)
        assert image.ok
        page.locator("[data-role=import]").set_input_files({
            "name": PurePosixPath(urlsplit(asset_url).path).name,
            "mimeType": "image/webp", "buffer": image.body(),
        })
        expect(page.locator("#fighter-select")).to_have_value("custom")
        expect(page.locator("[data-role=current]")).to_have_text("azure")
        page.locator("#begin").tap()
        page.wait_for_function("window.ringImages.has('custom-320')")
        expect(page.locator("#player-name")).to_have_text("タッチ検証")
        page.set_viewport_size({"width": 393, "height": 852})
        page.wait_for_function("!document.documentElement.dataset.playLayout")
        page.set_viewport_size({"width": 852, "height": 393})
        page.wait_for_function("document.documentElement.dataset.playLayout === 'rail'")
        page.reload(wait_until="load")
        enter_setup(page)
        expect(page.locator("#fighter-select")).to_have_value("custom")
        expect(page.locator("#nickname")).to_have_value("タッチ検証")
        expect(page.locator("#weight")).to_have_value("60")
        expect(page.locator("#opponent-type")).to_have_value("female")
        expect(page.locator("[data-role=current]")).to_have_text("azure")
        page.locator("#begin").tap()
        page.wait_for_function("window.ringImages.has('custom-320')")
        assert not failures, failures
        print(json.dumps({
            "url": url, "chromium": browser.version, "mobileViewport": [852, 393],
            "touchGuard": True, "twoFingerMoveAndHit": True, "doubleTapScale": 1,
            "stockRenders": images, "customSpriteRestoredAndRendered": True,
            "portraitLandscapeRotation": True, "responsesOrRuntimeErrors": failures,
        }, ensure_ascii=False))
        browser.close()


if __name__ == "__main__":
    run(*sys.argv[1:])
