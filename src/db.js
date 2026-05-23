const Database = require('better-sqlite3')

const dbPath = process.env.STONKER_DB_PATH || './investments.db'
const db = new Database(dbPath)

// db setup
db.prepare(`
    CREATE TABLE IF NOT EXISTS investment (
        stockTicker  VARCHAR(8) NOT NULL,
        stockPrice   REAL,
        initialValue REAL,
        value        REAL,
        minValue     REAL,
        maxValue     REAL,
        PRIMARY KEY (stockTicker)
    )`
).run()

// EXPORTS

exports.formatRow = (row) => {
    const stockPriceStr = row.stockPrice == null ? "??" : row.stockPrice.toFixed(2)

    if (row.value == null) {
        const fmt = `${row.stockTicker}
                     Price: $${stockPriceStr}
                     Invested: $??`
        return fmt.replace(/\n\s+/g, "\n")
    }

    const diff = row.value - row.initialValue
    const diffStr = (diff >= 0 ? "+$" : "-$") + Math.abs(diff).toFixed(2)

    const fmt = `${row.stockTicker}
                 Price: $${stockPriceStr}
                 Invested: $${row.initialValue.toFixed(2)} | Now: $${row.value.toFixed(2)}
                 Change: ${diffStr} | Min: $${row.minValue.toFixed(2)} Max: $${row.maxValue.toFixed(2)}`
    return fmt.replace(/\n\s+/g, "\n")
}

exports.getStock = (ticker) => {
    return db.prepare(`
        SELECT * FROM investment
        WHERE stockTicker == @ticker`
    ).get({ ticker })
}

exports.getStocks = () => {
    return db.prepare('SELECT * FROM investment').all()
}

exports.addStock = (ticker) => {
    return db.prepare(`
        INSERT INTO investment (stockTicker) VALUES (@ticker)
        ON CONFLICT(stockTicker) DO NOTHING
        RETURNING *`
    ).get({ ticker })
}

exports.delStock = (ticker) => {
    return db.prepare(`
        DELETE FROM investment
        WHERE stockTicker == @ticker
        RETURNING *`
    ).get({ ticker })
}

exports.updateStock = db.transaction((ticker, price) => {
    const b4 = exports.getStock(ticker)
    if (!b4) return undefined

    const now = db.prepare(`
        UPDATE investment SET
            value = CASE
                WHEN stockPrice IS NOT NULL AND value IS NOT NULL
                THEN value * @price / stockPrice
                ELSE value
            END,
            stockPrice = @price
        WHERE stockTicker == @ticker
        RETURNING *`
    ).get({ ticker, price })
    if (!now) return undefined

    const inRangeX = (v, min, max) => {
        if ([v, min, max].some((x) => x == null)) return false
        return min < v && v < max
    }

    const inRangeB4 = inRangeX(b4.value, b4.minValue, b4.maxValue)
    const inRangeNow = inRangeX(now.value, now.minValue, now.maxValue)
    return (inRangeB4 == inRangeNow) ? undefined : now
})

exports.invest = (ticker, value, diff, upDiff) => {
    return db.prepare(`
        UPDATE investment SET
            initialValue = @value,
            value = @value,
            minValue = @value - @diff,
            maxValue = @value + @upDiff
        WHERE stockTicker == @ticker AND stockPrice IS NOT NULL
        RETURNING *`
    ).get({ ticker, value, diff, upDiff })
}

exports.close = () => db.close()
