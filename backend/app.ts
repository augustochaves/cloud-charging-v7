import express from "express";
import { createClient, WatchError } from "redis";
import { json } from "body-parser";

const DEFAULT_BALANCE = 100;

interface ChargeResult {
    isAuthorized: boolean;
    remainingBalance: number;
    charges: number;
}

async function connect(): Promise<ReturnType<typeof createClient>> {
    const url = `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`;
    console.log(`Using redis URL ${url}`);
    const client = createClient({ url });
    await client.connect();
    return client;
}

async function reset(account: string): Promise<void> {
    const client = await connect();
    try {
        await client.set(`${account}/balance`, DEFAULT_BALANCE);
    } finally {
        await client.disconnect();
    }
}

async function charge(account: string, charges: number): Promise<ChargeResult> {
    const client = await connect();
    try {
        const maxRetries = 10; // Maximum number of retry attempts to prevent infinity loop
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            await client.watch(`${account}/balance`);
            const balanceStr = await client.get(`${account}/balance`);
            const balance = parseInt(balanceStr ?? "0");

            if (balance < charges) {
                await client.unwatch();
                return { isAuthorized: false, remainingBalance: balance, charges: 0 };
            }

            const transaction = client.multi().set(`${account}/balance`, balance - charges);
            let result;
            try {
                result = await transaction.exec();
                if (result) {
                    return { isAuthorized: true, remainingBalance: balance - charges, charges };
                }
            } catch (error) {
                if (!(error instanceof WatchError)) {
                    throw error; // Propagate errors that are not WatchError
                }
                // In case of WatchError, the loop will try again
            }
            // Wait a brief period before retrying (optional)
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Failed to charge after maximum retries");
    } catch (error) {
        console.error("Error in charging process", error);
        throw error;
    } finally {
        await client.disconnect();
    }
}

async function balance(account: string): Promise<{ balance: number }> {
    const client = await connect();
    try {
        const balance = parseInt((await client.get(`${account}/balance`)) ?? "");

        return { balance };
    } finally {
        await client.disconnect();
    }
}

export function buildApp(): express.Application {
    const app = express();
    app.use(json());
    app.post("/reset", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            await reset(account);
            console.log(`Successfully reset account ${account}`);
            res.sendStatus(204);
        } catch (e) {
            console.error("Error while resetting account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    app.post("/charge", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            const result = await charge(account, req.body.charges ?? 10);
            console.log(`Successfully charged account ${account}`);
            res.status(200).json(result);
        } catch (e) {
            console.error("Error while charging account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    app.get("/balance", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            console.log("account", account);
            const result = await balance(account);
            res.status(200).json(result);
        } catch (e) {
            console.error("Error while checking account balance", e);
            res.status(500).json({ error: String(e) });
        }
    });
    return app;
}
