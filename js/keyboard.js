// スマホ用の PC 風キーボード
import { icon } from './icons.js';

// 特殊キー: [ラベル, キー名, 幅]
const EXTRA = [['Tab', 'TAB'], ['←', 'LEFT'], ['→', 'RIGHT'], ['↑', 'UP'], ['↓', 'DOWN'], ['貼付', 'PASTE'], ['あ', 'OSKB'], [icon('kb-hide'), 'HIDE']];

const LAYOUTS = {
  abc: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '-'],
    [['⇧', 'SHIFT', 1.5], 'z', 'x', 'c', 'v', 'b', 'n', 'm', [icon('backspace'), 'BS', 1.5]],
  ],
  // 数字と記号 (Git でよく使うものだけ)
  sym: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '_', '=', '+', '~', '|', '\\', ':', ';', "'"],
    ['!', '@', '#', '$', '^', '{', '}', '?', '`', [icon('backspace'), 'BS', 1.5]],
  ],
};
const BOTTOM = {
  abc: [['123#', 'SYM', 1.5], ['"', '"'], ['/', '/'], ['space', ' ', 4], ['.', '.'], ['⏎', 'ENTER', 2]],
  sym: [['abc', 'ABC', 1.5], ['"', '"'], ['/', '/'], ['space', ' ', 4], ['.', '.'], ['⏎', 'ENTER', 2]],
};

export function createKeyboard(el, { onText, onKey }) {
  let layer = 'abc';
  let shift = false;
  let repeat = null;

  const keyHtml = (k) => {
    const [label, name, w] = Array.isArray(k) ? k : [k, k, 1];
    const cls = name.length > 1 && !/^\W$/.test(name) ? ' fn' : '';
    const text = !Array.isArray(k) && shift && layer === 'abc' ? label.toUpperCase() : label;
    return `<button type="button" class="kb-key${cls}${name === 'SHIFT' && shift ? ' on' : ''}${name === 'ENTER' ? ' enter' : ''}" data-k="${name.replace(/"/g, '&quot;')}" style="flex:${w || 1}">${text}</button>`;
  };

  function render() {
    el.innerHTML = `<div class="kb-row kb-extra">${EXTRA.map(keyHtml).join('')}</div>`
      + LAYOUTS[layer].map((r) => `<div class="kb-row">${r.map(keyHtml).join('')}</div>`).join('')
      + `<div class="kb-row">${BOTTOM[layer].map(keyHtml).join('')}</div>`;
  }

  function press(name) {
    if (name === 'SHIFT') { shift = !shift; render(); return; }
    if (name === 'SYM') { layer = 'sym'; render(); return; }
    if (name === 'ABC') { layer = 'abc'; render(); return; }
    if (name.length === 1) {
      onText(shift && layer === 'abc' ? name.toUpperCase() : name);
      if (shift) { shift = false; render(); }
      return;
    }
    onKey(name);
  }

  const stop = () => { clearTimeout(repeat); clearInterval(repeat); repeat = null; };
  el.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.kb-key');
    if (!b) return;
    e.preventDefault(); // 入力欄のフォーカスを保つ
    b.classList.add('down');
    const name = b.dataset.k;
    press(name);
    if (['BS', 'LEFT', 'RIGHT'].includes(name)) {
      repeat = setTimeout(() => { repeat = setInterval(() => press(name), 60); }, 400);
    }
  });
  const up = () => { stop(); el.querySelectorAll('.down').forEach((b) => b.classList.remove('down')); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
  render();
}
