const stockSocket = require('stocksocket') // https://github.com/gregtuc/StockSocket

const watchedTickers = new Set()
const callbacks = new Map()

function normalizeTicker(ticker) {
    return ticker.toUpperCase()
}

exports.watchTicker = (ticker, onUpdate) => {
    const normalized = normalizeTicker(ticker)
    if (watchedTickers.has(normalized)) return false

    const wrappedCallback = async (data) => {
        try {
            await onUpdate(data)
        } catch (err) {
            console.error(`Stock update handler failed for ${normalized}:`, err)
        }
    }

    stockSocket.addTicker(normalized, wrappedCallback)
    watchedTickers.add(normalized)
    callbacks.set(normalized, wrappedCallback)
    return true
}

exports.unwatchTicker = (ticker) => {
    const normalized = normalizeTicker(ticker)
    if (!watchedTickers.has(normalized)) return false

    stockSocket.removeTicker(normalized)
    watchedTickers.delete(normalized)
    callbacks.delete(normalized)
    return true
}

exports.isWatching = (ticker) => {
    return watchedTickers.has(normalizeTicker(ticker))
}

exports.getWatchedTickers = () => {
    return [...watchedTickers].sort()
}
