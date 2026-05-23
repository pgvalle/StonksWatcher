const Database = require('better-sqlite3')

const dbPath = process.env.STONKER_DB_PATH || './investments.db'
const db = new Database(dbPath)

db.pragma('foreign_keys = ON')

function tableExists(name) {
    return !!db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = @name`
    ).get({ name })
}

function tableHasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all()
        .some((info) => info.name === column)
}

function createSchema() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS watchlist (
            stockTicker VARCHAR(8) NOT NULL,
            stockPrice  REAL,
            PRIMARY KEY (stockTicker)
        )`
    ).run()

    db.prepare(`
        CREATE TABLE IF NOT EXISTS investment (
            stockTicker  VARCHAR(8) NOT NULL,
            initialValue REAL NOT NULL,
            value        REAL NOT NULL,
            minValue     REAL NOT NULL,
            maxValue     REAL NOT NULL,
            PRIMARY KEY (stockTicker),
            FOREIGN KEY (stockTicker)
                REFERENCES watchlist(stockTicker)
                ON DELETE CASCADE
        )`
    ).run()
}

// Alpha schema cleanup: old builds stored watchlist data inside investment.
// Drop that obsolete table shape instead of carrying migration complexity.
if (tableExists('investment') && tableHasColumn('investment', 'stockPrice')) {
    db.prepare('DROP TABLE investment').run()
}

createSchema()

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
        SELECT
            w.stockTicker,
            w.stockPrice,
            i.initialValue,
            i.value,
            i.minValue,
            i.maxValue
        FROM watchlist w
        LEFT JOIN investment i ON i.stockTicker = w.stockTicker
        WHERE w.stockTicker == @ticker`
    ).get({ ticker })
}

exports.getStocks = () => {
    return db.prepare(`
        SELECT
            w.stockTicker,
            w.stockPrice,
            i.initialValue,
            i.value,
            i.minValue,
            i.maxValue
        FROM watchlist w
        LEFT JOIN investment i ON i.stockTicker = w.stockTicker
        ORDER BY w.stockTicker`
    ).all()
}

exports.addStock = (ticker) => {
    const inserted = db.prepare(`
        INSERT INTO watchlist (stockTicker) VALUES (@ticker)
        ON CONFLICT(stockTicker) DO NOTHING
        RETURNING stockTicker`
    ).get({ ticker })

    return inserted ? exports.getStock(ticker) : undefined
}

exports.delStock = db.transaction((ticker) => {
    const row = exports.getStock(ticker)
    if (!row) return undefined

    db.prepare(`
        DELETE FROM watchlist
        WHERE stockTicker == @ticker`
    ).run({ ticker })

    return row
})

exports.updateStock = db.transaction((ticker, price) => {
    const b4 = exports.getStock(ticker)
    if (!b4) return undefined

    db.prepare(`
        UPDATE investment
        SET value = CASE
            WHEN @oldPrice IS NOT NULL AND @oldPrice != 0
            THEN value * @price / @oldPrice
            ELSE value
        END
        WHERE stockTicker == @ticker`
    ).run({ ticker, price, oldPrice: b4.stockPrice })

    db.prepare(`
        UPDATE watchlist
        SET stockPrice = @price
        WHERE stockTicker == @ticker`
    ).run({ ticker, price })

    const now = exports.getStock(ticker)
    if (!now) return undefined

    const inRangeX = (v, min, max) => {
        if ([v, min, max].some((x) => x == null)) return false
        return min < v && v < max
    }

    const inRangeB4 = inRangeX(b4.value, b4.minValue, b4.maxValue)
    const inRangeNow = inRangeX(now.value, now.minValue, now.maxValue)
    return (inRangeB4 == inRangeNow) ? undefined : now
})

exports.invest = db.transaction((ticker, value, diff, upDiff) => {
    const stock = exports.getStock(ticker)
    if (!stock || stock.stockPrice == null) return undefined

    db.prepare(`
        INSERT INTO investment (stockTicker, initialValue, value, minValue, maxValue)
        VALUES (@ticker, @value, @value, @value - @diff, @value + @upDiff)
        ON CONFLICT(stockTicker) DO UPDATE SET
            initialValue = excluded.initialValue,
            value = excluded.value,
            minValue = excluded.minValue,
            maxValue = excluded.maxValue`
    ).run({ ticker, value, diff, upDiff })

    return exports.getStock(ticker)
})

exports.close = () => db.close()
