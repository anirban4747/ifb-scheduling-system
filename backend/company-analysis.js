/**
 * Company fulfillment analysis: what was scheduled vs what was dispatched.
 *
 * ONE PLACE TO CHANGE THE COLUMN MAPPING
 * Each uploaded row holds monthly values in these fields:
 *   monthlyCommitments -> the Excel "<Mon> schedule" column (the company's monthly schedule / commitment)
 *   monthlySchedules   -> the Excel "Actual customer scheule" column (what the customer asked for)
 *   monthlyDispatches  -> the Excel "Dispatch QTY" column
 * basis "schedule" measures dispatch against the company schedule, basis "actual" against the customer's request.
 * If a diagnostic shows the fields are named differently in your stored records, change ONLY this object.
 */
const BASIS_FIELDS = {
    schedule: "monthlyCommitments",
    actual: "monthlySchedules"
};
const DISPATCH_FIELD = "monthlyDispatches";

const { normalizeCustomer } = require("./customer-normalizer");

const toNumber = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;      // keep decimals: no rounding anywhere in this file
};

const fillRatePct = (dispatched, scheduled) => (scheduled > 0 ? (dispatched / scheduled) * 100 : null);

/* blank or purely numeric line values are data-entry problems: group them as "Uncategorized" */
function lineKind(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return { name: "Uncategorized", problem: "blank" };
    if (/^\d+$/.test(text)) return { name: "Uncategorized", problem: "numeric", value: text };
    return { name: text, problem: null };
}

const newBucket = () => ({ scheduled: 0, dispatched: 0, shortfall: 0, surplus: 0 });

/* shortfall and surplus are worked out per part and per month, then added up.
   They are never taken from the difference of two totals, so a part that over-ships
   in one month does not hide a shortfall in another. */
function addMonth(bucket, scheduled, dispatched) {
    bucket.scheduled += scheduled;
    bucket.dispatched += dispatched;
    bucket.shortfall += Math.max(scheduled - dispatched, 0);
    bucket.surplus += Math.max(dispatched - scheduled, 0);
}

function calculateCompanyFulfillment(rows, options = {}) {
    if (!Array.isArray(rows)) {
        throw new Error("rows must be an array");
    }

    const {
        customer = "ALL",
        line = "ALL",
        fromMonth = null,
        toMonth = null,
        basis = "schedule",
        target = 95
    } = options;

    const basisField = BASIS_FIELDS[basis] || BASIS_FIELDS.schedule;
    const inRange = month => (!fromMonth || month >= fromMonth) && (!toMonth || month <= toMonth);

    const overall = newBucket();
    const byMonth = new Map();
    const byLine = new Map();
    const byCustomer = new Map();
    const byPart = new Map();               // keyed by customer + part: one part number can go to several customers

    const quality = {
        missingBasisField: [],
        blankLine: [],
        numericLine: [],
        duplicates: [],
        customerInconsistencies: []
    };
    const seenCustomerPart = new Map();
    const codesByCustomer = new Map();
    let rowsUsed = 0;
    let rowsMissingBasis = 0;

    rows.forEach(row => {
        if (!row || typeof row !== "object") return;

        const norm = normalizeCustomer(row.customer, row.customerName2, row.customerCode);
        const customerName = norm.name;
        const lineInfo = lineKind(row.line);
        const lineName = lineInfo.name;

        if (customer !== "ALL" && customerName !== customer && norm.group !== customer) return;
        if (line !== "ALL" && lineName !== String(line)) return;

        const basisValues = row[basisField];
        if (!basisValues || typeof basisValues !== "object") {
            rowsMissingBasis++;                 // never fall back to another column: that is how wrong numbers slipped in
            return;
        }
        const dispatchValues = row[DISPATCH_FIELD] && typeof row[DISPATCH_FIELD] === "object" ? row[DISPATCH_FIELD] : {};

        rowsUsed++;
        const partNo = String(row.partNo ?? "").trim();
        const label = { slNo: row.serialNo ?? "", customer: customerName, partNo };

        /* data quality is reported for every row in scope, with enough detail to find it in the Excel */
        if (lineInfo.problem === "blank") quality.blankLine.push(label);
        if (lineInfo.problem === "numeric") quality.numericLine.push({ ...label, value: lineInfo.value });
        if (!codesByCustomer.has(customerName)) codesByCustomer.set(customerName, new Set());
        if (norm.code !== undefined && norm.code !== null && norm.code !== "") codesByCustomer.get(customerName).add(String(norm.code));

        const partKey = `${customerName}|${partNo}`;
        if (partNo) {
            if (seenCustomerPart.has(partKey)) quality.duplicates.push({ ...label, firstSeenSlNo: seenCustomerPart.get(partKey) });
            else seenCustomerPart.set(partKey, row.serialNo ?? "");
        }

        /* months come from BOTH the schedule field and the dispatch field, so dispatch is never lost */
        const months = new Set([...Object.keys(basisValues), ...Object.keys(dispatchValues)]);

        months.forEach(month => {
            if (!inRange(month)) return;
            const scheduled = toNumber(basisValues[month]);
            const dispatched = toNumber(dispatchValues[month]);

            addMonth(overall, scheduled, dispatched);

            if (!byMonth.has(month)) byMonth.set(month, newBucket());
            addMonth(byMonth.get(month), scheduled, dispatched);

            if (!byLine.has(lineName)) byLine.set(lineName, { ...newBucket(), parts: new Set() });
            addMonth(byLine.get(lineName), scheduled, dispatched);
            if (partNo) byLine.get(lineName).parts.add(partKey);

            if (!byCustomer.has(customerName)) byCustomer.set(customerName, { ...newBucket(), parts: new Set(), group: norm.group || "Unknown" });
            addMonth(byCustomer.get(customerName), scheduled, dispatched);
            if (partNo) byCustomer.get(customerName).parts.add(partNo);

            if (partNo) {
                if (!byPart.has(partKey)) {
                    byPart.set(partKey, {
                        ...newBucket(),
                        partNo,
                        description: row.productDescription || row.description || "",
                        customer: customerName,
                        line: lineName
                    });
                }
                addMonth(byPart.get(partKey), scheduled, dispatched);
            }
        });
    });

    if (rowsUsed === 0 && rowsMissingBasis > 0) {
        quality.missingBasisField.push(
            `${rowsMissingBasis} row(s) have no "${basisField}" values, so basis "${basis}" cannot be calculated. Re-upload the Excel file with the current parser.`
        );
    }
    codesByCustomer.forEach((codes, name) => {
        if (codes.size > 1) quality.customerInconsistencies.push({ customer: name, codes: Array.from(codes).join(", ") });
    });

    const monthKeys = Array.from(byMonth.keys()).sort();
    const monthResult = {};
    monthKeys.forEach(month => {
        const b = byMonth.get(month);
        monthResult[month] = { ...b, fillRate: fillRatePct(b.dispatched, b.scheduled) };
    });

    const lineResult = {};
    byLine.forEach((b, name) => {
        lineResult[name] = {
            scheduled: b.scheduled, dispatched: b.dispatched, shortfall: b.shortfall, surplus: b.surplus,
            fillRate: fillRatePct(b.dispatched, b.scheduled), parts: b.parts.size
        };
    });

    const customerResult = {};
    byCustomer.forEach((b, name) => {
        const rate = fillRatePct(b.dispatched, b.scheduled);
        customerResult[name] = {
            scheduled: b.scheduled, dispatched: b.dispatched, shortfall: b.shortfall, surplus: b.surplus,
            fillRate: rate, parts: b.parts.size, group: b.group,
            belowTarget: rate !== null && rate < target ? 1 : 0
        };
    });

    const partList = Array.from(byPart.values()).map(p => ({
        partNo: p.partNo, description: p.description, customer: p.customer, line: p.line,
        scheduled: p.scheduled, dispatched: p.dispatched, shortfall: p.shortfall, surplus: p.surplus,
        fillRate: fillRatePct(p.dispatched, p.scheduled)
    }));
    const topShortfallParts = partList.slice().sort((a, b) => b.shortfall - a.shortfall).slice(0, 10);

    const belowTarget = rate => rate !== null && rate < target;      // items with nothing scheduled are never "below target"

    return {
        overall: {
            scheduled: overall.scheduled,
            dispatched: overall.dispatched,
            fillRate: fillRatePct(overall.dispatched, overall.scheduled),
            shortfall: overall.shortfall,
            surplus: overall.surplus,
            partsBelowTarget: partList.filter(p => belowTarget(p.fillRate)).length,
            customersBelowTarget: Object.values(customerResult).filter(c => belowTarget(c.fillRate)).length,
            target
        },
        byMonth: monthResult,
        byLine: lineResult,
        byCustomer: customerResult,
        topShortfallParts,
        dataQuality: quality,
        meta: { basis, basisField, rowsUsed, rowsMissingBasis }
    };
}

module.exports = { calculateCompanyFulfillment, BASIS_FIELDS };