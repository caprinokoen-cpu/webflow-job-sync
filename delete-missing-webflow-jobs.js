const WEBFLOW_API_BASE = "https://api.webflow.com/v2";

const SOURCE_API_BASE =
  "https://techniekmatch.my.salesforce-sites.com/services/apexrest/byner/BYNER_WEBSITE_REST_API/v2/getJobs";

const WEBFLOW_TOKEN = process.env.WEBFLOW_TOKEN;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;
const WEBFLOW_JOB_ID_FIELD = process.env.WEBFLOW_JOB_ID_FIELD;
const SOURCE_API_KEY = process.env.SOURCE_API_KEY;

const INTERNAL_CHANNEL = "Company website";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function extractJobIds(jobs) {
  const ids = new Set();

  for (const job of jobs) {
    if (job?.job?.Id) {
      ids.add(String(job.job.Id));
    }
  }

  return ids;
}

async function fetchWebflowItems() {
  const items = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${WEBFLOW_API_BASE}/collections/${WEBFLOW_COLLECTION_ID}/items?offset=${offset}&limit=${limit}`;

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

async function deleteWebflowItem(itemId) {
  const url = `${WEBFLOW_API_BASE}/collections/${WEBFLOW_COLLECTION_ID}/items/${itemId}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${WEBFLOW_TOKEN}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete failed: ${text}`);
  }
}

async function main() {
  console.log("Fetching source jobs...");

  const jobs = await fetchAllJobs();
  const jobIds = extractJobIds(jobs);

  console.log("Jobs from API:", jobIds.size);

  console.log("Fetching Webflow items...");

  const webflowItems = await fetchWebflowItems();

  console.log("Webflow items:", webflowItems.length);

  const toDelete = [];

  for (const item of webflowItems) {
    const fieldData = item.fieldData || {};
    const externalId = fieldData[WEBFLOW_JOB_ID_FIELD];

    if (!externalId) continue;

    if (!jobIds.has(String(externalId))) {
      toDelete.push({
        id: item.id,
        name: fieldData.name,
        jobId: externalId,
      });
    }
  }

  console.log("Items to delete:", toDelete.length);

  for (const item of toDelete) {
    console.log(`Deleting: ${item.name} (${item.jobId})`);

    await deleteWebflowItem(item.id);

    await sleep(250);
  }

  console.log("Cleanup finished.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
