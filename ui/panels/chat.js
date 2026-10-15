// The chat with the agent: a button in the zoom bar opens a panel. A message goes to the agent through the
// project's chat.json and the same watcher the comments use; the answer appears here. The panel says what is
// happening to an unanswered message (the agent has it, or nobody is watching) so it never looks stuck.
// Messages are shown as text only.

import { h, icon } from '../core/dom.js';

// What the person has sent since the agent last spoke.
const unanswered = (messages) => {
  let last = -1;
  messages.forEach((m, i) => m.role === 'agent' && (last = i));
  return messages.slice(last + 1).filter((m) => m.role === 'user');
};

export function createChat({ button, panel }, { send }) {
  button.innerHTML = icon.chat;
  const list = h('div', { class: 'chat__list', role: 'log', 'aria-live': 'polite' });
  const status = h('p', { class: 'chat__status', role: 'status' });
  const input = h('textarea', { class: 'chat__input', rows: 1, placeholder: 'Ask for a change…', 'aria-label': 'Message to the agent' });
  const submit = h('button', { class: 'note-pop__send', type: 'button', disabled: true }, 'Send');
  panel.replaceChildren(
    h('header', { class: 'chat__head' }, h('strong', null, 'Chat with the agent'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close chat', onclick: () => set(false), html: icon.close })),
    list,
    status,
    h('div', { class: 'chat__form' }, input, submit),
  );

  let messages = [];
  let watching = false;
  let sending = false;

  function paint() {
    list.replaceChildren(...messages.map((m) => h('div', { class: `chat__msg chat__msg--${m.role}` }, m.text)));
    list.scrollTop = list.scrollHeight;
    const waiting = unanswered(messages).length;
    status.dataset.state = !waiting ? '' : watching ? 'work' : 'idle';
    status.textContent = !messages.length
      ? 'Ask for a change. It reaches the agent in your coding session.'
      : !waiting
        ? ''
        : watching
          ? 'The agent is on it…'
          : 'Nobody is watching · ask the agent, or run: npx framery watch';
  }

  async function go() {
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    submit.disabled = true;
    try {
      await send(text);
      input.value = '';
      input.style.height = '';
    } catch (error) {
      status.dataset.state = 'idle';
      status.textContent = error.message;
    }
    sending = false;
    submit.disabled = !input.value.trim();
  }

  submit.addEventListener('click', go);
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    submit.disabled = sending || !input.value.trim();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) (event.preventDefault(), go());
  });

  const set = (open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-pressed', String(open));
    if (open) (paint(), input.focus());
  };
  button.addEventListener('click', () => set(panel.hidden));
  panel.addEventListener('keydown', (event) => event.key === 'Escape' && (event.stopPropagation(), set(false), button.focus()));

  return {
    show(next, isWatching) {
      messages = next;
      watching = isWatching;
      if (!panel.hidden) paint();
    },
    isOpen: () => !panel.hidden,
  };
}
