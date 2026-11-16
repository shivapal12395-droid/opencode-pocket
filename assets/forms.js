import { escapeHtml } from "./markdown.js";

/**
 * Forms are how the server asks a question mid-turn (the `question` tool, plus
 * external fields). The shapes here mirror packages/schema: Form.Info,
 * Form.Field (string | number | integer | boolean | multiselect | external) and
 * Form.When (a visibility condition).
 *
 * The markup is deliberately plain: chips for choices, a text field for free
 * answers, and a hidden/shown rule re-evaluated from the DOM so typing is never
 * interrupted by a re-render.
 */

const condHolds = (cond, values) => {
  const current = values[cond.key];
  const equal = Array.isArray(current) ? current.includes(cond.value) : current === cond.value;
  return cond.op === "neq" ? !equal : equal;
};

export const fieldVisible = (field, values) => (field.when ?? []).every((c) => condHolds(c, values));

const defaultValues = (form) => {
  const values = {};
  for (const f of form.fields ?? []) {
    if (f.default !== undefined) values[f.key] = f.default;
  }
  return values;
};

export function visibleFields(form, values) {
  return (form.fields ?? []).filter((f) => !f.hidden && fieldVisible(f, values));
}

const optionLabel = (field, value) =>
  (field.options ?? []).find((o) => String(o.value) === String(value))?.label ?? String(value);

function chips(field, { multi }) {
  const picked = new Set(
    (multi ? field.default ?? [] : [field.default]).filter((v) => v !== undefined && v !== null).map((v) => String(v))
  );
  return `
    <div class="form-options" data-multi="${multi ? "1" : "0"}">
      ${(field.options ?? [])
        .map(
          (o) => `<button type="button" class="opt" data-pick="${escapeHtml(field.key)}" data-value="${escapeHtml(
            String(o.value)
          )}" aria-pressed="${picked.has(String(o.value))}">
          <span class="opt-label">${escapeHtml(o.label)}</span>
          ${o.description ? `<span class="opt-sub">${escapeHtml(o.description)}</span>` : ""}
        </button>`
        )
        .join("")}
    </div>`;
}

function fieldBody(field) {
  if (field.type === "multiselect") {
    return `${chips(field, { multi: true })}${
      field.custom
        ? `<input class="input form-custom" data-custom="${escapeHtml(field.key)}" placeholder="Something else" spellcheck="false">`
        : ""
    }`;
  }

  if (field.type === "string" && field.options?.length) {
    return `${chips(field, { multi: false })}${
      field.custom
        ? `<input class="input form-custom" data-custom="${escapeHtml(field.key)}" placeholder="Or type your own" spellcheck="false">`
        : ""
    }`;
  }

  if (field.type === "boolean") {
    const yes = field.default === true;
    const no = field.default === false;
    return `<div class="form-options" data-multi="0">
      <button type="button" class="opt" data-pick="${escapeHtml(field.key)}" data-value="true" aria-pressed="${yes}">Yes</button>
      <button type="button" class="opt" data-pick="${escapeHtml(field.key)}" data-value="false" aria-pressed="${no}">No</button>
    </div>`;
  }

  if (field.type === "external") {
    return `<a class="btn btn-ghost form-external" href="${escapeHtml(field.url)}" target="_blank" rel="noreferrer">Open
      <span class="muted">${escapeHtml(field.url)}</span></a>`;
  }

  const inputType =
    field.type === "number" || field.type === "integer"
      ? "number"
      : field.format === "date"
        ? "date"
        : field.format === "date-time"
          ? "datetime-local"
          : field.format === "email"
            ? "email"
            : field.format === "uri"
              ? "url"
              : "text";

  const attrs = [
    `class="input form-input"`,
    `data-value-for="${escapeHtml(field.key)}"`,
    `type="${inputType}"`,
    field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : "",
    field.default != null ? `value="${escapeHtml(String(field.default))}"` : "",
    field.type === "integer" ? `step="1"` : field.type === "number" ? `step="any"` : "",
    field.minLength != null ? `minlength="${field.minLength}"` : "",
    field.maxLength != null ? `maxlength="${field.maxLength}"` : "",
    `spellcheck="false"`,
  ]
    .filter(Boolean)
    .join(" ");

  return `<input ${attrs}>`;
}

export function formCardHtml(form, { status = "pending", answer = null, compact = false } = {}) {
  const fields = (form.fields ?? []).filter((f) => !f.hidden);
  const title = form.title || "The agent needs an answer";

  if (status === "answered") {
    const show = (field, value) => {
      if (typeof value === "boolean") return value ? "Yes" : "No";
      if (Array.isArray(value)) return value.map((v) => optionLabel(field ?? {}, v)).join(", ");
      const option = optionLabel(field ?? {}, value);
      return option;
    };
    const parts = Object.entries(answer ?? {})
      .map(([key, value]) => {
        const field = fields.find((f) => f.key === key);
        return `${escapeHtml(field?.title ?? key)}: ${escapeHtml(show(field, value))}`;
      })
      .filter(Boolean);
    return `<div class="form-card answered" data-form="${escapeHtml(form.id)}">
      <div class="form-head">${escapeHtml(title)}</div>
      <div class="form-answer">${parts.length ? parts.join(" · ") : "Answered"}</div>
    </div>`;
  }

  if (status === "cancelled") {
    return `<div class="form-card cancelled" data-form="${escapeHtml(form.id)}">
      <div class="form-head">${escapeHtml(title)}</div>
      <div class="form-answer">Dismissed</div>
    </div>`;
  }

  // Fields whose `when` does not hold must start out hidden, or a form looks
  // like it is asking two questions when it is asking one.
  const initial = defaultValues(form);

  return `<div class="form-card" data-form="${escapeHtml(form.id)}" data-session="${escapeHtml(form.sessionID ?? "")}">
    <div class="form-head">${escapeHtml(title)}</div>
    ${
      compact
        ? ""
        : fields
            .map(
              (f) => `<div class="form-field" data-key="${escapeHtml(f.key)}" data-type="${escapeHtml(f.type)}"${
                fieldVisible(f, initial) ? "" : " hidden"
              }>
                <div class="form-label">${escapeHtml(f.title || f.key)}${
                  f.required ? `<span class="req">*</span>` : ""
                }</div>
                ${f.description ? `<div class="form-sub">${escapeHtml(f.description)}</div>` : ""}
                ${fieldBody(f)}
              </div>`
            )
            .join("")
    }
    <div class="form-actions">
      <button class="btn btn-primary" data-form-submit="${escapeHtml(form.id)}">Send answer</button>
      <button class="btn btn-ghost" data-form-cancel="${escapeHtml(form.id)}">Dismiss</button>
    </div>
  </div>`;
}

/** Current value per field, read from the live DOM inside `root`. */
export function readFormValues(root, form) {
  const values = {};
  for (const field of form.fields ?? []) {
    const card = root.querySelector(`.form-field[data-key="${CSS.escape(field.key)}"]`);
    if (!card) continue;

    if (field.type === "multiselect") {
      const picked = [...card.querySelectorAll(`.opt[aria-pressed="true"]`)].map((b) => b.dataset.value);
      const custom = card.querySelector(".form-custom")?.value?.trim();
      values[field.key] = custom ? [...picked, custom] : picked;
    } else if (field.type === "boolean") {
      const on = card.querySelector(`.opt[aria-pressed="true"]`);
      if (on) values[field.key] = on.dataset.value === "true";
    } else if (field.type === "external") {
      continue;
    } else if (card.querySelector(".opt")) {
      const on = card.querySelector(`.opt[aria-pressed="true"]`);
      const custom = card.querySelector(".form-custom")?.value?.trim();
      if (custom) values[field.key] = custom;
      else if (on) values[field.key] = on.dataset.value;
    } else {
      const input = card.querySelector(".form-input");
      if (!input) continue;
      const raw = input.value.trim();
      if (!raw) continue;
      values[field.key] = field.type === "number" || field.type === "integer" ? Number(raw) : raw;
    }
  }
  return values;
}

/** Hide the fields whose `when` condition no longer holds, without re-rendering. */
export function applyFormConditions(root, form) {
  const values = readFormValues(root, form);
  for (const field of form.fields ?? []) {
    const card = root.querySelector(`.form-field[data-key="${CSS.escape(field.key)}"]`);
    if (card) card.hidden = !fieldVisible(field, values);
  }
}

export function missingRequired(root, form) {
  const values = readFormValues(root, form);
  for (const field of visibleFields(form, values)) {
    if (!field.required || field.type === "external") continue;
    const v = values[field.key];
    if (v === undefined || (Array.isArray(v) && !v.length) || v === "") return field;
  }
  return null;
}

/** The answer body for POST .../form/{id}/reply — { answer: { key: value } }. */
export function buildAnswer(root, form) {
  const values = readFormValues(root, form);
  const answer = {};
  for (const field of visibleFields(form, values)) {
    if (field.type === "external") continue;
    const v = values[field.key];
    if (v === undefined) continue;
    if (Array.isArray(v) && !v.length) continue;
    answer[field.key] = v;
  }
  return answer;
}