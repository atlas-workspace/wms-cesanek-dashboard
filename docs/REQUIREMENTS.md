# Cesanek WMS Dashboard — v2 Architecture & Requirements

## Scope
- Tenant: LT
- Facility: LT_F21 / Cesanek
- Timezone: America/New_York
- Real WMS API data only; no mock/demo/fabricated operational records.
- Username/password IAM login only; server-side proxy for all WMS API calls.

## v2 Architecture: Independent Modules

Each tab operates as an independent module with its own:
- Constants (prefixed per module: `OVERVIEW_*`, `SLA_MODULE_*`, etc.)
- Data fetching logic and error handling
- Component state (no shared mutable state between tabs)
- Error boundary (module-level; one tab failure does not crash others)

Modules MUST NOT share mutable constants. If one module fails, remaining modules continue functioning.

---

## TAB 1: SLA MONITORING (`/dashboard/sla`)

**Purpose:** Proactive visibility into open orders needing attention before SLA failure.

**Data scope:**
- Last 90 days (3 months). No `createdTimeFrom` in WMS query (unsupported); client-side filter enforced.
- Statuses: Imported, Committed, Planned, Picked, Packed, Loaded ONLY.
- Excludes: Shipped, Cancelled, Completed, Delivered, Closed.
- Constants: `SLA_MODULE_STATUSES` — independent from Overview.

**Columns:** Customer Name, RN (from WISE), DN/Order # (from WISE), Load Number, PO/Reference, Type (Inbound/Outbound), Created Date, SLA Deadline, SLA Status, Appointment Date, Appointment Status, Carrier, Pallet Count, Weight.

**SLA calculation:**
- SLA = Created Date + 48 hours.
- Display primarily in days: `2.4 Days Remaining`, `1.8 Days Remaining`.
- Under 4 hours: show hours. Under 1 hour: critical. Past due: `1.3 Days Past Due`.
- If appointment exists: show appointment-based status instead of creation SLA.

**Appointment-aware logic:**
- Appointment >1h future: "X Days/h to Appt" (green)
- Appointment within 1h: "Appt in Xm" (yellow)
- Appointment passed >1h: "Missed (Xh/Xd ago)" (red)
- No appointment: use createdTime + 48h SLA

**Colors:** Green = healthy, Yellow = approaching (<4h), Red = critical/overdue. Text/badges only — NO red row backgrounds.

**Sort:** Oldest created date to newest (ASC) for follow-up/cancellation cleanup.

**Filters:** Status multi-select, Customer (searchable), RN, DN, Carrier, Orders per page (25/50/75/100, default 50).

**KPI cards:** Total Open, Scheduled, Approaching SLA (<4h), Critical (<1h), Out of SLA, Missing Appointments.

**Appointment editing:** Click field to edit inline. Session draft override unless verified WMS mutation exists.

**Expandable detail panel:** Click row to open side panel with Customer Info, Order Info (RN, DN, Load, PO), Product Info (SKU, qty, weight, pallets), Shipping Info (carrier, ship-to, appointment), and actions (Edit Appointment, Send Notification).

---

## TAB 2: APPOINTMENTS (`/dashboard/missed-appointments`)

**Purpose:** Track missed appointments, pending appointments, carrier performance, customer impact.

**KPI cards:** Total Missed, Missed %, Late Arrivals, On-Time %, Worst Carrier, Most Impacted Customer.

**Graphs (executive scorecard style, high-contrast on dark bg):**
1. Missed Appointments by Carrier — horizontal bar, full-width first, carrier names readable, count + percentage.
2. Missed Appointments by Customer — horizontal bar, top 10.
3. Monthly Missed Appointment Trend — line graph, 90-day range, trend indicator.
4. Appointment Status Breakdown — donut: Missed, In Progress, Complete.
5. Average Days Overdue by Carrier — table-style with avg/longest/total.

**Table columns:** Customer, RN, DN, Appointment Type, Inbound/Outbound, Carrier, Scheduled Date, Time Since Missed, Status.

**Status colors:** Missed = red text, In Progress = yellow text, Complete = green text. Background remains dark.

**Filters:** Customer, Carrier, RN, DN, Appointment Date, Status, Inbound/Outbound.

**Drill-down:** Click carrier/customer chart bar to filter table. Active filter chip with clear button.

**Export:** CSV, Print/PDF.

---

## TAB 3: NOTIFICATIONS (`/dashboard/notifications`)

**Purpose:** Customer and carrier communication automation.

**Recipient types:** Customer Communications, Carrier Communications (separate dropdown).

**Templates:** Missed Appointment, Reschedule Request, 1 Hour Reminder, Reschedule Required — for both Customer and Carrier.

**Variables:** Customer Name, Carrier Name, RN, DN, Load Number, Appointment Date/Time, User Name, Facility Location.

**Order context selector:** Searchable dropdown populated from real WMS orders; auto-fills template variables.

**Signature:** Erin Cambra, Account Manager, 175 Cesanek Rd., Northampton, PA 18067.

**Recipient management:** Add/remove contacts (customer vs carrier type), session-persisted. Default: erin.cambra@unisco.com.

**Safe workflow:** Open Email Draft / Copy Draft buttons. No auto-send unless verified endpoint exists.

---

## OVERVIEW TAB (`/dashboard`) — LOCKED BASELINE

**DO NOT REGRESS.** Uses `OVERVIEW_*` constants, completely independent from SLA/Appointments modules.

- 21 open operational statuses selected by default (shows "Status: 21 selected").
- No date restriction — includes current and older open orders.
- Load All Orders (up to 1500), Refresh, Previous/Next pagination.
- Customer search, multi-select status filter, appointment filter.
- SLA createdTime + 48h with urgency-based sorting.
- Inline appointment add/edit (session draft).
- Expandable order detail slide-out panel.

---

## Design Standards

- Dark/black dashboard background throughout.
- Green = healthy/complete/scheduled, Yellow = approaching/in-progress, Red = critical/missed/overdue.
- No red/yellow table row backgrounds — text and badges only.
- Readable fonts on standard monitors.
- Module-level error boundaries prevent cross-tab failures.

## Persistence
- GitHub: `atlas-workspace/wms-cesanek-dashboard`
- `.env.local` and secrets never committed.
