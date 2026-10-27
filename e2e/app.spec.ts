/// <reference lib="dom" />
// The app in a browser: finding works for a line-up, smaller groups, work and
// composer pages, search, and the server-rendered pages.

import { expect, test, type Page } from "@playwright/test";

/** Fails the test on any console error or uncaught exception. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return () => expect(errors, "console errors").toEqual([]);
}

// Visible ones only: the finder stays mounted (hidden) under other pages.
const works = (page: Page) => page.locator(".works .work").filter({ visible: true });

test("pick a preset: the line-up's works, most established first, and more on request", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Who's playing?" })).toBeVisible();
  await page.getByRole("button", { name: /^Wind quintet \d/ }).click();
  await expect(page).toHaveURL(/\?i=flute,oboe,clarinet,bassoon,horn$/);
  await expect(page.locator(".results-head h2")).toContainText("works for flute, oboe, clarinet, bassoon, horn");
  await expect(works(page).first()).toContainText("Wind Quintet, Op.43");
  await expect(works(page).first()).toContainText("Carl Nielsen");
  await expect(works(page)).toHaveCount(50);
  await page.getByRole("button", { name: /^Load more/ }).click();
  await expect(works(page)).toHaveCount(100);
  noErrors();
});

test("the logo starts over: no line-up, no search, top of the page; back restores", async ({ page }) => {
  await page.goto("/?i=flute,oboe,clarinet,bassoon,horn,piano&sub=1");
  await expect(works(page).first()).toBeVisible();
  const box = page.getByRole("searchbox", { name: "Search works and composers" });
  await box.fill("poulenc");
  await expect(page).toHaveURL(/q=poulenc/);
  await page.locator(".site-title").getByRole("link").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Who's playing?" })).toBeVisible();
  await expect(page.locator(".chips")).toHaveCount(0);
  await expect(box).toHaveValue("");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page.getByLabel(/Include smaller groups/)).toBeChecked();
  await expect(box).toHaveValue("poulenc");
  await expect(works(page).first()).toContainText("Sextet");
});

test("search everything, then narrow it down by picking players", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/");
  const box = page.getByRole("searchbox", { name: "Search works and composers" });
  await box.fill("brahms");
  await expect(page.locator(".results-head h2")).toContainText("works matching “brahms”");
  await expect(page.locator(".composer-matches")).toContainText("Johannes Brahms");
  await expect(works(page).first()).toContainText("Johannes Brahms");
  // Picking a line-up keeps the search: Brahms for clarinet quintet.
  await page.getByRole("button", { name: /^Clarinet quintet \d/ }).click();
  await expect(page).toHaveURL(/\?i=clarinet,violin:2,viola,cello&q=brahms$/);
  await expect(page.locator(".results-head h2")).toContainText(/matching “brahms” for clarinet, 2 violins, viola, cello/);
  await expect(works(page).first()).toContainText("Clarinet Quintet, Op.115");
  // And widening it again; back returns to the line-up.
  await page.getByRole("button", { name: "Search all line-ups instead" }).click();
  await expect(page).toHaveURL(/\/\?q=brahms$/);
  await expect(page.locator(".results-head h2")).toContainText("works matching “brahms”");
  await page.goBack();
  await expect(page.locator(".chips")).toContainText("clarinet");
  await expect(works(page).first()).toContainText("Clarinet Quintet, Op.115");
  noErrors();
});

test("typing a search keeps the focus while results come in", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("searchbox", { name: "Search works and composers" });
  await box.click();
  await page.keyboard.type("bra");
  await expect(page.locator(".results-head h2")).toContainText("matching “bra”");
  await page.keyboard.type("hms");
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("brahms");
  await expect(page.locator(".results-head h2")).toContainText("matching “brahms”");
  // Picking players doesn't move it either
  await page.getByRole("button", { name: /^String quartet \d/ }).click();
  await box.click();
  await page.keyboard.type(" op");
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("brahms op");
});

test("searching everything has filters too, and a line-up to narrow it to", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/?q=brahms");
  await expect(page.getByRole("combobox", { name: "Sort" })).toHaveValue("relevance");
  await page.getByRole("button", { name: /^Romantic \d/ }).click();
  await expect(page).toHaveURL(/q=brahms&era=Romantic|era=Romantic.*q=brahms/);
  for (const badge of await works(page).locator(".work-meta .badge").allTextContents()) expect(badge).toBe("Romantic");
  const lineup = page.getByRole("combobox", { name: "Line-up" });
  const quartet = await lineup.locator("option", { hasText: /^2 violins, viola, cello \(/ }).getAttribute("value");
  await lineup.selectOption(quartet!);
  await expect(page).toHaveURL(/i=violin:2,viola,cello/);
  await expect(page).toHaveURL(/era=Romantic/); // the filters come along
  await expect(page.locator(".results-head h2")).toContainText("matching “brahms” for 2 violins, viola, cello");
  noErrors();
});

test("search finds catalogue numbers; old /search links still work", async ({ page }) => {
  await page.goto("/search?q=k581");
  await expect(page).toHaveURL(/\/\?q=k581$/);
  await expect(page.getByRole("searchbox", { name: "Search works and composers" })).toHaveValue("k581");
  await expect(works(page).first()).toContainText("K.581");
});

test("filters narrow the list, from facets with counts", async ({ page }) => {
  await page.goto("/?i=violin:2,viola,cello");
  await expect(works(page).first()).toBeVisible();
  const romantic = page.getByRole("button", { name: /^Romantic \d/ });
  const expected = Number((await romantic.locator(".era-count").textContent())!.replace(/,/g, ""));
  await romantic.click();
  await expect(page.locator(".results-head h2")).toContainText(`${expected.toLocaleString("en")} matching works`);
  await page.getByRole("searchbox", { name: "Search works and composers" }).fill("debussy");
  await expect(works(page).first()).toContainText("String Quartet in G minor, Op.10");
  await expect(works(page)).toHaveCount(1);
});

test("a slow list says it's working and how it's going, without moving; a failed one offers to try again", async ({ page }) => {
  await page.goto("/?i=violin:2,viola,cello");
  await expect(works(page).first()).toBeVisible();
  const pill = page.locator(".loading-pill");
  const top = async () => (await works(page).first().boundingBox())!.y;
  const before = await top();
  // Hold the next lists back
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/api\/works\?/, async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("button", { name: /^Romantic \d/ }).click();
  await expect(pill).toContainText("Updating…");
  await expect(page.locator(".works-wrap.stale")).toHaveCount(1);
  await expect(pill).toContainText("Still working", { timeout: 6_000 });
  expect(await top()).toBe(before);
  // Typing shows it at once, before the search goes out
  await page.getByRole("searchbox", { name: "Search works and composers" }).pressSequentially("x");
  await expect(pill).toBeVisible();
  await page.getByRole("searchbox", { name: "Search works and composers" }).fill("");
  release();
  await expect(pill).toHaveCount(0);
  await page.unroute(/\/api\/works\?/);

  // A list that fails says so, and trying again works
  await page.route(/\/api\/works\?/, (route) => route.abort("connectionfailed"));
  await page.getByRole("button", { name: /^Classical \d/ }).click();
  await expect(page.getByRole("alert")).toContainText("couldn't be reached");
  await page.unroute(/\/api\/works\?/);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(works(page).first()).toBeVisible();
});

test("filters and sort live in the URL: a reload, a link or going back shows the same list", async ({ page }) => {
  await page.goto("/?i=violin:2,viola,cello");
  await page.getByRole("button", { name: /^Romantic \d/ }).click();
  await page.getByRole("combobox", { name: "Sort" }).selectOption({ label: "Newest first" });
  await page.getByRole("combobox", { name: "Length" }).selectOption("20-40");
  await expect(page).toHaveURL(/era=Romantic&sort=chronological&order=desc&len=20-40/);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".works-wrap.stale")).toHaveCount(0);
  const heading = await page.locator(".results-head h2").textContent();
  const first = await works(page).first().locator(".work-title").textContent();

  await page.reload();
  await expect(page.getByRole("button", { name: /^Romantic \d/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "Sort" })).toHaveValue("chronological:desc");
  await expect(page.getByRole("combobox", { name: "Length" })).toHaveValue("20-40");
  await expect(page.locator(".results-head h2")).toHaveText(heading!);
  await expect(works(page).first().locator(".work-title")).toHaveText(first!);

  await works(page).first().locator(".work-title").click();
  await expect(page).toHaveURL(/\/work\//);
  await page.goBack();
  await expect(page).toHaveURL(/era=Romantic&sort=chronological&order=desc&len=20-40/);
  await expect(works(page).first().locator(".work-title")).toHaveText(first!);

  // Another ensemble starts afresh
  await page.getByRole("button", { name: /^Piano trio \d/ }).click();
  await expect(page).toHaveURL(/\?i=[^&]+$/);
});

test("a crash shows a way out, not a blank page", async ({ page }) => {
  // What a response cached for older code once did: facets without the length counts
  await page.route(/\/api\/works\?.*facets=1/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    delete body.facets.lengths;
    await route.fulfill({ response: res, json: body });
  });
  page.on("pageerror", () => {}); // expected
  await page.goto("/?i=violin:2,viola,cello");
  await expect(page.getByRole("alert")).toContainText("Something went wrong showing this page");
  await expect(page.getByRole("link", { name: "report it" })).toHaveAttribute("href", /github\.com\/tgwizard\/repertoire\/issues\/new/);
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(page.locator(".site-title")).toBeVisible();
});

test("where a line-up comes from is behind a ?", async ({ page }) => {
  await page.goto("/?i=violin:2,viola,cello");
  const sources = page.locator(".info-popover");
  await expect(sources).toBeHidden();
  await page.getByRole("button", { name: "Where this line-up comes from" }).click();
  await expect(sources).toBeVisible();
  await expect(sources).toContainText("Line-up from IMSLP");
  await page.keyboard.press("Escape");
  await page.locator(".site-title").hover();
  await expect(sources).toBeHidden();
});

test("picking a composer keeps the others on offer", async ({ page }) => {
  await page.goto("/?i=violin:2,viola,cello");
  const select = page.getByRole("combobox", { name: "Composer" });
  await expect(select.locator("option").first()).toHaveText(/All composers \(300\+\)/);
  const haydn = await select.locator("option", { hasText: /^Joseph Haydn \(/ }).getAttribute("value");
  await select.selectOption(haydn!);
  await expect(works(page).first()).toContainText("Joseph Haydn");
  await expect(select.locator("option").first()).toHaveText(/All composers \(300\+\)/);
  expect(await select.locator("option").count()).toBeGreaterThan(100);
});

test("smaller groups: the full group's works, then those for fewer players", async ({ page }) => {
  await page.goto("/?i=flute,oboe,clarinet,bassoon,horn,piano");
  await page.getByLabel(/Include smaller groups/).check();
  await expect(page).toHaveURL(/sub=1/);
  await expect(page.locator(".players-heading").first()).toHaveText("All 6 players");
  await expect(works(page).first()).toContainText("Sextet");
  // The full group's works fill the first page.
  await page.getByRole("button", { name: /^Load more/ }).click();
  await expect(page.locator(".players-heading").nth(1)).toHaveText("5 of your 6 players");
  // One of the smaller groups on its own.
  const group = page.getByLabel("Group", { exact: true });
  const quintet = await group.locator("option", { hasText: /^flute, oboe, clarinet, bassoon, horn \(/ }).getAttribute("value");
  await group.selectOption(quintet!);
  await expect(works(page).first()).toContainText("Wind Quintet, Op.43");
});

test("an orchestra gives its scoring and gets what it can play; the scoring is in the link", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/?i=orchestra");
  await expect(works(page).first()).toBeVisible();
  const field = page.getByLabel("Your orchestra");
  await field.fill("2.2.2.2 2.2.0.0 timp str");
  await expect(page.locator(".orchestra-hint")).toContainText("2 flutes, 2 oboes, 2 clarinets, 2 bassoons, 2 horns, 2 trumpets, timpani, strings");
  await expect(page.locator(".orchestra-hint")).toContainText(/Leaves out [\d,]+ orchestral works/);
  await expect(page).toHaveURL(/orch=2\.2\.2\.2/);
  await expect(page.locator(".results-head h2")).toContainText("matching works for symphony orchestra");
  // Every work listed fits: no 4 horns, no trombones
  await expect(works(page).first().locator(".orchestration-tag")).toBeVisible();
  for (const tag of await works(page).locator(".orchestration-tag").allTextContents()) expect(tag).toMatch(/^([0-2](\+\w+)?\.){3}[0-2](\+\w+)? – [0-2]\.[0-2]\.0\.0/);
  // Typing doesn't move the page: the hint keeps its place whatever it says
  const below = async () => (await page.locator(".filters").boundingBox())!.y;
  const before = await below();
  await field.fill("2.2.2.2 4.2.3.1 timp+perc+harpz str");
  await expect(page.locator("#orchestra-hint")).toContainText("Couldn't read “harpz”");
  expect(await below()).toBe(before);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  // How to write one, with typical orchestras to start from
  await page.getByRole("button", { name: "How to write an orchestra" }).click();
  await page.locator(".orchestra-example", { hasText: "Romantic" }).click();
  await expect(field).toHaveValue("2.2.2.2 4.2.3.1 timp perc str");
  await expect(field).toHaveAttribute("aria-invalid", "false");
  noErrors();
});

test("a work page, and back to the list where you left it", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/?i=flute,oboe,clarinet,bassoon,horn");
  await works(page).first().getByRole("link", { name: "Wind Quintet, Op.43" }).click();
  await expect(page).toHaveURL(/\/work\/[0-9a-z]{8}\/nielsen-wind-quintet-op-43$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wind Quintet, Op.43");
  await expect(page.getByRole("link", { name: "Sheet music on IMSLP" })).toHaveAttribute("href", /^https:\/\/imslp\.org\/wiki\//);
  await expect(page.locator(".detail-head").getByRole("link", { name: "Carl Nielsen" })).toBeVisible();
  await expect(page.locator(".score-parts li").first()).toBeVisible();
  await expect(page).toHaveTitle("Wind Quintet, Op.43 – Carl Nielsen · Repertoire Finder");
  await page.goBack();
  await expect(page).toHaveURL(/\?i=flute,oboe,clarinet,bassoon,horn$/);
  await expect(works(page).first()).toContainText("Wind Quintet, Op.43");
  noErrors();
});

test("a work's line-up links to the finder for that line-up", async ({ page }) => {
  await page.goto("/?q=brahms%20clarinet%20quintet");
  await works(page).first().getByRole("link", { name: "Clarinet Quintet, Op.115" }).click();
  await page.locator(".scorings").getByRole("link", { name: "clarinet, 2 violins, viola, cello" }).click();
  await expect(page).toHaveURL(/\?i=clarinet,violin:2,viola,cello$/);
  await expect(page.locator(".chips")).toContainText("clarinet");
  await expect(works(page).first()).toBeVisible();
});

test("a composer page from search, filtered by line-up", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/?q=brahms");
  await page.locator(".composer-matches").getByRole("link", { name: "Johannes Brahms" }).click();
  await expect(page).toHaveURL(/\/composer\/[0-9a-z]{8}\/johannes-brahms$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Johannes Brahms");
  await page.getByRole("button", { name: /^\d+ more$/ }).click(); // Brahms wrote for many line-ups
  await page.getByRole("button", { name: /^clarinet, 2 violins, viola, cello \d/ }).click();
  await expect(page).toHaveURL(/\?lineup=cello,clarinet,viola,violin\*2/);
  await expect(works(page).first()).toContainText("Clarinet Quintet, Op.115");
  noErrors();
});

test("work and composer pages are rendered on the server, for links and search engines", async ({ request }) => {
  const search = await (await request.get("/api/search?q=nielsen%20wind%20quintet&limit=1")).json();
  const id = search.works[0].id as string;
  const res = await request.get(`/work/${id}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("<title>Wind Quintet, Op.43 – Carl Nielsen · Repertoire Finder</title>");
  expect(html).toMatch(/<meta property="og:description" content="Wind Quintet, Op\.43 by Carl Nielsen[^"]*for flute, oboe, clarinet, bassoon, horn/);
  expect(html).toContain(`<link rel="canonical" href="`);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]!);
  expect(ld).toMatchObject({ "@type": "MusicComposition", name: "Wind Quintet, Op.43", composer: { name: "Carl Nielsen" } });
  expect(html).toMatch(/<div id="root"><main class="ssr"><h1>Wind Quintet, Op\.43<\/h1>/);

  const composer = ld.composer.url.replace(/^https?:\/\/[^/]+/, "");
  const c = await request.get(composer);
  expect(c.status()).toBe(200);
  expect(await c.text()).toContain("<title>Carl Nielsen · Repertoire Finder</title>");

  const missing = await request.get("/work/zzzzzzzz");
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain('<meta name="robots" content="noindex" />');
});

test("the API is cached at the edge and browsers", async ({ request }) => {
  const res = await request.get("/api/meta");
  expect(res.status()).toBe(200);
  test.skip(res.headers()["cache-control"] === "no-store", "the dev server caches nothing");
  expect(res.headers()["cache-control"]).toBe("public, max-age=300");
  expect(res.headers()["access-control-allow-origin"]).toBe("*");
});

test("about page: sources with numbers, license and how to give feedback", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/");
  await page.locator(".footer").getByRole("link", { name: "About the data" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Where this comes from");
  const imslp = page.locator(".about-table tbody tr").filter({ hasText: "IMSLP" });
  await expect(imslp.locator("td").first()).toHaveText(/^\d{3},\d{3}$/);
  await expect(page.locator(".stat-grid")).toContainText("Works");
  await expect(page.getByRole("link", { name: "tgwizard@gmail.com" })).toHaveAttribute("href", "mailto:tgwizard@gmail.com?subject=%5BRepertoire%20Feedback%5D%3A%20");
  await expect(page.getByRole("link", { name: "github.com/tgwizard/repertoire" })).toHaveAttribute("href", "https://github.com/tgwizard/repertoire");
  noErrors();
});
