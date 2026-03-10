const WEBFLOW_API_BASE = "https://api.webflow.com/v2";

const SOURCE_API_BASE =
  "https://techniekmatch.my.salesforce-sites.com/services/apexrest/byner/BYNER_WEBSITE_REST_API/v2/getJobs";

const WEBFLOW_TOKEN = process.env.WEBFLOW_TOKEN;
const WEBFLOW_CITY_COLLECTION_ID = process.env.WEBFLOW_CITY_COLLECTION_ID;
const WEBFLOW_SITE_ID = process.env.WEBFLOW_SITE_ID;
const SOURCE_API_KEY = process.env.SOURCE_API_KEY;

const INTERNAL_CHANNEL = "Company website";

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

async function fetchAllJobs() {
  const jobs = [];
  let start = 0;

  while (true) {
    const url =
      `${SOURCE_API_BASE}?internal_channel=${encodeURIComponent(INTERNAL_CHANNEL)}` +
      `&start=${start}&apiKey=${encodeURIComponent(SOURCE_API_KEY)}`;

    const data = await fetchJson(url);

    const results = data.results || [];

    if (results.length === 0) break;

    jobs.push(...results);
    start += results.length;
  }

  return jobs;
}

function extractCities(jobs) {
  const cities = new Set();

  for (const job of jobs) {
    const city = job?.job?.byner__Job_location__c;

    if (city && city.trim()) {
      cities.add(city.trim());
    }
  }

  return cities;
}

async function fetchWebflowCities() {
  const items = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${WEBFLOW_API_BASE}/collections/${WEBFLOW_CITY_COLLECTION_ID}/items?offset=${offset}&limit=${limit}`;

    const data = await fetchJson(url, {
      headers: {
        Authorization: `Bearer ${WEBFLOW_TOKEN}`,
        Accept: "application/json",
      },
    });

    const pageItems = data.items || [];

    if (pageItems.length === 0) break;

    items.push(...pageItems);

    if (pageItems.length < limit) break;

    offset += pageItems.length;
  }

  return items;
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function createCity(name) {
  const slug = slugify(name);

  const url = `${WEBFLOW_API_BASE}/collections/${WEBFLOW_CITY_COLLECTION_ID}/items`;

  await fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WEBFLOW_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      fieldData: {
        name,
        slug,
      },
    }),
  });
}

async function deleteCity(id) {
  const url = `${WEBFLOW_API_BASE}/collections/${WEBFLOW_CITY_COLLECTION_ID}/items/${id}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${WEBFLOW_TOKEN}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete failed: ${text}`);
  }
}

async function publishWebflowSite() {
  const domainsUrl = `${WEBFLOW_API_BASE}/sites/${WEBFLOW_SITE_ID}/custom_domains`;

  const domainsData = await fetchJson(domainsUrl, {
    headers: {
      Authorization: `Bearer ${WEBFLOW_TOKEN}`,
      Accept: "application/json",
    },
  });

  const domainIds = (domainsData.customDomains || [])
    .map((domain) => domain.id)
    .filter(Boolean);

  console.log("Domains response:", JSON.stringify(domainsData, null, 2));
  console.log("Domain IDs:", domainIds);

  if (domainIds.length === 0) {
    throw new Error("No valid Webflow domain IDs found for publish.");
  }

  const publishUrl = `${WEBFLOW_API_BASE}/sites/${WEBFLOW_SITE_ID}/publish`;

  const res = await fetch(publishUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WEBFLOW_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      customDomains: domainIds,
      publishToWebflowSubdomain: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Publish failed: ${text}`);
  }
}

async function main() {
  console.log("Fetching jobs...");

  const jobs = await fetchAllJobs();
  const cities = extractCities(jobs);

  console.log("Cities from API:", cities.size);

  const webflowCities = await fetchWebflowCities();
  const existing = new Map();

  for (const city of webflowCities) {
    const name = city.fieldData?.name;
    if (name) {
      existing.set(name, city.id);
    }
  }

  let changes = false;

  for (const city of cities) {
    if (!existing.has(city)) {
      console.log("Creating city:", city);
      await createCity(city);
      changes = true;
    }
  }

  for (const [name, id] of existing.entries()) {
    if (!cities.has(name)) {
      console.log("Deleting city:", name);
      await deleteCity(id);
      changes = true;
    }
  }

  if (changes) {
    console.log("Publishing site...");
    await publishWebflowSite();
    console.log("Publish finished.");
  }

  console.log("City sync finished.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
