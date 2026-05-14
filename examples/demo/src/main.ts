import { Informe, color, date, datetime, input, type ChangeRecord, type InformeValue } from 'informe';
import 'informe/style.css';
import './style.css';

const informe = new Informe({
  name: input({ label: 'Full name', default: 'Bob', required: true }),
  age: input({ type: 'number', default: 50, min: 1, max: 99 }),
  accent: color({
    label: 'Accent color',
    default: '#FF8C00',
    options: [
      { label: 'Red', value: '#FF0000' },
      { label: 'Blue', value: '#0000FF' },
      { label: 'Green', value: '#00AA00' },
    ],
  }),
  birthday: date({
    label: 'Date of birth',
    default: '1990-01-01',
    max: '2026-05-05',
  }),
  meeting: datetime({
    label: 'Meeting time',
    default: '2026-05-05T09:30',
  }),
  food: input({ description: 'What is your favorite food?' }),
  email: input({
    label: 'Email address',
    description: 'Where should we send updates?',
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  }),
});
(window as any).informe = informe;
console.log(informe);

const editorElement = document.querySelector<HTMLElement>('#editor');
const outputElement = document.querySelector<HTMLPreElement>('#output');

if (!editorElement || !outputElement) {
  throw new Error('Demo markup is missing required elements.');
}

const output = outputElement;
let lastInputChanges: ChangeRecord[] = [];

function renderOutput(informe: Informe): void {
  output.textContent = JSON.stringify(
    {
      value: Object.fromEntries(informe),
      rawEntries: informe.rawEntries(),
      lastInputChanges,
    },
    null,
    2,
  );
}

informe.addEventListener('input', (event) => {
  lastInputChanges = event.detail.changes;
  renderOutput(event.detail.informe);
});
informe.addEventListener('change', (event) => {
  renderOutput(event.detail.informe);
});

informe.mount(editorElement);
renderOutput(informe);
informe.focus();

const resetButton = document.querySelector<HTMLButtonElement>('#reset');
resetButton?.addEventListener('click', () => {
  informe.reset();
});

const clearButton = document.querySelector<HTMLButtonElement>('#clear');
clearButton?.addEventListener('click', () => {
  informe.clear();
});

const appendButton = document.querySelector<HTMLButtonElement>('#append');
appendButton?.addEventListener('click', () => {
  informe.append('age', Math.floor(Math.random() * 100));
});

const setButton = document.querySelector<HTMLButtonElement>('#set');
setButton?.addEventListener('click', () => {
  informe.set('food', 'Pizza');
});
