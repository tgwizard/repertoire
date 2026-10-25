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

const works = (page: Page) => page.locator(".works .work");

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

test("filters narrow the list, from facets with counts", async ({ page }) => {
  await page.goto("/?i=violin:2,viola,cello");
  await expect(works(page).first()).toBeVisible();
  const romantic = page.getByRole("button", { name: /^Romantic \d/ });
  const expected = Number((await romantic.locator(".era-count").textContent())!.replace(/,/g, ""));
  await romantic.click();
  await expect(page.locator(".results-head h2")).toContainText(`${expected.toLocaleString("en")} works match`);
  await page.getByPlaceholder("Search titles and composers…").fill("debussy");
  await expect(works(page).first()).toContainText("String Quartet in G minor, Op.10");
  await expect(works(page)).toHaveCount(1);
});

test("smaller groups: the full group's works, then those for fewer players", async ({ page }) => {
  await page.goto("/?i=flute,oboe,clarinet,bassoon,horn,piano");
  await page.getByLabel(/Include smaller groups/).check();
  await expect(page).toHaveURL(/sub=1/);
  await expect(page.locator(".players-heading").first()).toHaveText("All 6 players");
  await expect(page.locator(".players-heading").nth(1)).toHaveText("5 of your 6 players");
  await expect(works(page).first()).toContainText("Sextet");
  // One of the smaller groups on its own.
  const group = page.getByLabel("Group", { exact: true });
  const quintet = await group.locator("option", { hasText: /^flute, oboe, clarinet, bassoon, horn \(/ }).getAttribute("value");
  await group.selectOption(quintet!);
  await expect(works(page).first()).toContainText("Wind Quintet, Op.43");
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
  await page.goto("/search?q=brahms%20clarinet%20quintet");
  await works(page).first().getByRole("link", { name: "Clarinet Quintet, Op.115" }).click();
  await page.locator(".scorings").getByRole("link", { name: "clarinet, 2 violins, viola, cello" }).click();
  await expect(page).toHaveURL(/\?i=clarinet,violin:2,viola,cello$/);
  await expect(page.locator(".chips")).toContainText("clarinet");
  await expect(works(page).first()).toBeVisible();
});

test("search: suggestions as you type, then a composer page filtered by line-up", async ({ page }) => {
  const noErrors = watchErrors(page);
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search works and composers" }).fill("brahms");
  const suggestion = page.locator(".suggestion").filter({ hasText: "Johannes Brahms" }).first();
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(page).toHaveURL(/\/composer\/[0-9a-z]{8}\/johannes-brahms$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Johannes Brahms");
  await page.getByRole("button", { name: /^\d+ more$/ }).click(); // Brahms wrote for many line-ups
  await page.getByRole("button", { name: /^clarinet, 2 violins, viola, cello \d/ }).click();
  await expect(page).toHaveURL(/\?lineup=cello,clarinet,viola,violin\*2/);
  await expect(works(page).first()).toContainText("Clarinet Quintet, Op.115");
  noErrors();
});

test("search page: all results for a query", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("searchbox", { name: "Search works and composers" });
  await box.fill("k581");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=k581$/);
  await expect(works(page).first()).toContainText("K.581");
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
