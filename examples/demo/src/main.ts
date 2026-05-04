import { Informe, input, type InformeValue } from 'informe';
import 'informe/style.css';
import './style.css';

const fields = {
  name: input({ label: 'Full name', default: 'Bob', required: true }),
  age: input({ type: 'number', default: 50, min: 1, max: 99 }),
  food: input({ description: 'What is your favorite food?' }),
  email: input({
    label: 'Email address',
    description: 'Where should we send updates?',
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  }),
  color: input({
    label: 'Favorite color',
    description: 'A CSS color name or hex value.',
  }),
};

const editorElement = document.querySelector<HTMLElement>('#editor');
const outputElement = document.querySelector<HTMLPreElement>('#output');

if (!editorElement || !outputElement) {
  throw new Error('Demo markup is missing required elements.');
}

const output = outputElement;

function renderOutput(value: InformeValue<typeof fields>): void {
  output.textContent = JSON.stringify(value, null, 2);
}

function getOutputValue(
  informe: Informe<typeof fields>,
): InformeValue<typeof fields> {
  return Object.fromEntries(informe) as InformeValue<typeof fields>;
}

const informe = new Informe(fields);
informe.addEventListener('change', (event) => {
  renderOutput(getOutputValue(event.detail.informe));
});

informe.mount(editorElement);
renderOutput(getOutputValue(informe));
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
