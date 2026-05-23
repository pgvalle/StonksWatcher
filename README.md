# Stonker

# WARNING: This project is experimental and still under active cleanup

Stonker is a Telegram bot that helps you track stock investments,
notifying you when stock prices change.
No more constantly checking prices—Stonker has you covered.

> **DISCLAIMER:** Invest at your own risk, even with Stonker at your service.
I take no responsibility for any financial outcomes.

---

## Setting up and running

### 1. Requirements

- Node.js **20+**

### 2. Get Your Token

You need a Telegram bot token. Talk to [@BotFather](https://t.me/BotFather) to obtain one.

### 3. Running the Bot

#### Option 1: Without Docker

```sh
git clone https://github.com/pgvalle/Stonker
cd Stonker
npm install
export TELEGRAM_BOT_TOKEN='your_token_here'
# Optional: export STONKER_DB_PATH='./investments.db'
npm start
```

#### Option 2: With Docker

```sh
git clone https://github.com/pgvalle/Stonker
cd Stonker
docker build -t stonker .
docker run \
  -e TELEGRAM_BOT_TOKEN='your_token_here' \
  -e STONKER_DB_PATH='/data/investments.db' \
  -v stonker-data:/data \
  -d stonker
```

### Configuration

Environment variables:

- `TELEGRAM_BOT_TOKEN` - required Telegram bot token from BotFather.
- `STONKER_DB_PATH` - optional SQLite database path. Defaults to `./investments.db`.

### Tests

```sh
npm test
```

## Commands

Commands have short names for speed and readable aliases for recall:

- `/h`, `/help` - list commands or show help for one command.
- `/w`, `/watch` - watch a ticker. Legacy aliases: `/a`, `/add`.
- `/u`, `/unwatch` - stop watching a ticker. Aliases: `/d`, `/del`, `/delete`, `/rm`, `/remove`.
- `/s`, `/stock` - show one ticker or the full watchlist. Aliases: `/l`, `/list`.
- `/i`, `/invest` - create or replace an investment alert.

Examples:

```txt
/w TSLA
/stock TSLA
/i TSLA 100 5
/invest NVDA 500 25 100
/u TSLA
```

Use `/h` to list commands and `/h <command>` for details:

```txt
/h
/h invest
/help ticker
```

`/i` notifies when the simulated investment moves in or out of the configured range:

```txt
/i MSFT 500 5        # range: 495.00 to 505.00
/invest GOOG 100 3 100  # range: 97.00 to 200.00
```

## Data model

SQLite data is split into two tables:

- `watchlist` stores tracked tickers and their last known price.
- `investment` stores the configured investment range for a watched ticker.

Deleting a ticker from `watchlist` cascades and deletes its `investment` row.

This is alpha software; old local database layouts may be discarded during cleanup. If something looks wrong, stop the bot and remove the configured `STONKER_DB_PATH` database file.

## Stock price provider

Stock price watching is isolated behind `src/stocks.js`.
The current implementation still uses `stocksocket`, but the Telegram bot no longer imports it directly.
This keeps command handling independent from the provider and makes it easier to replace `stocksocket` with a polling or API-based provider later.

The provider module exposes:

- `watchTicker(ticker, onUpdate)`
- `unwatchTicker(ticker)`
- `isWatching(ticker)`
- `getWatchedTickers()`

## Motivation

A realization hit me after playing a little bit with the stock market and talking to friends:
Either you are extremely lucky, 
rivileged with relevant information or have time monitor stock prices every second.
But I bet you are none of those, just like me.
So here is Stonker to help you.

## The Journey

I was not familiar with stocks at all.
When I was looking for a way to collect real-time stock data, I thought
[gadicc/node-yahoo-finance2](https://github.com/gadicc/node-yahoo-finance2) was going to help me,
but it turned out not to be what I needed.
After 2 days trying to make sense out of it,
I found [gregtuc/StockSocket](https://github.com/gregtuc/StockSocket),
which was exactly what I needed.

Another challenge was structuring the code.
I started with everything in a single file, but after nearly a week,
I finally managed to reorganize it.
I struggled with design patterns and got frustrated at times,
especially due to my tendency to strive for symmetry and perfection,
which lead to me hanging for hours just trying to make my code "look good".

After a couple weeks of having a half-working release,
I decided to simplify the project.
Initially, I wanted Stonker to watch Stocks for multiple users independently.
However, I decided to go for a single-user approach later,
because this requirement was just complicating everything.

## Technology Stack

- **SQLite3** - I demanded persistence, and sqlite already does the heavylifting of data manipulation for you.
- **NodeJS** - Using it would improve my portfolio.
  Javascript is a big name and I have never played much with it before this project.
- **[yagop/node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)** - Initially, I considered WhatsApp,
  because here in Brazil **EVERYONE** has a Whatsapp account.
  But all the options I had required stuff like creating an account or having a spare phone number.
  Telegram turned out to be a better option.
- **Stock provider abstraction** - `src/stocks.js` isolates stock price watching from bot command handling.
  It currently wraps [gregtuc/StockSocket](https://github.com/gregtuc/StockSocket), which is archived but still works.
- **[Docker](https://www.docker.com/)** - A friend of mine suggested me to use docker.
  I think it was a great idea.

## Future Improvements

If you have suggestions or find bugs, feel free to contribute!

## Meme

Just for the sake of it.

![Stonks](https://media.tenor.com/id8Pj5h70zgAAAAe/stonks.png)
