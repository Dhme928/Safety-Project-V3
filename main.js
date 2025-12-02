// js/main.js
// CAT HSE Incident Hub – Dashboard logic
// Reads a published Google Sheet CSV and populates the dashboard.

(function () {
  "use strict";

  // Published CSV URL (from your Google Sheet -> File -> Share -> Publish to web -> CSV)
  const SHEET_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vSDmya03LSq6UP-hBpgu-RLr681T4uwobVDb-GrPv8tlFcIQPJRlsEiaYOLK580FlZN7HuCLmeYc6mm/pub?output=csv";

  // Column keys used in the Google Sheet header row.
  // For best results, keep your sheet headers exactly equal to these keys.
  const COLUMN_HEADERS = {
    reportNumber: "reportNumber",
    date: "eventDate",
    type: "eventType",
    location: "countryYard",
    project: "projectClient",
    severity: "potentialSeverity",
    status: "status"
  };

  let allReports = [];
  let filteredReports = [];

  document.addEventListener("DOMContentLoaded", function () {
    initFilters();
    fetchAndRender();
  });

  function initFilters() {
    const form = document.getElementById("filters-form");
    const resetBtn = document.getElementById("filters-reset");
    const downloadBtn = document.getElementById("download-csv");

    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        applyFilters();
      });
    }

    if (resetBtn && form) {
      resetBtn.addEventListener("click", function () {
        form.reset();
        filteredReports = allReports.slice();
        renderTable(filteredReports);
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener("click", handleDownloadCsv);
    }
  }

  function fetchAndRender() {
    showPlaceholder("Loading reports…");

    fetch(SHEET_CSV_URL)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to load CSV");
        }
        return response.text();
      })
      .then(function (text) {
        allReports = parseCsv(text);
        filteredReports = allReports.slice();
        updateStats(allReports);
        renderTable(filteredReports);
      })
      .catch(function (error) {
        console.error("Error loading CSV:", error);
        showPlaceholder("Could not load reports. Please check the Google Sheet or network.");
      });
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(function (line) {
      return line.trim().length > 0;
    });

    if (!lines.length) return [];

    const rawHeaders = splitCsvLine(lines[0]).map(function (h) {
      return h.trim();
    });

    const result = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const cells = splitCsvLine(line);
      const raw = {};

      rawHeaders.forEach(function (header, idx) {
        const value = cells[idx] || "";
        raw[header] = value.replace(/^"|"$/g, "").trim();
      });

      const incident = mapRowToIncident(raw);
      result.push(incident);
    }

    return result;
  }

  // Simple CSV line splitter that respects quoted commas
  function splitCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        inQuotes = !inQuotes;
        current += ch;
      } else if (ch === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }

    if (current !== "") {
      result.push(current);
    }

    return result;
  }

  function mapRowToIncident(raw) {
    const dateStr = raw[COLUMN_HEADERS.date] || raw["eventDate"] || "";
    let dateObj = null;

    if (dateStr) {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        dateObj = parsed;
      }
    }

    return {
      raw: raw,
      reportNumber: raw[COLUMN_HEADERS.reportNumber] || raw["reportNumber"] || "",
      date: dateStr,
      dateObj: dateObj,
      type: raw[COLUMN_HEADERS.type] || raw["eventType"] || "",
      location: raw[COLUMN_HEADERS.location] || raw["countryYard"] || "",
      project: raw[COLUMN_HEADERS.project] || raw["projectClient"] || "",
      severity: raw[COLUMN_HEADERS.severity] || raw["potentialSeverity"] || "",
      status: raw[COLUMN_HEADERS.status] || raw["status"] || ""
    };
  }

  function updateStats(reports) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let incidents = 0;
    let nearMisses = 0;
    let openActions = 0;

    reports.forEach(function (r) {
      if (!r.dateObj) return;

      const sameMonth =
        r.dateObj.getFullYear() === currentYear && r.dateObj.getMonth() === currentMonth;

      if (sameMonth) {
        const t = (r.type || "").toLowerCase();
        if (t.includes("near")) {
          nearMisses++;
        } else if (t) {
          incidents++;
        }
      }

      const status = (r.status || "").toLowerCase();
      if (status.includes("open") || status.includes("pending") || status.includes("under")) {
        openActions++;
      }
    });

    const elIncidents = document.getElementById("stat-incidents");
    const elNearMiss = document.getElementById("stat-near-misses");
    const elOpenActions = document.getElementById("stat-open-actions");

    if (elIncidents) elIncidents.textContent = incidents;
    if (elNearMiss) elNearMiss.textContent = nearMisses;
    if (elOpenActions) elOpenActions.textContent = openActions;
  }

  function applyFilters() {
    const form = document.getElementById("filters-form");
    if (!form) return;

    const fromDateValue = form.elements["fromDate"].value;
    const toDateValue = form.elements["toDate"].value;
    const locationValue = form.elements["location"].value.trim().toLowerCase();
    const typeValue = form.elements["type"].value;
    const severityValue = form.elements["severity"].value;
    const statusValue = form.elements["status"].value;

    let fromDate = null;
    let toDate = null;

    if (fromDateValue) {
      const d = new Date(fromDateValue);
      if (!isNaN(d.getTime())) fromDate = d;
    }

    if (toDateValue) {
      const d = new Date(toDateValue);
      if (!isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        toDate = d;
      }
    }

    filteredReports = allReports.filter(function (r) {
      if (fromDate && r.dateObj && r.dateObj < fromDate) {
        return false;
      }
      if (toDate && r.dateObj && r.dateObj > toDate) {
        return false;
      }

      if (locationValue) {
        const loc = (r.location || "").toLowerCase();
        if (!loc.includes(locationValue)) return false;
      }

      if (typeValue) {
        if ((r.type || "").toLowerCase() !== typeValue.toLowerCase()) return false;
      }

      if (severityValue) {
        if ((r.severity || "").toLowerCase() !== severityValue.toLowerCase()) return false;
      }

      if (statusValue) {
        if ((r.status || "").toLowerCase() !== statusValue.toLowerCase()) return false;
      }

      return true;
    });

    renderTable(filteredReports);
  }

  function renderTable(reports) {
    const tbody = document.getElementById("reports-table-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!reports.length) {
      showPlaceholder("No reports match the current filters.");
      return;
    }

    const sorted = reports.slice().sort(function (a, b) {
      if (!a.dateObj || !b.dateObj) return 0;
      return b.dateObj - a.dateObj;
    });

    sorted.forEach(function (r) {
      const tr = document.createElement("tr");

      tr.appendChild(createCell(r.date || ""));
      tr.appendChild(createCell(r.type || ""));
      tr.appendChild(createCell(r.location || ""));
      tr.appendChild(createCell(r.severity || ""));

      const statusCell = document.createElement("td");
      statusCell.textContent = r.status || "";
      statusCell.title = r.status || "";
      tr.appendChild(statusCell);

      const actionsCell = document.createElement("td");
      const link = document.createElement("a");
      const reportNumber = r.reportNumber || "";
      link.textContent = reportNumber ? "View / Edit" : "View";
      link.href = "report.html" + (reportNumber ? "?reportNumber=" + encodeURIComponent(reportNumber) : "");
      link.className = "btn btn--ghost btn--sm";
      actionsCell.appendChild(link);
      tr.appendChild(actionsCell);

      tbody.appendChild(tr);
    });
  }

  function createCell(text) {
    const td = document.createElement("td");
    td.textContent = text || "";
    return td;
  }

  function handleDownloadCsv() {
    const source = filteredReports.length ? filteredReports : allReports;
    if (!source.length) {
      alert("No data available to download yet.");
      return;
    }

    const headers = Object.keys(source[0].raw || {});
    if (!headers.length) {
      alert("No header row detected in the data.");
      return;
    }

    const lines = [];
    lines.push(headers.map(escapeCsvValue).join(","));

    source.forEach(function (r) {
      const row = headers.map(function (h) {
        return escapeCsvValue((r.raw && r.raw[h]) || "");
      });
      lines.push(row.join(","));
    });

    const csvContent = lines.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "cat-hse-incidents-filtered.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function escapeCsvValue(value) {
    const str = String(value == null ? "" : value);
    if (/[",\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function showPlaceholder(message) {
    const tbody = document.getElementById("reports-table-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    const tr = document.createElement("tr");
    tr.className = "table-placeholder";

    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = message;

    tr.appendChild(td);
    tbody.appendChild(tr);
  }
})();