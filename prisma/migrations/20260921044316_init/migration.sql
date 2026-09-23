-- CreateTable
CREATE TABLE "Stock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "country" TEXT,
    "sector" TEXT,
    "industry" TEXT,
    "currency" TEXT,
    "assetType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DailyStockState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "tradingDate" TEXT NOT NULL,
    "previous52WeekHigh" REAL,
    "previous52WeekLow" REAL,
    "current52WeekHigh" REAL,
    "current52WeekLow" REAL,
    "lastPrice" REAL,
    "previousPrice" REAL,
    "lastQuoteAt" DATETIME,
    "highTriggered" BOOLEAN NOT NULL DEFAULT false,
    "lowTriggered" BOOLEAN NOT NULL DEFAULT false,
    "highCurrentlyBroken" BOOLEAN NOT NULL DEFAULT false,
    "lowCurrentlyBroken" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyStockState_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "tradingDate" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "reference52WeekPrice" REAL NOT NULL,
    "distanceFromBoundary" REAL NOT NULL,
    "percentFromBoundary" REAL NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketEvent_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "volume" REAL,
    "timestamp" DATETIME NOT NULL,
    CONSTRAINT "QuoteSnapshot_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Stock_symbol_key" ON "Stock"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStockState_stockId_tradingDate_key" ON "DailyStockState"("stockId", "tradingDate");

-- CreateIndex
CREATE INDEX "MarketEvent_tradingDate_idx" ON "MarketEvent"("tradingDate");

-- CreateIndex
CREATE INDEX "MarketEvent_eventType_idx" ON "MarketEvent"("eventType");

-- CreateIndex
CREATE INDEX "MarketEvent_timestamp_idx" ON "MarketEvent"("timestamp");

-- CreateIndex
CREATE INDEX "MarketEvent_stockId_idx" ON "MarketEvent"("stockId");
