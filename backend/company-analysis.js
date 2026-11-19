const { normalizeCustomer } = require("./customer-normalizer");
const lineOf = row => (row.line === null || row.line === undefined || String(row.line).trim() === "")
    ? "Uncategorized" : String(row.line).trim();

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

    // Filter rows by customer and line
    let filtered = rows.filter(row => {
        if (!row || typeof row !== "object") return false;
        const normCustomer = normalizeCustomer(row.customer, row.customerName2, row.customerCode);
        const matchesCustomer = customer === "ALL" ||
            normCustomer.name === customer ||
            normCustomer.group === customer;
        const matchesLine = line === "ALL" || lineOf(row) === String(line);
        if (!matchesCustomer || !matchesLine) return false;

        // Filter by month range - keep rows that have at least one month in range
        const rowMonths = Object.keys(row.monthlySchedules || {}).filter(m => {
            if (fromMonth && m < fromMonth) return false;
            if (toMonth && m > toMonth) return false;
            return true;
        });
        return rowMonths.length > 0;
    });

    // Detect duplicate customer-part-month rows
    const groupingKey = (row) => {
        const norm = normalizeCustomer(row.customer, row.customerName2, row.customerCode);
        return norm.name + "|" + row.partNo + "|" + (row.deliveryMonth || "no-month") + "|" + (row.line || "no-line");
    };
    const seen = new Map();
    const duplicates = [];
    filtered.forEach(row => {
        if (!row) return;
        const key = groupingKey(row);
        if (seen.has(key)) {
            duplicates.push({ row, existingRow: seen.get(key), message: "Duplicate: " + row.customer + " / " + row.partNo + " / " + row.deliveryMonth });
        } else {
            seen.set(key, row);
        }
    });
    if (duplicates.length > 0) {
    const dupRows = new Set(duplicates.map(d => d.row));
    filtered = filtered.filter(row => !dupRows.has(row));
}

    // Collect all unique months within the requested range
    const allMonths = (() => {
        const monthSet = new Set();
        filtered.forEach(row => {
            if (row && row.monthlySchedules) {
                Object.keys(row.monthlySchedules).forEach(m => {
                    if ((!fromMonth || m >= fromMonth) && (!toMonth || m <= toMonth)) {
                        monthSet.add(m);
                    }
                });
            }
        });
        return Array.from(monthSet).sort();
    })();

    // Early return if no data
    if (allMonths.length === 0) {
        return {
            overall: { scheduled: 0, dispatched: 0, fillRate: null, shortfall: 0, surplus: 0, partsBelowTarget: 0, customersBelowTarget: 0, target },
            byMonth: {}, byLine: {}, byCustomer: {}, topShortfallParts: [],
            dataQuality: { duplicates: duplicates.length, blankLine: 0, numericLine: 0, customerInconsistencies: [] }
        };
    }

    // Accumulate per-part-month and per-customer stats
    const partMonthData = {};
    const partLineData = {};
    const partMeta = {};
    const partGross = {};
    let grossShortfall = 0, grossSurplus = 0;
    const customerPartData = {};
    const lineData = new Map();
    const customerData = new Map();

    filtered.forEach(row => {
        if (!row) return;
        const normCustomer = normalizeCustomer(row.customer, row.customerName2, row.customerCode);
        const custKey = normCustomer.name;
        const lineKey = lineOf(row);

        if (!lineData.has(lineKey)) {
            lineData.set(lineKey, { scheduled: 0, dispatched: 0, shortfall: 0, surplus: 0, parts: new Set(), months: new Set() });
        }
        const lineStats = lineData.get(lineKey);
        if (row.partNo) lineStats.parts.add(row.partNo);

        if (!customerData.has(custKey)) {
            customerData.set(custKey, { scheduled: 0, dispatched: 0, shortfall: 0, surplus: 0, parts: new Set(), months: new Set() });
        }
        const custStats = customerData.get(custKey);
        custStats.group = normCustomer.group;
        if (row.partNo) custStats.parts.add(row.partNo);

        const rowMonths = Object.keys(row.monthlySchedules || {});
        rowMonths.forEach(monthKey => {
            // Only process months within the requested range
            if ((!fromMonth || monthKey >= fromMonth) && (!toMonth || monthKey <= toMonth)) {
                let scheduled = 0;
                if (basis === "schedule") {
                    scheduled = (row.monthlySchedules && row.monthlySchedules[monthKey] !== undefined ? Number(row.monthlySchedules[monthKey]) : 0);
                } else if (basis === "actual") {
                    scheduled = (row.actualCustomerSchedule && row.actualCustomerSchedule[monthKey] !== undefined ? Number(row.actualCustomerSchedule[monthKey]) : 0);
                } else {
                    scheduled = 0;
                }

                let dispatched = 0;
                if (row.monthlyDispatches && row.monthlyDispatches[monthKey] !== undefined) {
                    dispatched = Number(row.monthlyDispatches[monthKey]);
                }

                if (row.partNo && !partLineData[row.partNo]) {
                    partLineData[row.partNo] = lineKey;
                }

                if (row.partNo && !partMeta[row.partNo]) {
                    partMeta[row.partNo] = { description: row.productDescription || row.description || "", customer: custKey };
                }

                if (row.partNo) {
                    if (!partMonthData[row.partNo]) partMonthData[row.partNo] = {};
                    if (!partMonthData[row.partNo][monthKey]) partMonthData[row.partNo][monthKey] = { scheduled: 0, dispatched: 0 };
                    partMonthData[row.partNo][monthKey].scheduled += scheduled;
                    partMonthData[row.partNo][monthKey].dispatched += dispatched;
                }

                if (custKey && row.partNo) {
                    if (!customerPartData[custKey]) customerPartData[custKey] = {};
                    if (!customerPartData[custKey][row.partNo]) customerPartData[custKey][row.partNo] = { scheduled: 0, dispatched: 0, months: new Set() };
                    customerPartData[custKey][row.partNo].scheduled += scheduled;
                    customerPartData[custKey][row.partNo].dispatched += dispatched;
                    customerPartData[custKey][row.partNo].months.add(monthKey);
                }
                const gShort = Math.max(scheduled - dispatched, 0);
                const gSurp = Math.max(dispatched - scheduled, 0);
                lineStats.shortfall += gShort; lineStats.surplus += gSurp;
                custStats.shortfall += gShort; custStats.surplus += gSurp;
                grossShortfall += gShort; grossSurplus += gSurp;
                if (row.partNo) {
                    if (!partGross[row.partNo]) partGross[row.partNo] = { shortfall: 0, surplus: 0 };
                    partGross[row.partNo].shortfall += gShort;
                    partGross[row.partNo].surplus += gSurp;
                }

                lineStats.scheduled += scheduled;
                lineStats.dispatched += dispatched;
                lineStats.months.add(monthKey);

                custStats.scheduled += scheduled;
                custStats.dispatched += dispatched;
                custStats.months.add(monthKey);
            }
        });
    });

    // byMonth - only months in allMonths
    const byMonth = {};
    allMonths.forEach(monthKey => {
        let totalScheduled = 0, totalDispatched = 0, partsWithData = 0, totalShort = 0, totalSurp = 0;
        filtered.forEach(row => {
            if (!row) return;
            const rowMonths = Object.keys(row.monthlySchedules || {});
            if (!rowMonths.includes(monthKey)) return;
            let sched = 0, disp = 0;
            if (basis === "schedule") sched = (row.monthlySchedules && row.monthlySchedules[monthKey] !== undefined ? Number(row.monthlySchedules[monthKey]) : 0);
            else sched = (row.actualCustomerSchedule && row.actualCustomerSchedule[monthKey] !== undefined ? Number(row.actualCustomerSchedule[monthKey]) : 0);
            if (row.monthlyDispatches && row.monthlyDispatches[monthKey] !== undefined) disp = Number(row.monthlyDispatches[monthKey]);
            totalScheduled += sched; totalDispatched += disp; partsWithData++;
            totalShort += Math.max(sched - disp, 0); totalSurp += Math.max(disp - sched, 0);
        });
        const fillRate = totalScheduled > 0 ? totalDispatched / totalScheduled : null;
        const shortfall = totalScheduled > 0 ? Math.max(totalScheduled - totalDispatched, 0) : 0;
        const surplus = totalDispatched > totalScheduled ? totalDispatched - totalScheduled : 0;
        byMonth[monthKey] = { scheduled: totalScheduled, dispatched: totalDispatched, fillRate, shortfall: totalShort, surplus: totalSurp, partsWithData };
    });

    // byLine
const byLine = {};
lineData.forEach((stats, lineName) => {
    const sl = stats.scheduled, dl = stats.dispatched;
    byLine[lineName] = {
        scheduled: sl, dispatched: dl,
        fillRate: sl > 0 ? dl / sl : null,
        shortfall: stats.shortfall, surplus: stats.surplus,
        parts: stats.parts.size, months: stats.months.size
    };
});

// byCustomer
const byCustomer = {};
customerData.forEach((stats, custName) => {
    const sc = stats.scheduled, dc = stats.dispatched;
    const rate = sc > 0 ? (dc / sc) * 100 : null;
    byCustomer[custName] = {
        scheduled: sc, dispatched: dc,
        fillRate: sc > 0 ? dc / sc : null,
        shortfall: stats.shortfall, surplus: stats.surplus,
        parts: stats.parts.size, months: stats.months.size,
        belowTarget: rate !== null && rate < target ? 1 : 0,
        group: stats.group || "Unknown"
    };
});

    // topShortfallParts
    const partShortfallList = [];
    const allPartNoSet = new Set(filtered.flatMap(row => row.partNo || "").filter(Boolean));
    const partAggregate = {};
    filtered.forEach(row => {
        if (!row || !row.partNo) return;
        const pn = row.partNo;
        if (!partAggregate[pn]) partAggregate[pn] = {};
        const rowMonths = Object.keys(row.monthlySchedules || {});
        rowMonths.forEach(m => {
            if ((!partAggregate[pn][m]) && ((!fromMonth || m >= fromMonth) && (!toMonth || m <= toMonth))) {
                partAggregate[pn][m] = { scheduled: 0, dispatched: 0 };
            }
            if (partAggregate[pn][m]) {
                let sc = 0, dc = 0;
                if (basis === "schedule") sc = (row.monthlySchedules && row.monthlySchedules[m] !== undefined ? Number(row.monthlySchedules[m]) : 0);
                else if (basis === "actual") sc = (row.actualCustomerSchedule && row.actualCustomerSchedule[m] !== undefined ? Number(row.actualCustomerSchedule[m]) : 0);
                if (row.monthlyDispatches && row.monthlyDispatches[m] !== undefined) dc = Number(row.monthlyDispatches[m]);
                partAggregate[pn][m].scheduled += sc;
                partAggregate[pn][m].dispatched += dc;
            }
        });
    });

    Object.keys(partAggregate).forEach(pn => {
        let ts = 0, td = 0;
        allMonths.forEach(m => {
            if (partAggregate[pn] && partAggregate[pn][m]) {
                ts += partAggregate[pn][m].scheduled;
                td += partAggregate[pn][m].dispatched;
            }
        });
        const shortfall = partGross[pn] ? partGross[pn].shortfall : 0;
        const fillRate = ts > 0 ? td / ts : null;
        partShortfallList.push({
            partNo: pn,
            description: (partMeta[pn] && partMeta[pn].description) || "",
            customer: (partMeta[pn] && partMeta[pn].customer) || "",
            line: partLineData[pn] || "Uncategorized",
            scheduled: ts, dispatched: td, shortfall, fillRate
        });
    });

    partShortfallList.sort((a, b) => b.shortfall - a.shortfall);
    const topShortfallParts = partShortfallList.slice(0, 10);

    // Overall metrics - only months in allMonths
    let totalScheduled = 0, totalDispatched = 0;
    allMonths.forEach(m => {
        let ts = 0, td = 0;
        filtered.forEach(row => {
            if (!row) return;
            let sc = 0, dc = 0;
            if (basis === "schedule") sc = (row.monthlySchedules && row.monthlySchedules[m] !== undefined ? Number(row.monthlySchedules[m]) : 0);
            else if (basis === "actual") sc = (row.actualCustomerSchedule && row.actualCustomerSchedule[m] !== undefined ? Number(row.actualCustomerSchedule[m]) : 0);
            if (row.monthlyDispatches && row.monthlyDispatches[m] !== undefined) dc = Number(row.monthlyDispatches[m]);
            ts += sc; td += dc;
        });
        totalScheduled += ts; totalDispatched += td;
    });
    const overallFillRate = totalScheduled > 0 ? totalDispatched / totalScheduled : null;
    const overallShortfall = grossShortfall;
    const overallSurplus = grossSurplus;
    const partsBelowTargetCount = partShortfallList.filter(p => p.scheduled > 0 && (p.dispatched / p.scheduled) * 100 < target).length;
    const customersBelowTargetCount = Object.values(byCustomer).filter(c => c.scheduled > 0 && (c.dispatched / c.scheduled) * 100 < target).length;
    const overall = { scheduled: totalScheduled, dispatched: totalDispatched, fillRate: overallFillRate, shortfall: overallShortfall, surplus: overallSurplus, partsBelowTarget: partsBelowTargetCount, customersBelowTarget: customersBelowTargetCount, target };

    // Data quality
    const blankLineCount = filtered.filter(row => String(row.line ?? "").trim() === "").length;
    const numericLineCount = filtered.filter(row => /^\d+$/.test(String(row.line ?? "").trim())).length;
    const customerInconsistencies = [];
    const customerGroups = new Map();
    filtered.forEach(row => {
        if (!row) return;
        const norm = normalizeCustomer(row.customer, row.customerName2, row.customerCode);
        if (!customerGroups.has(norm.name)) customerGroups.set(norm.name, { codes: new Set(), groups: new Set() });
        customerGroups.get(norm.name).codes.add(norm.code);
        customerGroups.get(norm.name).groups.add(norm.group);
    });
    customerGroups.forEach((info, name) => {
        if (info.codes.size > 1 || info.groups.size > 1) {
            customerInconsistencies.push({ customer: name, codes: Array.from(info.codes), groups: Array.from(info.groups) });
        }
    });

    return { overall, byMonth, byLine, byCustomer, topShortfallParts, dataQuality: { duplicates: duplicates.length, blankLine: blankLineCount, numericLine: numericLineCount, customerInconsistencies } };
}

module.exports = { calculateCompanyFulfillment };