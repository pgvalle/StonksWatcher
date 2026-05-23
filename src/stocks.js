const MIN_POLL_INTERVAL_MS = 15_000
const DEFAULT_POLL_INTERVAL_MS = 60_000
const DEFAULT_REALTIME_CHECK_TIMEOUT_MS = 5_000
const REALTIME_URL = 'wss://streamer.finance.yahoo.com'

let providers = null
let providersInit = null
const watchedTickers = new Set()

function normalizeTicker(ticker) {
    return ticker.toUpperCase()
}

function parsePollInterval() {
    const raw = Number(process.env.STONKER_POLL_INTERVAL_MS)
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_POLL_INTERVAL_MS
    return Math.max(raw, MIN_POLL_INTERVAL_MS)
}

function parseRealtimeCheckTimeout() {
    const raw = Number(process.env.STONKER_REALTIME_CHECK_TIMEOUT_MS)
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_REALTIME_CHECK_TIMEOUT_MS
    return raw
}

function autoFallbackEnabled() {
    return process.env.STONKER_AUTO_FALLBACK !== 'false'
}

function normalizeUpdate(ticker, data) {
    const id = normalizeTicker(data?.id || data?.symbol || ticker)
    const price = Number(data?.price)

    if (!Number.isFinite(price) || price <= 0) return undefined
    return { id, price }
}

function getWebSocketImpl() {
    return globalThis.WebSocket || require('isomorphic-ws')
}

function checkRealtimeAvailable(timeoutMs = parseRealtimeCheckTimeout()) {
    if (process.env.STONKER_FORCE_REALTIME_UNAVAILABLE === 'true') {
        return Promise.resolve(false)
    }

    return new Promise((resolve) => {
        let ws
        let settled = false
        let opened = false

        function finish(available) {
            if (settled) return
            settled = true
            clearTimeout(timeout)

            try {
                ws?.close()
            } catch (_) {
                // Best-effort cleanup only.
            }

            resolve(available)
        }

        const timeout = setTimeout(() => finish(false), timeoutMs)

        try {
            const WebSocketImpl = getWebSocketImpl()
            ws = new WebSocketImpl(REALTIME_URL)

            ws.onopen = () => {
                opened = true
                finish(true)
            }

            ws.onerror = () => finish(false)
            ws.onclose = () => {
                if (!opened) finish(false)
            }
        } catch (_) {
            finish(false)
        }
    })
}

function createStockSocketProvider() {
    const stockSocket = require('stocksocket') // https://github.com/gregtuc/StockSocket
    const providerWatchedTickers = new Set()

    return {
        name: 'stocksocket',

        watch(ticker, onUpdate) {
            const normalized = normalizeTicker(ticker)
            if (providerWatchedTickers.has(normalized)) return false

            stockSocket.addTicker(normalized, async (data) => {
                const update = normalizeUpdate(normalized, data)
                if (!update) return

                await onUpdate(update)
            })

            providerWatchedTickers.add(normalized)
            return true
        },

        unwatch(ticker) {
            const normalized = normalizeTicker(ticker)
            if (!providerWatchedTickers.has(normalized)) return false

            stockSocket.removeTicker(normalized)
            providerWatchedTickers.delete(normalized)
            return true
        },
    }
}

function createPollingProvider(name, fetchQuotes) {
    const intervalMs = parsePollInterval()
    const watched = new Map()
    let timer = null
    let polling = false

    async function poll() {
        if (polling || watched.size == 0) return

        polling = true
        try {
            const tickers = [...watched.keys()]
            const quotes = await fetchQuotes(tickers)

            for (const quote of quotes) {
                const update = normalizeUpdate(quote.id, quote)
                if (!update) continue

                const callback = watched.get(update.id)
                if (callback) await callback(update)
            }
        } catch (err) {
            console.error(`${name} polling failed:`, err)
        } finally {
            polling = false
        }
    }

    function start() {
        if (timer) return
        timer = setInterval(poll, intervalMs)
        timer.unref?.()
    }

    function stop() {
        if (!timer || watched.size > 0) return
        clearInterval(timer)
        timer = null
    }

    return {
        name,

        watch(ticker, onUpdate) {
            const normalized = normalizeTicker(ticker)
            if (watched.has(normalized)) return false

            watched.set(normalized, onUpdate)
            start()
            poll()
            return true
        },

        unwatch(ticker) {
            const normalized = normalizeTicker(ticker)
            if (!watched.delete(normalized)) return false

            stop()
            return true
        },

        close() {
            watched.clear()
            stop()
        },
    }
}

async function fetchJson(url) {
    const res = await fetch(url, {
        headers: {
            'user-agent': 'Stonker/0.0.1',
            'accept': 'application/json,text/csv,*/*',
        },
    })

    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
}

async function fetchText(url) {
    const res = await fetch(url, {
        headers: {
            'user-agent': 'Stonker/0.0.1',
            'accept': 'text/csv,*/*',
        },
    })

    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.text()
}

async function fetchYahooQuotes(tickers) {
    const symbols = tickers.map(encodeURIComponent).join(',')
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`
    const data = await fetchJson(url)

    return (data.quoteResponse?.result || [])
        .map((quote) => ({
            id: quote.symbol,
            price: quote.regularMarketPrice ?? quote.postMarketPrice ?? quote.preMarketPrice,
        }))
}

function toStooqSymbol(ticker) {
    const suffix = process.env.STONKER_STOOQ_SUFFIX ?? '.us'
    const lower = ticker.toLowerCase()

    if (!suffix || lower.includes('.')) return lower
    return `${lower}${suffix}`
}

function fromStooqSymbol(symbol) {
    const suffix = (process.env.STONKER_STOOQ_SUFFIX ?? '.us').toLowerCase()
    const lower = symbol.toLowerCase()

    if (suffix && lower.endsWith(suffix)) {
        return lower.slice(0, -suffix.length).toUpperCase()
    }

    return symbol.toUpperCase()
}

function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/)
    if (lines.length < 2) return []

    const headers = lines[0].split(',')
    return lines.slice(1).map((line) => {
        const values = line.split(',')
        return Object.fromEntries(headers.map((header, index) => [header, values[index]]))
    })
}

async function fetchStooqQuotes(tickers) {
    const symbols = tickers.map(toStooqSymbol).map(encodeURIComponent).join(',')
    const url = `https://stooq.com/q/l/?s=${symbols}&f=sd2t2ohlcv&h&e=csv`
    const text = await fetchText(url)

    return parseCsv(text)
        .filter((row) => row.Close && row.Close !== 'N/D')
        .map((row) => ({
            id: fromStooqSymbol(row.Symbol),
            price: Number(row.Close),
        }))
}

const providerFactories = {
    yahoo: () => createPollingProvider('yahoo', fetchYahooQuotes),
    stooq: () => createPollingProvider('stooq', fetchStooqQuotes),
}

function configuredProviderNames() {
    const raw = process.env.STONKER_STOCK_PROVIDERS
        || process.env.STONKER_STOCK_PROVIDER
        || 'stocksocket'

    const names = raw.split(',')
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean)
        .map((name) => name == 'socket' ? 'stocksocket' : name)

    return [...new Set(names)]
}

function ensureFallbackProvider(providersList, requestedNames, reason) {
    if (!autoFallbackEnabled()) return
    if (providersList.length > 0) return
    if (!requestedNames.includes('stocksocket')) return

    console.warn(`${reason} Falling back to yahoo polling.`)
    providersList.push(providerFactories.yahoo())
}

async function createProviders() {
    const activeProviders = []
    const requestedNames = configuredProviderNames()

    for (const name of requestedNames) {
        if (name == 'stocksocket') {
            const available = await checkRealtimeAvailable()
            if (!available) {
                console.warn(`StockSocket realtime endpoint is unavailable: ${REALTIME_URL}`)
                continue
            }

            activeProviders.push(createStockSocketProvider())
            continue
        }

        const factory = providerFactories[name]
        if (!factory) {
            throw new Error(`Unknown stock provider "${name}". Use one of: stocksocket, yahoo, stooq.`)
        }

        activeProviders.push(factory())
    }

    ensureFallbackProvider(
        activeProviders,
        requestedNames,
        'No configured realtime provider is available.'
    )

    if (activeProviders.length == 0) {
        throw new Error('At least one stock provider must be configured and available.')
    }

    return activeProviders
}

exports.init = async () => {
    if (providers) return providers
    if (!providersInit) providersInit = createProviders()
    providers = await providersInit
    return providers
}

async function getProviders() {
    return exports.init()
}

exports.watchTicker = async (ticker, onUpdate) => {
    const normalized = normalizeTicker(ticker)
    if (watchedTickers.has(normalized)) return false

    const wrappedCallback = async (data) => {
        try {
            await onUpdate(data)
        } catch (err) {
            console.error(`Stock update handler failed for ${normalized}:`, err)
        }
    }

    let attachedProviders = 0
    for (const provider of await getProviders()) {
        try {
            if (provider.watch(normalized, wrappedCallback)) attachedProviders++
        } catch (err) {
            console.error(`Failed to watch ${normalized} with ${provider.name}:`, err)
        }
    }

    if (attachedProviders == 0) return false

    watchedTickers.add(normalized)
    return true
}

exports.unwatchTicker = async (ticker) => {
    const normalized = normalizeTicker(ticker)
    if (!watchedTickers.has(normalized)) return false

    for (const provider of await getProviders()) {
        try {
            provider.unwatch(normalized)
        } catch (err) {
            console.error(`Failed to unwatch ${normalized} with ${provider.name}:`, err)
        }
    }

    watchedTickers.delete(normalized)
    return true
}

exports.isWatching = (ticker) => {
    return watchedTickers.has(normalizeTicker(ticker))
}

exports.getWatchedTickers = () => {
    return [...watchedTickers].sort()
}

exports.getProviderNames = () => {
    return (providers || []).map((provider) => provider.name)
}

exports.close = async () => {
    for (const ticker of [...watchedTickers]) {
        await exports.unwatchTicker(ticker)
    }

    for (const provider of await getProviders()) {
        provider.close?.()
    }
}

exports.checkRealtimeAvailable = checkRealtimeAvailable
