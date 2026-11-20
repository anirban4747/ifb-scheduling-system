const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateCompanyFulfillment } = require("./company-analysis");
const { normalizeCustomer } = require("./customer-normalizer");

/* customer names go through the real normalizer, so tests ask it for the final name instead of assuming one */
const nameOf = customer => normalizeCustomer(customer).name;

function makeRow(overrides = {}) {
    return {
        serialNo: 1,
        customer: "Alpha",
        partNo: "P1",
        line: "Radiator",
        productDescription: "Part one",
        monthlyCommitments: { "2026-04": 100, "2026-05": 100 },   // company schedule  (Excel "<Mon> schedule")
        monthlySchedules: { "2026-04": 150, "2026-05": 100 },     // customer request  (Excel "Actual customer scheule")
        monthlyDispatches: { "2026-04": 60, "2026-05": 130 },
        ...overrides
    };
}

test("shortfall and surplus are worked out per part and month, not from totals", () => {
    const result = calculateCompanyFulfillment([makeRow()]);
    // April: 100 scheduled, 60 shipped -> short 40.  May: 100 scheduled, 130 shipped -> surplus 30
    assert.equal(result.overall.scheduled, 200);
    assert.equal(result.overall.dispatched, 190);
    assert.equal(result.overall.shortfall, 40);
    assert.equal(result.overall.surplus, 30);          // not 10 (200 - 190): over-shipping must not hide the April gap
});

test("basis schedule reads the company schedule field, basis actual reads the customer request field", () => {
    const rows = [makeRow()];
    const schedule = calculateCompanyFulfillment(rows, { basis: "schedule" });
    const actual = calculateCompanyFulfillment(rows, { basis: "actual" });
    assert.equal(schedule.overall.scheduled, 200);
    assert.equal(actual.overall.scheduled, 250);
    assert.equal(actual.overall.shortfall, 90);        // April: 150 - 60
});

test("a missing basis field is reported, never replaced by another column", () => {
    const rows = [makeRow({ monthlyCommitments: undefined })];
    const result = calculateCompanyFulfillment(rows, { basis: "schedule" });
    assert.equal(result.overall.scheduled, 0);
    assert.equal(result.dataQuality.missingBasisField.length, 1);
    assert.equal(result.meta.rowsMissingBasis, 1);
});

test("fill rate is a percentage and is null when nothing is scheduled", () => {
    const result = calculateCompanyFulfillment([
        makeRow(),
        makeRow({ partNo: "P2", monthlyCommitments: { "2026-04": 0 }, monthlyDispatches: { "2026-04": 50 } })
    ], { fromMonth: "2026-04", toMonth: "2026-04" });
    assert.equal(Math.round(result.byMonth["2026-04"].fillRate * 10) / 10, 110);          // 110 shipped of 100 scheduled
    const onlyUnscheduled = calculateCompanyFulfillment([
        makeRow({ monthlyCommitments: { "2026-04": 0 }, monthlyDispatches: { "2026-04": 50 } })
    ], { fromMonth: "2026-04", toMonth: "2026-04" });
    assert.equal(onlyUnscheduled.overall.fillRate, null);
    assert.equal(onlyUnscheduled.overall.surplus, 50);                                    // dispatch without a schedule is surplus
});

test("month range keeps only the requested months", () => {
    const result = calculateCompanyFulfillment([makeRow()], { fromMonth: "2026-05", toMonth: "2026-05" });
    assert.deepEqual(Object.keys(result.byMonth), ["2026-05"]);
    assert.equal(result.overall.scheduled, 100);
});

test("dispatch in a month that has no schedule entry is still counted", () => {
    const row = makeRow({ monthlyCommitments: { "2026-04": 100 }, monthlyDispatches: { "2026-04": 60, "2026-05": 25 } });
    const result = calculateCompanyFulfillment([row]);
    assert.equal(result.overall.dispatched, 85);
    assert.equal(result.byMonth["2026-05"].surplus, 25);
});

test("line and customer filters narrow the result", () => {
    const rows = [
        makeRow(),
        makeRow({ customer: "Beta", partNo: "P2", line: "PWM" })
    ];
    assert.equal(calculateCompanyFulfillment(rows, { line: "PWM" }).overall.scheduled, 200);
    assert.equal(calculateCompanyFulfillment(rows, { customer: nameOf("Alpha") }).overall.scheduled, 200);
    assert.equal(calculateCompanyFulfillment(rows).overall.scheduled, 400);
});

test("blank and numeric line values become Uncategorized and are listed with their Sl No", () => {
    const rows = [
        makeRow({ serialNo: 11, partNo: "A", line: "" }),
        makeRow({ serialNo: 12, partNo: "B", line: "50020718" }),
        makeRow({ serialNo: 13, partNo: "C", line: "PWM" })
    ];
    const result = calculateCompanyFulfillment(rows);
    assert.ok(result.byLine.Uncategorized);
    assert.equal(result.byLine.Uncategorized.scheduled, 400);
    assert.equal(result.dataQuality.blankLine[0].slNo, 11);
    assert.equal(result.dataQuality.numericLine[0].value, "50020718");
    assert.equal(Object.keys(result.byLine).some(name => /^\d+$/.test(name)), false);
});

test("the same part number sold to two customers stays as two separate entries", () => {
    const rows = [
        makeRow({ customer: "Alpha", partNo: "SHARED", monthlyDispatches: { "2026-04": 100, "2026-05": 100 } }),
        makeRow({ customer: "Beta", partNo: "SHARED", monthlyDispatches: { "2026-04": 0, "2026-05": 0 } })
    ];
    const result = calculateCompanyFulfillment(rows);
    const shared = result.topShortfallParts.filter(p => p.partNo === "SHARED");
    assert.equal(shared.length, 2);
    assert.equal(shared.find(p => p.customer === nameOf("Beta")).shortfall, 200);
    assert.equal(shared.find(p => p.customer === nameOf("Alpha")).shortfall, 0);
});

test("repeated customer and part rows are reported but never dropped", () => {
    const rows = [makeRow({ serialNo: 1 }), makeRow({ serialNo: 2 })];
    const result = calculateCompanyFulfillment(rows);
    assert.equal(result.overall.scheduled, 400);       // both rows are counted
    assert.equal(result.dataQuality.duplicates.length, 1);
    assert.equal(result.dataQuality.duplicates[0].firstSeenSlNo, 1);
});

test("parts and customers with nothing scheduled are not counted as below target", () => {
    const rows = [
        makeRow({ partNo: "OK", monthlyDispatches: { "2026-04": 100, "2026-05": 100 } }),
        makeRow({ partNo: "BAD", monthlyDispatches: { "2026-04": 10, "2026-05": 10 } }),
        makeRow({ partNo: "NONE", monthlyCommitments: { "2026-04": 0, "2026-05": 0 }, monthlyDispatches: { "2026-04": 0, "2026-05": 0 } })
    ];
    const result = calculateCompanyFulfillment(rows, { target: 95 });
    assert.equal(result.overall.partsBelowTarget, 1);
});

test("decimal quantities are kept, not rounded", () => {
    const row = makeRow({ monthlyCommitments: { "2026-04": 4290.8 }, monthlySchedules: { "2026-04": 4290.8 }, monthlyDispatches: { "2026-04": 4000 } });
    const result = calculateCompanyFulfillment([row], { fromMonth: "2026-04", toMonth: "2026-04" });
    assert.equal(result.overall.scheduled, 4290.8);
    assert.ok(Math.abs(result.overall.shortfall - 290.8) < 1e-9);
});

test("an empty list returns zero totals instead of failing", () => {
    const result = calculateCompanyFulfillment([]);
    assert.equal(result.overall.scheduled, 0);
    assert.equal(result.overall.fillRate, null);
    assert.deepEqual(result.byMonth, {});
});