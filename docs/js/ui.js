// Toasts and modal dialogs (replacements for console.hud_alert / input_alert / list_dialog).

let toastTimer = null;

export function toast(msg, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = kind; }, kind === 'error' ? 1800 : 1200);
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...children.filter((c) => c != null));
  return el;
}

// Generic modal: build(dialog, close) fills it; resolves with whatever close() receives (null on Esc).
function modal(build) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dlg' });
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(null); }); // backdrop
    const body = h('div', { class: 'dlg-body' }); // padding lives here so backdrop clicks hit only <dialog>
    build(body, close);
    dlg.append(body);
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('[autofocus]')?.focus();
  });
}

const buttons = (...btns) => h('div', { class: 'dlg-buttons' }, ...btns);

export function promptDialog({ title, message = '', value = '', ok = 'OK', placeholder = '' }) {
  return modal((dlg, close) => {
    const input = h('input', { type: 'text', value, placeholder, autofocus: '', autocomplete: 'off', spellcheck: 'false' });
    const form = h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); close(input.value); } },
      h('h3', {}, title),
      message ? h('p', {}, message) : null,
      input,
      buttons(
        h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn primary' }, ok),
      ));
    dlg.append(form);
    setTimeout(() => input.select(), 0);
  });
}

export function confirmDialog({ title, message = '', ok = 'OK', danger = false }) {
  return modal((dlg, close) => {
    dlg.append(
      h('h3', {}, title),
      message ? h('p', {}, message) : null,
      buttons(
        h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, 'Cancel'),
        h('button', { type: 'button', class: `btn ${danger ? 'danger' : 'primary'}`, autofocus: '', onclick: () => close(true) }, ok),
      ));
  }).then((v) => v === true);
}

export function alertDialog({ title, message = '', ok = 'OK' }) {
  return modal((dlg, close) => {
    dlg.append(
      h('h3', {}, title),
      message ? h('p', {}, message) : null,
      buttons(h('button', { type: 'button', class: 'btn primary', autofocus: '', onclick: () => close(true) }, ok)));
  });
}

// items: [{label, value, sub?}]; onDelete(value) -> Promise<boolean> removes a row when it resolves true.
export function listDialog({ title, items, onDelete = null, empty = 'Nothing here' }) {
  return modal((dlg, close) => {
    const list = h('ul', { class: 'dlg-list' });
    const render = () => {
      list.replaceChildren(...(items.length ? items.map((it) => h('li', {},
        h('button', { type: 'button', class: 'dlg-item', onclick: () => close(it.value) },
          h('span', {}, it.label), it.sub ? h('small', {}, it.sub) : null),
        onDelete ? h('button', {
          type: 'button', class: 'dlg-del', 'aria-label': `Delete ${it.label}`,
          onclick: async () => {
            if (await onDelete(it.value)) { items = items.filter((x) => x !== it); render(); }
          },
        }, 'Delete') : null,
      )) : [h('li', { class: 'dlg-empty' }, empty)]));
    };
    render();
    dlg.append(h('h3', {}, title), list,
      buttons(h('button', { type: 'button', class: 'btn', autofocus: '', onclick: () => close(null) }, 'Close')));
  });
}

export const isDialogOpen = () => !!document.querySelector('dialog[open]');
