import { performance } from "perf_hooks";
import supertest from "supertest";
import { buildApp } from "./app";

const app = supertest(buildApp());

async function basicLatencyTest() {
    await app.post("/reset").expect(204);
    const start = performance.now();
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    console.log(`Latency: ${performance.now() - start} ms`);
}

async function concurrentChargesTest() {
    await app.post("/reset").expect(204);

    const chargeRequests = [];
    for (let i = 0; i < 6; i++) {
        chargeRequests.push(app.post("/charge").send({ account: "account", charges: 20 }).expect(200));
    }

    await Promise.all(chargeRequests);

    const { body } = await app.get("/balance").send({ account: "account" });
    console.log("Expected balance: 0");
    console.log(`Final balance: ${body.balance}`);

    if (body.balance !== 0) {
        throw new Error("concurrent charges failed");
    }
}

async function runTests() {
    await basicLatencyTest();
    await concurrentChargesTest();
}

runTests().catch(console.error);
