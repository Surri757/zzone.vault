import { mkdir, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = path.join(ROOT_DIR, "data", "stock-catalog.json");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "Chrome/131.0.0.0 Safari/537.36 Zz.one-Vault-Catalog/1.0";

const URLS = {
  sse: "https://query.sse.com.cn/sseQuery/commonQuery.do",
  szse: "http://www.szse.cn/api/report/ShowReport/data",
  bse: "https://www.bse.cn/nqxxController/nqxxCnzq.do",
  nasdaq: "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
  other: "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"
};

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchText(url, init, label, attempts = 3) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();

      if (response.ok) return text;

      const error = new Error(`${label} returned HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 408 && response.status !== 429) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt + 1 < attempts) await delay(500 * 2 ** attempt);
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} request failed`);
}

function parseJsonOrJsonp(text, label) {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const objectStart = trimmed.indexOf("{");
    const arrayStart = trimmed.indexOf("[");
    const starts = [objectStart, arrayStart].filter((index) => index >= 0);
    const start = starts.length > 0 ? Math.min(...starts) : -1;

    if (start < 0) throw new Error(`${label} did not return JSON or JSONP`);

    const closingCharacter = trimmed[start] === "[" ? "]" : "}";
    const end = trimmed.lastIndexOf(closingCharacter);
    if (end <= start) throw new Error(`${label} returned malformed JSONP`);

    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value) {
  const text = cleanText(value);
  if (!text || text === "-" || /^0+$/.test(text)) return undefined;

  const digits = text.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  return text;
}

function optionalField(key, value) {
  const text = cleanText(value);
  return text ? { [key]: text } : {};
}

function sinaUsSymbol(symbol) {
  return `gb_${symbol.replaceAll(".", "$").toLowerCase()}`;
}

function assertMinimum(label, actual, minimum) {
  if (actual < minimum) {
    throw new Error(`${label} returned only ${actual} rows; refusing to replace the catalog`);
  }
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}

async function fetchSseBoard(stockType, sourceId, board) {
  const url = new URL(URLS.sse);
  const parameters = {
    jsonCallBack: "jsonpCallback",
    isPagination: "true",
    sqlId: "COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L",
    productid: "",
    type: "inParams",
    STOCK_CODE: "",
    REG_PROVINCE: "",
    STOCK_TYPE: stockType,
    COMPANY_STATUS: "2,4,5,7,8",
    "pageHelp.pageSize": "10000",
    "pageHelp.pageNo": "1",
    "pageHelp.beginPage": "1",
    "pageHelp.cacheSize": "1",
    "pageHelp.endPage": "1"
  };

  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);

  const text = await fetchText(
    url,
    {
      headers: {
        Referer: "https://www.sse.com.cn/assortment/stock/list/share/",
        "User-Agent": USER_AGENT
      }
    },
    `SSE ${board}`
  );
  const payload = parseJsonOrJsonp(text, `SSE ${board}`);
  const rows = Array.isArray(payload.result)
    ? payload.result
    : Array.isArray(payload.pageHelp?.data)
      ? payload.pageHelp.data
      : [];

  const items = rows
    .map((row) => {
      const symbol = cleanText(row.A_STOCK_CODE);
      const name = cleanText(row.SEC_NAME_CN || row.COMPANY_ABBR || row.SEC_NAME_FULL);
      if (!/^\d{6}$/.test(symbol) || !name) return null;

      return {
        id: `CN:XSHG:${symbol}`,
        market: "CN",
        exchange: "XSHG",
        symbol,
        name,
        ...optionalField("nameEn", row.COMPANY_ABBR_EN || row.FULL_NAME_IN_ENGLISH),
        securityType: "common-stock",
        board,
        currency: "CNY",
        provider: "sina",
        providerSymbol: `sh${symbol}`,
        ...optionalField("sector", row.CSRC_CODE_DESC),
        ...(normalizeDate(row.LIST_DATE) ? { listDate: normalizeDate(row.LIST_DATE) } : {}),
        source: sourceId
      };
    })
    .filter(Boolean);

  return {
    items,
    source: {
      id: sourceId,
      name: `Shanghai Stock Exchange ${board}`,
      url: url.toString(),
      count: items.length
    }
  };
}

function szseReport(payload) {
  if (!Array.isArray(payload)) return null;
  return payload.find((entry) => entry?.metadata?.tabkey === "tab1") ?? payload[0] ?? null;
}

async function fetchSzsePage(page) {
  const url = new URL(URLS.szse);
  url.searchParams.set("SHOWTYPE", "JSON");
  url.searchParams.set("CATALOGID", "1110");
  url.searchParams.set("TABKEY", "tab1");
  url.searchParams.set("PAGENO", String(page));
  url.searchParams.set("random", String(Math.random()));

  const text = await fetchText(
    url,
    {
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        Referer: "https://www.szse.cn/market/product/stock/list/index.html",
        "User-Agent": USER_AGENT,
        "X-Requested-With": "XMLHttpRequest"
      }
    },
    `SZSE page ${page}`
  );
  const report = szseReport(parseJsonOrJsonp(text, `SZSE page ${page}`));
  if (!report || !Array.isArray(report.data)) throw new Error(`SZSE page ${page} is malformed`);
  return report;
}

async function fetchSzse() {
  const first = await fetchSzsePage(1);
  const pageCount = Number(first.metadata?.pagecount ?? 1);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 1000) {
    throw new Error(`SZSE returned invalid page count ${pageCount}`);
  }

  const remainingPages = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
  const reports = await mapWithConcurrency(remainingPages, 6, fetchSzsePage);
  const rows = [first, ...reports].flatMap((report) => report.data);
  const items = rows
    .map((row) => {
      const symbol = cleanText(row.agdm);
      const name = cleanText(row.agjc);
      if (!/^\d{6}$/.test(symbol) || !name) return null;

      const listDate = normalizeDate(row.agssrq);
      return {
        id: `CN:XSHE:${symbol}`,
        market: "CN",
        exchange: "XSHE",
        symbol,
        name,
        securityType: "common-stock",
        ...optionalField("board", row.bk),
        currency: "CNY",
        provider: "sina",
        providerSymbol: `sz${symbol}`,
        ...optionalField("sector", row.sshymc),
        ...(listDate ? { listDate } : {}),
        source: "szse-a"
      };
    })
    .filter(Boolean);

  assertMinimum("SZSE", items.length, 2000);
  return {
    items,
    source: {
      id: "szse-a",
      name: "Shenzhen Stock Exchange A-share list",
      url: URLS.szse,
      ...optionalField("asOf", first.metadata?.subname),
      count: items.length
    }
  };
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  return value ? value.split(";", 1)[0] : "";
}

async function fetchBsePage(page, session) {
  let lastError;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const body = new URLSearchParams();
    body.append("page", String(page));
    body.append("typejb", "T");
    body.append("xxfcbj[]", "2");
    body.append("xxzqdm", "");
    body.append("sortfield", "xxzqdm");
    body.append("sorttype", "asc");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    try {
      const response = await fetch(URLS.bse, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          ...(session.cookie ? { Cookie: session.cookie } : {}),
          "User-Agent": USER_AGENT
        },
        body
      });
      const nextCookie = cookieFrom(response);
      if (nextCookie) session.cookie = nextCookie;

      if (response.status >= 300 && response.status < 400) {
        lastError = new Error(`BSE page ${page} redirected through its request guard`);
        continue;
      }

      const text = await response.text();
      if (!response.ok) throw new Error(`BSE page ${page} returned HTTP ${response.status}`);

      const payload = parseJsonOrJsonp(text, `BSE page ${page}`);
      const report = Array.isArray(payload) ? payload[0] : payload;
      if (!report || !Array.isArray(report.content)) {
        throw new Error(`BSE page ${page} is malformed`);
      }
      return report;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt + 1 < 5) await delay(300 * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error(`BSE page ${page} failed`);
}

async function fetchBse() {
  const session = { cookie: "" };
  const first = await fetchBsePage(0, session);
  const totalPages = Number(first.totalPages ?? 1);
  if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > 1000) {
    throw new Error(`BSE returned invalid page count ${totalPages}`);
  }

  const reports = [first];
  for (let page = 1; page < totalPages; page += 1) {
    reports.push(await fetchBsePage(page, session));
  }

  const rows = reports.flatMap((report) => report.content);
  const items = rows
    .map((row) => {
      const symbol = cleanText(row.xxzqdm);
      const name = cleanText(row.xxzqjc);
      if (!/^\d{6}$/.test(symbol) || !name) return null;

      const listDate = normalizeDate(row.fxssrq || row.xxgprq);
      return {
        id: `CN:XBSE:${symbol}`,
        market: "CN",
        exchange: "XBSE",
        symbol,
        name,
        ...optionalField("nameEn", row.xxywjc),
        securityType: "common-stock",
        board: "BSE",
        currency: "CNY",
        provider: "sina",
        providerSymbol: `bj${symbol}`,
        ...optionalField("sector", row.xxhyzl),
        ...(listDate ? { listDate } : {}),
        source: "bse-listed"
      };
    })
    .filter(Boolean);

  assertMinimum("BSE", items.length, 100);
  const sourceAsOf = rows
    .map((row) => normalizeDate(row.xxjsrq))
    .filter(Boolean)
    .sort()
    .at(-1);

  return {
    items,
    source: {
      id: "bse-listed",
      name: "Beijing Stock Exchange listed companies",
      url: URLS.bse,
      ...(sourceAsOf ? { asOf: sourceAsOf } : {}),
      count: items.length
    }
  };
}

function parsePipeFile(text) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headers = lines[0].split("|");
  const rows = [];
  let fileCreationTime;

  for (const line of lines.slice(1)) {
    if (line.startsWith("File Creation Time")) {
      fileCreationTime = line
        .split("|", 1)[0]
        .replace(/^File Creation Time:\s*/, "") || undefined;
      continue;
    }

    const values = line.split("|");
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    rows.push(row);
  }

  return { rows, fileCreationTime };
}

function inferUsSecurityType(name) {
  const normalized = name.toLowerCase();
  if (/\bwarrants?\b/.test(normalized)) return "warrant";
  if (/\brights?\b/.test(normalized)) return "right";
  if (/\bunits?\b/.test(normalized)) return "unit";
  if (/american depositary|\bads\b|\badr\b/.test(normalized)) return "adr";
  if (/preferred|preference/.test(normalized)) return "preferred-stock";
  if (/real estate investment trust|\breit\b/.test(normalized)) return "reit";
  if (/closed-end|\bfund\b/.test(normalized)) return "fund";
  if (/\bnotes?\b|\bbonds?\b|debentures?/.test(normalized)) return "debt";
  return "common-stock";
}

function usInstrument({ symbol, name, exchange, source }) {
  return {
    id: `US:${exchange}:${symbol}`,
    market: "US",
    exchange,
    symbol,
    name,
    securityType: inferUsSecurityType(name),
    currency: "USD",
    provider: "sina",
    providerSymbol: sinaUsSymbol(symbol),
    source
  };
}

const US_STOCK_SECURITY_TYPES = new Set([
  "common-stock",
  "preferred-stock",
  "adr",
  "reit"
]);

async function fetchNasdaqTrader() {
  const [nasdaqText, otherText] = await Promise.all([
    fetchText(URLS.nasdaq, { headers: { "User-Agent": USER_AGENT } }, "Nasdaq listed file"),
    fetchText(URLS.other, { headers: { "User-Agent": USER_AGENT } }, "Nasdaq other-listed file")
  ]);
  const nasdaq = parsePipeFile(nasdaqText);
  const other = parsePipeFile(otherText);

  const nasdaqItems = nasdaq.rows
    .filter((row) => row.Symbol && row.ETF === "N" && row["Test Issue"] === "N")
    .map((row) =>
      usInstrument({
        symbol: cleanText(row.Symbol),
        name: cleanText(row["Security Name"]),
        exchange: "XNAS",
        source: "nasdaq-listed"
      })
    )
    .filter((item) => US_STOCK_SECURITY_TYPES.has(item.securityType));

  const exchangeMap = {
    A: "XASE",
    N: "XNYS",
    P: "ARCX",
    Z: "BATS",
    V: "IEXG"
  };
  const otherItems = other.rows
    .filter((row) => row["ACT Symbol"] && row.ETF === "N" && row["Test Issue"] === "N")
    .map((row) => {
      const symbol = cleanText(row["ACT Symbol"]);
      const exchangeCode = cleanText(row.Exchange);
      return usInstrument({
        symbol,
        name: cleanText(row["Security Name"]),
        exchange: exchangeMap[exchangeCode] ?? `US-${exchangeCode || "OTHER"}`,
        source: "nasdaq-other-listed"
      });
    })
    .filter((item) => US_STOCK_SECURITY_TYPES.has(item.securityType));

  assertMinimum("Nasdaq listed", nasdaqItems.length, 1000);
  assertMinimum("Nasdaq other-listed", otherItems.length, 1000);

  return {
    items: [...nasdaqItems, ...otherItems],
    sources: [
      {
        id: "nasdaq-listed",
        name: "NasdaqTrader Nasdaq-listed symbol directory",
        url: URLS.nasdaq,
        ...optionalField("asOf", nasdaq.fileCreationTime),
        count: nasdaqItems.length
      },
      {
        id: "nasdaq-other-listed",
        name: "NasdaqTrader other-listed symbol directory",
        url: URLS.other,
        ...optionalField("asOf", other.fileCreationTime),
        count: otherItems.length
      }
    ]
  };
}

function validateAndSort(items) {
  const byId = new Map();

  for (const item of items) {
    if (!item.id || !item.market || !item.exchange || !item.symbol || !item.name) {
      throw new Error(`Catalog contains an incomplete instrument: ${JSON.stringify(item)}`);
    }
    if (byId.has(item.id)) throw new Error(`Duplicate stock catalog id: ${item.id}`);
    byId.set(item.id, item);
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id, "en"));
}

// Fallback: load existing catalog to preserve data from blocked sources
let existingItems = [];
let existingSources = [];
try {
  const existingRaw = readFileSync(OUTPUT_PATH, "utf8");
  const existing = JSON.parse(existingRaw);
  if (Array.isArray(existing.items)) existingItems = existing.items;
  if (Array.isArray(existing.sources)) existingSources = existing.sources;
  console.log(`Loaded ${existingItems.length} existing catalog entries as fallback`);
} catch {
  console.log("No existing catalog to use as fallback");
}

function existingItemsBySource(sourceId) {
  return existingItems.filter((item) => item.source === sourceId);
}

function existingSourceById(sourceId) {
  return existingSources.find((s) => s.id === sourceId) ?? null;
}

// Fetch each source independently; fall back to existing data on failure
async function fetchOrFallback(fetcher, sourceId, label, minCount) {
  try {
    const result = await fetcher();
    if (result.items) {
      assertMinimum(label, result.items.length, minCount ?? 1);
      return result;
    }
    // Single array result (items only, no source wrapper)
    if (Array.isArray(result)) {
      assertMinimum(label, result.length, minCount ?? 1);
      return result;
    }
    throw new Error(`${label} returned unexpected format`);
  } catch (error) {
    const fallbackItems = existingItemsBySource(sourceId);
    const fallbackSource = existingSourceById(sourceId);
    if (fallbackItems.length > 0) {
      console.warn(`${label} unavailable, using ${fallbackItems.length} cached entries (${error.message})`);
      return {
        items: fallbackItems,
        source: fallbackSource ?? {
          id: sourceId,
          name: label,
          url: "cached",
          count: fallbackItems.length
        }
      };
    }
    console.warn(`${label} unavailable and no cache, skipping (${error.message})`);
    return { items: [], source: { id: sourceId, name: label, url: "unavailable", count: 0 } };
  }
}

async function main() {
  const generatedAt = new Date().toISOString();

  // Fetch all sources with fallback
  const sseMain = await fetchOrFallback(
    () => fetchSseBoard("1", "sse-main-a", "Main Board A-share"),
    "sse-main-a", "SSE Main Board", 1000
  );
  const sseStar = await fetchOrFallback(
    () => fetchSseBoard("8", "sse-star", "STAR Market"),
    "sse-star", "SSE STAR Market", 400
  );
  const szseResult = await fetchOrFallback(
    fetchSzse, "szse-a", "SZSE A-share", 2000
  );
  const bseResult = await fetchOrFallback(
    fetchBse, "bse-listed", "BSE listed companies", 100
  );
  const usResult = await fetchOrFallback(
    fetchNasdaqTrader, "nasdaq-combined", "Nasdaq", 2000
  );

  // Flatten US result (which returns { items, sources })
  const usItems = usResult.items ?? usResult;
  const usSources = usResult.sources ?? [usResult.source];

  const items = validateAndSort([
    ...sseMain.items,
    ...sseStar.items,
    ...szseResult.items,
    ...bseResult.items,
    ...usItems
  ]);
  assertMinimum("Combined stock catalog", items.length, 7000);

  const catalog = {
    catalogAsOf: generatedAt,
    sources: [
      sseMain.source,
      sseStar.source,
      szseResult.source,
      bseResult.source,
      ...usSources
    ],
    items
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(catalog)}\n`, "utf8");
  await rename(temporaryPath, OUTPUT_PATH);

  const counts = items.reduce(
    (result, item) => {
      result[item.market] += 1;
      result[item.exchange] = (result[item.exchange] ?? 0) + 1;
      return result;
    },
    { CN: 0, US: 0 }
  );
  console.log(
    JSON.stringify(
      {
        output: path.relative(ROOT_DIR, OUTPUT_PATH),
        catalogAsOf: generatedAt,
        total: items.length,
        counts
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
