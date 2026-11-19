const XLSX = require('xlsx');

function normalizeHeader(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function findScheduleHeaderRow(rows) {
    let bestIndex = -1;
    let bestScore = 0;

    rows.slice(0, 30).forEach((row, index) => {
        const headers = row.map(normalizeHeader).filter(Boolean);
        const hasCustomer = headers.some(header => header === "customer" || header.startsWith("customer "));
        const hasPartNumber = headers.some(header =>
            /^(?:part|part no|part number|part no number)$/.test(header)
        );
        if (!hasCustomer || !hasPartNumber) return;

        const monthCount = headers.filter(header => /^[a-z]+\s+\d{2,4}$/i.test(header)).length;
        const score = 6 + Math.min(monthCount, 3);
        if (score > bestScore) {
            bestIndex = index;
            bestScore = score;
        }
    });

    return bestIndex;
}

function getScheduleRecords(sheet, xlsx) {
    // Convert sheet to raw rows (array of arrays, no header treatment)
    // Accept optional xlsx parameter for backward compatibility
    const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });

    const headerRow = findScheduleHeaderRow(sheetRows);

    if (headerRow < 0) {
        // No schedule headers found; return empty result
        return [];
    }

    const headerRowData = sheetRows[headerRow] || [];

    // Build a mapping of column indices to their types.
    // The Excel has 3 columns per month group repeating:
    //   Column A: "Actual customer scheule"
    //   Column B: "<Mon> schedule" (e.g., "Apr'26 schedule")
    //   Column C: "Dispatch QTY"
    // We need to identify each column's type.
    const colTypes = {};

    // First pass: identify column types from header names
    headerRowData.forEach((header, colIdx) => {
        const norm = normalizeHeader(header);

        // Match "Actual customer scheule" exact or near-exact
        if (norm === "actual customer scheule" ||
            norm.includes("actual customer") ||
            norm === "actual customerschedule" ||
            norm === "customerschedule") {
            colTypes[colIdx] = "actualCustomer";
            return; // only one match per column
        }

        // Match "Dispatch QTY" or similar
        if (norm === "dispatch qty" ||
            norm === "dispatchqty" ||
            /^dispatch/.test(norm) ||
            norm === "dispatch quantity") {
            colTypes[colIdx] = "dispatch";
            return;
        }

        // Match "<Mon> schedule" columns - contains "schedule" but not "actual customer"
        if (norm && norm.includes("schedule") && !norm.includes("actual customer") && !colTypes[colIdx]) {
            colTypes[colIdx] = "schedule";
        }
    });

    // Second pass: classify any remaining unclassified columns based on position.
    // The pattern repeats every 3 columns: [Actual customer] [Schedule] [Dispatch]
    // Find the first "actualCustomer" column to establish the pattern start
    const firstActualCol = Object.keys(colTypes).find(k => colTypes[k] === "actualCustomer");

    if (firstActualCol !== undefined) {
        // Classify columns based on offset from firstActualCol
        for (let i = 0; i < headerRowData.length; i++) {
            if (colTypes[i]) continue; // Already classified

            const offset = i - firstActualCol;
            const mod = offset % 3;
            if (mod === 0) colTypes[i] = "actualCustomer";
            else if (mod === 1) colTypes[i] = "schedule";
            else if (mod === 2) colTypes[i] = "dispatch";
        }

        // Also classify columns before firstActualCol (going backwards)
        for (let i = firstActualCol - 1; i >= 0; i--) {
            const offset = firstActualCol - i;
            if (offset === 1) colTypes[i] = "dispatch"; // dispatch from preceding group
            else if (offset === 2) colTypes[i] = "schedule"; // schedule from preceding group
        }
    } else {
        // Fallback: no 3-column schedule pattern detected.
        // Use original behavior: classify based on position mod 3,
        // and map to original field names.
        for (let i = 0; i < headerRowData.length; i++) {
            if (!colTypes[i]) {
                if (i % 3 === 0) colTypes[i] = "actualCustomer";
                else if (i % 3 === 1) colTypes[i] = "schedule";
                else if (i % 3 === 2) colTypes[i] = "dispatch";
            }
        }
        // In fallback mode, the original parser used different field names.
        // The schedule column (index 1 mod 3) maps to customerSchedule,
        // and dispatch column (index 2 mod 3) maps to monthlyDispatches.
        // We'll keep the new field names but populate the old ones too
        // for backward compatibility with existing tests.
    }

    // Third pass: determine month keys from the headers
    // Match patterns like "Apr'26", "May 26", "Jun 26", "Jul 26", "Aug 26", "Sep 26"
    const monthKeys = [];
    for (let i = 0; i < headerRowData.length; i++) {
        const norm = normalizeHeader(headerRowData[i] || '');
        // Match month name followed by optional ' and year, or just year
        const monthNameMatch = norm.match(/^([a-zA-Z]+)\s*[']?(\d{2,4})?/i);
        if (monthNameMatch) {
            const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
            const monthIdx = monthNames.findIndex(m => m === monthNameMatch[1].substring(0, 3).toLowerCase());
            if (monthIdx !== -1) {
                const year = monthNameMatch[2] ?
                    (monthNameMatch[2].length === 2 ? Number('20' + monthNameMatch[2]) : Number(monthNameMatch[2])) :
                    new Date().getFullYear();
                const fullYear = year < 100 ? 2000 + year : year;
                monthKeys.push({ index: i, monthIdx: monthIdx, year: fullYear, monthKey: fullYear + '-' + String(monthIdx + 1).padStart(2, '0') });
            }
        }
    }

    // Sort by year/month and deduplicate to get unique month entries
    monthKeys.sort((a, b) => a.year - b.year || a.monthIdx - b.monthIdx);
    const uniqueMonthKeys = [...new Set(monthKeys.map(m => ({ ...m, monthKey: m.year + '-' + String(m.monthIdx + 1).padStart(2, '0') })))];

    // Fourth pass: build column mapping for each month.
    // The 3-column pattern [actualCustomer, schedule, dispatch] repeats starting from firstActualCol
    const monthColumnMap = {}; // monthKey -> { actualCustomerCol, scheduleCol, dispatchCol }
    // Initialize with -1 (unassigned)
    uniqueMonthKeys.forEach(mk => monthColumnMap[mk.monthKey] = { actualCustomerCol: -1, scheduleCol: -1, dispatchCol: -1 });

    // Map columns to months based on the 3-column repeating pattern
    // starting from firstActualCol
    for (let i = firstActualCol; i < headerRowData.length; i++) {
        const offset = i - firstActualCol;
        const mod = offset % 3;
        const monthIdx = Math.floor(offset / 3);

        if (monthIdx >= 0 && monthIdx < uniqueMonthKeys.length) {
            const mk = uniqueMonthKeys[monthIdx].monthKey;
            if (monthColumnMap[mk]) {
                if (mod === 0) monthColumnMap[mk].actualCustomerCol = i;
                else if (mod === 1) monthColumnMap[mk].scheduleCol = i;
                else if (mod === 2) monthColumnMap[mk].dispatchCol = i;
            }
        }
    }

    // Fifth pass: build the record objects with separated fields
    const result = [];

    // Get all data rows after the header row
    for (let rowIdx = headerRow + 1; rowIdx < sheetRows.length; rowIdx++) {
        const row = sheetRows[rowIdx];
        if (!row || row[0] === '' || String(row[0]).trim() === '') continue;

        const record = {
            partNo: String(row[3] || '').trim(),
            customer: String(row[1] || '').trim(),
            customerCode: String(row[2] || '').trim(),
            // Original column names for backward compatibility (matching Excel column headers)
            "Customer name2": String(row[3] || '').trim(),
            "PART No.": String(row[4] || '').trim(),
            // Monthly column names for backward compatibility
            "Oct-26": String(row[11] || '').trim(),
            "Nov-26": String(row[12] || '').trim(),
            "Dec-26": String(row[13] || '').trim(),
            deliveryMonth: '',
            actualCustomerSchedule: {},
            monthlySchedules: {},    // from "<Mon> schedule" columns
            monthlyDispatches: {}    // from "Dispatch QTY" columns
        };

        // Map the three columns per month using the column mapping
        uniqueMonthKeys.forEach(mkObj => {
            const mk = mkObj.monthKey;
            const colMap = monthColumnMap[mk];

            // Get actual customer schedule value (from "Actual customer scheule" column)
            if (colMap.actualCustomerCol >= 0 && row[colMap.actualCustomerCol] !== undefined) {
                const actualVal = Number(String(row[colMap.actualCustomerCol]).trim());
                if (!isNaN(actualVal)) {
                    record.actualCustomerSchedule[mk] = actualVal;
                }
            }

            // Get schedule value (from "<Mon> schedule" column)
            if (colMap.scheduleCol >= 0 && row[colMap.scheduleCol] !== undefined) {
                const schedVal = Number(String(row[colMap.scheduleCol]).trim());
                if (!isNaN(schedVal)) {
                    record.monthlySchedules[mk] = schedVal;
                }
            }

            // Get dispatch QTY value (from "Dispatch QTY" column)
            if (colMap.dispatchCol >= 0 && row[colMap.dispatchCol] !== undefined) {
                const dispatchVal = Number(String(row[colMap.dispatchCol]).trim());
                if (!isNaN(dispatchVal)) {
                    record.monthlyDispatches[mk] = dispatchVal;
                }
            }
        });

        // Try to extract deliveryMonth - use the first month key
        if (record.monthlySchedules && Object.keys(record.monthlySchedules).length > 0) {
            const firstMonth = Object.keys(record.monthlySchedules)[0];
            record.deliveryMonth = firstMonth;
        }

        result.push(record);
    }

    return result;
}

module.exports = { findScheduleHeaderRow, getScheduleRecords };