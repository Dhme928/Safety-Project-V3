// js/report.js
// Handles the incident/near-miss form: local draft + submit to Apps Script.
// Also supports basic edit mode when opened with ?reportNumber=...

(function () {
  "use strict";

  const DRAFT_KEY_BASE = "cat-hse-incident-draft";
  const APPS_SCRIPT_ENDPOINT =
    "https://script.google.com/macros/s/AKfycbz4a3UJtxYIqxj9QRr5shA0z4dsOHApkHd5ny7z6pkENGTNOJv8taEVN70cHJtHK2XC/exec";

  // Same CSV URL used on the dashboard
  const SHEET_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vSDmya03LSq6UP-hBpgu-RLr681T4uwobVDb-GrPv8tlFcIQPJRlsEiaYOLK580FlZN7HuCLmeYc6mm/pub?output=csv";

  let isEditMode = false;
  let editingReportNumber = null;
  let draftKey = DRAFT_KEY_BASE + "-new";

  document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("incident-form");
    if (!form) return;

    const params = new URLSearchParams(window.location.search);
    const reportNumberParam = params.get("reportNumber");

    if (reportNumberParam) {
      isEditMode = true;
      editingReportNumber = reportNumberParam;
      draftKey = DRAFT_KEY_BASE + "-" + reportNumberParam;
      applyEditModeUi(reportNumberParam);
      loadReportForEdit(form, reportNumberParam);
    } else {
      draftKey = DRAFT_KEY_BASE + "-new";
      restoreDraft(form);
      // Pre-fill today's date for convenience
      const dateField = form.elements["eventDate"];
      if (dateField && !dateField.value) {
        dateField.value = new Date().toISOString().slice(0, 10);
      }
    }

    const saveDraftBtn = document.getElementById("save-draft");
    const clearDraftBtn = document.getElementById("clear-draft");

    if (saveDraftBtn) {
      saveDraftBtn.addEventListener("click", function (event) {
        event.preventDefault();
        const draftData = collectFormData(form, { includeMeta: false });
        try {
          localStorage.setItem(draftKey, JSON.stringify(draftData));
          alert("Draft saved on this browser.");
        } catch (error) {
          console.error("Could not save draft:", error);
          alert("Could not save draft (storage full or disabled).");
        }
      });
    }

    if (clearDraftBtn) {
      clearDraftBtn.addEventListener("click", function (event) {
        event.preventDefault();
        if (!confirm("Clear all fields and remove local draft?")) return;
        localStorage.removeItem(draftKey);
        form.reset();
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      handleSubmit(form);
    });
  });

  function applyEditModeUi(reportNumber) {
    const title = document.getElementById("form-title");
    const subtitle = document.getElementById("form-subtitle");
    const submitBtn = document.getElementById("submit-btn");

    if (title) {
      title.textContent = "Edit near miss / incident";
    }
    if (subtitle) {
      subtitle.textContent = "Updating report #" + reportNumber + ". Ensure changes reflect the actual event.";
    }
    if (submitBtn) {
      submitBtn.textContent = "Update report";
    }
  }

  function restoreDraft(form) {
    try {
      const stored = localStorage.getItem(draftKey);
      if (!stored) return;
      const data = JSON.parse(stored);
      Object.keys(data).forEach(function (key) {
        applyValueToField(form, key, data[key]);
      });
    } catch (error) {
      console.warn("Could not restore draft:", error);
    }
  }

  function loadReportForEdit(form, reportNumber) {
    fetch(SHEET_CSV_URL)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to load existing reports");
        }
        return response.text();
      })
      .then(function (text) {
        const records = parseCsv(text);
        const match = records.find(function (row) {
          return (row.reportNumber || row["reportNumber"] || row["Report Number"]) === reportNumber;
        });

        if (!match) {
          alert("Could not find this report in the data. You can still edit and resubmit.");
          restoreDraft(form);
          return;
        }

        Object.keys(match).forEach(function (key) {
          if (key === "__raw") return;
          applyValueToField(form, key, match[key]);
        });
      })
      .catch(function (error) {
        console.error("Failed to load report for edit:", error);
        alert("Could not load existing report details. You can still edit and resubmit.");
        restoreDraft(form);
      });
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(function (line) {
      return line.trim().length > 0;
    });

    if (!lines.length) return [];

    const headers = splitCsvLine(lines[0]).map(function (h) {
      return h.trim();
    });

    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const cells = splitCsvLine(line);
      const row = {};

      headers.forEach(function (header, idx) {
        const value = cells[idx] || "";
        row[header] = value.replace(/^"|"$/g, "").trim();
      });

      if (row["reportNumber"] && !row.reportNumber) {
        row.reportNumber = row["reportNumber"];
      }
      if (row["Report Number"] && !row.reportNumber) {
        row.reportNumber = row["Report Number"];
      }

      records.push(row);
    }

    return records;
  }

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

  function collectFormData(form, options) {
    options = options || {};
    const includeMeta = options.includeMeta !== false;

    const formData = new FormData(form);
    const payload = {};

    formData.forEach(function (value, key) {
      if (payload[key] === undefined) {
        payload[key] = value;
      } else if (Array.isArray(payload[key])) {
        payload[key].push(value);
      } else {
        payload[key] = [payload[key], value];
      }
    });

    // Convert arrays (checkbox groups) to pipe-separated strings
    Object.keys(payload).forEach(function (key) {
      if (Array.isArray(payload[key])) {
        payload[key] = payload[key].join(" | ");
      }
    });

    if (isEditMode && editingReportNumber) {
      payload.reportNumber = editingReportNumber;
    }

    if (!payload.status) {
      payload.status = "Open";
    }

    if (includeMeta) {
      payload.mode = isEditMode ? "update" : "create";
      payload.submittedAt = new Date().toISOString();
    }

    return payload;
  }

  function applyValueToField(form, name, value) {
    if (value == null || value === "") return;

    const field = form.elements[name];
    if (!field) return;

    const fieldType = field.type || (field[0] && field[0].type);

    if (!fieldType) return;

    if (fieldType === "checkbox" || fieldType === "radio" || field.length) {
      const values = String(value)
        .split("|")
        .map(function (v) {
          return v.trim();
        });
      const items = field.length ? Array.prototype.slice.call(field) : [field];
      items.forEach(function (el) {
        if (el.type === "checkbox" || el.type === "radio") {
          el.checked = values.indexOf(el.value) !== -1;
        }
      });
    } else {
      field.value = value;
    }
  }

  function handleSubmit(form) {
    const payload = collectFormData(form, { includeMeta: true });

    if (!APPS_SCRIPT_ENDPOINT) {
      console.log("Form data preview:", payload);
      alert("Form is not connected to Google Sheets. Please set APPS_SCRIPT_ENDPOINT in js/report.js.");
      return;
    }

    fetch(APPS_SCRIPT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        return response.json().catch(function () {
          return {};
        });
      })
      .then(function () {
        alert(isEditMode ? "Report updated successfully." : "Report submitted successfully.");
        try {
          localStorage.removeItem(draftKey);
        } catch (error) {
          console.warn("Could not clear draft:", error);
        }
        form.reset();

        if (!isEditMode) {
          const dateField = form.elements["eventDate"];
          if (dateField) {
            dateField.value = new Date().toISOString().slice(0, 10);
          }
        }
      })
      .catch(function (error) {
        console.error("Failed to submit form:", error);
        alert("Could not submit the report. Please try again or inform HSE admin.");
      });
  }
})();