function normalizeMonth(value) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}$/.test(text)) return text;
    const namedMonth = text.match(/^([a-z]+)[\s/-]+(\d{2}|\d{4})$/i);
    if (namedMonth) {
        const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const monthIndex = months.indexOf(namedMonth[1].slice(0, 3).toLowerCase());
        if (monthIndex !== -1) {
            const year = namedMonth[2].length === 2 ? Number(`20${namedMonth[2]}`) : Number(namedMonth[2]);
            return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
        }
    }
    const numericMonth = text.match(/^(0?[1-9]|1[0-2])[-/](\d{4})$/);
    if (numericMonth) return `${numericMonth[2]}-${numericMonth[1].padStart(2, "0")}`;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 7) : "";
}

function getMonthEnd(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
    const [year, monthNumber] = month.split("-").map(Number);
    return new Date(Date.UTC(year, monthNumber, 0, 23, 59, 59, 999));
}

function getSnapshotOrderKey(snapshot) {
    const uploadedAt = String(snapshot.capturedAt || snapshot.snapshotDate || "");
    const uploadTime = uploadedAt.includes("T") ? uploadedAt.slice(uploadedAt.indexOf("T")) : "";
    const snapshotDate = String(snapshot.snapshotDate || uploadedAt.slice(0, 10));
    return `${snapshotDate}${uploadTime}`;
}

function getEntityKey(row) {
    return [
        row.customerCode || row.customer || "",
        row.partNo || "",
        row.customerPartNo || "",
        row.line || ""
    ].map(value => String(value).trim().toLowerCase()).join("|");
}

function getVersionRank(version) {
    const value = String(version || "").trim();
    if (/^(current|latest|final)$/i.test(value)) return [2, Infinity];
    const match = value.match(/^(?:v(?:ersion)?\s*)?(\d+(?:\.\d+)?)$/i);
    return match ? [1, Number(match[1])] : [0, value.toLowerCase()];
}

function isHigherVersion(candidate, existing) {
    const left = getVersionRank(candidate);
    const right = getVersionRank(existing);
    if (left[0] !== right[0]) return left[0] > right[0];
    if (typeof left[1] === "number" && typeof right[1] === "number") return left[1] > right[1];
    return String(left[1]).localeCompare(String(right[1])) > 0;
}

function matchesCustomer(row, customer) {
    return !customer || customer === "ALL"
        || String(row.customer || "").trim() === customer
        || String(row.customerGroup || "").trim() === customer
        || String(row.customerCode || "").trim() === customer;
}

function getDemandForMonth(row, month) {
    if (row.monthlySchedules && Object.prototype.hasOwnProperty.call(row.monthlySchedules, month)) {
        const quantity = Number(row.monthlySchedules[month]);
        return Number.isFinite(quantity) ? quantity : null;
    }

    const deliveryMonth = normalizeMonth(row.deliveryMonth);
    if (deliveryMonth === month || (!deliveryMonth && row.referenceMonth === month)) {
        const quantity = Number(row.currentCustomerSchedule ?? row.currentMonth ?? row.customerSchedule);
        return Number.isFinite(quantity) ? quantity : null;
    }
    return null;
}

function getDemandByEntity(snapshot, month, customer) {
    const rowsByEntity = new Map();
    for (const row of snapshot.rows || []) {
        if (!matchesCustomer(row, customer)) continue;
        const demand = getDemandForMonth(row, month);
        if (demand === null) continue;
        const key = getEntityKey(row);
        if (key === "||||") continue;
        const existing = rowsByEntity.get(key);
        if (!existing || isHigherVersion(row.version, existing.row.version)) {
            rowsByEntity.set(key, { row, demand });
        }
    }
    return rowsByEntity;
}

function getDemandStateSignature(demand) {
    return JSON.stringify(Array.from(demand.entries())
        .map(([key, value]) => [key, value.demand])
        .sort(([left], [right]) => left.localeCompare(right)));
}

function getDemandSnapshotTimeline(snapshots, month, customer) {
    let previousSignature = null;
    return snapshots
        .map(snapshot => ({ snapshot, demand: getDemandByEntity(snapshot, month, customer) }))
        .sort((left, right) => getSnapshotOrderKey(left.snapshot).localeCompare(getSnapshotOrderKey(right.snapshot)))
        .map(({ snapshot, demand }) => {
            const signature = demand.size ? getDemandStateSignature(demand) : null;
            const duplicateOfPrevious = signature !== null && signature === previousSignature;
            if (signature !== null) previousSignature = signature;
            return {
                snapshotId: snapshot.snapshotId || `${snapshot.capturedAt || snapshot.snapshotDate}`,
                snapshotDate: snapshot.snapshotDate,
                capturedAt: snapshot.capturedAt || snapshot.snapshotDate,
                source: snapshot.source || "",
                rowCount: (snapshot.rows || []).length,
                demandRows: demand.size,
                hasDemand: demand.size > 0,
                duplicateOfPrevious
            };
        });
}

function calculateDemandRevisionWape(snapshots, month, customer, comparison = {}) {
    const demandSnapshots = snapshots
        .map(snapshot => ({ snapshot, demand: getDemandByEntity(snapshot, month, customer) }))
        .sort((left, right) => getSnapshotOrderKey(left.snapshot).localeCompare(getSnapshotOrderKey(right.snapshot)));
    let previous;
    let latest;

    if (comparison.previousSnapshotId || comparison.currentSnapshotId) {
        previous = demandSnapshots.find(item =>
            (item.snapshot.snapshotId || String(item.snapshot.capturedAt || item.snapshot.snapshotDate))
                === comparison.previousSnapshotId);
        latest = demandSnapshots.find(item =>
            (item.snapshot.snapshotId || String(item.snapshot.capturedAt || item.snapshot.snapshotDate))
                === comparison.currentSnapshotId);
        if (!previous || !latest) {
            return { value: null, status: "selected_snapshot_unavailable", comparedParts: 0, revisions: [] };
        }
        if (previous === latest) {
            return { value: null, status: "select_two_snapshots", comparedParts: 0, revisions: [] };
        }
        if (getSnapshotOrderKey(previous.snapshot) >= getSnapshotOrderKey(latest.snapshot)) {
            return { value: null, status: "snapshots_out_of_order", comparedParts: 0, revisions: [] };
        }
        if (previous.demand.size === 0 || latest.demand.size === 0) {
            return {
                value: null,
                status: "snapshot_has_no_month_data",
                comparedParts: 0,
                revisions: [],
                previousSnapshotDate: previous.snapshot.snapshotDate,
                latestSnapshotDate: latest.snapshot.snapshotDate
            };
        }
    } else {
        let previousSignature = null;
        const available = demandSnapshots.filter(item => {
            if (!item.demand.size) return false;
            const signature = getDemandStateSignature(item.demand);
            const duplicateOfPrevious = signature === previousSignature;
            previousSignature = signature;
            return !duplicateOfPrevious;
        });
        if (available.length < 2) {
            return { value: null, status: "needs_two_snapshots", comparedParts: 0, revisions: [] };
        }
        previous = available[available.length - 2];
        latest = available[available.length - 1];
    }

    const entities = new Set([...previous.demand.keys(), ...latest.demand.keys()]);
    let absoluteRevision = 0;
    let latestDemandTotal = 0;
    const revisions = [];
    for (const entity of entities) {
        const previousEntry = previous.demand.get(entity);
        const latestEntry = latest.demand.get(entity);
        const before = previousEntry?.demand || 0;
        const after = latestEntry?.demand || 0;
        const row = latestEntry?.row || previousEntry.row;
        absoluteRevision += Math.abs(after - before);
        latestDemandTotal += after;
        if (before !== after) {
            revisions.push({
                customer: row.customer || row.customerName2 || row.customerCode || "Unknown",
                partNo: row.partNo || "-",
                previousDemand: before,
                latestDemand: after,
                change: after - before
            });
        }
    }
    revisions.sort((left, right) => Math.abs(right.change) - Math.abs(left.change));

    return {
        value: latestDemandTotal > 0 ? absoluteRevision / latestDemandTotal * 100 : null,
        status: latestDemandTotal > 0 ? "available" : "zero_latest_demand",
        comparedParts: entities.size,
        revisions,
        previousSnapshotId: previous.snapshot.snapshotId,
        latestSnapshotId: latest.snapshot.snapshotId,
        previousSnapshotDate: previous.snapshot.snapshotDate,
        latestSnapshotDate: latest.snapshot.snapshotDate,
        previousSource: previous.snapshot.source || "",
        latestSource: latest.snapshot.source || ""
    };
}

function getMonthQuantity(row, field, month, scalarField, scalarPresentField) {
    const monthly = row[field];
    if (monthly && Object.prototype.hasOwnProperty.call(monthly, month)) {
        const quantity = Number(monthly[month]);
        return Number.isFinite(quantity) ? quantity : null;
    }

    if (row[scalarPresentField] === true
        && (scalarField !== "actualDispatch" || row.actualDispatchMonthAligned !== false)
        && normalizeMonth(row.deliveryMonth) === month) {
        const quantity = Number(row[scalarField]);
        return Number.isFinite(quantity) ? quantity : null;
    }
    return null;
}

function parseDispatchDate(value) {
    if (!value) return null;
    const text = String(value).trim();
    const dayFirst = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (dayFirst) {
        let day = Number(dayFirst[1]);
        let month = Number(dayFirst[2]);
        if (day <= 12 && month > 12) [day, month] = [month, day];
        let year = Number(dayFirst[3]);
        if (year < 100) year += 2000;
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
        return date;
    }

    const namedDate = text.match(/^(\d{1,2})[-\s]([a-z]{3,})[-\s,]+(\d{2,4})$/i);
    if (namedDate) {
        const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
            .indexOf(namedDate[2].slice(0, 3).toLowerCase());
        let year = Number(namedDate[3]);
        if (year < 100) year += 2000;
        if (month === -1) return null;
        const date = new Date(Date.UTC(year, month, Number(namedDate[1]), 23, 59, 59, 999));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== Number(namedDate[1])) return null;
        return date;
    }

    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function calculateOnTime(snapshots, month, customer, now = new Date()) {
    const dueDate = getMonthEnd(month);
    if (!dueDate) return { quantityRate: null, lineRate: null, status: "invalid_month" };

    const eligibleSnapshots = [...snapshots].sort((left, right) =>
        String(right.capturedAt || right.snapshotDate).localeCompare(String(left.capturedAt || left.snapshotDate)));

    let selectedSnapshot;
    let commitments = [];
    for (const snapshot of eligibleSnapshots) {
        const byEntity = new Map();
        for (const row of snapshot.rows || []) {
            if (!matchesCustomer(row, customer)) continue;
            const committed = getMonthQuantity(
                row, "monthlyCommitments", month, "companyCommitment", "companyCommitmentProvided"
            );
            if (committed === null) continue;

            const key = getEntityKey(row);
            if (key === "||||") continue;
            const existing = byEntity.get(key);
            if (!existing || isHigherVersion(row.version, existing.row.version)) {
                byEntity.set(key, { row, committed });
            }
        }
        if (byEntity.size) {
            selectedSnapshot = snapshot;
            commitments = Array.from(byEntity.values());
            break;
        }
    }

    if (!selectedSnapshot) {
        return { quantityRate: null, lineRate: null, status: "no_month_aligned_commitments" };
    }

    if (dueDate.getTime() >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) {
        return {
            quantityRate: null,
            lineRate: null,
            status: "due_date_not_passed",
            dueDate: dueDate.toISOString().slice(0, 10)
        };
    }

    if (Date.parse(selectedSnapshot.capturedAt || selectedSnapshot.snapshotDate) <= dueDate.getTime()) {
        return {
            quantityRate: null,
            lineRate: null,
            status: "snapshot_before_due_date",
            dueDate: dueDate.toISOString().slice(0, 10)
        };
    }

    let committedTotal = 0;
    let onTimeQuantity = 0;
    let commitmentLines = 0;
    let onTimeLines = 0;
    let missingDispatchData = false;
    let missingDispatchDates = false;
    const issues = [];

    for (const { row, committed } of commitments) {
        if (committed <= 0) continue;
        commitmentLines += 1;
        committedTotal += committed;

        const dispatched = getMonthQuantity(
            row, "monthlyDispatches", month, "actualDispatch", "actualDispatchProvided"
        );
        if (dispatched === null) {
            missingDispatchData = true;
            issues.push({
                customer: row.customer || row.customerName2 || row.customerCode || "Unknown",
                partNo: row.partNo || "-",
                type: "Missing dispatch quantity",
                committedQty: committed,
                dispatchedQty: null,
                dispatchDate: ""
            });
            continue;
        }

        const dispatchDateValue = row.monthlyDispatchDates
            && Object.prototype.hasOwnProperty.call(row.monthlyDispatchDates, month)
            ? row.monthlyDispatchDates[month]
            : normalizeMonth(row.deliveryMonth) === month ? row.dispatchDate : "";
        const dispatchDate = parseDispatchDate(dispatchDateValue);
        if (dispatched > 0 && !dispatchDate) {
            missingDispatchDates = true;
            issues.push({
                customer: row.customer || row.customerName2 || row.customerCode || "Unknown",
                partNo: row.partNo || "-",
                type: "Missing dispatch date",
                committedQty: committed,
                dispatchedQty: dispatched,
                dispatchDate: ""
            });
            continue;
        }

        const wasOnTime = dispatched > 0 && dispatchDate <= dueDate;
        if (wasOnTime) {
            onTimeQuantity += Math.min(dispatched, committed);
            if (dispatched >= committed) onTimeLines += 1;
        }

        const issueTypes = [];
        if (dispatched < committed) issueTypes.push("Short dispatch");
        if (dispatched > 0 && dispatchDate > dueDate) issueTypes.push("Late dispatch");
        if (issueTypes.length) {
            issues.push({
                customer: row.customer || row.customerName2 || row.customerCode || "Unknown",
                partNo: row.partNo || "-",
                type: issueTypes.join(" + "),
                committedQty: committed,
                dispatchedQty: dispatched,
                dispatchDate: dispatchDate ? dispatchDate.toISOString().slice(0, 10) : ""
            });
        }
    }

    if (!committedTotal) {
        return { quantityRate: null, lineRate: null, status: "zero_commitment", dueDate: dueDate.toISOString().slice(0, 10) };
    }
    if (missingDispatchData || missingDispatchDates) {
        return {
            quantityRate: null,
            lineRate: null,
            status: missingDispatchDates ? "missing_dispatch_dates" : "missing_dispatch_quantities",
            dueDate: dueDate.toISOString().slice(0, 10),
            committedQty: committedTotal,
            issues
        };
    }

    return {
        quantityRate: onTimeQuantity / committedTotal * 100,
        lineRate: onTimeLines / commitmentLines * 100,
        status: "available",
        dueDate: dueDate.toISOString().slice(0, 10),
        committedQty: committedTotal,
        onTimeQty: onTimeQuantity,
        commitmentLines,
        onTimeLines,
        snapshotDate: selectedSnapshot.snapshotDate,
        issues
    };
}

function calculateScheduleAnalytics(snapshots, month, customer, now = new Date(), comparison = {}) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return { month, customer: customer || "ALL", demandRevisionWape: { value: null, status: "invalid_month" }, onTime: { quantityRate: null, lineRate: null, status: "invalid_month" } };
    }

    return {
        month,
        customer: customer || "ALL",
        demandRevisionWape: calculateDemandRevisionWape(snapshots, month, customer, comparison),
        onTime: calculateOnTime(snapshots, month, customer, now)
    };
}

function formatNumberEn(value) {
    if (value === null || value === undefined || isNaN(value)) return "0";
    return new Intl.NumberFormat("en-IN").format(Math.round(Number(value)));
}

function formatMonthLabel(monthKey) {
    if (!monthKey || monthKey === "ALL") return "All Months";
    const [year, month] = monthKey.split("-");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const idx = parseInt(month, 10) - 1;
    if (idx >= 0 && idx < 12) {
        return `${monthNames[idx]}'${year.slice(2)}`;
    }
    return monthKey;
}


function sumField(obj) {
    if (!obj || typeof obj !== "object") return null;
    const values = Object.values(obj).map(Number).filter(Number.isFinite);
    return values.length ? values.reduce((s, v) => s + v, 0) : null;
}

function getMetricValue(row, metric, month) {
    const specific = month && month !== "ALL";
    if (metric === "schedule") {
        if (specific) return getDemandForMonth(row, month) ?? 0;
        return sumField(row.monthlySchedules) ?? Number(row.currentCustomerSchedule ?? row.currentMonth ?? row.customerSchedule ?? 0);
    }
    if (metric === "commitment") {
        if (specific) return getMonthQuantity(row, "monthlyCommitments", month, "companyCommitment", "companyCommitmentProvided") ?? 0;
        return sumField(row.monthlyCommitments) ?? Number(row.companyCommitment ?? 0);
    }
    if (metric === "dispatch") {
        if (specific) return getMonthQuantity(row, "monthlyDispatches", month, "actualDispatch", "actualDispatchProvided") ?? 0;
        return sumField(row.monthlyDispatches) ?? Number(row.actualDispatch ?? 0);
    }
    if (metric === "production") return Number(row.actualProductionQty ?? 0);
    if (metric === "balance") return Number(row.balance ?? 0);
    if (metric === "originalSchedule") return Number(row.originalCustomerSchedule ?? row.scheduleReceivedQty ?? row.currentCustomerSchedule ?? 0);
    return 0;
}

const METRIC_LABELS = {
    schedule: "Customer Schedule",
    commitment: "Company Commitment",
    dispatch: "Actual Dispatch",
    production: "Actual Production",
    balance: "Backlog / Balance",
    originalSchedule: "Original Schedule"
};

function shiftMonthKey(monthKey, offset) {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function compareWithinSameSheet(snapshots, options = {}) {
    if (!snapshots || snapshots.length === 0) {
        return {
            status: "no_snapshots",
            message: "No schedule sheets have been uploaded yet. Upload an Excel file to begin.",
            summary: null,
            rows: []
        };
    }

    const {
        snapshotId,
        part = "",
        partQuery = "",
        range = 6,
        trendYear = "",
        mode = "months",
        monthA,
        monthB,
        metricA = "commitment",
        metricB = "dispatch",
        month = "ALL",
        customer = "ALL"
    } = options;

    let targetSnap = snapshotId ? snapshots.find(s => s.snapshotId === snapshotId) : null;
    if (!targetSnap) {
        targetSnap = snapshots[snapshots.length - 1];
    }

    if (!targetSnap) {
        return {
            status: "snapshot_not_found",
            message: "Selected Excel sheet was not found.",
            summary: null,
            rows: []
        };
    }

    const partFilter = String(part || "").trim().toLowerCase();
    const queryTokens = String(partQuery || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matchedRows = (targetSnap.rows || []).filter(r => {
        if (!matchesCustomer(r, customer)) return false;
        if (partFilter
            && String(r.partNo || "").trim().toLowerCase() !== partFilter
            && String(r.customerPartNo || "").trim().toLowerCase() !== partFilter) {
            return false;
        }
        if (queryTokens.length) {
            const haystack = `${r.partNo || ""} ${r.customerPartNo || ""} ${r.line || ""} ${r.productDescription || ""}`.toLowerCase();
            if (!queryTokens.every(token => haystack.includes(token))) return false;
        }
        return true;
    });

    if (mode === "months") {
        const allMonthsInSheet = new Set();
        matchedRows.forEach(r => {
            if (r.monthlySchedules) {
                Object.keys(r.monthlySchedules).forEach(m => allMonthsInSheet.add(m));
            }
            const dm = normalizeMonth(r.deliveryMonth);
            if (dm) allMonthsInSheet.add(dm);
        });
        const sortedMonths = Array.from(allMonthsInSheet).sort();

        const targetMonthA = monthA || (sortedMonths.length > 0 ? sortedMonths[0] : "");
        const targetMonthB = monthB || (sortedMonths.length > 1 ? sortedMonths[1] : targetMonthA);

        if (!targetMonthA) {
            return {
                status: "no_months_in_sheet",
                message: "No monthly schedule columns found in this sheet.",
                summary: null,
                rows: []
            };
        }

        const byEntity = new Map();
        for (const row of matchedRows) {
            const key = getEntityKey(row);
            if (key === "||||") continue;
            const existing = byEntity.get(key);
            if (!existing || isHigherVersion(row.version, existing.version)) {
                byEntity.set(key, row);
            }
        }

        let totalA = 0;
        let totalB = 0;
        let diffAbsSum = 0;
        let partsIncreased = 0;
        let partsDecreased = 0;
        let partsUnchanged = 0;

        const rows = [];
        for (const row of byEntity.values()) {
            const qtyA = Number(getDemandForMonth(row, targetMonthA) || 0);
            const qtyB = Number(getDemandForMonth(row, targetMonthB) || 0);
            if (qtyA === 0 && qtyB === 0) continue;

            totalA += qtyA;
            totalB += qtyB;
            const change = qtyB - qtyA;
            diffAbsSum += Math.abs(change);

            let status = "unchanged";
            if (qtyA === 0 && qtyB > 0) {
                status = "added";
                partsIncreased++;
            } else if (qtyA > 0 && qtyB === 0) {
                status = "removed";
                partsDecreased++;
            } else if (change > 0) {
                status = "increased";
                partsIncreased++;
            } else if (change < 0) {
                status = "decreased";
                partsDecreased++;
            } else {
                partsUnchanged++;
            }

            const percentChange = qtyA > 0 ? (change / qtyA) * 100 : (qtyB > 0 ? 100 : 0);

            rows.push({
                customer: row.customer || row.customerCode || "Unknown",
                customerCode: row.customerCode || "",
                partNo: row.partNo || "-",
                customerPartNo: row.customerPartNo || "-",
                productDescription: row.productDescription || "-",
                line: row.line || "-",
                qtyA,
                qtyB,
                change,
                percentChange,
                status
            });
        }

        rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        const netChange = totalB - totalA;
        const percentChange = totalA > 0 ? (netChange / totalA) * 100 : (totalB > 0 ? 100 : 0);
        const labelA = formatMonthLabel(targetMonthA);
        const labelB = formatMonthLabel(targetMonthB);
        const changeSign = netChange >= 0 ? "+" : "";

        const takeaway = rows.length === 0
            ? `No records found comparing ${labelA} and ${labelB}.`
            : `Across the production timeline, demand shifts from ${formatNumberEn(totalA)} in ${labelA} to ${formatNumberEn(totalB)} in ${labelB} (${changeSign}${formatNumberEn(netChange)} units or ${changeSign}${percentChange.toFixed(1)}%). Of ${rows.length} parts: ${partsIncreased} ramp up, ${partsDecreased} ramp down, and ${partsUnchanged} stay flat.`;

        return {
            status: "available",
            mode: "months",
            sheet: {
                snapshotId: targetSnap.snapshotId,
                source: targetSnap.source || "Current Sheet",
                date: targetSnap.snapshotDate || targetSnap.capturedAt?.slice(0, 10) || ""
            },
            monthA: targetMonthA,
            monthB: targetMonthB,
            labelA,
            labelB,
            summary: {
                totalA,
                totalB,
                netChange,
                percentChange,
                partsTotal: rows.length,
                partsIncreased,
                partsDecreased,
                partsUnchanged,
                takeaway
            },
            rows
        };
    } else {
        const labelA = METRIC_LABELS[metricA] || metricA;
        const labelB = METRIC_LABELS[metricB] || metricB;

        const byEntity = new Map();
        for (const row of matchedRows) {
            const key = getEntityKey(row);
            if (key === "||||") continue;
            const existing = byEntity.get(key);
            if (!existing || isHigherVersion(row.version, existing.version)) {
                byEntity.set(key, row);
            }
        }

        const allEntityRows = Array.from(byEntity.values());

        // Count duplicate entity keys removed during dedup
        let duplicateKeys = 0;
        const matchedWithKeys = matchedRows.filter(r => getEntityKey(r) !== "||||");
        duplicateKeys = matchedWithKeys.length - byEntity.size;

        // ---- New: monthlyTrend over ALL months in the snapshot ----
        const allMonths = new Set();
        for (const row of allEntityRows) {
            if (row.monthlyCommitments) {
                Object.keys(row.monthlyCommitments).forEach(m => allMonths.add(m));
            }
            if (row.monthlySchedules) {
                Object.keys(row.monthlySchedules).forEach(m => allMonths.add(m));
            }
            if (row.monthlyDispatches) {
                Object.keys(row.monthlyDispatches).forEach(m => allMonths.add(m));
            }
            const dm = normalizeMonth(row.deliveryMonth);
            if (dm) allMonths.add(dm);
        }
        const sortedMonths = Array.from(allMonths).sort();

        const availableYears = Array.from(new Set(sortedMonths.map(m => m.slice(0, 4)))).sort();
        const rangeKey = String(range || "6").toLowerCase();
        const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "";
        const fallbackAnchor = validMonth || sortedMonths[sortedMonths.length - 1] || `${new Date().getFullYear()}-01`;
        const activeYear = /^\d{4}$/.test(String(trendYear || ""))
            ? String(trendYear)
            : fallbackAnchor.slice(0, 4);

        let windowMonths = [];
        if (rangeKey === "all") {
            if (sortedMonths.length) {
                const start = sortedMonths[0];
                const end = sortedMonths[sortedMonths.length - 1];
                const [sy, sm] = start.split("-").map(Number);
                const [ey, em] = end.split("-").map(Number);
                const span = (ey - sy) * 12 + (em - sm) + 1;
                windowMonths = span > 0 && span <= 48
                    ? Array.from({ length: span }, (_, i) => shiftMonthKey(start, i))
                    : sortedMonths;
            } else if (validMonth) {
                windowMonths = [validMonth];
            }
        } else if (rangeKey === "12") {
            windowMonths = Array.from({ length: 12 }, (_, i) => `${activeYear}-${String(i + 1).padStart(2, "0")}`);
        } else {
            let windowEnd = sortedMonths.length ? sortedMonths[sortedMonths.length - 1] : validMonth;
            if (validMonth && (!windowEnd || validMonth > windowEnd)) windowEnd = validMonth;
            let windowStart = windowEnd ? shiftMonthKey(windowEnd, -5) : "";
            if (validMonth && validMonth < windowStart) {
                windowStart = validMonth;
                windowEnd = shiftMonthKey(validMonth, 5);
            }
            windowMonths = windowEnd
                ? Array.from({ length: 6 }, (_, i) => shiftMonthKey(windowStart, i))
                : [];
        }

        const monthlyTrend = windowMonths.map(m => {
            let actCustSched = 0, commitment = 0, dispatched = 0;
            let grossShortfall = 0, grossSurplus = 0;
            for (const row of allEntityRows) {
                const acs = row.monthlySchedules && Object.prototype.hasOwnProperty.call(row.monthlySchedules, m)
                    ? Number(row.monthlySchedules[m]) : 0;
                const com = row.monthlyCommitments && Object.prototype.hasOwnProperty.call(row.monthlyCommitments, m)
                    ? Number(row.monthlyCommitments[m]) : 0;
                const disp = row.monthlyDispatches && Object.prototype.hasOwnProperty.call(row.monthlyDispatches, m)
                    ? Number(row.monthlyDispatches[m]) : 0;
                actCustSched += acs;
                commitment += com;
                dispatched += disp;
                grossShortfall += Math.max(com - disp, 0);
                grossSurplus += Math.max(disp - com, 0);
            }
            return {
                month: m,
                label: formatMonthLabel(m),
                actualCustomerSchedule: actCustSched,
                commitment,
                dispatched,
                fillRateVsCommitment: commitment > 0 ? Math.round((dispatched / commitment) * 1000) / 10 : null,
                fillRateVsCustomer: actCustSched > 0 ? Math.round((dispatched / actCustSched) * 1000) / 10 : null,
                grossShortfall,
                grossSurplus,
                hasData: actCustSched > 0 || commitment > 0 || dispatched > 0
            };
        });

        // ---- New: byLine for the selected month ----
        const lineMap = new Map();
        for (const row of allEntityRows) {
            const com = row.monthlyCommitments && Object.prototype.hasOwnProperty.call(row.monthlyCommitments, month)
                ? Number(row.monthlyCommitments[month]) : 0;
            const disp = row.monthlyDispatches && Object.prototype.hasOwnProperty.call(row.monthlyDispatches, month)
                ? Number(row.monthlyDispatches[month]) : 0;
            if (month !== "ALL" && com === 0 && disp === 0) continue;

            const rawLine = String(row.line || "").trim().replace(/\s+/g, " ");
            const lineName = (rawLine === "" || /^\d+$/.test(rawLine)) ? "Uncategorized" : rawLine;
            const lineKey = lineName.toLowerCase();

            if (!lineMap.has(lineKey)) {
                lineMap.set(lineKey, {
                    name: lineName,
                    commitment: 0, dispatched: 0,
                    grossShortfall: 0, grossSurplus: 0,
                    parts: new Set(), partsOnTarget: 0
                });
            }
            const bucket = lineMap.get(lineKey);
            bucket.commitment += com;
            bucket.dispatched += disp;
            bucket.grossShortfall += Math.max(com - disp, 0);
            bucket.grossSurplus += Math.max(disp - com, 0);
            if (row.partNo) bucket.parts.add(String(row.partNo).trim());
            if (com > 0 && disp >= com) bucket.partsOnTarget += 1;
        }

        const byLine = month !== "ALL" ? Array.from(lineMap.values()).map(l => ({
            line: l.name,
            commitment: l.commitment,
            dispatched: l.dispatched,
            fillRate: l.commitment > 0 ? Math.round((l.dispatched / l.commitment) * 1000) / 10 : null,
            grossShortfall: l.grossShortfall,
            grossSurplus: l.grossSurplus,
            partsTotal: l.parts.size,
            partsOnTarget: l.partsOnTarget
        })) : [];

                // ---- byCustomer for the selected month ----
        const customerMap = new Map();
        for (const row of allEntityRows) {
            if (month === "ALL") break;
            const com = row.monthlyCommitments && Object.prototype.hasOwnProperty.call(row.monthlyCommitments, month)
                ? Number(row.monthlyCommitments[month]) : 0;
            const disp = row.monthlyDispatches && Object.prototype.hasOwnProperty.call(row.monthlyDispatches, month)
                ? Number(row.monthlyDispatches[month]) : 0;
            if (com === 0 && disp === 0) continue;
            const name = row.customer || row.customerCode || "Unknown";
            if (!customerMap.has(name)) {
                customerMap.set(name, { customer: name, commitment: 0, dispatched: 0, grossShortfall: 0, partsShort: 0 });
            }
            const b = customerMap.get(name);
            b.commitment += com;
            b.dispatched += disp;
            b.grossShortfall += Math.max(com - disp, 0);
            if (com > 0 && disp < com) b.partsShort += 1;
        }
        const byCustomer = Array.from(customerMap.values()).map(c => ({
            ...c,
            fillRate: c.commitment > 0 ? Math.round((c.dispatched / c.commitment) * 1000) / 10 : null
        }));

        // ---- New: demandCoverage for the selected month ----
        let customerDemand = 0, demandCommitment = 0, demandDispatched = 0;
        if (month !== "ALL") {
            for (const row of allEntityRows) {
                customerDemand += row.monthlySchedules && Object.prototype.hasOwnProperty.call(row.monthlySchedules, month)
                    ? Number(row.monthlySchedules[month]) : 0;
                demandCommitment += row.monthlyCommitments && Object.prototype.hasOwnProperty.call(row.monthlyCommitments, month)
                    ? Number(row.monthlyCommitments[month]) : 0;
                demandDispatched += row.monthlyDispatches && Object.prototype.hasOwnProperty.call(row.monthlyDispatches, month)
                    ? Number(row.monthlyDispatches[month]) : 0;
            }
        }
        const demandCoverage = month === "ALL" ? null : {
            customerDemand,
            commitment: demandCommitment,
            dispatched: demandDispatched,
            commitmentCoverage: customerDemand > 0 ? Math.round((demandCommitment / customerDemand) * 1000) / 10 : null,
            dispatchVsCustomer: customerDemand > 0 ? Math.round((demandDispatched / customerDemand) * 1000) / 10 : null
        };

                // ---- customer demand for the months around the selected one (dashboard cards) ----
        const demandAround = {};
        if (validMonth) {
            for (let offset = -2; offset <= 1; offset++) {
                const mk = shiftMonthKey(validMonth, offset);
                let total = 0;
                let present = false;
                for (const row of allEntityRows) {
                    if (row.monthlySchedules && Object.prototype.hasOwnProperty.call(row.monthlySchedules, mk)) {
                        total += Number(row.monthlySchedules[mk]) || 0;
                        present = true;
                    }
                }
                demandAround[mk] = { month: mk, label: formatMonthLabel(mk), demand: total, hasData: present };
            }
        }

        // ---- Summary computation (from all entity rows) ----
        let totalA = 0, totalB = 0;
        let partsOnTarget = 0, partsShortfall = 0, partsSurplus = 0;
        let partsNoCommitment = 0, partsUnscheduledDispatch = 0;
        let grossShortfallQty = 0, grossSurplusQty = 0;
        let blankLines = 0, numericLines = 0;

        const rows = [];
        for (const row of allEntityRows) {
            const qtyA = getMetricValue(row, metricA, month);
            const qtyB = getMetricValue(row, metricB, month);

            totalA += qtyA;
            totalB += qtyB;
            const diff = qtyB - qtyA;

            const rawLine = String(row.line || "").trim();
            if (rawLine === "") blankLines++;
            else if (/^\d+$/.test(rawLine)) numericLines++;

            grossShortfallQty += Math.max(qtyA - qtyB, 0);
            grossSurplusQty += Math.max(qtyB - qtyA, 0);
            if (qtyA > 0) {
                if (qtyB >= qtyA) { partsOnTarget++; if (qtyB > qtyA) partsSurplus++; }
                else partsShortfall++;
            } else if (qtyB > 0) {
                partsUnscheduledDispatch++;
            } else {
                partsNoCommitment++;
            }

            const qtySchedule = getMetricValue(row, "schedule", month);
            const qtyCommitment = getMetricValue(row, "commitment", month);
            const qtyDispatch = getMetricValue(row, "dispatch", month);
            if (qtyA === 0 && qtyB === 0 && qtySchedule === 0) continue;

            const fulfillmentRate = qtyA > 0 ? (qtyB / qtyA) * 100 : null;
            let status = diff < 0 ? "shortfall" : diff > 0 ? "surplus" : "fulfilled";
            if (qtyA <= 0 && qtyB > 0) status = "unscheduled";

            rows.push({
                customer: row.customer || row.customerCode || "Unknown",
                customerCode: row.customerCode || "",
                partNo: row.partNo || "-",
                customerPartNo: row.customerPartNo || "-",
                productDescription: row.productDescription || "-",
                line: row.line || "-",
                qtyA,
                qtyB,
                qtySchedule,
                qtyCommitment,
                qtyDispatch,
                diff,
                fulfillmentRate,
                status
            });
        }

        rows.sort((a, b) => a.diff - b.diff);
        const netDiff = totalB - totalA;
        const overallFulfillmentRate = totalA > 0 ? (totalB / totalA) * 100 : (totalB >= 0 ? 100 : 0);
        const monthLabel = formatMonthLabel(month);

        const partsTotal = allEntityRows.length;

        let takeaway = "";
        if (rows.length === 0) {
            takeaway = `No data found comparing ${labelA} vs ${labelB} for ${monthLabel}.`;
        } else if (partsShortfall === 0 && partsUnscheduledDispatch === 0) {
            takeaway = `100% fulfilled! ${labelB} completely met or exceeded ${labelA} (${formatNumberEn(totalB)} of ${formatNumberEn(totalA)} units) across all ${partsTotal} parts for ${monthLabel}.`;
        } else {
            takeaway = `${labelB} achieved ${overallFulfillmentRate.toFixed(1)}% of ${labelA} (${formatNumberEn(totalB)} of ${formatNumberEn(totalA)} units) for ${monthLabel}. ${partsShortfall} parts experienced shortfalls totaling ${formatNumberEn(grossShortfallQty)} units.`;
        }
        if (demandCoverage && demandCoverage.customerDemand > 0) {
            takeaway += ` Customers actually asked for ${formatNumberEn(demandCoverage.customerDemand)} units: IFB committed ${demandCoverage.commitmentCoverage}% of that and shipped ${demandCoverage.dispatchVsCustomer}%.`;
        }

        const dataQuality = {
            blankLines,
            numericLines,
            duplicateKeys,
            unscheduledDispatchParts: partsUnscheduledDispatch
        };

        return {
            status: "available",
            mode: "metrics",
            sheet: {
                snapshotId: targetSnap.snapshotId,
                source: targetSnap.source || "Current Sheet",
                date: targetSnap.snapshotDate || targetSnap.capturedAt?.slice(0, 10) || ""
            },
            metricA,
            metricB,
            labelA,
            labelB,
            month,
            monthLabel,
            monthlyTrend,
            availableYears,
            trendYear: activeYear,
            byLine,
            byCustomer,
            demandAround,
            demandCoverage,
            dataQuality,
            summary: {
                totalA, totalB, netDiff, fulfillmentRate: overallFulfillmentRate,
                partsTotal, partsOnTarget, partsFulfilled: partsOnTarget,
                partsShortfall, partsSurplus, partsNoCommitment, partsUnscheduledDispatch,
                shortfallQty: grossShortfallQty, grossShortfallQty,
                surplusQty: grossSurplusQty, grossSurplusQty,
                takeaway
            },
            rows
        };
    }
}

function getSnapshotComparisonMeta(snapshots, snapshotId) {
    if (!snapshots || snapshots.length === 0) {
        return {
            snapshots: [],
            availableMonths: [],
            availableCustomers: [],
            availableMetrics: [
                { id: "schedule", label: "Customer Schedule" },
                { id: "commitment", label: "Company Commitment" },
                { id: "dispatch", label: "Actual Dispatch" },
                { id: "production", label: "Actual Production" },
                { id: "originalSchedule", label: "Original Customer Schedule" }
            ]
        };
    }

    const snapshotList = snapshots.map((s, idx) => {
        const months = new Set();
        (s.rows || []).forEach(r => {
            if (r.monthlySchedules) {
                Object.keys(r.monthlySchedules).forEach(m => months.add(m));
            }
            const dm = normalizeMonth(r.deliveryMonth);
            if (dm) months.add(dm);
        });
        return {
            snapshotId: s.snapshotId || `snap-${idx}`,
            source: s.source || `Excel upload #${idx + 1}`,
            date: s.snapshotDate || s.capturedAt?.slice(0, 10) || "",
            rowCount: (s.rows || []).length,
            months: Array.from(months).sort()
        };
    });

    let targetSnap = snapshotId ? snapshots.find(s => s.snapshotId === snapshotId) : snapshots[snapshots.length - 1];
    if (!targetSnap && snapshots.length > 0) targetSnap = snapshots[snapshots.length - 1];

    const months = new Set();
    const customers = new Set();
    const parts = new Map();
    const pairs = new Map();
    if (targetSnap) {
        (targetSnap.rows || []).forEach(r => {
            if (r.monthlySchedules) {
                Object.keys(r.monthlySchedules).forEach(m => months.add(m));
            }
            const dm = normalizeMonth(r.deliveryMonth);
            if (dm) months.add(dm);
            const cust = r.customerGroup || r.customer || r.customerCode;
            if (cust) customers.add(cust);
            if (r.partNo && !parts.has(r.partNo)) parts.set(r.partNo, r.productDescription || "");
            if (cust && r.partNo) {
                const pairKey = `${cust}||${r.partNo}`;
                if (!pairs.has(pairKey)) {
                    pairs.set(pairKey, {
                        customer: cust,
                        partNo: r.partNo,
                        customerPartNo: r.customerPartNo || "",
                        line: String(r.line || "").trim(),
                        description: String(r.productDescription || "").trim()
                    });
                }
            }
        });
    }

    const allMonths = new Set();
    const allCustomers = new Set();
    snapshots.forEach(s => {
        (s.rows || []).forEach(r => {
            if (r.monthlySchedules) {
                Object.keys(r.monthlySchedules).forEach(m => allMonths.add(m));
            }
            const dm = normalizeMonth(r.deliveryMonth);
            if (dm) allMonths.add(dm);
            const cust = r.customerGroup || r.customer || r.customerCode;
            if (cust) allCustomers.add(cust);
        });
    });

    return {
        snapshots: snapshotList,
        currentSnapshotId: targetSnap?.snapshotId || "",
        availableMonths: Array.from(months).sort(),
        availableCustomers: Array.from(customers).sort(),
        availableParts: Array.from(parts, ([partNo, description]) => ({ partNo, description })).sort((a, b) => a.partNo.localeCompare(b.partNo)),
        availablePairs: Array.from(pairs.values()),
        allMonths: Array.from(allMonths).sort(),
        allCustomers: Array.from(allCustomers).sort(),
        availableMetrics: [
            { id: "schedule", label: "Customer Schedule" },
            { id: "commitment", label: "Company Commitment" },
            { id: "dispatch", label: "Actual Dispatch" },
            { id: "production", label: "Actual Production" },
            { id: "originalSchedule", label: "Original Customer Schedule" }
        ]
    };
}

module.exports = {
    calculateScheduleAnalytics,
    calculateDemandRevisionWape,
    calculateOnTime,
    getDemandSnapshotTimeline,
    compareWithinSameSheet,
    getSnapshotComparisonMeta
};
